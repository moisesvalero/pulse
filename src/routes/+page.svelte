<script lang="ts">
	import MixPanel from '$lib/components/MixPanel.svelte';
	import StartOverlay from '$lib/components/StartOverlay.svelte';
	import StepGrid from '$lib/components/StepGrid.svelte';
	import StudioHeader from '$lib/components/StudioHeader.svelte';
	import TransportControls from '$lib/components/TransportControls.svelte';
	import Visualizer from '$lib/components/Visualizer.svelte';
	import {
		buildShareUrl,
		getLocalStorage,
		resolveInitialState,
		writeStoredState
	} from '$lib/stores/persistence';
	import { studio } from '$lib/stores/studio.svelte';

	/**
	 * How long to wait after the last edit before touching storage and the URL.
	 * Gate toggling is a rapid-fire interaction and neither target should be hit
	 * once per click.
	 */
	const SAVE_DEBOUNCE_MS = 400;

	/** Blocks the save effect until the initial restore has run. */
	let restored = $state(false);
	/** Set on the first pass after restoring, so loading a page never rewrites the URL. */
	let skippedInitialSave = false;

	$effect(() => {
		// Read once, on mount. `$effect` never runs while prerendering, so this is
		// also the client-only guard for `location` and `localStorage`.
		const stored = resolveInitialState(globalThis.location.hash, getLocalStorage());
		if (stored) studio.restoreFrom(stored);
		restored = true;
	});

	$effect(() => {
		// Reading the whole snapshot is what subscribes this effect to every gate,
		// note and parameter; there is no manual subscription anywhere.
		const state = studio.toShareState();
		if (!restored) return;
		if (!skippedInitialSave) {
			skippedInitialSave = true;
			return;
		}

		const timer = setTimeout(() => {
			writeStoredState(getLocalStorage(), state);
			// `replaceState` rather than assigning `location.hash`: the hash would
			// otherwise push a history entry for every edit.
			globalThis.history.replaceState(null, '', buildShareUrl(globalThis.location.href, state));
		}, SAVE_DEBOUNCE_MS);

		return () => clearTimeout(timer);
	});
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

		<p class="mt-auto pt-2 font-mono text-xs leading-relaxed text-mist">
			Arrastra sobre la rejilla para pintar pasos · Mayús + clic cambia la nota ·
			las flechas mueven el foco
		</p>
	</div>
</main>
