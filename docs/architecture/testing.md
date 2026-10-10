# Testing & Benchmarking Architecture

> **Audience:** Reference for AI agents and maintainers running, debugging, or extending automated test suites.

---

## 1. Unified Test Runner (`test/runAll.js`)

All automated tests are executed via `npm test` (`node test/runAll.js`):

- **Process Isolation:** Spawns each `test/*.test.js` file in a dedicated, isolated Node.js child process (`spawnSync`).
- **Forced Garbage Collection Flag:** Automatically passes `['--expose-gc', filePath]` to child processes so memory leak tests can invoke `global.gc()`.
- **Per-suite Timeout:** Each child is killed after 120 seconds and reported as failed, preventing hanging suites from blocking CI indefinitely.
- **Summary Reporting:** Formats execution times, assertions, and pass/fail counts.

---

## 2. Test Suite Overview

| Test Suite                                                                | Purpose                                                                                                                                            | Key Techniques                                                                                                                         |
| :------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| `test/concurrency.test.js`                                                | Verifies `MAX_ACTIVE_GAMES` limits and room creation guardrails.                                                                                   | Rapid allocation past limit and validation of room rejection errors.                                                                   |
| `test/disconnect.test.js`                                                 | Verifies the 4 phases of disconnected client handling and trail ghosting.                                                                          | Mock WebSocket drops, mid-round elimination checks, and zero-trail restart verification.                                               |
| `test/explosion.test.js`                                                  | Verifies explosion particle cleanup, `Arena.reset()` flushing, wall breaches, client `Int8Array` buffer resets, and persistence isolation.         | Mid-round crash simulation, expiration force-timeouts, border restoration, client buffer reset checks, and cold reboot disk isolation. |
| `test/leak.test.js`                                                       | Verifies zero server-side memory leaks over 500 game sessions.                                                                                     | 10 cycles creating/destroying 50 rooms with 2,000 players under `node --expose-gc`, asserting net heap $\Delta < 0.5\text{MB}$.        |
| `test/metrics.test.js`                                                    | Verifies Prometheus metrics collector, gauges, counters, summary timers, and secured `/metrics` authorization.                                     | Gauge room/player calculation checks, counter increments, tick summary timer assertions, and IP/token authorization testing.           |
| `test/palette.test.js`                                                    | Verifies mathematical WCAG contrast, CIELAB color distance, CVD simulation, and template bindings.                                                 | Headless CSS parsing, WCAG 2.1 AA ratios ($\ge 4.5:1$ text, $\ge 3.0:1$ trails), CIELAB $\Delta E^*$, and Brettel/Viénot CVD matrices. |
| `test/persistence.test.js`                                                | Verifies versioned atomic snapshot storage and score/roster recovery.                                                                              | Disk snapshot verification, cold server reboot simulation, and disconnected state restoration.                                         |
| `test/credential-persistence.test.js`                                     | Verifies private verifier durability, legacy/future snapshot handling, and registration write rollback.                                            | Real socket registration and reconnect across a cold restore, isolated snapshot fixtures, and forced save failure.                     |
| `test/scoreboard.test.js`                                                 | Verifies descending point sorting, tie-breaking heuristics, shared rankings (1224 competition rank), and scoretable HTML markup.                   | Standard competition ranking tests, tie-breaking assertions on kills/escapes, and Express template markup checks.                      |
| `test/spectator-speed.test.js`                                            | Verifies spectator action locks and room speed synchronization.                                                                                    | Spectator authorization rejection on `START_GAME` / `SET_INTERVAL`.                                                                    |
| `test/welcome-view.test.js`                                               | Verifies route rendering, welcome view lifecycle, legal modals, and email hydration.                                                               | Express template rendering assertions, state transition checks, and DOM modal controller tests.                                        |
| `test/browser-smoke.test.js`                                              | Required real-browser game smoke test.                                                                                                             | Isolated server/data, welcome-to-game navigation, two local players, and failure diagnostics.                                          |
| `test/ownership-flow.test.js`                                             | Required independent-context browser ownership journey.                                                                                            | Isolated server/data, two local players, reload, spectator rejection, partial handover, stale controls, and old-owner leave/close.     |
| `test/ownership-acceptance.test.js`                                       | Integrated real-socket ownership and credential audit.                                                                                             | Restart/reclaim, owner-safe movement and cleanup, protocol rejection, and private versus public message/log inspection.                |
| `test/client-leak.test.js`                                                | Verifies zero client browser memory and DOM element leaks.                                                                                         | Headless Chromium via Playwright, CDP `Performance.getMetrics`, and multi-round match lifecycles.                                      |
| `test/player-ownership.test.js`                                           | Verifies registration, socket authority, retry, binary movement, and handle exhaustion.                                                            | Real local WebSocket clients, isolated snapshot directory, and explicit room/socket teardown.                                          |
| `test/player-reconnect.test.js` and `test/reconnection-ownership.test.js` | Verify credential claims, partial and repeated handovers, owner-safe leave/close, fresh handles, capacity preflight, and real-disconnect recovery. | Real local WebSocket clients and isolated room/socket teardown.                                                                        |

---

## 3. Playwright Headless Browser Testing

`test/client-leak.test.js` verifies the complete frontend lifecycle:

- **Prerequisites:** `playwright` devDependency and Chromium binaries (`npx playwright install chromium`).
- **Local optional coverage:** The client-leak suite may skip if Playwright or Chromium is unavailable outside CI. In CI those conditions fail. Assertions fail in every environment; cleanup must never replace a failure with exit code 0.
- **Required browser coverage:** `test/browser-smoke.test.js` and `test/ownership-flow.test.js` never skip missing browser prerequisites. Install Chromium before running the complete suite. CI lints and executes both suites; the aggregated runner fails when either cannot launch.
- **CDP Metrics:** Uses `Performance.enable` and `Performance.getMetrics` to inspect `JSHeapUsedSize`, `Nodes`, and `JSEventListeners`.
- **Assertions:**
  - Attached DOM elements (`document.querySelectorAll('*')`) must be strictly flat across matches ($\Delta = 0$).
  - Retained JS heap memory delta must remain $<1.0\text{MB}$.

The client-leak fixture registers two local players in a new room per cycle, leaves and rejoins with both credentials, plays two rounds, then leaves. It reaps the empty fixture room on the server and waits for the normal lobby broadcast to prune the saved room record before measuring the next lobby baseline. The original heap, DOM, and event-listener thresholds remain intact. Browser smoke also transfers one of two local players to a second tab. The ownership-flow suite instead uses separate browser contexts for the owner, replacement, and spectator, so no ambient session storage is shared. It asserts feedback and bindings after a bad claim, reload, partial transfer, and the former owner's leave and close; failures preserve screenshots and server diagnostics in `test/artifacts/ownership-flow/`.

---

## 4. Headless Concurrency Stress Benchmark (`npm run benchmark` / `npm run benchmark:stress`)

- Located in [benchmark/stress.js](../../benchmark/stress.js).
- **Quick Sanity Mode (`npm run benchmark`):**
  - Automatically applies `--quick` to run a fast (~1.5s) health verification against the default server limit (`MAX_ACTIVE_GAMES = 50`) at 40 FPS without pegging system resources.
- **Progressive Saturation & Stress Mode (`npm run benchmark:stress`):**
  - Dynamically ramps up active 4-player rooms in incremental batches (default: +100 rooms/stage) with active steering input injection and binary delta buffer encoding until performance degrades.
  - Monitors real-time health thresholds against the 25.0ms (40 FPS) frame budget:
    - **Warning (Frame Drops):** Average jitter $\ge 5.0\text{ms}$ or max event-loop spike $\ge 25.0\text{ms}$ (1 full frame dropped).
    - **Saturation ("Not Good Anymore"):** Average jitter $\ge 10.0\text{ms}$ (40%+ frame budget consumed by lag) or max spike $\ge 40.0\text{ms}$ (consecutive dropped frames).
  - Outputs live stage metrics, pinpointing the single-thread saturation limit, root cause degradation factor, and recommended maximum safe operating capacity before tearing down all sessions cleanly.
  - Supports CLI overrides: `--quick`, `--start`, `--step`, `--max`, `--duration`, `--jitter-threshold`, `--spike-threshold`.

---

### Ownership performance diagnostics

[Ownership benchmark](../../benchmark/ownership-performance.js): run
`npm run benchmark:ownership -- --baseline HEAD` before committing a
simplification to compare the working renderer with the PR’s committed version.
Use another Git revision for a different baseline. The benchmark uses real
Chromium canvas drawing, warms both implementations, alternates their order,
and reports p50/p95/max CPU time for 6, 256, 4,096, and 64,000 changed cells.
The largest case is a full-grid stress bound, not an assumed typical delta.
Samples for smaller packets average ten calls to reduce timer-resolution noise;
the results measure draw submission, not GPU completion or displayed frame time.

The same command measures the existing per-player reconnect saves for 1, 2, and
6 players across registries of 1, 10, and 50 six-player rooms. It calls the real
`reconnectPlayer` and snapshot writer, reports synchronous batch time, snapshot
size, and delay of a timer scheduled immediately before the batch. Timer delay
includes normal timer scheduling overhead; this isolates persistence rather
than measuring complete WebSocket reconnect latency or concurrent game load.
Only temporary fixtures are written and removed.

Set `BENCHMARK_DATA_DIR` to an existing writable directory on the deployment
filesystem to measure representative disk behavior; the default temporary
filesystem may be much faster. Repeat on a quiet host, then inspect frame time
and long tasks during six-player explosion-heavy gameplay on a target mobile
browser. Compare tails against the 25 ms server tick budget and the browser’s
frame budget. Batch saves only if repeated measurements show meaningful stalls;
there are no machine-dependent timing assertions in the test suite.

Local diagnostic run on 2026-10-10 (Node 24.0.0, headless Chromium 151):
4,096-cell draw p95 was 0.86 ms on `main` and 0.87 ms after simplification;
the 64,000-cell stress bound was 13.0 ms and 12.9 ms respectively. Against
committed PR revision `435d923`, 4,096-cell p95 was 0.85 ms for both versions.
Six reconnecting players with 50 populated rooms produced a 164,175-byte
snapshot per save. The existing six saves took 2.94 ms at p95 on the temporary
filesystem and 4.37 ms on the project filesystem (maximum 4.40 ms, timer-delay
p95 4.41 ms). These are local synthetic diagnostics, not deployment or mobile
frame guarantees; they do not currently establish a need to batch saves.

---

## 5. Palette Verification Suite & Visual Gallery (`npm run test:palettes`)

- **Mathematical Accessibility Suite (`test/palette.test.js`):**
  - Parses `public/stylesheets/palettes.css` directly to ensure zero drift between production stylesheets and verification checks.
  - **WCAG 2.1 AA Contrast:** Enforces $\ge 4.5:1$ text contrast (`--color-fg` on `--color-bg`) and $\ge 3.0:1$ graphical visibility for all 6 player trails and `--color-rose` against `--color-bg`.
  - **CIELAB Perceptual Color Distance ($\Delta E^*$):** Computes Euclidean $\Delta E^*$ across all 15 player pairings ($\binom{6}{2}$) to ensure light-cycle vehicles are distinctly distinguishable during high-speed gameplay.
  - **CVD Simulation:** Validates legibility under Deuteranopia and Protanopia linear transformation matrices.
- **Offline Visual Gallery Generator (`scripts/generate-palette-gallery.js`):**
  - Executed via `npm run test:palettes`.
  - Generates `test/reports/palette-gallery.html` featuring side-by-side Dark and Light mode mockups for all 12 palettes, arena delta traces, scoreboard overlays, color swatches, and interactive SVG CVD filter simulation toggles.

---

## 6. Code Quality, Static Analysis & Formatting

Static analysis and formatting tools maintain codebase readability and prevent silent runtime errors:

- **ESLint (`eslint.config.js`):**
  - Configured with ESLint flat config (`@eslint/js.configs.recommended`) and Node/Browser global environments.
  - Strictly enforces zero unused variables, imports, or dead symbols via `'no-unused-vars': ['error', { args: 'none' }]`.
  - Run static analysis: `npx eslint <files>` or `npx eslint .`.
- **Prettier (`prettier`):**
  - Enforces uniform code style across the repository: single quotes, trailing commas, 80-character print width, and no semicolons.
  - Format files: `npx prettier --write <files>`.
  - Check formatting without modifying: `npx prettier --check <files>`.

## 7. GitHub Actions verification

[Tests workflow](../../.github/workflows/ci.yml) runs on branch pushes and pull requests targeting main. It uses Node 24, `npm ci`, and `npx playwright install --with-deps chromium`, then runs the unified `npm test` command with `CI=true`. The application runs on the runner with isolated test data; no deployment is required.

The workflow checks the CI test JavaScript with ESLint. Browser smoke failures retain a screenshot and Playwright trace where capture is possible. Test output is retained in a diagnostics artifact for seven days, including failed runs. The shell preserves the test command's failure through `tee`.

For autonomous work, a push is a validation candidate. Require a successful Tests run for the exact candidate commit before marking a package verified. Read failed job logs, fix the cause, push a follow-up commit, and check the new run. A cancelled, skipped, timed-out, or missing run is not passing evidence. This workflow does not configure branch protection or merge a PR automatically.

## 8. Roadmap orchestration skill

The repository-local [implement-roadmap-section skill](../../.agents/skills/implement-roadmap-section/SKILL.md) uses two human review points: the implementation plan before coding and the final PR. Explicit approval enables independent implementation/testing/review agents and phase-by-phase candidate pushes with CI verification. A progress document records the approved revision, real test evidence, and resume action.

Invoke `$implement-roadmap-section` to prepare a named roadmap section. Review and refine the plan, then explicitly request implementation of that approved revision. To resume, name the plan/branch; the agent verifies approval and current remote evidence first. Existing branches and plans are reused.

The skill travels with checkouts containing `.agents/skills/`. Hosts that do not discover repository skills automatically can be instructed to read its `SKILL.md` and follow its references. Merely connecting the GitHub repository does not install a personal ChatGPT skill. Available agents, model controls, GitHub permissions, and shell/browser capabilities still depend on the host.
