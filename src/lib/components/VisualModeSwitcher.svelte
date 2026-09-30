<script lang="ts">
	/**
	 * Visual mode switcher.
	 *
	 * A segmented control: one button per mode with `aria-pressed`, inside a
	 * labelled group. Keyboard users can also press 1/2/3 anywhere on the page.
	 */
	import { visuals } from '$lib/stores/visuals.svelte';
	import { VISUAL_MODES } from '$lib/visuals/modes';
	import { cn } from '$lib/utils/cn';

	function handleKeydown(event: KeyboardEvent): void {
		// Never steal keys from a control the user is operating.
		const target = event.target;
		if (target instanceof HTMLElement && target.closest('input, select, textarea')) return;

		const index = Number(event.key) - 1;
		if (!Number.isInteger(index) || index < 0 || index >= VISUAL_MODES.length) return;

		event.preventDefault();
		visuals.setMode(VISUAL_MODES[index].id);
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	role="group"
	aria-label="Modo visual"
	class="flex items-center gap-1 rounded-full border border-hairline/70 bg-panel/70 p-0.5 backdrop-blur-md"
>
	{#each VISUAL_MODES as mode, index (mode.id)}
		<button
			type="button"
			aria-pressed={visuals.mode === mode.id}
			data-visual-mode={mode.id}
			title="{mode.description} (tecla {index + 1})"
			onclick={() => visuals.setMode(mode.id)}
			class={cn(
				'rounded-full px-2.5 py-1 font-display text-[0.625rem] tracking-[0.1em] uppercase transition duration-150 ease-out-expo active:scale-95',
				'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
				visuals.mode === mode.id
					? 'bg-accent/15 text-accent'
					: 'text-dim hover:text-mist'
			)}
		>
			{mode.label}
		</button>
	{/each}
</div>
