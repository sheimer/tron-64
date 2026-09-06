# Testing & Benchmarking Architecture

> **Audience:** Reference for AI agents and maintainers running, debugging, or extending automated test suites.

---

## 1. Unified Test Runner (`test/runAll.js`)

All automated tests are executed via `npm test` (`node test/runAll.js`):
* **Process Isolation:** Spawns each `test/*.test.js` file in a dedicated, isolated Node.js child process (`spawnSync`).
* **Forced Garbage Collection Flag:** Automatically passes `['--expose-gc', filePath]` to child processes so memory leak tests can invoke `global.gc()`.
* **Summary Reporting:** Formats execution times, assertions, and pass/fail counts.

---

## 2. Test Suite Overview

| Test Suite | Purpose | Key Techniques |
| :--- | :--- | :--- |
| `test/concurrency.test.js` | Verifies `MAX_ACTIVE_GAMES` limits and room creation guardrails. | Rapid allocation past limit and validation of room rejection errors. |
| `test/disconnect.test.js` | Verifies the 4 phases of disconnected client handling and trail ghosting. | Mock WebSocket drops, mid-round elimination checks, and zero-trail restart verification. |
| `test/explosion.test.js` | Verifies explosion particle cleanup, `Arena.reset()` flushing, wall breaches, client `Int8Array` buffer resets, and persistence isolation. | Mid-round crash simulation, expiration force-timeouts, border restoration, client buffer reset checks, and cold reboot disk isolation. |
| `test/leak.test.js` | Verifies zero server-side memory leaks over 500 game sessions. | 10 cycles creating/destroying 50 rooms with 2,000 players under `node --expose-gc`, asserting net heap $\Delta < 0.5\text{MB}$. |
| `test/metrics.test.js` | Verifies Prometheus metrics collector, gauges, counters, summary timers, and secured `/metrics` authorization. | Gauge room/player calculation checks, counter increments, tick summary timer assertions, and IP/token authorization testing. |
| `test/palette.test.js` | Verifies mathematical WCAG contrast, CIELAB color distance, CVD simulation, and template bindings. | Headless CSS parsing, WCAG 2.1 AA ratios ($\ge 4.5:1$ text, $\ge 3.0:1$ trails), CIELAB $\Delta E^*$, and Brettel/Viénot CVD matrices. |
| `test/persistence.test.js` | Verifies atomic snapshot storage and crash recovery. | Disk snapshot verification, cold server reboot simulation, and state restoration. |
| `test/scoreboard.test.js` | Verifies descending point sorting, tie-breaking heuristics, shared rankings (1224 competition rank), and scoretable HTML markup. | Standard competition ranking tests, tie-breaking assertions on kills/escapes, and Express template markup checks. |
| `test/spectator-speed.test.js` | Verifies spectator action locks and room speed synchronization. | Spectator authorization rejection on `START_GAME` / `SET_INTERVAL`. |
| `test/welcome-view.test.js` | Verifies route rendering, welcome view lifecycle, legal modals, and email hydration. | Express template rendering assertions, state transition checks, and DOM modal controller tests. |
| `test/client-leak.test.js` | Verifies zero client browser memory and DOM element leaks. | Headless Chromium via Playwright, CDP `Performance.getMetrics`, and multi-round match lifecycles. |

---

## 3. Playwright Headless Browser Testing

`test/client-leak.test.js` verifies the complete frontend lifecycle:
* **Prerequisites:** `playwright` devDependency and Chromium binaries (`npx playwright install chromium`).
* **Graceful Skip:** If Playwright is not installed in the environment, the suite logs a skip notice and exits with code 0.
* **CDP Metrics:** Uses `Performance.enable` and `Performance.getMetrics` to inspect `JSHeapUsedSize`, `Nodes`, and `JSEventListeners`.
* **Assertions:**
  * Attached DOM elements (`document.querySelectorAll('*')`) must be strictly flat across matches ($\Delta = 0$).
  * Retained JS heap memory delta must remain $<1.0\text{MB}$.

---

## 4. Headless Concurrency Stress Benchmark (`npm run benchmark` / `npm run benchmark:stress`)

* Located in [benchmark/stress.js](../../benchmark/stress.js).
* **Quick Sanity Mode (`npm run benchmark`):**
  * Automatically applies `--quick` to run a fast (~1.5s) health verification against the default server limit (`MAX_ACTIVE_GAMES = 50`) at 40 FPS without pegging system resources.
* **Progressive Saturation & Stress Mode (`npm run benchmark:stress`):**
  * Dynamically ramps up active 4-player rooms in incremental batches (default: +100 rooms/stage) with active steering input injection and binary delta buffer encoding until performance degrades.
  * Monitors real-time health thresholds against the 25.0ms (40 FPS) frame budget:
    * **Warning (Frame Drops):** Average jitter $\ge 5.0\text{ms}$ or max event-loop spike $\ge 25.0\text{ms}$ (1 full frame dropped).
    * **Saturation ("Not Good Anymore"):** Average jitter $\ge 10.0\text{ms}$ (40%+ frame budget consumed by lag) or max spike $\ge 40.0\text{ms}$ (consecutive dropped frames).
  * Outputs live stage metrics, pinpointing the single-thread saturation limit, root cause degradation factor, and recommended maximum safe operating capacity before tearing down all sessions cleanly.
  * Supports CLI overrides: `--quick`, `--start`, `--step`, `--max`, `--duration`, `--jitter-threshold`, `--spike-threshold`.

---

## 5. Palette Verification Suite & Visual Gallery (`npm run test:palettes`)

* **Mathematical Accessibility Suite (`test/palette.test.js`):**
  - Parses `public/stylesheets/palettes.css` directly to ensure zero drift between production stylesheets and verification checks.
  - **WCAG 2.1 AA Contrast:** Enforces $\ge 4.5:1$ text contrast (`--color-fg` on `--color-bg`) and $\ge 3.0:1$ graphical visibility for all 6 player trails and `--color-rose` against `--color-bg`.
  - **CIELAB Perceptual Color Distance ($\Delta E^*$):** Computes Euclidean $\Delta E^*$ across all 15 player pairings ($\binom{6}{2}$) to ensure light-cycle vehicles are distinctly distinguishable during high-speed gameplay.
  - **CVD Simulation:** Validates legibility under Deuteranopia and Protanopia linear transformation matrices.
* **Offline Visual Gallery Generator (`scripts/generate-palette-gallery.js`):**
  - Executed via `npm run test:palettes`.
  - Generates `test/reports/palette-gallery.html` featuring side-by-side Dark and Light mode mockups for all 12 palettes, arena delta traces, scoreboard overlays, color swatches, and interactive SVG CVD filter simulation toggles.

---

## 6. Code Quality, Static Analysis & Formatting

Static analysis and formatting tools maintain codebase readability and prevent silent runtime errors:

* **ESLint (`eslint.config.js`):**
  - Configured with ESLint flat config (`@eslint/js.configs.recommended`) and Node/Browser global environments.
  - Strictly enforces zero unused variables, imports, or dead symbols via `'no-unused-vars': ['error', { args: 'none' }]`.
  - Run static analysis: `npx eslint <files>` or `npx eslint .`.
* **Prettier (`prettier`):**
  - Enforces uniform code style across the repository: single quotes, trailing commas, 80-character print width, and no semicolons.
  - Format files: `npx prettier --write <files>`.
  - Check formatting without modifying: `npx prettier --check <files>`.


