# PROGRESS — Pulse

> Memoria externa del agente. **Léeme al inicio de cada iteración y actualízame al final.**
> Si el contexto se reinicia, este archivo debe bastar para retomar sin preguntar nada.

- **Proyecto:** Pulse — estudio audiovisual interactivo en el navegador (secuenciador 16 pasos + sintetizador Web Audio propio + visuales WebGL reactivos).
- **Ruta local:** `~/Proyectos Web/webs/Sveltekit/Pulse`
- **Estado global:** EN CURSO — secciones A y B completas; siguiente: C (visuales WebGL).

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

- [ ] **C1.** Canvas WebGL a pantalla completa detrás de la UI
- [ ] **C2.** Fragment shader reactivo al AnalyserNode (graves / medios / agudos → parámetros distintos)
- [ ] **C3.** Mínimo 3 modos visuales intercambiables
- [ ] **C4.** Control de rendimiento: si baja de 45 fps sostenidos, baja la resolución interna

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

## 2. Decisiones tomadas

| # | Decisión | Motivo |
|---|---|---|
| D-01 | `@sveltejs/adapter-static` con `fallback: '404.html'`, `strict: true` | App 100% cliente. El fallback evita colisión con la home prerenderizada. |
| D-02 | Tailwind CSS **v4** vía plugin `@tailwindcss/vite` (sin `tailwind.config.js` ni PostCSS) | Vía oficial actual para SvelteKit; el tema vive en el bloque `@theme` de `src/app.css`. |
| D-03 | `vitest` con `vitest.config.ts` propio, `environment: 'node'` | Los tests cubren sólo lógica pura. Sin jsdom ni plugin de SvelteKit → suite de ~200 ms. |
| D-04 | TS estricto + `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride`, `verbatimModuleSyntax` | El brief exige TS estricto; `verbatimModuleSyntax` obliga a `import type` y evita imports fantasma. |
| D-05 | Idioma de la UI: **español**, `lang="es"` | El brief pide README bilingüe pero no fija idioma de UI. |
| D-06 | Sin `clsx`/`tailwind-merge`: helper propio `cn()` | El brief pide no meter dependencias innecesarias. |
| D-07 | Voces **monofónicas y persistentes** (nodos creados una vez, las notas sólo escriben automatización) | Cero asignaciones por paso mientras suena el patrón; además habilita el *glide* (los osciladores no se reinician) y evita clics. |
| D-08 | `cancelAndHoldAtTime` + fallback a anclar en `param.value` en vez de `setValueAtTime(0, t)` | El pad libera >1 s y se re-dispara antes de terminar: saltar a 0 haría clic. |
| D-09 | Bombo = seno con barrido de tono + clic de ruido paso-alto; hi-hat = ruido blanco por paso-alto + paso-banda | Percusión sintetizada de verdad, sin samples ni ficheros binarios en el repo. Ruido generado en runtime y **en bucle** (no se recrea por golpe). |
| D-10 | Reverb = `ConvolverNode` con respuesta al impulso generada (ruido con decaimiento exponencial, estéreo) | Reverb de convolución sin enviar ningún fichero IR. |
| D-11 | Delay y reverb como **caminos paralelos** wet/dry, no como inserts | Los controles de mezcla son simples ganancias y se pueden mover en vivo sin cortar la señal seca. |
| D-12 | Todos los cambios de parámetro en vivo con `setTargetAtTime` (τ = 20 ms) | Sin clics ni cortes al mover sliders. |
| D-13 | Delay = corchea con puntillo, retimado sólo cuando cambia el BPM | Musicalmente es la elección clásica de secuenciador; retimar `delayTime` dobla el tono de lo que ya está en la línea, así que sólo se toca cuando el tempo cambia de verdad. |
| D-14 | El núcleo del scheduler (`planSteps`) es una función pura sin Web Audio ni DOM; `Transport` recibe reloj y timer **inyectables** | Es lo que permite testear el lookahead con reloj falso, sin navegador. |
| D-15 | Swing desplaza **sólo los pasos impares**, hasta 1/3 de paso, y no toca la rejilla | A 100% el off-beat cae a 2/3 del camino (shuffle clásico). El cursor avanza siempre por la rejilla sin swing → el tempo no deriva. |
| D-16 | Tope de 64 pasos planificados por tick | Si una pestaña en segundo plano se congela, el reloj de audio salta hacia delante; antes de agendar miles de notas seguidas, se descarta el atraso. |
| D-17 | El estado vive en `studio.svelte.ts` y el motor lo lee con *getters* en vivo | El motor nunca cachea el patrón: es imposible que la UI y el audio se desincronicen. |
| D-18 | `onpointermove` en `<svelte:window>` para pintar arrastrando | El puntero sale continuamente de la celda donde empezó; además, poner el listener en la `<table>` disparaba `a11y_no_noninteractive_element_interactions`. |
| D-19 | La rejilla es una `<table>` real con `th scope="row"`/`col` y botones con `aria-pressed` | Semántica de tabla = relación fila/columna gratis para lectores de pantalla, sin implementar el patrón ARIA `grid` a mano. |
| D-20 | Edición de nota con **Mayús + clic** (cicla la pentatónica) en vez de una fila de pitch por pista | El brief no pide edición de notas. Esto la da completa en ~15 líneas sin duplicar la UI. |
| D-21 | Rango del bajo A1–C3 (33–48) | Por debajo de ~55 Hz la línea de bajo desaparece en altavoces de portátil. |
| D-22 | Playwright **no** es dependencia del proyecto: `tools/visual-check.mjs` lo busca en `node_modules` y si no en la caché de `npx` | Es herramienta de verificación, la app no lo necesita. Evita engordar `package.json` del portfolio. |

---

## 3. Problemas abiertos / riesgos

- **R-01 (resuelto):** `sv create` ya no genera `svelte.config.js`; la config vive en `vite.config.ts` dentro de `sveltekit({...})`.
- **R-02 (abierto):** Tipografía. Ahora mismo se usa el *stack* de sistema (Space Grotesk / Inter están declaradas pero **no se cargan**). Pendiente en D2: decidir entre auto-hospedar `.woff2` en `static/` o quedarse con el stack de sistema.
- **R-03 (abierto):** **El audio no se puede verificar de oído.** Todo lo sonoro queda como "no verificado auditivamente" (ver §5).
- **R-04 (abierto):** En táctil, `touch-action: pan-x` en la rejilla hace que un arrastre vertical se convierta en scroll y el navegador cancele el `pointermove` (se deja de pintar). El toque simple para activar/desactivar sí funciona siempre. Es el compromiso estándar entre pintar arrastrando y poder hacer scroll.
- **R-05:** `vite preview` cachea el build → usar `python3 -m http.server` para verificar (ver §0).

---

## 4. Verificaciones ejecutadas

Leyenda: ✅ ejecutado y en verde · — no aplica aún · ⚠️ con matices

| Fecha | Tarea | `pnpm check` | `pnpm build` | `pnpm test` | Visual (Playwright) |
|---|---|---|---|---|---|
| 2026-02-14 | A1 | ✅ 0 errores | ✅ OK | — | ⏳ |
| 2026-02-14 | A2 | ✅ 0 errores | ✅ OK | ✅ 21 casos | ⏳ (sin UI todavía) |
| 2026-02-14 | A3 | ✅ 0 errores | ✅ OK | ✅ 43 casos | ⏳ (sin UI todavía) |
| 2026-02-14 | A4 | ✅ 0 errores | ✅ OK | ✅ 46 casos | ⏳ (sin UI todavía) |
| 2026-02-14 | B1–B3 | ✅ 0 errores, 0 warnings | ✅ OK | ✅ 74 casos | ✅ ver §5 |

### Detalle de la verificación visual (B1–B3)

Salida real de `node tools/visual-check.mjs` contra el build estático servido en `http://localhost:4173`:

```json
{
  "httpStatus": 200,
  "title": "Pulse — estudio audiovisual",
  "cellCount": 80,
  "initialActiveCells": 19,
  "kickStep2Before": "false", "kickStep2After": "true", "kickStep2Restored": "false",
  "padActiveAfterDrag": 6,
  "bassNoteBefore": "Bass, paso 1, activo, nota A1",
  "bassNoteAfter":  "Bass, paso 1, activo, nota C2",
  "focusAfterArrow": "bass:1",
  "pauseButtonVisible": 1,
  "playheadText": "paso 08 / 16",
  "playheadDuringLiveTweaks": ["paso 13 / 16", "paso 04 / 16"],
  "transportSurvivedLiveTweaks": true,
  "bpmAfterTweak": "150",
  "playheadAfterPause": "16 pasos · 5 pistas · Web Audio",
  "activeAfterRandomize": 17,
  "mobileHorizontalOverflow": false,
  "reducedMotionMatches": true,
  "problems": []
}
```

Capturas en `.verify/` (ignorado por git): `desktop-idle.png`, `desktop-playing.png`, `desktop-randomized.png`, `mobile-idle.png`, `reduced-motion.png`.

Esto demuestra: la página hidrata sin errores de consola, hay 80 celdas, el clic conmuta, el arrastre pinta 5 pasos seguidos, Mayús+Enter sube la nota (A1→C2), las flechas mueven el foco, el transporte arranca y avanza el playhead contra el reloj de audio, el transporte sobrevive a cambios en vivo de BPM/swing/cutoff/volumen sin pararse, y no hay desbordamiento horizontal en 390 px.

---

## 5. Lo que NO está verificado

- **Sonido (nada).** El agente no puede escuchar. Que las voces, el bombo, el hi-hat, el delay y la reverb *suenen bien* está **sin verificar auditivamente**.
- **Que el grafo de audio produzca señal.** El `AnalyserNode` está conectado, pero todavía no se lee desde la verificación visual. **Pendiente en D1**: exponer un puente `window.__pulse` sólo en dev con `audioState()` y `audioEnergy()`, y afirmar en `visual-check.mjs` que hay energía > 0 mientras suena. Eso convertiría "el motor arrancó" en "el motor produce señal".
- **Estética.** Que el diseño sea bonito es un juicio humano; lo verificado es que no hay solapamientos, desbordes ni errores.
- **Pintar arrastrando en táctil** (ver R-04).
- **Latencia/glitches reales de audio** en una máquina con carga.

---

## 6. Siguiente paso

**C1 — Canvas WebGL a pantalla completa detrás de la UI.**

Plan:
1. `src/lib/visuals/gl.ts`: helpers puros de WebGL (compilar shader con mensaje de error legible, crear programa, crear quad a pantalla completa, `resize` con `devicePixelRatio` limitado a 2).
2. `src/lib/visuals/Visualizer.svelte`: `<canvas class="fixed inset-0 -z-0">` que crea el contexto, monta el programa en `$effect` y **cancela el `requestAnimationFrame` y borra el contexto en el cleanup** (fuga de memoria: es la trampa clásica aquí).
3. Fallback: si no hay WebGL, dejar un fondo CSS con degradado y no romper la página.
4. Criterio de aceptación: `pnpm check` y `pnpm build` en verde; en `visual-check.mjs`, dos capturas separadas 400 ms del canvas deben dar hashes de píxel distintos (prueba de que el shader dibuja y anima de verdad) y `problems` debe seguir vacío.

Después: C2 (shader reactivo a graves/medios/agudos), C3 (3 modos), C4 (auto-bajar resolución por debajo de 45 fps).
