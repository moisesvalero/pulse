<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<!-- Preloaded because the whole interface depends on them; `crossorigin` is
	     required for font preloads even when the file is same-origin. -->
	<link
		rel="preload"
		href="/fonts/inter-latin.woff2"
		as="font"
		type="font/woff2"
		crossorigin="anonymous"
	/>
	<link
		rel="preload"
		href="/fonts/space-grotesk-latin.woff2"
		as="font"
		type="font/woff2"
		crossorigin="anonymous"
	/>
	<title>Pulse — estudio audiovisual</title>
	<meta
		name="description"
		content="Secuenciador de 16 pasos, sintetizador Web Audio y visuales WebGL reactivos. Todo en el navegador."
	/>
</svelte:head>

{@render children()}
