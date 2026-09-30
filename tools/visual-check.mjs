#!/usr/bin/env node
/**
 * Visual and runtime verification for Pulse.
 *
 * Loads the built site in headless Chromium, drives the real UI (grid painting,
 * transport, drag, mobile viewport, reduced motion) and fails loudly on any
 * console error, page error or failed request.
 *
 * Playwright is intentionally **not** a project dependency: it is a verification
 * tool that the app does not need. The script looks for an existing install in
 * node_modules, then in the npx cache. Run it with:
 *
 *   python3 -m http.server 4173 --directory build   # in one shell
 *   node tools/visual-check.mjs                     # in another
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

/** Highest level seen per band over `durationMs`, as a percentage. */
async function sampleBandPeaks(page, durationMs) {
	return page.evaluate(async (window) => {
		const peaks = { bass: 0, mid: 0, treble: 0 };
		const started = performance.now();

		while (performance.now() - started < window) {
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

async function main() {
	const { chromium } = await loadPlaywright();
	await mkdir(OUT_DIR, { recursive: true });

	const browser = await chromium.launch();

	try {
		// --- desktop ---------------------------------------------------------
		const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
		const page = await context.newPage();
		attachDiagnostics(page);

		const response = await page.goto(BASE_URL, { waitUntil: 'networkidle' });
		record('httpStatus', response?.status() ?? null);
		record('title', await page.title());
		record('heading', await page.locator('h1').innerText());

		// Every lane and step must be rendered and addressable.
		record('cellCount', await page.locator('[data-cell]').count());
		record('initialActiveCells', await page.locator('[data-cell][aria-pressed="true"]').count());

		await page.screenshot({ path: join(OUT_DIR, 'desktop-idle.png'), fullPage: true });

		// --- WebGL canvas ---------------------------------------------------
		// Two clipped frames of the canvas: identical bytes would mean the
		// shader is not running (or the CSS fallback is showing).
		const canvasBox = await page.locator('canvas').boundingBox();
		// Kept in the outer scope: the audio-reactivity check below reuses it.
		// Centred on the canvas: every mode is radial, so the interesting pixels are
		// around the middle, not in the top-left corner.
		const clipSize = { width: 820, height: 480 };
		const canvasClip = canvasBox
			? {
					x: Math.round(canvasBox.x + (canvasBox.width - clipSize.width) / 2),
					y: Math.round(canvasBox.y + (canvasBox.height - clipSize.height) / 2),
					width: Math.round(Math.min(canvasBox.width, clipSize.width)),
					height: Math.round(Math.min(canvasBox.height, clipSize.height))
				}
			: { x: 0, y: 0, width: 640, height: 360 };

		if (!canvasBox) {
			fail('The visualiser canvas was not found.');
		} else {
			record('canvasHasWebgl', await page.evaluate(() => {
				const element = document.querySelector('canvas');
				return element instanceof HTMLCanvasElement
					? element.getContext('webgl') instanceof WebGLRenderingContext
					: false;
			}));
			record('canvasBackingStore', await page.evaluate(() => {
				const element = document.querySelector('canvas');
				return element instanceof HTMLCanvasElement
					? { width: element.width, height: element.height }
					: null;
			}));

			const first = await page.screenshot({ clip: canvasClip });
			await page.waitForTimeout(420);
			const second = await page.screenshot({ clip: canvasClip });

			record('canvasAnimates', hash(first) !== hash(second));
			record('canvasFrameBytes', first.length);
			await writeFile(join(OUT_DIR, 'canvas-frame.png'), second);
		}

		// --- grid interaction -----------------------------------------------
		const kickStep2 = page.locator('[data-cell][data-track="kick"][data-step="1"]');
		record('kickStep2Before', await kickStep2.getAttribute('aria-pressed'));
		await kickStep2.click();
		record('kickStep2After', await kickStep2.getAttribute('aria-pressed'));
		await kickStep2.click();
		record('kickStep2Restored', await kickStep2.getAttribute('aria-pressed'));

		// Drag painting across one lane.
		const paintStart = await page
			.locator('[data-cell][data-track="pad"][data-step="1"]')
			.boundingBox();
		const paintEnd = await page
			.locator('[data-cell][data-track="pad"][data-step="5"]')
			.boundingBox();

		if (!paintStart || !paintEnd) {
			fail('Could not measure the grid cells for the drag test.');
		} else {
			await page.mouse.move(paintStart.x + paintStart.width / 2, paintStart.y + paintStart.height / 2);
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

		// Keyboard: shift+Enter on a melodic cell must change its note.
		const bassCell = page.locator('[data-cell][data-track="bass"][data-step="0"]');
		const noteBefore = await bassCell.getAttribute('aria-label');
		await bassCell.focus();
		await page.keyboard.press('Shift+Enter');
		record('bassNoteBefore', noteBefore);
		record('bassNoteAfter', await bassCell.getAttribute('aria-label'));

		// Arrow keys move focus without activating anything.
		await page.keyboard.press('ArrowRight');
		record('focusAfterArrow', await page.evaluate(() => {
			const active = document.activeElement;
			return active instanceof HTMLElement
				? `${active.dataset.track}:${active.dataset.step}`
				: null;
		}));

		// --- transport ------------------------------------------------------
		await page.getByRole('button', { name: /Reproducir/i }).click();
		await page.waitForTimeout(1200);

		record('pauseButtonVisible', await page.getByRole('button', { name: /Pausar/i }).count());
		record('playheadText', await page.locator('[data-playhead]').innerText());
		record('audioDebug', await readAudioDebug(page));

		await page.screenshot({ path: join(OUT_DIR, 'desktop-playing.png') });

		// Live tweaks while the transport runs: the audio thread is already
		// scheduled ahead, so nothing here may throw or stall the playhead.
		await page.locator('#control-bpm').fill('150');
		await page.locator('#control-swing').fill('45');
		await page.locator('#control-cutoff').fill('640');
		await page.locator('#control-volumen').fill('0.4');
		await page.waitForTimeout(500);
		const firstReading = await page.locator('[data-playhead]').innerText();
		await page.waitForTimeout(700);
		const secondReading = await page.locator('[data-playhead]').innerText();
		record('playheadDuringLiveTweaks', [firstReading, secondReading]);
		record('transportSurvivedLiveTweaks', firstReading !== secondReading);
		record('bpmAfterTweak', await page.locator('#control-bpm').inputValue());

		// --- visual modes ----------------------------------------------------
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
			// Full page too, so the mode can be judged against the interface.
			await page.screenshot({ path: join(OUT_DIR, `mode-${id}-full.png`) });
		}
		record('visualModeHashes', modeHashes);
		record('visualModesAreDistinct', new Set(Object.values(modeHashes)).size === 3);

		// Back to the default before the audio comparison below.
		await page.locator('[data-visual-mode="tunnel"]').click();
		await page.waitForTimeout(300);

		// --- audio actually reaches the shaders ------------------------------
		// The meters publish the exact numbers the fragment shader receives, so
		// non-zero peaks here prove the AnalyserNode is carrying signal.
		const peaks = await sampleBandPeaks(page, 2600);
		record('bandPeaksWhilePlaying', peaks);
		record('analyserHasSignal', peaks.bass > 0 || peaks.mid > 0 || peaks.treble > 0);

		// And the proof that the signal changes the picture: identical renders
		// would not care about the audio. Mean brightness is compared over a few
		// frames on both sides, frame-aligned, so the time-based animation cannot
		// be mistaken for audio reactivity.
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

		// --- randomize ------------------------------------------------------
		await page.getByRole('button', { name: /Aleatorio/i }).click();
		await page.waitForTimeout(100);
		record('activeAfterRandomize', await page.locator('[data-cell][aria-pressed="true"]').count());
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
		record('mobileHorizontalOverflow', await mobilePage.evaluate(
			() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
		));
		await mobilePage.screenshot({ path: join(OUT_DIR, 'mobile-idle.png'), fullPage: true });
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
		await reducedPage.screenshot({ path: join(OUT_DIR, 'reduced-motion.png') });
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
}

/**
 * Reads the optional `window.__pulse` developer bridge, when the app is running
 * in dev mode. Returns `null` on a production build, which is expected.
 */
async function readAudioDebug(page) {
	return page.evaluate(() => {
		const bridge = globalThis.__pulse;
		if (!bridge || typeof bridge.audioEnergy !== 'function') return null;

		const state = bridge.audioState();
		const samples = [];
		for (let index = 0; index < 12; index += 1) {
			samples.push(bridge.audioEnergy());
		}

		return { state, peakEnergy: Math.max(...samples), samples };
	});
}

await main();
