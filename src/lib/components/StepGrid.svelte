<script lang="ts">
	/**
	 * The 16 x 5 step grid.
	 *
	 * Interactions:
	 *  - click / tap a cell toggles it
	 *  - pointer drag paints (mouse and touch; a single `pointermove` handler uses
	 *    `elementFromPoint` so it behaves the same on both)
	 *  - shift + click (or shift + Enter) cycles the note of a melodic cell up the
	 *    pentatonic scale, which is how pitch is edited without a second row of UI
	 *  - arrow keys move focus between cells
	 */
	import {
		TRACK_DISPLAY_ORDER,
		TRACK_LABELS
	} from '$lib/audio/constants';
	import { midiToNoteName } from '$lib/audio/pitch';
	import { DEFAULT_SCALE, isInScale, LANE_RANGES, scalePitches } from '$lib/audio/pattern';
	import { studio } from '$lib/stores/studio.svelte';
	import type { TrackId } from '$lib/audio/types';
	import { cn } from '$lib/utils/cn';

	/** Fifteen steps plus the downbeat: enough for a bar of 16ths. */
	const STEP_INDICES = Array.from({ length: 16 }, (_, index) => index);

	/** Signal colour per voice, so the grid reads as a mixing desk. */
	const TRACK_COLORS: Record<TrackId, string> = {
		bass: 'var(--color-voice-bass)',
		lead: 'var(--color-voice-lead)',
		pad: 'var(--color-voice-pad)',
		kick: 'var(--color-voice-kick)',
		hat: 'var(--color-voice-hat)'
	};

	const MELODIC: ReadonlySet<TrackId> = new Set(['bass', 'lead', 'pad']);

	let grid = $state<HTMLTableElement | null>(null);
	let painting = $state(false);
	let paintValue = $state(true);

	function isMelodic(track: TrackId): boolean {
		return MELODIC.has(track);
	}

	function applyPaint(track: TrackId, step: number): void {
		if (studio.pattern[track].gates[step] === paintValue) return;
		studio.setGate(track, step, paintValue);
	}

	/** Moves the note to the next/previous pitch of the lane's scale window. */
	function cycleNote(track: TrackId, step: number, direction: number): void {
		if (!isMelodic(track)) return;

		const range = LANE_RANGES[track as 'bass' | 'lead' | 'pad'];
		const pitches = scalePitches(DEFAULT_SCALE, range.min, range.max);
		const current = studio.pattern[track].notes[step];
		const index = pitches.indexOf(current);

		let next: number;
		if (index === -1) {
			// Not on the grid (e.g. loaded from a URL): snap to the nearest pitch.
			next = pitches.reduce(
				(best, pitch) => (Math.abs(pitch - current) < Math.abs(best - current) ? pitch : best),
				pitches[0]
			);
		} else {
			next = pitches[(index + direction + pitches.length) % pitches.length];
		}

		studio.setNote(track, step, next);
	}

	function handlePointerDown(event: PointerEvent, track: TrackId, step: number): void {
		if (event.button !== 0) return;

		// Safari on macOS does not focus buttons on click; do it explicitly so the
		// focus ring is visible for keyboard users coming back from the mouse.
		(event.currentTarget as HTMLElement).focus();

		if (event.shiftKey && isMelodic(track)) {
			cycleNote(track, step, 1);
			return;
		}

		painting = true;
		paintValue = !studio.pattern[track].gates[step];
		applyPaint(track, step);
	}

	function handlePointerMove(event: PointerEvent): void {
		if (!painting) return;

		const element = document.elementFromPoint(event.clientX, event.clientY);
		const cell = element?.closest<HTMLElement>('[data-cell]');
		if (!cell || !grid?.contains(cell)) return;

		const track = cell.dataset.track as TrackId | undefined;
		const step = Number(cell.dataset.step);
		if (!track || !Number.isInteger(step)) return;

		applyPaint(track, step);
	}

	function handleClick(event: MouseEvent, track: TrackId, step: number): void {
		// Pointer clicks are already handled on pointerdown. `detail === 0` means
		// the click came from the keyboard (Enter/Space on the focused button).
		if (event.detail !== 0) return;

		if (event.shiftKey && isMelodic(track)) {
			cycleNote(track, step, 1);
			return;
		}

		studio.toggleGate(track, step);
	}

	/** Arrow-key focus movement across the grid. */
	function handleKeyDown(event: KeyboardEvent): void {
		const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
		if (!keys.includes(event.key)) return;

		const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-cell]');
		if (!cell || !grid) return;

		const cells = [...grid.querySelectorAll<HTMLElement>('[data-cell]')];
		const index = cells.indexOf(cell);
		if (index === -1) return;

		const row = TRACK_DISPLAY_ORDER.indexOf(cell.dataset.track as TrackId);
		const column = Number(cell.dataset.step);
		const rows = TRACK_DISPLAY_ORDER.length;

		let nextRow = row;
		let nextColumn = column;

		if (event.key === 'ArrowUp') nextRow = (row - 1 + rows) % rows;
		if (event.key === 'ArrowDown') nextRow = (row + 1) % rows;
		if (event.key === 'ArrowLeft') nextColumn = (column - 1 + 16) % 16;
		if (event.key === 'ArrowRight') nextColumn = (column + 1) % 16;

		const next = cells.find(
			(candidate) =>
				candidate.dataset.track === TRACK_DISPLAY_ORDER[nextRow] &&
				Number(candidate.dataset.step) === nextColumn
		);

		if (next) {
			event.preventDefault();
			next.focus();
		}
	}
</script>

<!-- Drag painting is tracked on the window: the pointer regularly leaves the
     cell it started on, and listening on the table would also trip the
     a11y-no-noninteractive-element-interactions rule. -->
<svelte:window
	onpointermove={handlePointerMove}
	onpointerup={() => (painting = false)}
	onpointercancel={() => (painting = false)}
/>

<div
	class="overflow-x-auto rounded-panel border border-hairline/70 bg-abyss/60 backdrop-blur-md"
>
	<table
		bind:this={grid}
		class="w-full min-w-[34rem] border-separate border-spacing-1 p-2 select-none"
		style="touch-action: pan-x;"
	>
		<caption class="sr-only">
			Secuenciador de 16 pasos y 5 pistas. Usa las flechas para moverte, espacio para activar
			un paso y Mayús más clic para cambiar la nota.
		</caption>

		<thead>
			<tr>
				<td class="w-[4.5rem]"></td>
				{#each STEP_INDICES as step (step)}
					<th
						scope="col"
						class={cn(
							'pb-1 text-center font-mono text-[0.625rem] font-normal tabular-nums transition-colors',
							studio.currentStep === step ? 'text-accent' : 'text-dim/70',
							step % 4 === 0 && studio.currentStep !== step && 'text-mist'
						)}
					>
						{step + 1}
					</th>
				{/each}
			</tr>
		</thead>

		<tbody>
			{#each TRACK_DISPLAY_ORDER as track (track)}
				{@const color = TRACK_COLORS[track]}
				{@const melodic = isMelodic(track)}
				<tr>
					<th scope="row" class="pr-2 text-left align-middle font-normal">
						<span class="flex items-center gap-1.5">
							<span
								aria-hidden="true"
								class="size-1.5 shrink-0 rounded-full"
								style="background-color: {color}; box-shadow: 0 0 8px {color};"
							></span>
							<span
								class="font-display text-[0.6875rem] tracking-[0.1em] text-mist uppercase"
							>
								{TRACK_LABELS[track]}
							</span>
						</span>
					</th>

					{#each STEP_INDICES as step (step)}
						{@const active = studio.pattern[track].gates[step]}
						{@const playing = studio.currentStep === step}
						{@const note = studio.pattern[track].notes[step]}
						{@const offGrid = melodic && !isInScale(note, DEFAULT_SCALE)}
						<td class="p-0">
							<button
								type="button"
								data-cell
								data-track={track}
								data-step={step}
								aria-pressed={active}
								aria-label="{TRACK_LABELS[track]}, paso {step + 1}{active
									? ', activo'
									: ', inactivo'}{melodic ? `, nota ${midiToNoteName(note)}` : ''}"
								onpointerdown={(event) => handlePointerDown(event, track, step)}
								onclick={(event) => handleClick(event, track, step)}
								onkeydown={handleKeyDown}
								class={cn(
									'group relative flex h-9 w-full items-center justify-center rounded-[0.4rem] border text-[0.5625rem] transition-[transform,background-color,border-color,box-shadow] duration-150 ease-out-expo',
									'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent active:scale-95',
									active
										? 'border-transparent'
										: cn(
												'border-hairline/80 bg-panel-raised/50 hover:-translate-y-px hover:border-mist/40 hover:bg-panel-raised',
												step % 4 === 0 && 'bg-panel-raised/80'
											),
									playing && 'scale-[1.06]'
								)}
								style={active
									? `background-color: color-mix(in oklab, ${color} ${playing ? 100 : 78}%, var(--color-void)); box-shadow: 0 0 14px color-mix(in oklab, ${color} ${playing ? 75 : 35}%, transparent);`
									: undefined}
							>
								{#if playing}
									<span
										aria-hidden="true"
										class="pointer-events-none absolute inset-0 rounded-[0.4rem] ring-2 ring-chalk/70"
									></span>
								{/if}

								{#if active && melodic && !offGrid}
									<!-- Dark label on a bright voice colour: legible without an
									     extra outline. No blend mode, which washed it out. -->
									<span class="font-mono font-semibold tracking-tight text-void">
										{midiToNoteName(note)}
									</span>
								{:else if active && melodic}
									<span class="font-mono font-semibold text-void" title="Nota fuera de escala">
										?
									</span>
								{/if}
							</button>
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>
