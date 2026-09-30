import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Vitest runs the pure logic of Pulse (scheduler math, pattern generation, URL
 * state serialisation, DSP helpers). These modules never touch the DOM or the
 * Web Audio API, so a plain node environment is enough and keeps the suite fast.
 */
export default defineConfig({
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url))
		}
	},
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		reporters: ['dot']
	}
});
