<script lang="ts">
	/**
	 * Wordmark and orientation hints. The hint line doubles as documentation for
	 * the two interactions that are not discoverable on sight (drag painting and
	 * shift-click pitch editing).
	 */
	import { studio } from '$lib/stores/studio.svelte';
</script>

<header class="flex flex-wrap items-end justify-between gap-3">
	<div class="flex items-baseline gap-3">
		<h1
			class="font-display text-2xl font-semibold tracking-[-0.03em] text-chalk sm:text-3xl"
		>
			Pulse
		</h1>
		<p class="font-mono text-[0.625rem] tracking-[0.2em] text-dim uppercase">
			estudio audiovisual
		</p>
	</div>

	<p data-playhead class="font-mono text-[0.625rem] text-dim/80" aria-live="off">
		{#if studio.currentStep !== null}
			paso <span class="text-accent">{String(studio.currentStep + 1).padStart(2, '0')}</span> / 16
		{:else}
			16 pasos · 5 pistas · Web Audio
		{/if}
	</p>
</header>
