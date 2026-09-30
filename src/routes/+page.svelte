<script lang="ts">
	import MixPanel from '$lib/components/MixPanel.svelte';
	import StartOverlay from '$lib/components/StartOverlay.svelte';
	import StepGrid from '$lib/components/StepGrid.svelte';
	import StudioHeader from '$lib/components/StudioHeader.svelte';
	import TransportControls from '$lib/components/TransportControls.svelte';
	import Visualizer from '$lib/components/Visualizer.svelte';
	import { studio } from '$lib/stores/studio.svelte';
</script>

<!--
	Closing the AudioContext on page hide is the only teardown that ever runs for a
	single-page instrument like this; without it the context would outlive the page
	on browsers that keep the document alive for the back/forward cache.
-->
<svelte:window onpagehide={() => studio.dispose()} />

<Visualizer />

<!--
	Scrim between the canvas and the interface. The shader can put near-white light
	anywhere on screen, so without this the header and the footer hint drop below
	readable contrast. It leaves the middle of the frame untouched so the visuals
	still read.
-->
<div
	aria-hidden="true"
	class="pointer-events-none fixed inset-0 z-[5] bg-linear-to-b from-void/70 via-transparent to-void/85"
></div>

<StartOverlay />

<main class="relative z-10 min-h-dvh">
	<div
		class="relative mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-4 px-3 py-4 sm:px-6 sm:py-8"
	>
		<StudioHeader />

		<StepGrid />

		<div class="grid gap-4 md:grid-cols-2">
			<TransportControls />
			<MixPanel />
		</div>

		<p class="mt-auto pt-2 font-mono text-[0.625rem] leading-relaxed text-mist">
			Arrastra sobre la rejilla para pintar pasos · Mayús + clic cambia la nota ·
			las flechas mueven el foco
		</p>
	</div>
</main>
