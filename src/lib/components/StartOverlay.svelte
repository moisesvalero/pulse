<script lang="ts">
	/**
	 * Start screen.
	 *
	 * Not decoration: browsers only allow an `AudioContext` to be created or
	 * resumed inside a user gesture, so this button is the one place where audio
	 * can begin. That is also why nothing here runs in an `$effect` — an effect
	 * would count as an automatic start and the context would stay suspended.
	 *
	 * The exit animation is plain CSS rather than a Svelte transition, so the
	 * global `prefers-reduced-motion` rule in `app.css` neutralises it for free.
	 */
	import { studio } from '$lib/stores/studio.svelte';

	/** Set once the exit animation has finished, so the overlay leaves the DOM. */
	let dismissed = $state(false);
	let busy = $state(false);

	const leaving = $derived(studio.status === 'ready');

	/**
	 * Only the exit animation dismisses the overlay.
	 *
	 * `animationend` also fires for the entrance animation, so reacting to the
	 * event alone made the overlay vanish a few hundred milliseconds after load.
	 * Svelte scopes keyframe names with a hash, hence `includes` rather than `===`.
	 */
	function handleAnimationEnd(event: AnimationEvent): void {
		if (leaving && event.animationName.includes('overlay-out')) {
			dismissed = true;
		}
	}

	const features = [
		'5 voces sintetizadas en vivo: sin samples, sin ficheros de audio',
		'Scheduler con look-ahead sobre el reloj del AudioContext',
		'Visuales WebGL propios que reaccionan a graves, medios y agudos'
	];

	async function handleStart(): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await studio.start();
		} finally {
			busy = false;
		}
	}
</script>

{#if !dismissed}
	<div
		data-start-overlay
		class="overlay fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-void/80 px-4 py-8 backdrop-blur-xl"
		class:leaving
		onanimationend={handleAnimationEnd}
	>
		<div class="intro flex w-full max-w-lg flex-col items-start gap-6">
			<div class="flex flex-col gap-2">
				<p class="font-mono text-[0.625rem] tracking-[0.35em] text-accent uppercase">
					sintetizador · secuenciador · visuales
				</p>
				<h1
					class="bg-linear-to-br from-chalk from-35% to-accent bg-clip-text font-display text-5xl font-semibold tracking-[-0.045em] text-transparent sm:text-6xl"
				>
					Pulse
				</h1>
				<p class="max-w-md text-sm leading-relaxed text-mist">
					Un estudio audiovisual que vive en el navegador. Escribe un patrón, ajústalo
					mientras suena y mira cómo el sonido dibuja la pantalla.
				</p>
			</div>

			<ul class="flex flex-col gap-2">
				{#each features as feature (feature)}
					<li class="flex items-start gap-2 text-xs leading-relaxed text-dim">
						<span aria-hidden="true" class="mt-1.5 size-1 shrink-0 rounded-full bg-accent"
						></span>
						{feature}
					</li>
				{/each}
			</ul>

			<div class="flex w-full flex-col gap-3">
				<button
					type="button"
					onclick={handleStart}
					disabled={busy}
					class="group flex w-full items-center justify-center gap-3 rounded-xl border border-accent/50 bg-accent/12 px-6 py-3.5 font-display text-sm tracking-[0.16em] text-accent uppercase transition-all duration-200 ease-out-expo hover:bg-accent/20 hover:shadow-[0_0_36px_-8px_var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
				>
					<svg viewBox="0 0 16 16" class="size-3.5" aria-hidden="true" fill="currentColor">
						<path
							d="M4 2.6a.9.9 0 0 1 1.36-.77l7.2 4.4a1 1 0 0 1 0 1.71l-7.2 4.4A.9.9 0 0 1 4 11.57Z"
						/>
					</svg>
					{busy ? 'Iniciando…' : studio.status === 'error' ? 'Reintentar' : 'Empezar'}
				</button>

				{#if studio.status === 'error'}
					<p role="alert" class="rounded-lg border border-magenta/40 bg-magenta/10 px-3 py-2 text-xs text-magenta">
						{studio.error ?? 'No se pudo iniciar el audio.'}
					</p>
				{:else}
					<p class="text-[0.6875rem] leading-relaxed text-dim">
						Al pulsar Empezar se activa el audio del navegador. Se necesita un gesto
						tuyo: es la única forma de arrancar un <span class="font-mono"
							>AudioContext</span
						>.
					</p>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	/*
	 * Both animations are short and purely decorative. `app.css` collapses them to
	 * 0.01 ms under `prefers-reduced-motion`, which also makes `animationend` fire
	 * immediately — the overlay simply disappears instead of fading.
	 */
	.overlay {
		animation: overlay-in 380ms var(--ease-out-expo) both;
	}

	.intro {
		animation: intro-in 520ms var(--ease-out-expo) both;
	}

	.overlay.leaving {
		pointer-events: none;
		animation: overlay-out 420ms var(--ease-out-expo) both;
	}

	@keyframes overlay-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes overlay-out {
		from {
			opacity: 1;
		}
		to {
			opacity: 0;
			visibility: hidden;
		}
	}

	@keyframes intro-in {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
</style>
