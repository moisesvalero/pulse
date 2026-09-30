<script lang="ts">
	/**
	 * Transport controls: play/pause plus the two rhythm parameters and the
	 * pattern-level actions.
	 */
	import { MAX_BPM, MIN_BPM } from '$lib/audio/constants';
	import { buildShareUrl } from '$lib/stores/persistence';
	import { studio } from '$lib/stores/studio.svelte';
	import { cn } from '$lib/utils/cn';
	import Slider from './Slider.svelte';

	let busy = $state(false);
	/** Feedback for the share button: idle -> copied (or error) -> idle. */
	let shareState = $state<'idle' | 'copied' | 'manual'>('idle');

	/**
	 * Copies a link that reproduces the current patch.
	 *
	 * Clipboard access can be refused (insecure context, permissions). When that
	 * happens the hash is still written into the address bar, so the user can copy
	 * the URL by hand — hence the distinct "manual" message instead of a failure.
	 */
	async function copyLink(): Promise<void> {
		const url = buildShareUrl(globalThis.location.href, studio.toShareState());

		try {
			await navigator.clipboard.writeText(url);
			shareState = 'copied';
		} catch {
			globalThis.history.replaceState(null, '', url);
			shareState = 'manual';
		}

		setTimeout(() => (shareState = 'idle'), 2600);
	}

	async function toggle(): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await studio.toggle();
		} finally {
			busy = false;
		}
	}

	const swingPercent = $derived(Math.round(studio.swing * 100));
</script>

<section
	aria-label="Transporte"
	class="flex flex-col gap-4 rounded-panel border border-hairline/70 bg-panel/70 p-3 backdrop-blur-md sm:p-4"
>
	<div class="flex items-center gap-3">
		<button
			type="button"
			onclick={toggle}
			aria-label={studio.playing ? 'Pausar el secuenciador' : 'Reproducir el secuenciador'}
			class={cn(
				'group flex size-12 shrink-0 items-center justify-center rounded-full border transition-all duration-200 ease-out-expo active:scale-95',
				'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
				studio.playing
					? 'border-accent/60 bg-accent/15 text-accent shadow-[0_0_22px_-4px_var(--color-accent)]'
					: 'border-hairline bg-panel-raised text-chalk hover:border-accent/60 hover:text-accent'
			)}
		>
			{#if studio.playing}
				<svg viewBox="0 0 16 16" class="size-4" aria-hidden="true" fill="currentColor">
					<rect x="3" y="2.5" width="3.5" height="11" rx="1" />
					<rect x="9.5" y="2.5" width="3.5" height="11" rx="1" />
				</svg>
			{:else}
				<svg viewBox="0 0 16 16" class="size-4" aria-hidden="true" fill="currentColor">
					<path d="M4 2.6a.9.9 0 0 1 1.36-.77l7.2 4.4a1 1 0 0 1 0 1.71l-7.2 4.4A.9.9 0 0 1 4 11.57Z" />
				</svg>
			{/if}
		</button>

		<div class="flex min-w-0 flex-1 flex-col gap-1">
			<span class="font-display text-xs tracking-[0.14em] text-dim uppercase">
				Estado
			</span>
			<span class="truncate text-sm text-mist" aria-live="polite">
				{#if studio.status === 'error'}
					{studio.error ?? 'Error de audio'}
				{:else if studio.playing}
					Sonando · compás de 16 pasos
				{:else if studio.status === 'ready'}
					En pausa
				{:else}
					Listo para empezar
				{/if}
			</span>
		</div>
	</div>

	<div class="grid grid-cols-2 gap-4">
		<Slider
			label="BPM"
			value={studio.master.bpm}
			min={MIN_BPM}
			max={MAX_BPM}
			step={1}
			accent="var(--color-accent)"
			description="Tempo en pulsos por minuto"
			onInput={(value) => studio.setBpm(value)}
		/>
		<Slider
			label="Swing"
			value={swingPercent}
			min={0}
			max={100}
			step={1}
			format={(value) => `${Math.round(value)}%`}
			accent="var(--color-magenta)"
			description="Desplaza los pasos impares para dar balanceo"
			onInput={(value) => studio.setSwing(value / 100)}
		/>
	</div>

	<div class="flex flex-wrap gap-2">
		<button
			type="button"
			onclick={() => studio.randomize()}
			class="flex-1 rounded-lg border border-hairline bg-panel-raised/70 px-3 py-2 font-display text-xs tracking-[0.12em] text-mist uppercase transition duration-150 ease-out-expo hover:border-accent/50 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.97]"
		>
			Aleatorio
		</button>
		<button
			type="button"
			onclick={() => studio.clear()}
			class="flex-1 rounded-lg border border-hairline bg-panel-raised/70 px-3 py-2 font-display text-xs tracking-[0.12em] text-mist uppercase transition duration-150 ease-out-expo hover:border-magenta/50 hover:text-magenta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.97]"
		>
			Limpiar
		</button>
		<button
			type="button"
			onclick={() => studio.reset()}
			class="flex-1 rounded-lg border border-hairline bg-panel-raised/70 px-3 py-2 font-display text-xs tracking-[0.12em] text-mist uppercase transition duration-150 ease-out-expo hover:border-mist/50 hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.97]"
		>
			Demo
		</button>
	</div>

	<button
		type="button"
		onclick={copyLink}
		class="flex w-full items-center justify-center gap-2 rounded-lg border border-hairline bg-panel-raised/40 px-3 py-2 font-display text-xs tracking-[0.12em] text-mist uppercase transition duration-150 ease-out-expo hover:border-accent/50 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.98]"
	>
		<svg viewBox="0 0 16 16" class="size-3" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6">
			<path d="M6.5 9.5 9.5 6.5M6 11.5 4.6 12.9a2.4 2.4 0 0 1-3.4-3.4L4.6 6M10 4.5l1.4-1.4a2.4 2.4 0 0 1 3.4 3.4L11.4 10" stroke-linecap="round" />
		</svg>
		{#if shareState === 'copied'}
			Enlace copiado
		{:else if shareState === 'manual'}
			Enlace en la barra de direcciones
		{:else}
			Copiar enlace del patrón
		{/if}
	</button>

	<p aria-live="polite" class="sr-only">
		{#if shareState === 'copied'}Enlace copiado al portapapeles{:else if shareState === 'manual'
			}El portapapeles no está disponible; el enlace se ha escrito en la barra de direcciones{/if}
	</p>
</section>
