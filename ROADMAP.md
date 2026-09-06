# Retro Multiplayer Tron — Roadmap & Backlog

This document outlines upcoming architectural improvements, networking enhancements, and gameplay features for the Retro Multiplayer Tron project.

---

## Milestone 2: Game Room & Server Lifecycle

Focus on room creation options, host permissions, privacy, and process recovery.

- [ ] **Game Speed Setting & Host Round Lifecycle Controls**
  - _Problem:_ Game speed currently defaults globally to `NORMAL` (40 FPS / 25ms interval), cannot be chosen during room creation in the lobby, and can be changed mid-round by any participant. Additionally, there is no HUD indicator showing when a match runs at non-standard speeds.
  - _Proposed Solution:_
    - **Lobby Game Creation:** Add a speed selection dropdown/control in the lobby creation form (`LobbyView`), initializing the room with the selected interval.
    - **Host-Only Authorization:** Restrict `MSG_TYPE.SET_INTERVAL` permissions strictly to the room creator / host.
    - **Round-Gated Adjustment:** Enforce that speed can only be modified between rounds (when no active round is running, e.g. in config, round finish, or game reset states).
    - **HUD Speed Indicator Icon:** Display a visual indicator icon in the header / HUD whenever game speed is not `NORMAL` (e.g. snail icon for `SLOW`, and a high-speed icon for `FAST`). Note: Icons will be supplied and imported into `public/remixicon/` following [`public/remixicon/README.md`](public/remixicon/README.md).
- [ ] **Player Slot Relinquishing & Mid-Game Replacement Joining**
  - _Problem:_ Once a player disconnects or leaves, their slot remains locked to their `sessionStorage` identity unless manually re-joined. New lobby visitors cannot take over vacated light-cycle slots in ongoing matches.
  - _Proposed Solution:_
    - Allow players to explicitly surrender/vacate a slot (clearing session ownership).
    - Allow new lobby players to join ongoing matches by taking over abandoned light-cycles.
    - Provide a "Lock Room" toggle for room hosts who want private rosters.
- [ ] **Hidden / Unlisted Private Games**
  - _Problem:_ All games are currently broadcast publicly to the lobby list.
  - _Proposed Solution:_
    - Add a "Private / Unlisted" toggle in the game creation form (`isPublic: false`).
    - Exclude unlisted games from `MSG_TYPE.LOBBY_LIST`.
    - Allow players to join directly via URL hash (`https://domain.com/#gameId`) or a "Join by Game ID" input field.

---

## Milestone 3: Polish & Game Modes

Focus on scoring UX, color palettes, visual artifact cleanups, retro audio, and single-player options.

- [ ] **Scoreboard Sorted by Score**
  - _Problem:_ Scoreboard currently displays players in registration order (Player 0, 1, 2...).
  - _Proposed Solution:_ Sort the scoreboard rows descending by total points (`total`), with visual position rank badges (1st, 2nd, 3rd, etc.).
- [ ] **Explosion Ghosting Bug Verification**
  - _Problem:_ In earlier versions, residual explosion particles from a previous round would occasionally persist or flash on the canvas at the start of a new round.
  - _Proposed Solution:_ Verify that `Arena.reset()` cleanly clears `this.explosions = []` and that the hybrid delta renderer's local `Int8Array` buffer resets all cells to `CELL_TYPE.EMPTY` / `CELL_TYPE.BORDER` upon match start.
- [ ] **Procedural Retro Web Audio SFX (Zero Assets)**
  - _Proposed Solution:_ Implement synthesized chiptune audio via the browser's native Web Audio API (zero audio file downloads):
    - Light-cycle engine hum
    - Direction turn click (blip)
    - Collision & particle explosion crunch noise
    - Victory / game over fanfare
    - Mute audio toggle in Settings.
- [ ] **Single-Player Practice Bot (AI)**
  - _Proposed Solution:_ A lightweight survival heuristic bot (wall avoidance + flood-fill open space navigation) for offline or solo practice when no lobby opponents are available.
- [ ] **Dynamic Theme Registry & Plug-and-Play Palette Catalog**
  - _Problem:_ Adding a new theme/palette currently requires modifying multiple hardcoded locations across the codebase: CSS definitions in `public/stylesheets/palettes.css`, `<option>` elements in `views/controls.pug`, `EXPECTED_PALETTES` in `test/palette.test.js`, and `PALETTE_META` in `scripts/generate-palette-gallery.js`.
  - _Proposed Solution:_
    - Centralize palette metadata into a single data manifest (e.g. `shared/palettes.json` or individual CSS theme files with structured metadata headers).
    - **Custom Derivation Overrides Support:** Ensure the theme manifest/parser supports optional per-palette `-hl` and `-muted` derivation formulas (or raw CSS override blocks) so themes with unique optics (e.g. `arcade-neon` bloom, monochrome CRT decay) retain their specialized behaviors.
    - Dynamically populate the Settings dropdown selector (`<select id="game-palette">`) in Pug / `settingsView.js` from the manifest.
    - Automate `test/palette.test.js` and `scripts/generate-palette-gallery.js` to discover, verify, and generate swatch triads for all registered palettes dynamically without maintaining hardcoded arrays.
    - _Documentation:_ Update and expand `README.md` to document the plug-and-play theme architecture and provide clear developer instructions for creating, testing, and submitting custom palettes.
- [ ] **Feature Demo Showcase & Automated Media Recording Pipeline (GIFs / Video)**
  - _Dedicated Plan:_ [`docs/plans/2026-09-06-feature-demos-and-media-pipeline.md`](docs/plans/2026-09-06-feature-demos-and-media-pipeline.md)
  - _Problem:_ The repository and GitHub README currently lack visual gameplay animations (GIFs/videos) demonstrating unique mechanics:
    - Dynamic hot-swappable color palettes (Zenbones and retro CRT presets).
    - The 32-cell killzone trail cut-off mechanic and scoring bonuses.
    - Wall breach escaping through ragged holes blasted into arena borders.
    - Organic particle explosion dispersion and debris physics.
    Additionally, there is no in-engine feature demo or replay script allowing players or visitors to preview these mechanics interactively from the web UI.
  - _Proposed Solution:_
    - **In-Engine Scripted Demo Modes:**
      - Implement deterministic scripted sequences (or scripted bot routines) showcasing each core feature:
        - `themes`: Live gameplay demonstrating dynamic switching across the 12 color palettes in real-time.
        - `kill`: Two light-cycles engaging in a close-quarters interception where Player 2 crashes into Player 1's trailing killzone (last 32 cells), triggering the kill banner and kill score points.
        - `escape`: A light-cycle crashes directly adjacent to the arena border, explosive particles blast away border cells creating a breach, and a surviving light-cycle navigates through the opening to trigger the 3x-point `escaped!!!` round win.
        - `explosions`: A comparison or slow-motion sequence demonstrating the organic randomness of explosions (variable particle counts 16–20, randomized frame launch delays, non-linear velocity distribution, and random travel distances).
      - Make demos selectable directly from the game UI (e.g. "Watch Feature Demos" in the Welcome screen or settings modal) and via deep-link hash or query parameters (e.g. `#demo=escape`).
    - **Automated Headless Video & GIF Generation Script:**
      - Build a headless automation CLI script (`scripts/record-demos.js` or `npm run record:demos`) using Playwright to run the scripted scenarios at native canvas resolution.
      - Pipe frames or captured video to system `ffmpeg` using high-fidelity color quantization (`palettegen` / `paletteuse`) to generate crisp, loopable, lightweight `.gif` and `.mp4`/`.webm` assets in `docs/media/`.
    - **GitHub README & Documentation Assets:**
      - Embed the generated demo GIFs into `README.md` and feature documentation to illustrate game mechanics and visual aesthetics.


---

## Milestone 4: Mobile & Touch Experience

Focus on mobile ergonomics, touch input latency, and display scaling.

- [ ] **Mobile Landscape 16:10 Layout**
  - _Dedicated Plan:_ [`docs/plans/2026-08-17-mobile-landscape-layout.md`](docs/plans/2026-08-17-mobile-landscape-layout.md)
  - Height-driven 16:10 aspect ratio scaling for smartphones and tablets.
  - Ergonomic split thumb controls flanking the arena canvas (Retro handheld style).
- [ ] **Instant Touch Reactivity (`pointerdown` & Input Queue)**
  - _Problem:_ Standard `click` handlers on mobile have a 100–300ms tap delay, and rapid successive taps get dropped or misinterpreted as zoom gestures.
  - _Proposed Solution:_
    - Switch button touch handlers to `pointerdown` / `touchstart` with `touch-action: manipulation`.
    - Implement a client-side direction buffer queue so rapid turns (e.g. Left $\rightarrow$ Right within $<30\text{ms}$) are not lost before the server's next physics tick.
- [ ] **High-DPI / Zoom & Resolution Audit**
  - Verify that canvas sharpness, CSS variables, and touch boundaries adapt cleanly across 1x, 2x, and 3x device pixel ratios (Retina displays, foldable phones, and zoomed browser windows).

---

## Completed Milestones

For a chronological release history, see [CHANGELOG.md](CHANGELOG.md).

### Network Resilience & Protocol Optimization

- **Connection Quality Indicator (CQI):** Persistent `#cqi` signal indicator with theme-adaptive colors and latency tooltips.
- **Smooth Reconnection Handling:** Restores local player identities and bindings from `sessionStorage.connectedGames`.
- **Disconnected Client Lifecycle & Trail Ghosting:** Mid-round vehicle explosion with obstacle trail preservation and starting coordinate zero-trail restarts on subsequent rounds. (Plan: [`docs/plans/2026-08-22-disconnected-client-lifecycle.md`](docs/plans/2026-08-22-disconnected-client-lifecycle.md)).
- **Binary Delta Streaming & Movement Protocol:** Compact binary ArrayBuffers for canvas delta broadcasts (`[Uint16 X, Uint16 Y, Int8 Value]`) and movement input frames (`[Opcode, PlayerID, Direction]`).

### Server Concurrency, Stability & Lifecycles

- **Memory Leak Profiling & Verification (Server & Client):** Multi-cycle forced GC verification (`test/leak.test.js` under `node --expose-gc`) across 500 rooms ($\Delta < 0.25\text{MB}$), and Playwright headless browser test suite (`test/client-leak.test.js`) verifying bounded heap and strictly constant DOM retention. (Plan: [`docs/plans/2026-08-24-memory-leak-profiling-and-verification.md`](docs/plans/2026-08-24-memory-leak-profiling-and-verification.md)).
- **Server Concurrency & Capacity Limits:** Configurable `MAX_ACTIVE_GAMES` (default 50) and `MAX_CLIENTS_PER_ROOM` (default 32) guardrails with concurrency benchmark tooling (`npm run benchmark`). (Plan: [`docs/plans/2026-08-23-server-concurrency-capacity-limits.md`](docs/plans/2026-08-23-server-concurrency-capacity-limits.md)).
- **Match State Persistence & Crash Recovery:** Atomic JSON snapshot storage (`server/Storage.js`) persisting active game rooms and score tallies across daemon reboots and updates.
- **Spectator Controls & Permissions Restraint:** Disabled start/speed actions for spectator clients and enforced server-side validation. (Plan: [`docs/plans/2026-08-24-spectator-permissions-and-speed-sync.md`](docs/plans/2026-08-24-spectator-permissions-and-speed-sync.md)).
- **Synchronized Game Speed Across Clients:** Dynamically synced speed dropdowns across all connected clients on interval change.
- **Lobby Connection & Loading State Feedback:** 5-column spanning status rows in lobby table handling connection progress, empty room states, and reconnection. (Plan: [`docs/plans/2026-08-21-lobby-loading-state.md`](docs/plans/2026-08-21-lobby-loading-state.md)).
- **Lobby Return Navigation:** Dedicated "Lobby" buttons allowing players to return to the lobby while keeping player slots reclaimable via `sessionStorage`.

### Welcome View, Tribute & Legal Scaffold

- **Initial Welcome / Landing Screen:** Full-screen retro card (`#welcome` in `#main`) celebrating Oliver Stiller's 1989 Commodore 64 party classic _Ultimate Tron II_, with multi-player mode descriptions, controls guide, and open-source references. (Plan: [`docs/plans/2026-08-28-welcome-page-and-branding.md`](docs/plans/2026-08-28-welcome-page-and-branding.md)).
- **Dedicated `#footer-welcome` & Responsive Layout:** Primary Call-to-Action button (`Enter Lobby →`) integrated into `#footer`, fully responsive in both portrait and 4-column landscape mobile layouts.
- **Header Info Navigation:** Info button (`#btn-info`) in `#controls` allowing players to navigate back to the Welcome/About screen from the lobby at any time.
- **Legal Notice (Impressum) & Privacy (Datenschutz) Modals:** Compliant self-contained modals disclosing § 5 DDG operator info and GDPR-compliant zero-cookie / server telemetry operations.
- **Rebranding Harmonization:** Title update to **Bitcycles** (`bitcycles.net`).

### Operations, Telemetry & Infrastructure

- **Prometheus Metrics & Application Telemetry:** Integrated `@prometheus-io/client` in `server/metrics.js` tracking dynamic room counts, active driving players, WebSocket connections, round completion throughput, collision tallies, physics loop tick latency, and V8 heap/event loop statistics. (Plan: [`docs/plans/2026-08-29-telemetry-monitoring-and-alerting.md`](docs/plans/2026-08-29-telemetry-monitoring-and-alerting.md)).
- **Secured `/metrics` Endpoint:** Implemented defense-in-depth authorization in Express (`isMetricsRequestAuthorized`) supporting IP whitelisting (`METRICS_ALLOWED_IPS`) and Bearer token auth (`METRICS_TOKEN`) in addition to Nginx reverse proxy restrictions.
- **Automated Host & Engine Monitoring (Prometheus + Grafana):** Configured Prometheus and Grafana on the monitoring hub scraping `bitcycles_game` over HTTPS and `bitcycles_host` OS metrics via `prometheus-node-exporter` (port 9100).
- **Automated Postfix Email Alerting:** Configured Grafana alert rules (`BitcyclesDown`, `BitcyclesHighMemory`, `BitcyclesEventLoopLag`) routing instant notifications through local Postfix mail server (`127.0.0.1:25`) to admin aliases.

### Multiple Color Schemes & Palette Accessibility

- **Multi-Palette Color Scheme Architecture:** Implemented 12 hot-swappable color themes in [`public/stylesheets/palettes.css`](public/stylesheets/palettes.css) using `[data-palette="..."]` attribute selectors and `light-dark()` color resolution. (Plan: [`docs/plans/2026-09-05-multi-palette-color-schemes.md`](docs/plans/2026-09-05-multi-palette-color-schemes.md)).
- **Curated 12-Palette Catalog:** 8 Zenbones family palettes (`forestbones`, `zenbones`, `zenburned`, `tokyobones`, `rosebones`, `nordbones`, `duckbones`, `seoulbones`) and 4 retro display presets (`c64` Commodore 64 VIC-II tribute, `arcade-neon` synthwave, `amber-crt` amber phosphor CRT, `green-crt` P1 green phosphor CRT).
- **Settings UI & Hot-Swapping:** Grouped dropdown selector in Settings modal with `localStorage` persistence, dynamically updating canvas light trails, arena borders, particle explosions, and UI without page reload.
- **Automated Verification & Visual Gallery:** Automated contrast and CVD test suite (`test/palette.test.js`) and standalone visual gallery generator (`scripts/generate-palette-gallery.js`, `npm run test:palettes`).
