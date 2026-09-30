# PROGRESS — Pulse

> Memoria externa del agente. **Léeme al inicio de cada iteración y actualízame al final.**
> Si el contexto se reinicia, este archivo debe bastar para retomar sin preguntar nada.

- **Proyecto:** Pulse — estudio audiovisual interactivo en el navegador (secuenciador 16 pasos + sintetizador Web Audio propio + visuales WebGL reactivos).
- **Ruta local:** `~/Proyectos Web/webs/Sveltekit/Pulse`
- **Estado global:** ✅ **CHECKLIST COMPLETO (A1–E3).** Pendiente sólo de revisión humana de lo no verificable (sonido, estética) y de una decisión sobre el despliegue.

---

## 0. Contexto de entorno (importante)

| Hecho | Valor |
|---|---|
| SO real de la sesión | **macOS** (no Windows). El brief pedía Windows/PowerShell 7, pero la sesión corre en macOS. |
| Shell usado por el agente | `bash` (nativo de macOS), tal como manda `~/.dsh/AGENTS.md` para macOS. |
| Node / pnpm | Node v22.23.2 · pnpm 12.5.1 |
| Navegador de verificación | **Playwright 1.63 + Chromium en caché** (`~/.npm/_npx/.../playwright`). Chrome del sistema NO está instalado. |
| Lighthouse | 12.8.2 vía `npx`. Necesita `CHROME_PATH` apuntando al Chromium de Playwright (ver §7). |
| Portabilidad | Los scripts de `package.json` no usan sintaxis bash-only: el proyecto se ejecuta igual en PowerShell 7. |
| Servidor para verificar | `python3 -m http.server 4173 --directory build` (lee de disco en cada petición). **No** usar `vite preview` mientras se itera: cachea el listado de `build/` al arrancar y, tras un rebuild, sirve hashes antiguos → la página no hidrata y los tests visuales dan falsos negativos. |

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

- [x] **D1.** Pantalla de inicio con botón "Start" (gesto de usuario para el AudioContext)
- [x] **D2.** Diseño oscuro cuidado, tipografía, microinteracciones
- [x] **D3.** Responsive y táctil
- [x] **D4.** Accesibilidad: foco visible, ARIA, `prefers-reduced-motion`
- [x] **D5.** localStorage + compartir por URL (hash) + tests de serialización

### E. Entrega

- [x] **E1.** README en español e inglés
- [x] **E2.** Build estático listo para desplegar
- [x] **E3.** Pasada final: check + build + test + Lighthouse

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
  renderer.ts     VisualRenderer: contexto GL, caché de programas, rAF, fps, bandas, guarda de uniforms

src/lib/stores/
  studio.svelte.ts     estado único (patrón, params, swing, transporte, playhead) + toShareState/restoreFrom
  visuals.svelte.ts    modo visual, bandas en vivo, fps, escala, soporte WebGL
  persistence.ts       storage protegido, lectura de hash, construcción de URL (PURO)

src/lib/utils/
  share.ts        códec del estado a/desde el hash de URL (PURO)
  scale.ts        mapeo lineal/logarítmico de sliders (PURO)
  cn.ts           helper de clases

src/lib/components/
  Visualizer, StartOverlay, StudioHeader, VisualModeSwitcher, StepGrid, TransportControls,
  MixPanel, LevelMeter, Slider

tools/visual-check.mjs   verificación en navegador real (Playwright, NO es dependencia)
```

Flujo de datos: **la UI muta `studio`** → el motor lee `studio` con *getters* en cada paso (nunca copia estado) → el scheduler agenda en el reloj de audio → el `AnalyserNode` alimenta `analysis.ts` → los uniforms del shader. Un `$effect` en `+page.svelte` lee el snapshot completo del estado, y con eso queda suscrito a todo: no hay ninguna suscripción manual en el proyecto.

---

## 3. Decisiones tomadas

| # | Decisión | Motivo |
|---|---|---|
| D-01 | `@sveltejs/adapter-static`, `fallback: '404.html'`, `precompress: true`, `strict: true` | App 100% cliente. El fallback evita colisión con la home; la precompresión deja `.br`/`.gz` para cualquier hosting estático. |
| D-02 | Tailwind CSS **v4** vía `@tailwindcss/vite` (sin `tailwind.config.js` ni PostCSS) | Vía oficial actual; el tema vive en el bloque `@theme` de `src/app.css`. |
| D-03 | `vitest` con config propia, `environment: 'node'` | Los tests cubren sólo lógica pura. Sin jsdom → suite de ~300 ms. |
| D-04 | TS estricto + `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride`, `verbatimModuleSyntax` | `verbatimModuleSyntax` obliga a `import type` y evita imports fantasma. |
| D-05 | Idioma de la UI: **español**, `lang="es"`; README bilingüe | El brief pide README bilingüe pero no fija idioma de UI. |
| D-06 | Sin `clsx`/`tailwind-merge`: helper propio `cn()` | Cero dependencias de runtime. |
| D-07 | Voces **monofónicas y persistentes** | Cero asignaciones por paso, habilita el *glide* y evita clics. |
| D-08 | `cancelAndHoldAtTime` + respaldo sobre `param.value` en vez de `setValueAtTime(0, t)` | El pad libera >1 s y se re-dispara antes de terminar: saltar a 0 haría clic. |
| D-09 | Bombo = seno con barrido + clic de ruido HP; hi-hat = ruido blanco por HP + BP | Percusión sintetizada sin samples. Ruido generado en runtime y **en bucle**. |
| D-10 | Reverb = `ConvolverNode` con IR generada (ruido con decaimiento, estéreo independiente) | Convolución sin enviar ningún fichero IR. |
| D-11 | Delay y reverb como **caminos paralelos** wet/dry, no como inserts | Los controles de mezcla son ganancias y se mueven en vivo sin cortar la señal seca. |
| D-12 | Todo cambio de parámetro en vivo con `setTargetAtTime` (τ = 20 ms) | Sin clics ni cortes al mover sliders. |
| D-13 | Delay = corchea con puntillo, retimado sólo cuando cambia el BPM | Retimar `delayTime` dobla el tono de lo que ya está en la línea. |
| D-14 | Núcleo del scheduler (`planSteps`) puro; `Transport` con reloj y timer **inyectables** | Permite testear el lookahead con reloj falso, sin navegador. |
| D-15 | Swing desplaza **sólo los pasos impares**, hasta 1/3 de paso, sin tocar la rejilla | Shuffle clásico del 66 % sin que el tempo derive. |
| D-16 | Tope de 64 pasos planificados por tick | Si una pestaña se congela, el reloj salta; mejor descartar el atraso que agendar miles de notas. |
| D-17 | El estado vive en `studio.svelte.ts` y el motor lo lee con *getters* en vivo | Imposible que la UI y el audio se desincronicen. |
| D-18 | `onpointermove` en `<svelte:window>` para pintar arrastrando | El puntero sale de la celda inicial; además, el listener en la `<table>` disparaba `a11y_no_noninteractive_element_interactions`. |
| D-19 | La rejilla es una `<table>` real con `th scope` y botones `aria-pressed`; `table-fixed` | Relación fila/columna gratis para lectores de pantalla; `table-fixed` hace que todas las celdas midan lo mismo (el auto-layout encogía las vacías a 12 px). |
| D-20 | Edición de nota con **Mayús + clic** (cicla la pentatónica) | Da edición de pitch completa en ~15 líneas, sin duplicar la UI. |
| D-21 | Rango del bajo A1–C3 (33–48) | Por debajo de ~55 Hz la línea de bajo desaparece en altavoces de portátil. |
| D-22 | Playwright **no** es dependencia: `tools/visual-check.mjs` lo busca en `node_modules` y si no en la caché de `npx` | Es herramienta de verificación; la app no lo necesita. |
| D-23 | **WebGL 1 directo**, sin OGL ni Three.js | Los visuales son un quad y un fragment shader propio; esas librerías añadirían >100 KB para funcionalidad no usada. |
| D-24 | Los 3 modos comparten un **contrato de uniforms fijo** | El renderer cambia de modo sin tocar el cableado; añadir un modo = un shader + una entrada en `modes.ts`. |
| D-25 | Cada banda controla un parámetro **distinto** en los 3 shaders | Requisito explícito del brief (C2). |
| D-26 | `u_intensity` baja a 0,3 con `prefers-reduced-motion` en vez de congelar | Un frame totalmente estático se lee como "roto". |
| D-27 | Scrim degradado entre canvas y UI | El shader puede poner luz casi blanca en cualquier punto; sin scrim la cabecera y el pie caían por debajo del contraste legible. |
| D-28 | El medidor de espectro publica los valores exactos que recibe el shader | Hace observable y testeable el enlace audio→visuales, y es una función real de la app. |
| D-29 | `ResolutionController` con **escalera discreta** (1 / 0,85 / 0,7 / 0,6 / 0,5) e histéresis (3 ventanas lentas para bajar, 12 rápidas para subir) | Evita oscilar entre dos resoluciones, que se ve peor que quedarse en la baja. |
| D-30 | La verificación visual decodifica PNG **dentro del navegador** (`Image` + `getImageData`) | Chromium ya trae decodificador PNG; evita añadir una librería de imagen. |
| D-31 | **Auto-hospedar** Space Grotesk e Inter (subconjunto latin, WOFF2 variable, 70 KB) en lugar de un CDN | Sin peticiones a terceros, funciona offline y no depende de Google Fonts. Licencias OFL incluidas en `static/fonts/`. |
| D-32 | El mono se queda en el *stack* del sistema | Sólo renderiza lecturas numéricas de 10-12 px; ahorrar 40 KB de descarga vale más que la consistencia. |
| D-33 | Formato de hash **compacto y legible** (`#p1.<params>.<gates>.<notes>`) en vez de base64 de JSON | El BPM se lee directamente en la URL; el patrón entero cabe en <200 caracteres. |
| D-34 | La URL gana al `localStorage` al arrancar; y **cargar la página no reescribe la URL** | Seguir el enlace de alguien debe mostrar *su* patch. El hash aparece sólo cuando el usuario edita. |
| D-35 | Acceso a storage protegido y decodificación total (nunca lanza) | Leer `localStorage` lanza en algunos modos privados, y un hash corrupto no debe impedir arrancar. |
| D-36 | El renderer **no arranca** hasta que el usuario pulsa Empezar | Medido: la evaluación de script en carga cayó de 2155 ms a 68 ms. El shader se rasterizaba por software detrás de un overlay casi opaco. |
| D-37 | Escala tipográfica subida un punto (9→10, 10→11, 11→12 px) | Legibilidad real en móvil: el texto ≥12 px pasó del 59,8 % al 90,3 %. |
| D-38 | Los reemplazos de la escala tipográfica se hacen sobre placeholders, no en cascada | La primera sustitución colapsó toda la escala a 12 px porque cada regla volvía a tocar el resultado de la anterior. |
| D-39 | Guarda en el renderer: `console.error` si un shader no lee un uniform del contrato | Un uniform declarado y no usado lo elimina el compilador GLSL, `getUniformLocation` devuelve null y escribir en él es un no-op silencioso: así se coló el bug del `prefers-reduced-motion`. |

---

## 4. Problemas abiertos / riesgos

- **R-01 (resuelto):** `sv create` ya no genera `svelte.config.js`; la config vive en `vite.config.ts`.
- **R-02 (resuelto):** tipografía → auto-hospedada (D-31/D-32).
- **R-03 (abierto):** **El audio no se verifica de oído.** Ver §5 para lo que sí se mide objetivamente.
- **R-04 (abierto):** en táctil, `touch-action: pan-x` en la rejilla hace que un arrastre vertical se convierta en scroll y el navegador cancele el `pointermove`. El toque simple funciona siempre.
- **R-05 (resuelto):** `vite preview` cachea el build → usar `python3 -m http.server` al iterar.
- **R-06 (resuelto):** el back-off de resolución se dispara de forma no determinista en headless (los fps rondan el umbral de 45). Los tests unitarios del controlador son la fuente fiable y el test visual fuerza el caso de carga alta midiendo antes/después.
- **R-07 (abierto, decisión del usuario):** **despliegue en subdirectorio.** El sitio asume `/`. Las rutas de las fuentes son absolutas; publicar en un subpath requiere `paths.base` y cambiarlas. Documentado en el README.
- **R-08 (abierto):** sólo verificado en Chromium. Web Audio estándar y GLSL ES 1.00, pero sin probar en Safari ni Firefox.

---

## 5. Verificaciones ejecutadas (todas en verde)

| Tarea | `pnpm check` | `pnpm build` | `pnpm test` | Visual (Playwright) |
|---|---|---|---|---|
| A1–A4 | ✅ 0 errores | ✅ OK | ✅ 46 casos | ⏳ (sin UI) |
| B1–B3 | ✅ 0 errores, 0 avisos | ✅ OK | ✅ 74 casos | ✅ |
| C1–C4 | ✅ 0 errores, 0 avisos | ✅ OK | ✅ 102 casos | ✅ |
| D1–D5 | ✅ 0 errores, 0 avisos | ✅ OK | ✅ 140 casos | ✅ |
| E3 (final) | ✅ 0 errores, 0 avisos | ✅ OK | ✅ 140 casos | ✅ `problems: []` |

### Evidencia objetiva de audio (lo importante)

No puedo oír nada, pero **sí puedo medir el grafo**. El `AnalyserNode` está al final de la cadena maestra y el medidor de espectro publica exactamente los números que recibe el shader:

1. **Hay señal mientras suena.** Picos durante 2,6 s: `{ bass: 100, mid: 92, treble: 28 }` (% de escala completa). Prueba de que voces, drums, filtro, delay, reverb y compresor están conectados y produciendo.
2. **La señal modula la imagen.** Brillo medio del canvas (decodificando el PNG con `getImageData`, en la banda lateral donde no hay paneles ni scrim): **~60 sonando** vs **~32 en silencio**.
3. **El grafo cae a silencio absoluto.** Decaimiento medido de la banda de graves tras pausar: `100 → 99 → 72 → 42 → 16 → 0` a los 3 s, y se queda en **0 exacto**. Prueba de que no hay osciladores atascados, bucles de ruido vivos ni fuga de continua. La cola es la reverb (IR de 2,4 s) más el delay con feedback 0,34.
4. **`prefers-reduced-motion` reduce de verdad la intensidad visual.** A/B sobre la misma página y el mismo audio: **60,6 → 17,7 (−70,8 %)**, exactamente lo que predice `u_intensity = 0.3`. *(Esta comprobación descubrió un bug real: ningún shader leía `u_intensity`, así que el requisito no estaba implementado.)*
5. **Los 3 modos visuales son distintos de verdad:** 3 hashes de frame diferentes sobre el mismo recorte.
6. **El AudioContext sólo se crea con gesto del usuario:** 0 contextos antes del botón, exactamente 1 después (parcheando el constructor desde el propio test).
7. **Compartir funciona de extremo a extremo:** tras editar, la URL pasa a `#p1.150-60-2561-…`; cargando esa URL en un contexto de navegador **limpio**, el patrón y el BPM vuelven.
8. **Sin desbordamiento horizontal** a 390 px, **todos los objetivos táctiles ≥24 px**, etiquetas de pista *sticky* al hacer scroll, **0 fallos de contraste** en toda la interfaz.

### Lighthouse (build de producción, Chromium headless)

| Métrica | `python3 -m http.server` | `vite preview` |
|---|---|---|
| Rendimiento | 92 | **99** |
| Accesibilidad | **100** | **100** |
| Buenas prácticas | **100** | **100** |
| SEO | **100** | **100** |
| FCP / LCP | 2,5 s / 2,9 s | 1,4 s / 2,0 s |
| Total Blocking Time | **0 ms** | **0 ms** |
| CLS | **0** | **0** |

La primera medición (antes de D-36) dio **65** de rendimiento con **930 ms** de bloqueo y 2155 ms de evaluación de script. Informes en `.verify/lighthouse.json`, `.verify/lighthouse-2.json`, `.verify/lighthouse-preview.json` (ignorados por git).

---

## 6. Lo que NO está verificado

- **Sonido.** El agente no puede escuchar. Que las voces, el bombo, el hi-hat, el delay y la reverb *suenen bien* está **sin verificar auditivamente**. Verificado: que el grafo produce señal, que responde a los parámetros, que cae a silencio exacto y que no hay fugas.
- **Latencia real / glitches** bajo carga en una máquina real con una interfaz de audio real.
- **Estética.** Que el diseño guste es un juicio humano. Verificado: sin solapamientos, sin desbordes, sin texto por debajo del contraste AA, sin errores de consola.
- **Pintar arrastrando en táctil** (R-04).
- **Recuperación de resolución en el navegador** (subir de nuevo la escala tras bajarla): cubierta por tests unitarios; en headless los fps caen dentro de la banda de histéresis y no se puede forzar de forma fiable.
- **Safari y Firefox** (R-08).
- **Auditoría con lector de pantalla real.** Verificado por reglas y medición (nombres accesibles, etiquetas, contraste, foco, jerarquía de encabezados, tamaño de objetivos), no con NVDA/VoiceOver.

---

## 7. Comandos útiles para retomar

```bash
# Puerta obligatoria
pnpm check && pnpm test && pnpm build

# Verificación en navegador real (dos terminales)
python3 -m http.server 4173 --directory build
pnpm verify:visual                      # deja capturas y report.json en .verify/

# Lighthouse (Chrome del sistema no está instalado: se usa el Chromium de Playwright)
CHROME_PATH="$HOME/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
  npx lighthouse@12 "http://localhost:4174/" --only-categories=performance,accessibility,best-practices,seo \
  --output=json --output-path=.verify/lighthouse.json \
  --chrome-flags="--headless=new --no-sandbox --disable-gpu-sandbox" --quiet
```

---

## 8. Siguiente paso

El checklist está completo. Lo que queda es **decisión humana**, no trabajo pendiente:

1. **Escuchar el instrumento.** Es lo único que ninguna medición puede sustituir. Arrancar `pnpm dev`, pulsar Empezar y juzgar el balance de las cinco voces, el bombo y la reverb.
2. **Decidir el destino de despliegue.** Si es la raíz del dominio, `build/` se puede subir tal cual. Si es un subdirectorio, hay que definir `paths.base` y convertir las rutas de `/fonts/` (R-07).
3. **Revisar el acabado visual** en un dispositivo real: el agente sólo ha visto capturas de Chromium headless.
