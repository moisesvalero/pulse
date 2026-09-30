# PROGRESS — Pulse

> Memoria externa del agente. **Léeme al inicio de cada iteración y actualízame al final.**
> Si el contexto se reinicia, este archivo debe bastar para retomar sin preguntar nada.

- **Proyecto:** Pulse — estudio audiovisual interactivo en el navegador (secuenciador 16 pasos + sintetizador Web Audio propio + visuales WebGL reactivos).
- **Ruta local:** `~/Proyectos Web/webs/Sveltekit/Pulse`
- **Fecha de arranque:** 2026-02-14
- **Estado global:** EN CURSO

---

## 0. Contexto de entorno (importante)

| Hecho | Valor |
|---|---|
| SO real de la sesión | **macOS** (no Windows). El brief pedía Windows/PowerShell 7, pero la sesión corre en macOS. |
| Shell usado | `bash` (zsh/bash nativo), tal como manda `~/.dsh/AGENTS.md` para macOS. |
| Node / pnpm | Node v22.23.2 · pnpm 12.5.1 |
| Navegador para verificación | **Playwright 1.63 con Chromium en caché** (`~/Library/Caches/ms-playwright`). Chrome del sistema NO está instalado. |
| Decisión | Ejecuto los comandos en bash porque el host es macOS. Los scripts de `package.json` son cross-platform (sin sintaxis bash-only), así que el proyecto sigue siendo usable en PowerShell 7 sin cambios. |

---

## 1. Checklist de tareas

### A. Base y audio

- [x] **A1.** Proyecto SvelteKit limpio + estructura `src/lib/{audio,visuals,components,stores,utils}`
- [ ] **A2.** Motor de audio: 3 voces (osciladores + filtro + ADSR), bombo y hi-hat sintetizados
- [ ] **A3.** Scheduler con lookahead ("two clocks") + función pura testeable + tests vitest
- [ ] **A4.** Cadena maestra: gain → filtro → delay/reverb → compresor → AnalyserNode

### B. Secuenciador

- [ ] **B1.** Rejilla 16 pasos × 5 pistas (clic y arrastre) + indicador de paso actual
- [ ] **B2.** Controles en tiempo real: BPM, volumen, cutoff, resonancia, delay, swing
- [ ] **B3.** Randomize con escala menor pentatónica (lógica pura + tests)

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
| D-01 | `@sveltejs/adapter-static` con `fallback: '404.html'` y `fallback` en lugar de `index.html` | App 100% cliente. El fallback evita colisión con la home prerenderizada. `strict: true` para detectar rutas no prerenderizadas. |
| D-02 | Tailwind CSS **v4** vía plugin `@tailwindcss/vite` (sin `tailwind.config.js`, sin PostCSS) | Es la vía oficial actual para SvelteKit; el tema vive en el bloque `@theme` de `src/app.css`. Menos archivos y menos dependencias. |
| D-03 | `vitest` con `vitest.config.ts` propio, `environment: 'node'` | Los tests cubren sólo lógica pura (scheduler, patrones, serialización). No hace falta jsdom ni el plugin de SvelteKit → suite rápida. Alias `$lib` declarado a mano. |
| D-04 | TypeScript estricto + `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride`, `verbatimModuleSyntax` | El brief exige TS estricto y código limpio. `verbatimModuleSyntax` obliga a `import type`, que evita imports fantasma en runtime. |
| D-05 | Idioma de la UI: **español**, `lang="es"` | El brief pide README bilingüe pero no fija idioma de UI. La audiencia natural del portfolio es hispanohablante; se documenta en el README. |
| D-06 | Sin librería de clases (`clsx`/`tailwind-merge`): helper propio `cn()` en `src/lib/utils/cn.ts` | El brief pide no meter dependencias innecesarias. El helper son 3 líneas. |
| D-07 | `runes: true` forzado por el scaffold (Svelte 5) | Ya venía configurado; lo mantengo. Todo el proyecto usa runas (`$state`, `$derived`, `$effect`, `$props`). |
| D-08 | Paleta y tipografía centralizadas en `@theme` de `src/app.css` | Un solo origen de verdad para el diseño; Tailwind genera las utilidades (`bg-void`, `text-chalk`, `font-display`…). |

---

## 3. Problemas abiertos / riesgos

- **R-01 (resuelto):** `sv create` ya no genera `svelte.config.js`; la config de SvelteKit vive en `vite.config.ts` dentro de `sveltekit({...})`. Verificado leyendo el scaffold generado.
- **R-02:** Fuentes tipográficas: aún no decidido si auto-hospedar `.woff2` (Space Grotesk / Inter) o usar stack de sistema. Pendiente en D2.
- **R-03:** El AudioContext no puede verificarse de forma audible por el agente. Todo lo sonoro se marcará como **"no verificado auditivamente"**.

---

## 4. Verificaciones ejecutadas

| Fecha | Tarea | `pnpm check` | `pnpm build` | `pnpm test` | Visual (Playwright) |
|---|---|---|---|---|---|
| 2026-02-14 | A1 | ✅ 0 errores | ✅ OK | — (sin tests aún) | ⏳ pendiente |

---

## 5. Siguiente paso

**A2 — Motor de audio.** Crear `src/lib/audio/` con:
- `types.ts`: tipos compartidos (nombre de pista, params de voz, etc.)
- `synth.ts`: voz genérica `createVoice(ctx, destination, options)` → osciladores + filtro + envolvente ADSR aplicada en `gainNode.gain` con `setValueAtTime`/`linearRampToValueAtTime`.
- `drums.ts`: bombo (oscilador senoidal con pitch-drop + click) y hi-hat (ruido blanco por `AudioBufferSourceNode` + filtro paso-alto + envolvente corta).
- Criterio de aceptación: `pnpm check` y `pnpm build` en verde; el módulo no toca el DOM al importarse (testeable en node en el futuro).
