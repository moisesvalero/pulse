<script lang="ts">
	/**
	 * Full-screen WebGL canvas sitting behind the interface.
	 *
	 * The renderer is created in an `$effect` and disposed in its cleanup, which
	 * is what guarantees the animation frame, the programs, the buffer and the
	 * GPU context itself are all released if the component ever unmounts.
	 */
	import { visuals } from '$lib/stores/visuals.svelte';
	import { SILENT_BANDS, VisualRenderer } from '$lib/visuals/renderer';

	let canvas = $state<HTMLCanvasElement | null>(null);
	let reducedMotion = $state(false);

	/** Non-reactive: the renderer is owned by the effect, not by the markup. */
	let renderer: VisualRenderer | null = null;

	/**
	 * Reduced motion lowers the shader's intensity instead of freezing it: a
	 * completely static frame reads as "broken", a calmer one does not.
	 */
	const intensity = $derived(reducedMotion ? 0.3 : 1);

	$effect(() => {
		if (!canvas) return;

		const query = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
		reducedMotion = query.matches;

		const onPreferenceChange = (event: MediaQueryListEvent): void => {
			reducedMotion = event.matches;
		};
		query.addEventListener('change', onPreferenceChange);

		renderer = VisualRenderer.create({
			canvas,
			getMode: () => visuals.mode,
			getIntensity: () => intensity,
			getBands: () => SILENT_BANDS,
			onStats: (stats) => {
				visuals.fps = stats.fps;
				visuals.scale = stats.scale;
			}
		});

		visuals.supported = renderer !== null;
		renderer?.start();

		return () => {
			query.removeEventListener('change', onPreferenceChange);
			renderer?.dispose();
			renderer = null;
		};
	});
</script>

<!--
	The radial gradient is the fallback: a bare `<canvas>` is transparent, so if
	the browser refuses a WebGL context this background is what the page shows
	instead of a flat void.
-->
<canvas
	bind:this={canvas}
	aria-hidden="true"
	class="pointer-events-none fixed inset-0 z-0 size-full"
	style="background: radial-gradient(120% 90% at 50% 0%, #0b1020 0%, #05060d 55%, #04050a 100%);"
></canvas>
