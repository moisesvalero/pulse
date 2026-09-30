<script lang="ts">
	import MixPanel from '$lib/components/MixPanel.svelte';
	import StepGrid from '$lib/components/StepGrid.svelte';
	import StudioHeader from '$lib/components/StudioHeader.svelte';
	import TransportControls from '$lib/components/TransportControls.svelte';
</script>

<main class="relative min-h-dvh">
	<div
		class="relative z-10 mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-4 px-3 py-4 sm:px-6 sm:py-8"
	>
		<StudioHeader />

		<StepGrid />

		<div class="grid gap-4 md:grid-cols-2">
			<TransportControls />
			<MixPanel />
		</div>

		<p class="mt-auto pt-2 font-mono text-[0.625rem] leading-relaxed text-dim/70">
			Arrastra sobre la rejilla para pintar pasos · Mayús + clic cambia la nota ·
			las flechas mueven el foco
		</p>
	</div>
</main>
