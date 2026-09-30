<script lang="ts">
	/**
	 * Master bus controls. The cutoff slider works on a logarithmic curve, so the
	 * bottom two octaves get as much travel as the top two.
	 */
	import { MAX_CUTOFF_HZ, MAX_RESONANCE, MIN_CUTOFF_HZ, MIN_RESONANCE } from '$lib/audio/master';
	import { studio } from '$lib/stores/studio.svelte';
	import { fromNormalized, toNormalized } from '$lib/utils/scale';
	import LevelMeter from './LevelMeter.svelte';
	import Slider from './Slider.svelte';

	/** The cutoff slider works in thousandths of the normalised position. */
	const CUTOFF_RESOLUTION = 1000;

	const cutoffPosition = $derived(
		Math.round(
			toNormalized(studio.master.cutoff, MIN_CUTOFF_HZ, MAX_CUTOFF_HZ, 'log') * CUTOFF_RESOLUTION
		)
	);

	function formatHertz(value: number): string {
		if (value >= 1000) return `${(value / 1000).toFixed(1)} kHz`;
		return `${Math.round(value)} Hz`;
	}

	function formatPercent(value: number): string {
		return `${Math.round(value * 100)}%`;
	}
</script>

<section
	aria-label="Mezcla y efectos"
	class="flex flex-col gap-4 rounded-panel border border-hairline/70 bg-panel/70 p-3 backdrop-blur-md sm:p-4"
>
	<div class="flex items-baseline justify-between">
		<h2 class="font-display text-[0.6875rem] tracking-[0.14em] text-dim uppercase">
			Mezcla
		</h2>
		<p class="font-mono text-[0.625rem] text-dim/70">filtro maestro · envíos</p>
	</div>

	<div class="grid grid-cols-2 gap-x-4 gap-y-4">
		<Slider
			label="Volumen"
			value={studio.master.volume}
			min={0}
			max={1}
			step={0.01}
			format={formatPercent}
			accent="var(--color-chalk)"
			description="Volumen general de la mezcla"
			onInput={(value) => studio.setMaster('volume', value)}
		/>

		<Slider
			label="Resonancia"
			value={studio.master.resonance}
			min={MIN_RESONANCE}
			max={MAX_RESONANCE}
			step={0.1}
			format={(value) => value.toFixed(1)}
			accent="var(--color-voice-lead)"
			description="Resonancia del filtro maestro"
			onInput={(value) => studio.setMaster('resonance', value)}
		/>

		<div class="col-span-2">
			<Slider
				label="Cutoff"
				value={cutoffPosition}
				min={0}
				max={CUTOFF_RESOLUTION}
				step={1}
				format={() => formatHertz(studio.master.cutoff)}
				accent="var(--color-voice-pad)"
				description="Frecuencia de corte del filtro paso bajo maestro"
				onInput={(value) =>
					studio.setMaster(
						'cutoff',
						fromNormalized(value / CUTOFF_RESOLUTION, MIN_CUTOFF_HZ, MAX_CUTOFF_HZ, 'log')
					)}
			/>
		</div>

		<Slider
			label="Delay"
			value={studio.master.delayMix}
			min={0}
			max={1}
			step={0.01}
			format={formatPercent}
			accent="var(--color-voice-bass)"
			description="Cantidad de delay de corchea con puntillo"
			onInput={(value) => studio.setMaster('delayMix', value)}
		/>

		<Slider
			label="Reverb"
			value={studio.master.reverbMix}
			min={0}
			max={1}
			step={0.01}
			format={formatPercent}
			accent="var(--color-voice-hat)"
			description="Cantidad de reverb de convolución"
			onInput={(value) => studio.setMaster('reverbMix', value)}
		/>

		<LevelMeter />
	</div>
</section>
