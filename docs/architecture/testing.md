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
| `test/persistence.test.js` | Verifies atomic snapshot storage and crash recovery. | Disk snapshot verification, cold server reboot simulation, and state restoration. |
| `test/spectator-speed.test.js` | Verifies spectator action locks and room speed synchronization. | Spectator authorization rejection on `START_GAME` / `SET_INTERVAL`. |
| `test/welcome-view.test.js` | Verifies route rendering, welcome view lifecycle, legal modals, and email hydration. | Express template rendering assertions, state transition checks, and DOM modal controller tests. |
| `test/leak.test.js` | Verifies zero server-side memory leaks over 500 game sessions. | 10 cycles creating/destroying 50 rooms with 2,000 players under `node --expose-gc`, asserting net heap $\Delta < 0.5\text{MB}$. |
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

## 4. Headless Concurrency Benchmarks (`npm run benchmark`)

* Located in `benchmark/concurrency.js`.
* Spins up 10, 25, and 50 simultaneous active rooms running 40 FPS physics loops.
* Measures server tick computation latency, event loop delay ($<1\text{ms}$), and memory overhead under high concurrency.
