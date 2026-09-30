<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Pulse — estudio audiovisual</title>
	<meta
		name="description"
		content="Secuenciador de 16 pasos, sintetizador Web Audio y visuales WebGL reactivos. Todo en el navegador."
	/>
</svelte:head>

{@render children()}
