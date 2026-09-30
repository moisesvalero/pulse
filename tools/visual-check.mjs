#!/usr/bin/env node
/**
 * Visual, audio and runtime verification for Pulse.
 *
 * Loads the built site in headless Chromium and drives the real UI: start screen,
 * grid painting, transport, live parameter tweaks, the three visual modes, the
 * performance back-off, a mobile viewport and reduced motion. It fails loudly on
 * any console error, page error or failed request.
 *
 * It also measures the audio graph objectively, which is the closest a machine
 * can get to "does it make sound":
 *   - patches `AudioContext` to count how many contexts get created, proving the
 *     start screen really is the user gesture that unlocks audio
 *   - reads the spectrum meter, which publishes the exact numbers the fragment
 *     shader receives
 *   - compares the mean brightness of canvas frames while playing and while
 *     silent, proving the audio drives the picture
 *   - checks the graph falls to exactly zero once the delay and reverb tails end,
 *     which would catch a stuck oscillator or a DC leak
 *
 * Playwright is intentionally **not** a project dependency: it is a verification
 * tool that the app does not need. The script looks for an existing install in
 * node_modules, then in the npx cache. Run it with:
 *
 *   python3 -m http.server 4173 --directory build   # in one shell
 *   pnpm verify:visual                              # in another
 *
 * Any static server works, but prefer a disk-backed one: `vite preview`
 * snapshots the build directory at startup, so after a rebuild it keeps serving
 * the previous chunk hashes and the page silently fails to hydrate.
 *
 * Environment:
 *   PULSE_URL        base URL of the running preview (default http://localhost:4173)
 *   PULSE_OUT        output directory for screenshots (default ./.verify)
 *   PLAYWRIGHT_PATH  explicit path to a playwright module, if auto-detection fails
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE_URL = process.env.PULSE_URL ?? 'http://localhost:4173';
// `fileURLToPath` (not `URL.pathname`) so spaces in the project path are decoded
// instead of turning into "%20" directory names.
const OUT_DIR = process.env.PULSE_OUT ?? fileURLToPath(new URL('../.verify/', import.meta.url));

const results = {};
const problems = [];

function record(name, value) {
	results[name] = value;
}

function fail(message) {
	problems.push(message);
}

function hash(buffer) {
	return createHash('sha256').update(buffer).digest('hex');
}

/** Finds an importable playwright, preferring an explicit path. */
async function loadPlaywright() {
	const candidates = [];

	if (process.env.PLAYWRIGHT_PATH) candidates.push(process.env.PLAYWRIGHT_PATH);

	const require = createRequire(import.meta.url);
	try {
		candidates.push(require.resolve('playwright'));
	} catch {
		// Not a project dependency: fall through to the npx cache.
	}

	const npxRoot = join(homedir(), '.npm', '_npx');
	try {
		for (const entry of await readdir(npxRoot)) {
			candidates.push(join(npxRoot, entry, 'node_modules', 'playwright', 'index.js'));
		}
	} catch {
		// No npx cache on this machine.
	}

	for (const candidate of candidates) {
		try {
			const module = await import(pathToFileURL(candidate).href);
			const playwright = module.default ?? module;
			if (playwright.chromium) return playwright;
		} catch {
			// Try the next candidate.
		}
	}

	throw new Error(
		'Could not find playwright. Install it (pnpm add -D playwright) or set PLAYWRIGHT_PATH.'
	);
}

function attachDiagnostics(target) {
	target.on('console', (message) => {
		if (message.type() === 'error') fail(`console error: ${message.text()}`);
		if (message.type() === 'warning' && /hydration|a11y/i.test(message.text())) {
			fail(`console warning: ${message.text()}`);
		}
	});
	target.on('pageerror', (error) => fail(`page error: ${error.message}`));
	target.on('requestfailed', (request) =>
		fail(`request failed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`)
	);
}

/**
 * Counts `AudioContext` constructions. Browsers only allow audio to start inside a
 * user gesture, so "zero contexts before the button, one after" is the objective
 * proof that the start screen is doing its job.
 */
async function installAudioContextCounter(page) {
	await page.addInitScript(() => {
		const Original = globalThis.AudioContext;
		globalThis.__pulseAudioContexts = 0;

		if (typeof Original !== 'function') return;

		globalThis.AudioContext = class extends Original {
			constructor(...args) {
				super(...args);
				globalThis.__pulseAudioContexts += 1;
			}
		};
	});
}

async function countAudioContexts(page) {
	return page.evaluate(() => globalThis.__pulseAudioContexts ?? 0);
}

/** Highest level seen per band over `durationMs`, as a percentage. */
async function sampleBandPeaks(page, durationMs) {
	return page.evaluate(async (windowMs) => {
		const peaks = { bass: 0, mid: 0, treble: 0 };
		const started = performance.now();

		while (performance.now() - started < windowMs) {
			for (const element of document.querySelectorAll('[data-band]')) {
				const key = element.dataset.band;
				if (key !== 'bass' && key !== 'mid' && key !== 'treble') continue;
				peaks[key] = Math.max(peaks[key], Number(element.dataset.level ?? 0));
			}
			await new Promise((resolve) => setTimeout(resolve, 40));
		}

		return peaks;
	}, durationMs);
}

/** Current internal resolution multiplier, as published by the meter. */
async function readScale(page) {
	return Number((await page.locator('[data-render-stats]').getAttribute('data-scale')) ?? 1);
}

/** Screenshots the canvas several times, spaced `intervalMs` apart. */
async function sampleCanvasFrames(page, clip, count, intervalMs) {
	const frames = [];
	for (let index = 0; index < count; index += 1) {
		frames.push(await page.screenshot({ clip }));
		if (index < count - 1) await page.waitForTimeout(intervalMs);
	}
	return frames;
}

/**
 * Mean brightness of PNG buffers.
 *
 * Decoding happens *inside the browser*: it already ships a PNG decoder, so no
 * image library is needed here, and `getImageData` is the objective measurement.
 */
async function meanBrightness(page, frames) {
	const values = [];

	for (const frame of frames) {
		values.push(
			await page.evaluate(async (base64) => {
				const image = new Image();
				image.src = `data:image/png;base64,${base64}`;
				await image.decode();

				const scratch = document.createElement('canvas');
				scratch.width = image.width;
				scratch.height = image.height;

				const context = scratch.getContext('2d');
				if (!context) return 0;

				context.drawImage(image, 0, 0);
				const { data } = context.getImageData(0, 0, scratch.width, scratch.height);

				let total = 0;
				for (let index = 0; index < data.length; index += 4) {
					total += data[index] + data[index + 1] + data[index + 2];
				}

				return total / (data.length / 4) / 3;
			}, frame.toString('base64'))
		);
	}

	return {
		mean: values.reduce((sum, value) => sum + value, 0) / values.length,
		samples: values.map((value) => Number(value.toFixed(2)))
	};
}

/** Centre of the canvas: every mode is radial, so that is where the detail is. */
async function measureCanvas(page) {
	const box = await page.locator('canvas').boundingBox();
	if (!box) {
		fail('The visualiser canvas was not found.');
		return { x: 0, y: 0, width: 640, height: 360 };
	}

	const width = Math.round(Math.min(box.width, 820));
	const height = Math.round(Math.min(box.height, 480));

	return {
		x: Math.round(box.x + (box.width - width) / 2),
		y: Math.round(box.y + (box.height - height) / 2),
		width,
		height
	};
}

/** Static accessibility checks that do not need a full axe run. */
async function inspectAccessibility(page) {
	record(
		'accessibleControls',
		await page.evaluate(() => {
			const issues = [];

			for (const button of document.querySelectorAll('button')) {
				const name = button.getAttribute('aria-label') ?? button.textContent.trim();
				if (!name) issues.push('button without an accessible name');
			}

			for (const slider of document.querySelectorAll('input[type="range"]')) {
				const id = slider.getAttribute('id');
				if (!id || !document.querySelector(`label[for="${id}"]`)) {
					issues.push(`slider without a label: ${id ?? '(no id)'}`);
				}
			}

			const levels = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((element) =>
				Number(element.tagName[1])
			);
			if (levels.filter((level) => level === 1).length !== 1) {
				issues.push(`expected exactly one h1, found ${levels.filter((l) => l === 1).length}`);
			}

			return issues;
		})
	);

	record(
		'focusVisibleRulePresent',
		await page.evaluate(() => {
			// Tailwind emits its rules inside `@layer`, so the walk has to recurse
			// instead of only looking at top-level rules.
			const walk = (rules) => {
				for (const rule of rules) {
					if (rule.selectorText?.includes(':focus-visible')) return true;
					if (rule.cssRules && walk(rule.cssRules)) return true;
				}
				return false;
			};

			for (const sheet of document.styleSheets) {
				try {
					if (walk(sheet.cssRules)) return true;
				} catch {
					// Cross-origin sheet; nothing to inspect.
				}
			}

			return false;
		})
	);
}

async function main() {
	const { chromium } = await loadPlaywright();
	await mkdir(OUT_DIR, { recursive: true });

	const browser = await chromium.launch();

	try {
		// --- desktop ---------------------------------------------------------
		const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
		const page = await context.newPage();
		attachDiagnostics(page);
		await installAudioContextCounter(page);

		const response = await page.goto(BASE_URL, { waitUntil: 'networkidle' });
		record('httpStatus', response?.status() ?? null);
		record('title', await page.title());
		record('heading', await page.locator('h1').first().innerText());
		record('cellCount', await page.locator('[data-cell]').count());
		record('initialActiveCells', await page.locator('[data-cell][aria-pressed="true"]').count());

		// --- start screen ----------------------------------------------------
		// Audio must not exist yet: no AudioContext, no playhead, silent meter.
		record('startOverlayVisible', await page.locator('[data-start-overlay]').count());
		record('audioContextsBeforeStart', await countAudioContexts(page));
		record('playheadBeforeStart', await page.locator('[data-playhead]').innerText());
		record('bandsBeforeStart', await sampleBandPeaks(page, 200));
		await page.screenshot({ path: join(OUT_DIR, 'desktop-start.png'), fullPage: true });

		await page.getByRole('button', { name: /Empezar|Reintentar/i }).click();
		await page.waitForTimeout(1300);

		record('startOverlayDismissed', (await page.locator('[data-start-overlay]').count()) === 0);
		record('audioContextsAfterStart', await countAudioContexts(page));
		record('pauseButtonVisible', await page.getByRole('button', { name: /Pausar/i }).count());
		record('playheadText', await page.locator('[data-playhead]').innerText());

		// --- WebGL canvas ---------------------------------------------------
		const canvasClip = await measureCanvas(page);

		record(
			'canvasHasWebgl',
			await page.evaluate(() => {
				const element = document.querySelector('canvas');
				return element instanceof HTMLCanvasElement
					? element.getContext('webgl') instanceof WebGLRenderingContext
					: false;
			})
		);
		record(
			'canvasBackingStore',
			await page.evaluate(() => {
				const element = document.querySelector('canvas');
				return element instanceof HTMLCanvasElement
					? { width: element.width, height: element.height }
					: null;
			})
		);

		const firstFrame = await page.screenshot({ clip: canvasClip });
		await page.waitForTimeout(420);
		const secondFrame = await page.screenshot({ clip: canvasClip });
		record('canvasAnimates', hash(firstFrame) !== hash(secondFrame));
		await writeFile(join(OUT_DIR, 'canvas-frame.png'), secondFrame);

		await page.screenshot({ path: join(OUT_DIR, 'desktop-playing.png') });

		// --- grid interaction -----------------------------------------------
		const kickStep2 = page.locator('[data-cell][data-track="kick"][data-step="1"]');
		record('kickStep2Before', await kickStep2.getAttribute('aria-pressed'));
		await kickStep2.click();
		record('kickStep2After', await kickStep2.getAttribute('aria-pressed'));
		await kickStep2.click();
		record('kickStep2Restored', await kickStep2.getAttribute('aria-pressed'));

		const paintStart = await page
			.locator('[data-cell][data-track="pad"][data-step="1"]')
			.boundingBox();
		const paintEnd = await page
			.locator('[data-cell][data-track="pad"][data-step="5"]')
			.boundingBox();

		if (!paintStart || !paintEnd) {
			fail('Could not measure the grid cells for the drag test.');
		} else {
			await page.mouse.move(
				paintStart.x + paintStart.width / 2,
				paintStart.y + paintStart.height / 2
			);
			await page.mouse.down();
			await page.mouse.move(paintEnd.x + paintEnd.width / 2, paintEnd.y + paintEnd.height / 2, {
				steps: 16
			});
			await page.mouse.up();
			record(
				'padActiveAfterDrag',
				await page.locator('[data-cell][data-track="pad"][aria-pressed="true"]').count()
			);
		}

		const bassCell = page.locator('[data-cell][data-track="bass"][data-step="0"]');
		record('bassNoteBefore', await bassCell.getAttribute('aria-label'));
		await bassCell.focus();
		await page.keyboard.press('Shift+Enter');
		record('bassNoteAfter', await bassCell.getAttribute('aria-label'));

		await page.keyboard.press('ArrowRight');
		record(
			'focusAfterArrow',
			await page.evaluate(() => {
				const active = document.activeElement;
				return active instanceof HTMLElement
					? `${active.dataset.track}:${active.dataset.step}`
					: null;
			})
		);

		// --- visual modes ---------------------------------------------------
		// Each mode must compile and draw something different: identical hashes
		// would mean the switcher is cosmetic.
		const modeHashes = {};
		for (const id of ['tunnel', 'ripple', 'particles']) {
			const button = page.locator(`[data-visual-mode="${id}"]`);
			if ((await button.count()) === 0) {
				fail(`Visual mode button "${id}" is missing.`);
				continue;
			}

			await button.click();
			await page.waitForTimeout(500);

			const frame = await page.screenshot({ clip: canvasClip });
			modeHashes[id] = hash(frame).slice(0, 12);
			await writeFile(join(OUT_DIR, `canvas-mode-${id}.png`), frame);
			await page.screenshot({ path: join(OUT_DIR, `mode-${id}-full.png`) });
		}
		record('visualModeHashes', modeHashes);
		record('visualModesAreDistinct', new Set(Object.values(modeHashes)).size === 3);

		// Keyboard shortcut, then back to the default before the audio comparison.
		await page.keyboard.press('2');
		await page.waitForTimeout(200);
		record(
			'modeAfterKey2',
			await page.locator('[data-visual-mode="ripple"]').getAttribute('aria-pressed')
		);
		await page.locator('[data-visual-mode="tunnel"]').click();
		await page.waitForTimeout(300);

		// --- live parameter changes -----------------------------------------
		await page.locator('#control-bpm').fill('150');
		await page.locator('#control-swing').fill('45');
		await page.locator('#control-cutoff').fill('640');
		await page.locator('#control-volumen').fill('0.6');
		await page.waitForTimeout(500);

		const firstReading = await page.locator('[data-playhead]').innerText();
		await page.waitForTimeout(700);
		const secondReading = await page.locator('[data-playhead]').innerText();
		record('playheadDuringLiveTweaks', [firstReading, secondReading]);
		record('transportSurvivedLiveTweaks', firstReading !== secondReading);
		record('bpmAfterTweak', await page.locator('#control-bpm').inputValue());
		record('cutoffAfterTweak', await page.locator('#control-cutoff').inputValue());

		// --- audio actually reaches the shaders ------------------------------
		const peaks = await sampleBandPeaks(page, 2600);
		record('bandPeaksWhilePlaying', peaks);
		record('analyserHasSignal', peaks.bass > 0 || peaks.mid > 0 || peaks.treble > 0);

		const litFrames = await sampleCanvasFrames(page, canvasClip, 4, 130);
		record('meanBrightnessPlaying', await meanBrightness(page, litFrames));

		await page.getByRole('button', { name: /Pausar/i }).click();
		await page.waitForTimeout(150);
		record('playheadAfterPause', await page.locator('[data-playhead]').innerText());

		// Let the delay and reverb tails die out. Measured on this build: the
		// slowest band (bass) decays 100 -> 99 -> 72 -> 42 -> 16 -> 0 over the
		// first 3 s, then stays at exactly 0. 3.4 s leaves margin.
		await page.waitForTimeout(3400);
		const quietPeaks = await sampleBandPeaks(page, 900);
		record('bandPeaksAfterPause', quietPeaks);
		// Reaching exactly zero proves no voice, noise loop or feedback path stays
		// alive (or leaks DC) after the transport stops.
		record(
			'graphFallsSilent',
			quietPeaks.bass === 0 && quietPeaks.mid === 0 && quietPeaks.treble === 0
		);

		const darkFrames = await sampleCanvasFrames(page, canvasClip, 4, 130);
		record('meanBrightnessPaused', await meanBrightness(page, darkFrames));
		record('renderStats', await page.locator('[data-render-stats]').innerText());

		const lit = results.meanBrightnessPlaying?.mean ?? 0;
		const dark = results.meanBrightnessPaused?.mean ?? 0;
		record('audioDrivesVisuals', lit > dark * 1.02);

		// --- performance back-off -------------------------------------------
		// 2560x1440 is enough to push software rasterisation well below the 45 fps
		// target. The controller has to give up internal resolution on its own,
		// with no user action at all.
		record('scaleBeforeLoad', await readScale(page));
		await page.setViewportSize({ width: 2560, height: 1440 });
		await page.waitForTimeout(6000);
		record('renderStatsUnderLoad', await page.locator('[data-render-stats]').innerText());
		const scaleUnderLoad = await readScale(page);
		record('scaleUnderLoad', scaleUnderLoad);
		// Either it gave up resolution under the extra load, or it was already at
		// the floor. Anything else means the controller is not reacting.
		record(
			'resolutionBacksOff',
			scaleUnderLoad < results.scaleBeforeLoad ||
				(results.scaleBeforeLoad === 0.5 && scaleUnderLoad === 0.5)
		);

		await page.setViewportSize({ width: 1440, height: 1024 });
		await page.waitForTimeout(400);
		await page.screenshot({ path: join(OUT_DIR, 'desktop-large-viewport.png') });

		// --- pattern actions -------------------------------------------------
		await page.getByRole('button', { name: /Aleatorio/i }).click();
		await page.waitForTimeout(120);
		record('activeAfterRandomize', await page.locator('[data-cell][aria-pressed="true"]').count());

		await page.getByRole('button', { name: /Limpiar/i }).click();
		await page.waitForTimeout(120);
		record('activeAfterClear', await page.locator('[data-cell][aria-pressed="true"]').count());

		await page.getByRole('button', { name: /Demo/i }).click();
		await page.waitForTimeout(120);
		record('activeAfterDemo', await page.locator('[data-cell][aria-pressed="true"]').count());

		await inspectAccessibility(page);
		await page.screenshot({ path: join(OUT_DIR, 'desktop-randomized.png'), fullPage: true });

		await context.close();

		// --- mobile ---------------------------------------------------------
		const mobile = await browser.newContext({
			viewport: { width: 390, height: 844 },
			deviceScaleFactor: 2,
			hasTouch: true,
			isMobile: true
		});
		const mobilePage = await mobile.newPage();
		attachDiagnostics(mobilePage);
		await mobilePage.goto(BASE_URL, { waitUntil: 'networkidle' });
		await mobilePage.screenshot({ path: join(OUT_DIR, 'mobile-start.png'), fullPage: true });

		await mobilePage.getByRole('button', { name: /Empezar|Reintentar/i }).click();
		await mobilePage.waitForTimeout(1200);
		record(
			'mobileHorizontalOverflow',
			await mobilePage.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
			)
		);
		await mobilePage.screenshot({ path: join(OUT_DIR, 'mobile-studio.png'), fullPage: true });

		// WCAG 2.5.8 (target size, minimum): every interactive control must offer a
		// hit area of at least 24x24 CSS px on a phone.
		record(
			'mobileTouchTargets',
			await mobilePage.evaluate(() => {
				const tooSmall = [];
				// Reported with one decimal: 23.6 rounds to 24 but still fails the rule.
				for (const element of document.querySelectorAll('button, input[type="range"]')) {
					const box = element.getBoundingClientRect();
					if (box.width === 0 && box.height === 0) continue;
					if (box.width < 24 || box.height < 24) {
						tooSmall.push(
							`${element.tagName.toLowerCase()} ${box.width.toFixed(1)}x${box.height.toFixed(1)}`
						);
					}
				}
				return tooSmall;
			})
		);

		// The lane labels must stay pinned while the grid scrolls sideways, or the
		// rows become unlabelled on a narrow screen.
		await mobilePage.evaluate(() => {
			const scroller = document.querySelector('[data-cell]')?.closest('.overflow-x-auto');
			if (scroller) scroller.scrollLeft = 240;
		});
		await mobilePage.waitForTimeout(200);
		record(
			'mobileLaneLabelPinned',
			await mobilePage.evaluate(() => {
				const label = document.querySelector('th[scope="row"]');
				if (!label) return null;
				const box = label.getBoundingClientRect();
				// Still inside the viewport after scrolling 240 px to the right.
				return box.left >= -1 && box.left < 60;
			})
		);
		await mobilePage.screenshot({ path: join(OUT_DIR, 'mobile-scrolled.png') });
		await mobile.close();

		// --- reduced motion -------------------------------------------------
		const reduced = await browser.newContext({
			viewport: { width: 1280, height: 900 },
			reducedMotion: 'reduce'
		});
		const reducedPage = await reduced.newPage();
		attachDiagnostics(reducedPage);
		await reducedPage.goto(BASE_URL, { waitUntil: 'networkidle' });
		record(
			'reducedMotionMatches',
			await reducedPage.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
		);
		// The overlay animation must be collapsed by the global CSS rule.
		record(
			'reducedMotionCollapsesOverlayAnimation',
			await reducedPage.evaluate(() => {
				const overlay = document.querySelector('.overlay');
				if (!overlay) return null;
				return Number.parseFloat(getComputedStyle(overlay).animationDuration) < 0.05;
			})
		);
		await reducedPage.screenshot({ path: join(OUT_DIR, 'reduced-motion.png'), fullPage: true });
		await reduced.close();
	} finally {
		await browser.close();
	}

	record('problems', problems);

	await writeFile(join(OUT_DIR, 'report.json'), `${JSON.stringify(results, null, '\t')}\n`);
	console.log(JSON.stringify(results, null, '\t'));

	if (problems.length > 0) {
		console.error(`\n${problems.length} problem(s) detected.`);
		process.exitCode = 1;
	}
}

await main();
