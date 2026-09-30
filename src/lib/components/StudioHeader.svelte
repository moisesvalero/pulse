<script lang="ts">
	/**
	 * Wordmark, playhead readout and the visual mode switcher.
	 */
	import VisualModeSwitcher from '$lib/components/VisualModeSwitcher.svelte';
	import { studio } from '$lib/stores/studio.svelte';
</script>

<header class="flex flex-wrap items-center justify-between gap-3">
	<div class="flex items-baseline gap-3">
		<h1 class="font-display text-2xl font-semibold tracking-[-0.03em] text-chalk sm:text-3xl">
			Pulse
		</h1>
		<p class="font-mono text-[0.625rem] tracking-[0.2em] text-dim uppercase">
			estudio audiovisual
		</p>
	</div>

	<div class="flex items-center gap-3">
		<p data-playhead class="font-mono text-[0.625rem] text-mist">
			{#if studio.currentStep !== null}
				paso <span class="text-accent">{String(studio.currentStep + 1).padStart(2, '0')}</span
				> / 16
			{:else}
				16 pasos · 5 pistas
			{/if}
		</p>

		<VisualModeSwitcher />
	</div>
</header>
