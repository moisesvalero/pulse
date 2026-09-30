# PROGRESS — Pulse

> Memoria externa del agente. **Léeme al inicio de cada iteración y actualízame al final.**
> Si el contexto se reinicia, este archivo debe bastar para retomar sin preguntar nada.

- **Proyecto:** Pulse — estudio audiovisual interactivo en el navegador (secuenciador 16 pasos + sintetizador Web Audio propio + visuales WebGL reactivos).
- **Ruta local:** `~/Proyectos Web/webs/Sveltekit/Pulse`
- **Estado global:** EN CURSO — secciones A, B y C completas. Siguiente: D (pulido) y E (entrega).

---

## 0. Contexto de entorno (importante)

| Hecho | Valor |
|---|---|
| SO real de la sesión | **macOS** (no Windows). El brief pedía Windows/PowerShell 7, pero la sesión corre en macOS. |
| Shell usado por el agente | `bash` (nativo de macOS), tal como manda `~/.dsh/AGENTS.md` para macOS. |
| Node / pnpm | Node v22.23.2 · pnpm 12.5.1 |
| Navegador de verificación | **Playwright 1.63 con Chromium en caché** (`~/.npm/_npx/.../playwright`). Chrome del sistema NO está instalado. |
| Portabilidad | Los scripts de `package.json` no usan sintaxis bash-only, así que el proyecto se ejecuta igual en PowerShell 7. |
| Servidor para verificar | `python3 -m http.server 4173 --directory build`. **No** usar `vite preview` para verificar: cachea el listado de `build/` al arrancar y, tras un rebuild, sirve hashes antiguos → la página no hidrata y los tests visuales dan falsos negativos. |
| Comando de verificación visual | `pnpm verify:visual` (con el servidor estático arriba). Escribe capturas y `report.json` en `.verify/` (ignorado por git). |

---

## 1. Checklist de tareas

### A. Base y audio

- [x] **A1.** Proyecto SvelteKit limpio + estructura `src/lib/{audio,visuals,components,stores,utils}`
- [x] **A2.** Motor de audio: 3 voces (osciladores + filtro + ADSR), bombo y hi-hat sintetizados
- [x] **A3.** Scheduler con lookahead ("two clocks") + función pura testeable + tests vitest
- [x] **A4.** Cadena maestra: gain → filtro → delay/reverb → compresor → AnalyserNode

### B. Secuenciador

- [x] **B1.** Rejilla 16 pasos × 5 pistas (clic y arrastre) + indicador de paso actual
- [x] **B2.** Controles en tiempo real: BPM, volumen, cutoff, resonancia, delay, swing
- [x] **B3.** Randomize con escala menor pentatónica (lógica pura + tests)

### C. Visuales

- [x] **C1.** Canvas WebGL a pantalla completa detrás de la UI
- [x] **C2.** Fragment shader reactivo al AnalyserNode (graves / medios / agudos → parámetros distintos)
- [x] **C3.** Mínimo 3 modos visuales intercambiables (túnel, ondas radiales, campo de partículas)
- [x] **C4.** Control de rendimiento: si baja de 45 fps sostenidos, baja la resolución interna

### D. Pulido

- [ ] **D1.** Pantalla de inicio con botón "Start" (gesto de usuario para el AudioContext)
- [ ] **D2.** Diseño oscuro cuidado, tipografía, microinteracciones
- [ ] **D3.** Responsive y táctil
- [ ] **D4.** Accesibilidad: foco visible, ARIA, `prefers-reduced-motion`
- [ ] **D5.** localStorage + compartir por URL (hash) + tests de serialización

### E. Entrega

- [ ] **E1.** README en español e inglés
- [ ] **E2.** Build estático listo para desplegar
- [ ] **E3.** Pasada final: check + build + test + Lighthouse

---

## 2. Arquitectura (para retomar sin releer todo el código)

```
src/lib/audio/
  types.ts        tipos de dominio (TrackId, Pattern, NoteEvent, VoicePreset, MasterParams)
  constants.ts    STEPS_PER_BAR, TRACK_IDS, presets de voz, límites de BPM, timing del scheduler
  envelope.ts     ADSR y envolvente percusiva sobre un subconjunto estructural de AudioParam
  pitch.ts        MIDI <-> Hz <-> nombre de nota
  noise.ts        buffers de ruido blanco procedurales (en bucle, no recreados)
  voice.ts        voz sustractiva monofónica persistente (osciladores -> lowpass con env -> amp)
  drums.ts        bombo (seno con barrido + clic) y hi-hat (ruido + HP/BP), sin samples
  master.ts       cadena maestra: filtro -> [dry | delay | reverb] -> compresor -> volumen -> analyser
  engine.ts       AudioEngine: une voces + drums + transporte + params en vivo
  scheduler.ts    scheduler de lookahead: `planSteps` PURA + clase Transport (reloj/timer inyectables)
  pattern.ts      modelo de patrón, escala pentatónica y randomizador (puro)

src/lib/visuals/
  gl.ts           helpers WebGL 1 (shaders, programa, quad, resize con DPR)
  shaders.ts      contrato de uniforms + noise/fbm/vignette + los 3 fragment shaders
  modes.ts        catálogo de modos visuales
  analysis.ts     espectro -> bandas (PURA) + suavizado asimétrico + BandReader
  performance.ts  ResolutionController (PURA): escalera de resolución con histéresis
  renderer.ts     VisualRenderer: contexto GL, caché de programas, rAF, fps, bandas

src/lib/stores/
  studio.svelte.ts    estado único (patrón, params, swing, transporte, playhead)
  visuals.svelte.ts   modo visual, bandas en vivo, fps, escala, soporte WebGL

src/lib/components/
  Visualizer, StudioHeader, VisualModeSwitcher, StepGrid, TransportControls,
  MixPanel, LevelMeter, Slider
```

Flujo de datos: **la UI muta `studio`** → el motor lee `studio` con *getters* en cada paso (nunca copia estado) → el scheduler agenda en el reloj de audio → el `AnalyserNode` alimenta `analysis.ts` → los uniforms del shader. No hay sincronización explícita en ningún punto.

---

## 3. Decisiones tomadas

| # | Decisión | Motivo |
|---|---|---|
| D-01 | `@sveltejs/adapter-static` con `fallback: '404.html'`, `strict: true` | App 100% cliente. El fallback evita colisión con la home prerenderizada. |
| D-02 | Tailwind CSS **v4** vía plugin `@tailwindcss/vite` (sin `tailwind.config.js` ni PostCSS) | Vía oficial actual para SvelteKit; el tema vive en el bloque `@theme` de `src/app.css`. |
| D-03 | `vitest` con `vitest.config.ts` propio, `environment: 'node'` | Los tests cubren sólo lógica pura. Sin jsdom ni plugin de SvelteKit → suite de ~200 ms. |
| D-04 | TS estricto + `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride`, `verbatimModuleSyntax` | El brief exige TS estricto; `verbatimModuleSyntax` obliga a `import type` y evita imports fantasma. |
| D-05 | Idioma de la UI: **español**, `lang="es"` | El brief pide README bilingüe pero no fija idioma de UI. |
| D-06 | Sin `clsx`/`tailwind-merge`: helper propio `cn()` | El brief pide no meter dependencias innecesarias. |
| D-07 | Voces **monofónicas y persistentes** (nodos creados una vez, las notas sólo escriben automatización) | Cero asignaciones por paso; habilita el *glide* y evita clics. |
| D-08 | `cancelAndHoldAtTime` + fallback a anclar en `param.value` en vez de `setValueAtTime(0, t)` | El pad libera >1 s y se re-dispara antes de terminar: saltar a 0 haría clic. |
| D-09 | Bombo = seno con barrido de tono + clic de ruido paso-alto; hi-hat = ruido blanco por paso-alto + paso-banda | Percusión sintetizada de verdad, sin samples. Ruido generado en runtime y **en bucle**. |
| D-10 | Reverb = `ConvolverNode` con respuesta al impulso generada | Reverb de convolución sin enviar ningún fichero IR. |
| D-11 | Delay y reverb como **caminos paralelos** wet/dry, no como inserts | Los controles de mezcla son ganancias y se mueven en vivo sin cortar la señal seca. |
| D-12 | Todos los cambios de parámetro en vivo con `setTargetAtTime` (τ = 20 ms) | Sin clics ni cortes al mover sliders. |
| D-13 | Delay = corchea con puntillo, retimado sólo cuando cambia el BPM | Retimar `delayTime` dobla el tono de lo que ya está en la línea. |
| D-14 | Núcleo del scheduler (`planSteps`) puro, sin Web Audio ni DOM; `Transport` con reloj y timer **inyectables** | Permite testear el lookahead con reloj falso, sin navegador. |
| D-15 | Swing desplaza **sólo los pasos impares**, hasta 1/3 de paso, sin tocar la rejilla | A 100% el off-beat cae a 2/3 (shuffle clásico); el cursor no deriva el tempo. |
| D-16 | Tope de 64 pasos planificados por tick | Si una pestaña se congela, el reloj de audio salta; se descarta el atraso en vez de agendar miles de notas. |
| D-17 | El estado vive en `studio.svelte.ts` y el motor lo lee con *getters* en vivo | Imposible que la UI y el audio se desincronicen. |
| D-18 | `onpointermove` en `<svelte:window>` para pintar arrastrando | El puntero sale de la celda inicial; además, el listener en la `<table>` disparaba `a11y_no_noninteractive_element_interactions`. |
| D-19 | La rejilla es una `<table>` real con `th scope="row"`/`col` y botones con `aria-pressed` | Semántica de tabla = relación fila/columna gratis, sin implementar el patrón ARIA `grid` a mano. |
| D-20 | Edición de nota con **Mayús + clic** (cicla la pentatónica) | El brief no pide edición de notas; así se consigue completa en ~15 líneas sin duplicar la UI. |
| D-21 | Rango del bajo A1–C3 (33–48) | Por debajo de ~55 Hz la línea de bajo desaparece en altavoces de portátil. |
| D-22 | Playwright **no** es dependencia del proyecto: `tools/visual-check.mjs` lo busca en `node_modules` y si no en la caché de `npx` | Es herramienta de verificación; la app no lo necesita. |
| D-23 | **WebGL 1 directo**, sin OGL ni Three.js | Los visuales son un quad a pantalla completa y un fragment shader propio. OGL/Three añadirían >100 KB para funcionalidad que no se usa. Justificación exigida por el brief. |
| D-24 | Los 3 modos comparten un **contrato de uniforms fijo** (`u_resolution`, `u_time`, `u_bands`, `u_level`, `u_intensity`) | El renderer cambia de modo sin tocar el cableado de uniforms; añadir un modo = añadir un shader y una entrada en `modes.ts`. |
| D-25 | Cada banda controla un parámetro **distinto** en los 3 shaders (graves → apertura/velocidad del túnel y núcleo; medios → energía global y deformación; agudos → octava fina de ruido, centelleo y tinte) | Requisito explícito del brief (C2). |
| D-26 | `u_intensity` baja a 0.3 con `prefers-reduced-motion` en vez de congelar la animación | Un frame totalmente estático se lee como "roto"; uno más calmado, no. |
| D-27 | Scrim degradado entre el canvas y la UI | El shader puede poner luz casi blanca en cualquier punto; sin scrim, la cabecera y el pie caían por debajo del contraste legible. |
| D-28 | El medidor de espectro publica los valores exactos que recibe el shader | Hace observable y testeable el enlace audio→visuales, y es una función real de la app, no sólo un gancho de test. |
| D-29 | `ResolutionController` con **escalera discreta** (1 / 0.85 / 0.7 / 0.6 / 0.5) e histéresis (3 ventanas lentas para bajar, 12 rápidas para subir) | Evita oscilar entre dos resoluciones, que se ve peor que quedarse en la baja. Lógica pura y testeable. |
| D-30 | La verificación visual decodifica PNG **dentro del navegador** (`Image` + `getImageData`) para medir brillo medio | Chromium ya trae decodificador PNG; evita añadir una librería de imagen al proyecto. |

---

## 4. Problemas abiertos / riesgos

- **R-01 (resuelto):** `sv create` ya no genera `svelte.config.js`; la config vive en `vite.config.ts` dentro de `sveltekit({...})`.
- **R-02 (abierto):** Tipografía. Ahora mismo se usa el *stack* de sistema (Space Grotesk / Inter están declaradas en `@theme` pero **no se cargan**). Pendiente en D2: decidir entre auto-hospedar `.woff2` o quedarse con el stack de sistema.
- **R-03 (abierto):** **El audio no se verifica de oído.** Ver §6 para lo que sí se verifica objetivamente.
- **R-04 (abierto):** En táctil, `touch-action: pan-x` en la rejilla hace que un arrastre vertical se convierta en scroll y el navegador cancele el `pointermove`. El toque simple sí funciona siempre.
- **R-05 (resuelto):** `vite preview` cachea el build → usar `python3 -m http.server` para verificar (ver §0).
- **R-06 (abierto):** En el entorno headless la renderización es software y ronda los 40-46 fps, justo en el umbral de C4. El back-off se dispara de forma no determinista en ventanas grandes; los tests unitarios del controlador son la fuente fiable, y el test visual comprueba el caso de carga alta forzada.

---

## 5. Verificaciones ejecutadas

Leyenda: ✅ ejecutado y en verde · — no aplica aún

| Fecha | Tarea | `pnpm check` | `pnpm build` | `pnpm test` | Visual (Playwright) |
|---|---|---|---|---|---|
| — | A1 | ✅ 0 errores | ✅ OK | — | ⏳ |
| — | A2 | ✅ 0 errores | ✅ OK | ✅ 21 casos | ⏳ (sin UI) |
| — | A3 | ✅ 0 errores | ✅ OK | ✅ 43 casos | ⏳ (sin UI) |
| — | A4 | ✅ 0 errores | ✅ OK | ✅ 46 casos | ⏳ (sin UI) |
| — | B1–B3 | ✅ 0 errores, 0 warnings | ✅ OK | ✅ 74 casos | ✅ |
| — | C1 | ✅ 0 errores, 0 warnings | ✅ OK | ✅ 74 casos | ✅ canvas con contexto WebGL real y animando |
| — | C2 | ✅ 0 errores, 0 warnings | ✅ OK | ✅ 90 casos | ✅ bandas con señal + brillo del canvas mayor sonando |
| — | C3 | ✅ 0 errores, 0 warnings | ✅ OK | ✅ 90 casos | ✅ 3 modos con hashes de frame distintos |
| — | C4 | ✅ 0 errores, 0 warnings | ✅ OK | ✅ 102 casos | ✅ 32 fps @2560×1440 → baja solo a 0,50× |

### Evidencia objetiva de audio (¡lo importante!)

No puedo oír nada, pero **sí puedo medir el grafo**. `AnalyserNode` está al final de la cadena maestra, y el medidor de espectro publica exactamente los números que recibe el shader. Medido sobre el build de producción:

1. **Hay señal mientras suena.** Picos durante 2,6 s de reproducción: `{ bass: 100, mid: 84, treble: 22 }` (porcentaje de escala completa). Prueba de que voces, drums, filtro, delay, reverb y compresor están conectados y produciendo.
2. **La señal modula la imagen.** Brillo medio del canvas (decodificado con `getImageData`): **68,9 sonando** vs **41,1 en silencio** (+68 %). Prueba de que el audio llega al shader.
3. **El grafo cae a silencio absoluto.** Cronología medida tras pausar (banda de graves): `100 → 99 → 72 → 42 → 16 → 0` a los 3 s, y se queda en **0 exacto** para siempre. Prueba de que no hay osciladores atascados, bucles de ruido vivos ni fuga de continua. La cola corresponde a la reverb (IR de 2,4 s) y al delay con feedback 0,34.
4. **El transporte sobrevive a cambios en vivo.** Mover BPM/swing/cutoff/volumen mientras suena no para el playhead ni lanza errores de consola.
5. **Los 3 modos son distintos de verdad:** 3 hashes de frame diferentes sobre el mismo recorte.

### Salida real de `pnpm verify:visual` (última pasada completa)

```json
{
  "httpStatus": 200,
  "title": "Pulse — estudio audiovisual",
  "cellCount": 80,
  "initialActiveCells": 19,
  "canvasHasWebgl": true,
  "canvasAnimates": true,
  "kickStep2After": "true",
  "padActiveAfterDrag": 6,
  "bassNoteBefore": "Bass, paso 1, activo, nota A1",
  "bassNoteAfter": "Bass, paso 1, activo, nota C2",
  "focusAfterArrow": "bass:1",
  "pauseButtonVisible": 1,
  "playheadText": "paso 09 / 16",
  "transportSurvivedLiveTweaks": true,
  "visualModeHashes": { "tunnel": "…", "ripple": "…", "particles": "…" },
  "visualModesAreDistinct": true,
  "bandPeaksWhilePlaying": { "bass": 100, "mid": 84, "treble": 22 },
  "analyserHasSignal": true,
  "meanBrightnessPlaying": { "mean": 68.92 },
  "bandPeaksAfterPause": { "bass": 0, "mid": 0, "treble": 0 },
  "graphFallsSilent": true,
  "meanBrightnessPaused": { "mean": 41.08 },
  "audioDrivesVisuals": true,
  "scaleBeforeLoad": 1,
  "renderStatsUnderLoad": "32 fps · 0.50×",
  "resolutionBacksOff": true,
  "mobileHorizontalOverflow": false,
  "reducedMotionMatches": true,
  "problems": []
}
```

Capturas en `.verify/`: `desktop-idle.png`, `desktop-playing.png`, `desktop-randomized.png`, `desktop-large-viewport.png`, `mobile-idle.png`, `reduced-motion.png`, `canvas-mode-{tunnel,ripple,particles}.png`, `mode-*-full.png`, `canvas-frame.png`.

---

## 6. Lo que NO está verificado

- **Sonido (nada).** El agente no puede escuchar. Que las voces, el bombo, el hi-hat, el delay y la reverb *suenen bien* está **sin verificar auditivamente**. Lo que sí está verificado es que el grafo produce señal, que responde a los cambios de parámetros y que cae a silencio exacto.
- **Latencia real / glitches de audio** bajo carga en una máquina real y con una interfaz de audio real.
- **Estética.** Que el diseño guste es un juicio humano. Verificado: no hay solapamientos, desbordes horizontales, texto ilegible ni errores de consola.
- **Pintar arrastrando en táctil** (R-04).
- **Recuperación de resolución en el navegador** (subir de nuevo la escala). Está cubierta por tests unitarios, pero en headless los fps (~45) caen dentro de la banda de histéresis, así que no se puede forzar de forma fiable.
- **Audio en Safari/Firefox.** Sólo se ha verificado en Chromium (Playwright). El código usa Web Audio estándar y GLSL ES 1.00, pero no está probado en otros motores.
- **Lighthouse / métricas reales** (pendiente en E3).

---

## 7. Siguiente paso

**D1 — Pantalla de inicio con botón "Start".**

Plan:
1. `StartOverlay.svelte`: capa a pantalla completa (`fixed inset-0 z-50`) con el wordmark, una frase de qué es Pulse y un botón grande "Empezar" que llama a `studio.start()`. El overlay desaparece (con transición) cuando `studio.status === 'ready'`.
2. Requisito duro: el `AudioContext` **sólo** puede crearse dentro de un gesto de usuario, así que ningún `$effect` debe llamar a `studio.start()`.
3. Manejo de error: si `studio.status === 'error'`, mostrar `studio.error` en el overlay con un botón de reintento.
4. Empezar a tocar el teclado/mover un slider no debe arrancar el audio por accidente.
5. Criterio de aceptación: `pnpm check` y `pnpm build` en verde; en `visual-check.mjs`, la página recién cargada muestra el overlay y **no** crea ningún `AudioContext` (comprobar que el playhead sigue en "16 pasos · 5 pistas" y que el medidor está a 0), y tras pulsar "Empezar" el overlay desaparece y el transporte arranca.

Después: D2 (tipografía + microinteracciones), D3 (responsive/táctil), D4 (pasada de accesibilidad), D5 (localStorage + hash de URL con tests), E1 (README bilingüe), E2/E3 (build y pasada final).
