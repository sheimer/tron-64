# Retro Multiplayer Tron — Roadmap & Backlog

This document outlines upcoming architectural improvements, networking enhancements, and gameplay features for the Retro Multiplayer Tron project.

---

## Milestone 2: Game Room & Server Lifecycle

Focus on room creation options, host permissions, privacy, and process recovery.

- [ ] **Game Speed Setting & Host Round Lifecycle Controls**
  - *Problem:* Game speed currently defaults globally to `NORMAL` (40 FPS / 25ms interval), cannot be chosen during room creation in the lobby, and can be changed mid-round by any participant. Additionally, there is no HUD indicator showing when a match runs at non-standard speeds.
  - *Proposed Solution:*
    - **Lobby Game Creation:** Add a speed selection dropdown/control in the lobby creation form (`LobbyView`), initializing the room with the selected interval.
    - **Host-Only Authorization:** Restrict `MSG_TYPE.SET_INTERVAL` permissions strictly to the room creator / host.
    - **Round-Gated Adjustment:** Enforce that speed can only be modified between rounds (when no active round is running, e.g. in config, round finish, or game reset states).
    - **HUD Speed Indicator Icon:** Display a visual indicator icon in the header / HUD whenever game speed is not `NORMAL` (e.g. snail icon for `SLOW`, and a high-speed icon for `FAST`). Note: Icons will be supplied and imported into `public/remixicon/` following [`public/remixicon/README.md`](file:///home/hidden/projects/tron/public/remixicon/README.md).
- [ ] **Player Slot Relinquishing & Mid-Game Replacement Joining**
  - *Problem:* Once a player disconnects or leaves, their slot remains locked to their `sessionStorage` identity unless manually re-joined. New lobby visitors cannot take over vacated light-cycle slots in ongoing matches.
  - *Proposed Solution:*
    - Allow players to explicitly surrender/vacate a slot (clearing session ownership).
    - Allow new lobby players to join ongoing matches by taking over abandoned light-cycles.
    - Provide a "Lock Room" toggle for room hosts who want private rosters.
- [ ] **Hidden / Unlisted Private Games**
  - *Problem:* All games are currently broadcast publicly to the lobby list.
  - *Proposed Solution:*
    - Add a "Private / Unlisted" toggle in the game creation form (`isPublic: false`).
    - Exclude unlisted games from `MSG_TYPE.LOBBY_LIST`.
    - Allow players to join directly via URL hash (`https://domain.com/#gameId`) or a "Join by Game ID" input field.

---

## Milestone 3: Polish & Game Modes

Focus on scoring UX, color palettes, visual artifact cleanups, retro audio, and single-player options.

- [ ] **Multiple Color Schemes & Palette Presets (Zenbones & Beyond)**
  - *Dedicated Plan:* [`docs/plans/2026-09-05-multi-palette-color-schemes.md`](docs/plans/2026-09-05-multi-palette-color-schemes.md)
  - *Context / Problem:* The current palette in `public/stylesheets/var.css` is based on `forestbones` (from the [`zenbones.nvim`](https://github.com/zenbones-theme/zenbones.nvim) collection) with manual by-eye contrast adjustments (notably `-hl` and `-muted` variations). The game currently only supports switching between Light, Dark, and Auto mode for this single palette.
  - *Proposed Solution:*
    - **Palette System Architecture:** Implement a multi-palette theming structure (e.g. CSS `data-theme` or `data-palette` attributes on the document root) overriding `--color-*` variables dynamically.
    - **Zenbones Family Presets:** Introduce additional schemes from the Zenbones collection (e.g. `zenbones`, `zenburned`, `tokyobones`, `rosebones`, `nordbones`, `duckbones`, `seoulbones`) with tuned light and dark variants.
    - **Non-Editor Aesthetic Palettes:** Add distinctive retro palettes not derived from code editors (e.g. neon arcade, green/amber monochrome phosphor CRT, cyberpunk synthwave, or pastel vaporwave).
    - **Settings Selection & Persistence:** Add a color scheme picker in Settings (`SettingsView`) persisting to `localStorage`, hot-swapping live computed CSS variables across the canvas delta renderer, player trail colors, and UI elements.
    - **Contrast & Visibility Balancing:** Fine-tune `-hl` and `-muted` contrast values for each palette to ensure optimal trail legibility and accessibility in both light and dark modes.
- [ ] **Scoreboard Sorted by Score**
  - *Problem:* Scoreboard currently displays players in registration order (Player 0, 1, 2...).
  - *Proposed Solution:* Sort the scoreboard rows descending by total points (`total`), with visual position rank badges (1st, 2nd, 3rd, etc.).
- [ ] **Explosion Ghosting Bug Verification**
  - *Problem:* In earlier versions, residual explosion particles from a previous round would occasionally persist or flash on the canvas at the start of a new round.
  - *Proposed Solution:* Verify that `Arena.reset()` cleanly clears `this.explosions = []` and that the hybrid delta renderer's local `Int8Array` buffer resets all cells to `CELL_TYPE.EMPTY` / `CELL_TYPE.BORDER` upon match start.
- [ ] **Procedural Retro Web Audio SFX (Zero Assets)**
  - *Proposed Solution:* Implement synthesized chiptune audio via the browser's native Web Audio API (zero audio file downloads):
    - Light-cycle engine hum
    - Direction turn click (blip)
    - Collision & particle explosion crunch noise
    - Victory / game over fanfare
    - Mute audio toggle in Settings.
- [ ] **Single-Player Practice Bot (AI)**
  - *Proposed Solution:* A lightweight survival heuristic bot (wall avoidance + flood-fill open space navigation) for offline or solo practice when no lobby opponents are available.

---

## Milestone 4: Mobile & Touch Experience

Focus on mobile ergonomics, touch input latency, and display scaling.

- [ ] **Mobile Landscape 16:10 Layout**
  - *Dedicated Plan:* [`docs/plans/2026-08-17-mobile-landscape-layout.md`](file:///home/hidden/projects/tron/docs/plans/2026-08-17-mobile-landscape-layout.md)
  - Height-driven 16:10 aspect ratio scaling for smartphones and tablets.
  - Ergonomic split thumb controls flanking the arena canvas (Retro handheld style).
- [ ] **Instant Touch Reactivity (`pointerdown` & Input Queue)**
  - *Problem:* Standard `click` handlers on mobile have a 100–300ms tap delay, and rapid successive taps get dropped or misinterpreted as zoom gestures.
  - *Proposed Solution:*
    - Switch button touch handlers to `pointerdown` / `touchstart` with `touch-action: manipulation`.
    - Implement a client-side direction buffer queue so rapid turns (e.g. Left $\rightarrow$ Right within $<30\text{ms}$) are not lost before the server's next physics tick.
- [ ] **High-DPI / Zoom & Resolution Audit**
  - Verify that canvas sharpness, CSS variables, and touch boundaries adapt cleanly across 1x, 2x, and 3x device pixel ratios (Retina displays, foldable phones, and zoomed browser windows).

---

## Completed Milestones

For a chronological release history, see [CHANGELOG.md](CHANGELOG.md).

### Milestone 1: Network Resilience & Protocol Optimization (v1.1.0)
- **Connection Quality Indicator (CQI):** Persistent `#cqi` signal indicator with theme-adaptive colors and latency tooltips.
- **Smooth Reconnection Handling:** Restores local player identities and bindings from `sessionStorage.connectedGames`.
- **Disconnected Client Lifecycle & Trail Ghosting:** Mid-round vehicle explosion with obstacle trail preservation and starting coordinate zero-trail restarts on subsequent rounds. (Plan: [`docs/plans/2026-08-22-disconnected-client-lifecycle.md`](docs/plans/2026-08-22-disconnected-client-lifecycle.md)).
- **Binary Delta Streaming & Movement Protocol:** Compact binary ArrayBuffers for canvas delta broadcasts (`[Uint16 X, Uint16 Y, Int8 Value]`) and movement input frames (`[Opcode, PlayerID, Direction]`).

### Milestone 2: Server Concurrency, Stability & Lifecycles (v1.2.0 & v1.3.0)
- **Memory Leak Profiling & Verification (Server & Client):** Multi-cycle forced GC verification (`test/leak.test.js` under `node --expose-gc`) across 500 rooms ($\Delta < 0.25\text{MB}$), and Playwright headless browser test suite (`test/client-leak.test.js`) verifying bounded heap and strictly constant DOM retention. (Plan: [`docs/plans/2026-08-24-memory-leak-profiling-and-verification.md`](docs/plans/2026-08-24-memory-leak-profiling-and-verification.md)).
- **Server Concurrency & Capacity Limits:** Configurable `MAX_ACTIVE_GAMES` (default 50) and `MAX_CLIENTS_PER_ROOM` (default 32) guardrails with concurrency benchmark tooling (`npm run benchmark`). (Plan: [`docs/plans/2026-08-23-server-concurrency-capacity-limits.md`](docs/plans/2026-08-23-server-concurrency-capacity-limits.md)).
- **Match State Persistence & Crash Recovery:** Atomic JSON snapshot storage (`server/Storage.js`) persisting active game rooms and score tallies across daemon reboots and updates.
- **Spectator Controls & Permissions Restraint:** Disabled start/speed actions for spectator clients and enforced server-side validation. (Plan: [`docs/plans/2026-08-24-spectator-permissions-and-speed-sync.md`](docs/plans/2026-08-24-spectator-permissions-and-speed-sync.md)).
- **Synchronized Game Speed Across Clients:** Dynamically synced speed dropdowns across all connected clients on interval change.
- **Lobby Connection & Loading State Feedback:** 5-column spanning status rows in lobby table handling connection progress, empty room states, and reconnection. (Plan: [`docs/plans/2026-08-21-lobby-loading-state.md`](docs/plans/2026-08-21-lobby-loading-state.md)).
- **Lobby Return Navigation:** Dedicated "Lobby" buttons allowing players to return to the lobby while keeping player slots reclaimable via `sessionStorage`.

### Milestone 3: Welcome View, Tribute & Legal Scaffold (v1.4.0)
- **Initial Welcome / Landing Screen:** Full-screen retro card (`#welcome` in `#main`) celebrating Oliver Stiller's 1989 Commodore 64 party classic *Ultimate Tron II*, with multi-player mode descriptions, controls guide, and open-source references. (Plan: [`docs/plans/2026-08-28-welcome-page-and-branding.md`](docs/plans/2026-08-28-welcome-page-and-branding.md)).
- **Dedicated `#footer-welcome` & Responsive Layout:** Primary Call-to-Action button (`Enter Lobby →`) integrated into `#footer`, fully responsive in both portrait and 4-column landscape mobile layouts.
- **Header Info Navigation:** Info button (`#btn-info`) in `#controls` allowing players to navigate back to the Welcome/About screen from the lobby at any time.
- **Legal Notice (Impressum) & Privacy (Datenschutz) Modals:** Compliant self-contained modals disclosing § 5 DDG operator info and GDPR-compliant zero-cookie / server telemetry operations.
- **Rebranding Harmonization:** Title update to **Bitcycles** (`bitcycles.net`).

### Milestone 4: Operations, Telemetry & Infrastructure
- **Prometheus Metrics & Application Telemetry:** Integrated `@prometheus-io/client` in `server/metrics.js` tracking dynamic room counts, active driving players, WebSocket connections, round completion throughput, collision tallies, physics loop tick latency, and V8 heap/event loop statistics. (Plan: [`docs/plans/2026-08-29-telemetry-monitoring-and-alerting.md`](docs/plans/2026-08-29-telemetry-monitoring-and-alerting.md)).
- **Secured `/metrics` Endpoint:** Implemented defense-in-depth authorization in Express (`isMetricsRequestAuthorized`) supporting IP whitelisting (`METRICS_ALLOWED_IPS`) and Bearer token auth (`METRICS_TOKEN`) in addition to Nginx reverse proxy restrictions.
- **Automated Host & Engine Monitoring (Prometheus + Grafana):** Configured Prometheus and Grafana on the monitoring hub scraping `bitcycles_game` over HTTPS and `bitcycles_host` OS metrics via `prometheus-node-exporter` (port 9100).
- **Automated Postfix Email Alerting:** Configured Grafana alert rules (`BitcyclesDown`, `BitcyclesHighMemory`, `BitcyclesEventLoopLag`) routing instant notifications through local Postfix mail server (`127.0.0.1:25`) to admin aliases.


