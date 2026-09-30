import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Pulse is a 100% client-side app. `fallback` makes every route a
			// prerendered shell so deep links work on a plain static host.
			adapter: adapter({
				pages: 'build',
				assets: 'build',
				fallback: '404.html',
				// Emits .br and .gz next to every asset, so a static host can serve
				// compressed responses with no server configuration at all.
				precompress: true,
				strict: true
			})
		})
	]
});
