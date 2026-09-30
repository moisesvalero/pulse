<script lang="ts">
	/**
	 * Labelled range control.
	 *
	 * Data flow is explicit (a `value` prop plus an `onInput` callback) rather
	 * than `bind:value`, because every change also has to be pushed into the
	 * audio graph. Keeping that call in the parent makes the side effect visible.
	 */

	interface Props {
		label: string;
		value: number;
		min: number;
		max: number;
		step?: number;
		/** Human-readable rendering of the current value, used in the readout. */
		format?: (value: number) => string;
		/** CSS colour for the filled track and thumb. */
		accent?: string;
		disabled?: boolean;
		/** Extra context for screen readers. */
		description?: string;
		onInput?: (value: number) => void;
	}

	let {
		label,
		value,
		min,
		max,
		step = 1,
		format = (raw: number) => String(Math.round(raw)),
		accent = 'var(--color-accent)',
		disabled = false,
		description,
		onInput
	}: Props = $props();

	/**
	 * Deterministic id derived from the label, so the server-rendered markup and
	 * the hydrated client agree (a counter would risk a hydration mismatch).
	 * Labels are unique within the control panel.
	 */
	const id = $derived(
		`control-${label
			.toLowerCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')}`
	);

	const percent = $derived(
		max === min ? 0 : Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
	);

	function handleInput(event: Event): void {
		const target = event.currentTarget as HTMLInputElement;
		onInput?.(Number(target.value));
	}
</script>

<div class="group flex flex-col gap-1.5">
	<div class="flex items-baseline justify-between gap-2">
		<label
			for={id}
			class="font-display text-[0.6875rem] font-medium tracking-[0.14em] text-mist uppercase transition-colors group-hover:text-chalk"
		>
			{label}
		</label>
		<output for={id} class="font-mono text-[0.6875rem] tabular-nums text-dim">
			{format(value)}
		</output>
	</div>

	<input
		{id}
		type="range"
		{min}
		{max}
		{step}
		{disabled}
		{value}
		aria-valuetext={format(value)}
		aria-describedby={description ? `${id}-description` : undefined}
		oninput={handleInput}
		style="--range-fill: {percent}%; --range-accent: {accent};"
		class="h-6 w-full sm:h-5"
	/>

	{#if description}
		<p id="{id}-description" class="sr-only">{description}</p>
	{/if}
</div>
