#!/usr/bin/env node
/**
 * Regenerates the screenshots used by the README.
 *
 * Kept in the repo on purpose: the images in `docs/` should be reproducible from
 * a running build instead of being hand-made files nobody can update. Run it
 * against the static build, exactly like `verify:visual`:
 *
 *   python3 -m http.server 4173 --directory build   # one shell
 *   pnpm docs:shots                                 # another
 *
 * Output lands in `docs/`. Playwright is not a dependency; see
 * tools/visual-check.mjs for how it is located.
 */

import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE_URL = process.env.PULSE_URL ?? 'http://localhost:4173';
const OUT_DIR = fileURLToPath(new URL('../docs/', import.meta.url));

async function loadPlaywright() {
	const candidates = [];

	if (process.env.PLAYWRIGHT_PATH) candidates.push(process.env.PLAYWRIGHT_PATH);

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

	throw new Error('Could not find playwright. Set PLAYWRIGHT_PATH.');
}

/*
 * Hides the interface so the shader output can be shown on its own.
 *
 * These are real functions, not template strings: `page.evaluate('() => {...}')`
 * evaluates the string as an *expression*, which returns the function without
 * ever calling it — the interface stayed visible and the first batch of mode
 * screenshots had to be thrown away.
 */
function setUiVisible(visible) {
	// `display: none` rather than `visibility: hidden`: a blurred panel keeps
	// compositing its own layer in Chromium and the transport button stayed
	// painted on top of an otherwise hidden interface.
	const main = document.querySelector('main');
	if (main) main.style.display = visible ? '' : 'none';

	// The scrim sits between the canvas and the interface; it has to go too or it
	// dims the shader output these shots exist to show. Selected by its own hook:
	// `[aria-hidden="true"].fixed` also matches the canvas, which is how an earlier
	// batch of screenshots came out black.
	const scrim = document.querySelector('[data-scrim]');
	if (scrim) scrim.style.display = visible ? '' : 'none';
}

async function main() {
	const { chromium } = await loadPlaywright();
	await mkdir(OUT_DIR, { recursive: true });

	const browser = await chromium.launch();

	try {
		const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
		const page = await context.newPage();
		await page.goto(BASE_URL, { waitUntil: 'networkidle' });
		await page.waitForTimeout(900);

		// 1. Start screen: the explanation a first-time visitor reads.
		await page.screenshot({ path: join(OUT_DIR, 'screen-start.png') });
		console.log('  screen-start.png     (pantalla de inicio)');

		// 2. Studio, silent: what you get after entering.
		await page.getByRole('button', { name: /Entrar|Reintentar/i }).click();
		await page.waitForTimeout(1200);
		await page.screenshot({ path: join(OUT_DIR, 'screen-silent.png') });
		console.log('  screen-silent.png    (estudio recién entrado, en silencio)');

		// 3. Playing: the hero shot.
		await page.getByRole('button', { name: /Reproducir/i }).click();
		await page.waitForTimeout(3200);
		await page.screenshot({ path: join(OUT_DIR, 'hero.png') });
		console.log('  hero.png             (estudio sonando, modo túnel)');

		// 4. One clean frame per visual mode, interface hidden.
		for (const id of ['tunnel', 'ripple', 'particles']) {
			await page.locator(`[data-visual-mode="${id}"]`).click();
			await page.waitForTimeout(1100);
			await page.evaluate(setUiVisible, false);
			await page.waitForTimeout(160);
			await page.screenshot({ path: join(OUT_DIR, `mode-${id}.png`) });
			await page.evaluate(setUiVisible, true);
			console.log(`  mode-${id}.png${' '.repeat(Math.max(1, 17 - id.length))}(modo visual)`);
		}

		await context.close();

		// 5. Mobile, silent and playing.
		const mobile = await browser.newContext({
			viewport: { width: 390, height: 844 },
			deviceScaleFactor: 2,
			hasTouch: true,
			isMobile: true
		});
		const mobilePage = await mobile.newPage();
		await mobilePage.goto(BASE_URL, { waitUntil: 'networkidle' });
		await mobilePage.waitForTimeout(800);
		await mobilePage.getByRole('button', { name: /Entrar|Reintentar/i }).click();
		await mobilePage.waitForTimeout(800);
		await mobilePage.getByRole('button', { name: /Reproducir/i }).click();
		await mobilePage.waitForTimeout(2200);
		await mobilePage.screenshot({ path: join(OUT_DIR, 'mobile.png') });
		console.log('  mobile.png           (vista móvil)');
		await mobile.close();
	} finally {
		await browser.close();
	}

	await writeFile(join(OUT_DIR, '.gitkeep'), '');
	console.log(`\nCapturas actualizadas en ${OUT_DIR}`);
}

await main();
