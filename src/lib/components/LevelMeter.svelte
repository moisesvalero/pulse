<script lang="ts">
	/**
	 * Spectrum meter.
	 *
	 * Two purposes: it makes the audio-to-visuals link visible (the bars are the
	 * exact numbers the shaders receive), and it is the hook the Playwright pass
	 * reads to prove the analyser is producing signal while the transport runs.
	 *
	 * The bars are decorative — the music is the content — so the bar group is
	 * `aria-hidden` and the live numbers live in `data-*` attributes.
	 */
	import { visuals } from '$lib/stores/visuals.svelte';

	const bands = $derived([
		{ key: 'bass', label: 'Graves', level: visuals.bass, color: 'var(--color-voice-bass)' },
		{ key: 'mid', label: 'Medios', level: visuals.mid, color: 'var(--color-voice-lead)' },
		{ key: 'treble', label: 'Agudos', level: visuals.treble, color: 'var(--color-voice-hat)' }
	]);

	const percent = (level: number): number => Math.round(Math.min(1, Math.max(0, level)) * 100);
</script>

<div class="col-span-2 flex flex-col gap-2">
	<div class="flex items-baseline justify-between gap-2">
		<h3 class="font-display text-[0.6875rem] tracking-[0.14em] text-dim uppercase">
			Espectro
		</h3>
		<p
			class="font-mono text-[0.625rem] tabular-nums text-dim/70"
			data-render-stats
			data-fps={Math.round(visuals.fps)}
			data-scale={visuals.scale}
		>
			{Math.round(visuals.fps)} fps · {visuals.scale.toFixed(2)}×
		</p>
	</div>

	<div class="flex flex-col gap-1.5" aria-hidden="true">
		{#each bands as band (band.key)}
			<div class="flex items-center gap-2" data-band={band.key} data-level={percent(band.level)}>
				<span class="w-12 shrink-0 font-mono text-[0.5625rem] text-dim">{band.label}</span>
				<span class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-hairline/60">
					<span
						class="block h-full rounded-full"
						style="width: {percent(band.level)}%; background-color: {band.color}; box-shadow: 0 0 8px {band.color};"
					></span>
				</span>
				<span class="w-7 shrink-0 text-right font-mono text-[0.5625rem] tabular-nums text-dim">
					{percent(band.level)}
				</span>
			</div>
		{/each}
	</div>
</div>
