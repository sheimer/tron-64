# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **Landing / Welcome View & Ultimate Tron II Homage:**
  - Initial welcome view (`#welcome` in `#main`) presenting the rich backstory of Oliver Stiller's 1989 Commodore 64 party classic *Ultimate Tron II*, highlighting 6 players on 1 keyboard and modern pure-web technology.
  - Dedicated `#footer-welcome` with responsive `Enter Lobby →` Call-to-Action button aligned with the existing desktop and mobile landscape 4-column layout grid.
  - Header Info icon (`#btn-info`) in `#controls` allowing players to return to the Welcome view from the lobby at any time.
- **Legal Notice (Impressum) & Privacy (Datenschutz) Modals:**
  - Integrated compliant legal notice modal (§ 5 DDG) and privacy notice modal (Art. 6(1)(f) GDPR) with zero-tracking cookie policy and in-memory server telemetry disclosures.
- **Automated Welcome View & Route Tests:**
  - `test/welcome-view.test.js`: Verified Express route rendering of `Bitcycles`, `#welcome`, `#footer-welcome`, modals, and `WelcomeView` lifecycle (backdrop click, escape key, and screen transitions).

### Changed
- Rebranded project and template title to **Bitcycles** (`bitcycles.net`).
- Default initial client screen set to `'welcome'` with seamless transition into `'lobby'`.
- Made `public/javascripts/state.js` isomorphic with safe global checks for `sessionStorage`.

---

## [1.3.0] - 2026-08-25

### Added
- **Automated Memory Leak Profiling Test Suites:**
  - `test/leak.test.js`: Multi-cycle forced garbage collection stress testing on the server (`node --expose-gc`), creating and destroying 500 game sessions with 2,000 players over 10 consecutive cycles, confirming zero heap memory creep ($\Delta < 0.25\text{MB}$).
  - `test/client-leak.test.js`: Headless browser test suite via Playwright querying Chrome DevTools Protocol (CDP) performance metrics across repeated match lifecycles to verify bounded browser heap ($\Delta < 0.1\text{MB}$) and strictly flat DOM element retention ($+0$).
- **Lobby Return Navigation:**
  - Added dedicated "Lobby" buttons to both the player configuration footer and in-game/scoreboard footers.
  - Implemented `MSG_TYPE.LEAVE_GAME` protocol action allowing players to exit running matches back to the lobby while keeping their local player slots reclaimable via `sessionStorage`.
- **License & Tribute Documentation:**
  - Added MIT License and nostalgic C64 homage documentation in `README.md`.

### Changed
- Converted form input listeners in `lobbyView.js` and `configView.js` from `onkeyup` to standard `oninput` for reliable typing, copy-pasting, and browser automation support.
- Pass `--expose-gc` flag automatically to child test runner processes in `test/runAll.js`.

### Fixed
- Fixed double-click / scoreboard flash issue when clicking "Lobby" during active or finished rounds by clearing socket room associations before broadcasting and guarding client match listeners.

---

## [1.2.0] - 2026-08-24

### Added
- **Server Concurrency & Capacity Limits:**
  - Configurable `MAX_ACTIVE_GAMES` (default 50) and `MAX_CLIENTS_PER_ROOM` (default 32) guardrails.
  - Graceful capacity feedback in the lobby creation form when the server reaches maximum active matches.
  - Retained 5-minute inactivity reaper (`IDLE_ROOM_TIMEOUT_MS`) to auto-destroy deserted rooms.
  - Headless multi-room stress benchmark (`npm run benchmark`) testing concurrency under load.
- **Match State Persistence & Crash Recovery:**
  - Atomic JSON snapshot storage (`server/Storage.js`) persisting active game rooms, registered players, and accumulated scores across daemon reboots and deployments.
- **Spectator Action Restraints & Synchronized Speed:**
  - Server-side guardrails preventing non-player spectator sockets from triggering `START_GAME` or `SET_INTERVAL`.
  - Broadcasted updated intervals across the room on `SET_INTERVAL` and synchronized client speed selectors dynamically without magic numbers.
- **Unified Test Runner:**
  - Created isolated child-process test runner in `test/runAll.js` executed via `npm test`.

---

## [1.1.0] - 2026-08-22

### Added
- **Disconnected Client Lifecycle Management:**
  - Mid-round disconnect handling: light-cycle explodes into particle sparks and freezes its trail on the grid.
  - Subsequent round starts keep disconnected players at starting coordinates without growing trail lines.
  - Reconnection recovery: returning players automatically reclaim their vehicle and rejoin active gameplay on the next round reset.
- **Lobby Loading & Connection State Feedback:**
  - Non-jumping 5-column spanning status rows in `views/index.pug` and `LobbyView.js` handling connection progress, empty room lists, and reconnecting states.

---

## [1.0.0] - 2026-08-18

### Added
- **Real-Time WebSocket Multiplayer Engine:**
  - Complete zero-dependency ES Modules architecture.
  - 40 FPS target-timestamp server physics loop absorbing OS timer jitter.
  - Binary draw coordinate delta packets (`Uint8Array` / `DataView`) for minimal bandwidth.
  - Hybrid delta HTML5 canvas renderer with dynamic device pixel ratio (DPR) and zoom scaling.
  - Local multiplayer support for up to 6 players on a single keyboard plus remote WebSocket players.
  - Multi-palette color theme system reading live computed CSS variables.
  - Crash resolution with simultaneous 2-in-1 spot collision tie handling.

---

## Project Origin & Pre-1.0.0 History (2023 – 2026)

Before adopting formal semantic versioning with the release of **v1.0.0**, the project evolved through several foundational development phases:

* **December 2023 (Project Genesis & WebSocket Prototype):**  
  * Transitioned from an initial client-only prototype into a Node.js server-authoritative multiplayer engine.
  * Replaced full-grid frame broadcasts with delta cell transmissions, implemented particle explosions on collision, and introduced the initial multi-game lobby and 6-player score calculations.
* **January 2024 (Game Flow & Session Handling):**  
  * Built multi-client player registration, state-driven lobby/config/game screen transitions, 5-minute inactivity room reaper, and automatic ping/reconnect monitoring.
* **July – August 2025 (Theming & UI Modernization):**  
  * Introduced dynamic light/dark/auto theme engine reading live CSS custom properties, multi-player palette color classes, settings persistence in `localStorage`, and responsive touch/desktop grid layouts.
* **August 2026 (Architecture Modernization $\rightarrow$ v1.0.0):**  
  * Refactored the entire codebase into modular isomorphic ES Modules (`shared/`, `server/`, `public/`), introduced the reactive state store, and unified networking under a single WebSocket protocol — establishing the **v1.0.0** baseline release.
