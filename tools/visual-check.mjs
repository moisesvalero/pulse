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

/**
 * Canvas region with nothing on top of it.
 *
 * Brightness comparisons run here. Two things dilute a measurement of the shader:
 * the panels (opaque enough to hide it) and the scrim gradient, which is nearly
 * opaque at the top and bottom edges. The side margin beside the panels, at mid
 * height, is the one band where the plain shader output is what reaches the
 * screen.
 */
async function measureCanvasFreeOfUi(page) {
	const box = await page.locator('canvas').boundingBox();
	if (!box) {
		fail('The visualiser canvas was not found.');
		return { x: 0, y: 0, width: 180, height: 400 };
	}

	return {
		x: Math.round(box.x + box.width * 0.02),
		y: Math.round(box.y + box.height * 0.3),
		width: Math.round(Math.max(80, box.width * 0.13)),
		height: Math.round(box.height * 0.4)
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

			// Heading levels must not be skipped (h1 -> h3 with no h2).
			let previous = 0;
			for (const level of levels) {
				if (previous !== 0 && level > previous + 1) {
					issues.push(`heading level jumped from h${previous} to h${level}`);
				}
				previous = level;
			}

			return issues;
		})
	);

	/*
	 * WCAG contrast of every text element against the surface it sits on.
	 *
	 * The panel is translucent over the WebGL canvas, so the true background moves
	 * with the shader. This composites the *declared* colours (walking up the
	 * ancestors and blending each alpha over the void base) which is the stable,
	 * checkable part; the scrim and the near-opaque panels are what keep the real
	 * values close to it.
	 */
	record(
		'contrastRatios',
		await page.evaluate(() => {
			/*
			 * Resolves any CSS colour to sRGB bytes by painting it and reading the
			 * pixel back. A regex over `rgb()` would miss `color-mix()`, `oklab()` and
			 * every other modern syntax, and the step cells are painted with
			 * `color-mix()`, which silently made the audit report 1.00:1.
			 */
			const probe = document.createElement('canvas');
			probe.width = 1;
			probe.height = 1;
			const probeContext = probe.getContext('2d', { willReadFrequently: true });

			const parse = (value) => {
				if (!value || !probeContext) return null;
				if (value === 'transparent' || value === 'rgba(0, 0, 0, 0)') {
					return { r: 0, g: 0, b: 0, a: 0 };
				}

				probeContext.clearRect(0, 0, 1, 1);
				probeContext.fillStyle = '#000000';
				probeContext.fillStyle = value;
				probeContext.fillRect(0, 0, 1, 1);

				const [r, g, b, a] = probeContext.getImageData(0, 0, 1, 1).data;
				return { r, g, b, a: a / 255 };
			};

			const over = (top, bottom) => ({
				r: top.r * top.a + bottom.r * (1 - top.a),
				g: top.g * top.a + bottom.g * (1 - top.a),
				b: top.b * top.a + bottom.b * (1 - top.a),
				a: 1
			});

			const luminance = ({ r, g, b }) => {
				const channel = (value) => {
					const scaled = value / 255;
					return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
				};
				return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
			};

			const contrast = (a, b) => {
				const first = luminance(a);
				const second = luminance(b);
				return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
			};

			/** Effective background of an element, walking ancestors upwards. */
			const background = (element) => {
				const layers = [];
				let node = element;
				while (node instanceof HTMLElement) {
					const parsed = parse(getComputedStyle(node).backgroundColor);
					if (parsed && parsed.a > 0) layers.push(parsed);
					node = node.parentElement;
				}

				let composited = { r: 4, g: 5, b: 10, a: 1 }; // --color-void
				for (const layer of layers.reverse()) composited = over(layer, composited);
				return composited;
			};

			const failures = [];
			const samples = {};

			/*
			 * Only elements that own a text node are audited. A <button> whose label
			 * lives in a child <span> would otherwise be measured with the button's
			 * inherited `color` (chalk) instead of the span's, which reported the
			 * dark note labels as 2.5:1 failures that do not exist on screen.
			 */
			const ownsText = (element) =>
				[...element.childNodes].some(
					(node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0
				);

			for (const element of document.querySelectorAll('p, span, label, h1, h2, h3, output, div'))
			{
				if (!ownsText(element)) continue;

				const text = element.textContent?.trim();
				if (!text) continue;

				const style = getComputedStyle(element);
				const foreground = parse(style.color);
				if (!foreground || foreground.a === 0) continue;

				const size = Number.parseFloat(style.fontSize);
				const bold = Number.parseInt(style.fontWeight, 10) >= 700;
				// WCAG "large text": >= 18.66px bold, or >= 24px.
				const large = size >= 24 || (bold && size >= 18.66);
				const required = large ? 3 : 4.5;

				const ratio = contrast(over(foreground, { r: 0, g: 0, b: 0, a: 0 }), background(element));
				if (ratio < required) {
					failures.push(
						`"${text.slice(0, 24)}" ${ratio.toFixed(2)}:1 (needs ${required}:1 at ${size}px)`
					);
				}

				const key = `${style.color} on ${Math.round(size)}px`;
				if (!samples[key] || ratio < samples[key]) samples[key] = Number(ratio.toFixed(2));
			}

			return { failures, samples };
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

		// 12 frames over ~3 s: the tunnel swings by ~30% frame to frame and a whole
		// bar takes 2.2 s at 110 BPM, so a short burst cannot tell a shader change
		// apart from the animation. Averaging over more than one bar can.
		const freeClip = await measureCanvasFreeOfUi(page);
		const litFrames = await sampleCanvasFrames(page, freeClip, 12, 250);
		record('meanBrightnessPlaying', await meanBrightness(page, litFrames));

		// A/B on the same page, the same audio and the same pattern: emulate the
		// preference, let the shader pick up the change, and measure again. Comparing
		// two separate browser contexts would have mixed in different patterns and
		// different audio levels, which is exactly the noise this avoids.
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.waitForTimeout(500);
		const reducedFrames = await sampleCanvasFrames(page, freeClip, 12, 250);
		record('meanBrightnessReducedMotion', await meanBrightness(page, reducedFrames));
		// `u_intensity` drops to 0.3, so the shader contribution should fall by
		// roughly two thirds. 0.75 leaves room for the animation noise while still
		// failing loudly if the uniform stops reaching the shader — which is exactly
		// the bug this check exists to catch.
		record(
			'reducedMotionDimsVisuals',
			(results.meanBrightnessReducedMotion?.mean ?? Infinity) <
				(results.meanBrightnessPlaying?.mean ?? 0) * 0.75
		);
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.waitForTimeout(300);

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

		const darkFrames = await sampleCanvasFrames(page, freeClip, 6, 200);
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
