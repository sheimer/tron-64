# Retro Multiplayer Tron — Roadmap & Backlog

This document outlines upcoming architectural improvements, networking enhancements, and gameplay features for the Retro Multiplayer Tron project.

---

## Milestone 1: Network Resilience & Latency

Focus on optimizing real-time packet delivery, handling unstable or high-latency connections, and managing disconnections gracefully.

- [x] **Connection Quality Indicator (CQI)**
  - *Problem:* Players on high-latency networks (e.g. mobile 4G or cross-border Wi-Fi with 80–200ms ping) experience delayed cycle turns without clear feedback.
  - *Solution:* Added persistent `#cqi` signal indicator next to `#ping` with theme-adaptive colors (🟢 Optimal $<60\text{ms}$, 🟡 Moderate $60-120\text{ms}$, 🔴 Poor $>120\text{ms}$, ⚫ Disconnected) and dynamic status tooltips, always visible even when numerical ping text is toggled off.
- [x] **Smooth Reconnection Handling**
  - *Problem:* Page reload or brief mobile carrier drops disconnect the player and can leave the session in an inconsistent state.
  - *Solution:* Preserved local player identities and keybindings in `sessionStorage.connectedGames`. On WebSocket reconnection or page reload, automatically re-joins active match rooms, populates local player controls, displays the scoreboard, and enables the start button for seamless continuation.
- [x] **Disconnected Client Lifecycle & Trail Ghosting**
  - *Dedicated Plan:* [`docs/plans/2026-08-22-disconnected-client-lifecycle.md`](docs/plans/2026-08-22-disconnected-client-lifecycle.md)
  - *Problem:* When a client disconnects, its light-cycles should explode mid-round leaving trails as obstacles, and on subsequent rounds explode at start ($t=0$) with zero trail left on the grid. Reconnecting clients should rejoin smoothly.
  - *Solution:* On socket disconnect (`ws.on('close')`), eliminates associated players immediately while preserving their trails as physical obstacles. On subsequent rounds, explodes offline cycles at start with zero trail. Disconnected players show a `[disconnected]` badge, and reconnected clients join as spectators before seamlessly resuming driving on the next round.
- [x] **Binary Delta Streaming & Movement Protocol**
  - *Problem:* JSON strings for real-time draw deltas and frequent direction turns create serialization, string allocation, and GC overhead.
  - *Solution:*
    - **Server Draw Streaming:** Packed delta updates into compact binary ArrayBuffers with 5-byte cell records (`[Uint16 X, Uint16 Y, Int8 Value]`) with zero-copy `DataView` canvas decoding for lightweight mobile throughput and resolution independence up to 65,535.
    - **Client Movement Inputs:** Packed `CHANGE_DIR` commands into 3-byte binary frames (`[Opcode 0x02, PlayerID, Direction]`) with an immediate fast-path on the server event loop bypassing `JSON.parse()`.

---

## Milestone 2: Game Room & Server Lifecycle

Focus on room privacy, concurrent server capacity, and process recovery.

- [x] **Spectator Controls & Permissions Restraint**
  - *Dedicated Plan:* [`docs/plans/2026-08-24-spectator-permissions-and-speed-sync.md`](docs/plans/2026-08-24-spectator-permissions-and-speed-sync.md)
  - *Problem:* Spectators (clients with zero registered players) can currently click "Start Game" on the config/score screen and modify game speed in settings.
  - *Solution:* Disabled "Start Game" buttons (`btnInitGame` and `startBtn`) and locked the speed dropdown for spectator clients. Enforced player-only authorization for `START_GAME` and `SET_INTERVAL` on the server in `wsHandler.js`.
- [x] **Synchronized Game Speed Across Clients**
  - *Problem:* When a player updates the game speed in config/settings, the new interval is not broadcast to other room clients, leaving their speed dropdowns and local settings out of sync.
  - *Solution:* Included `interval` in `gameServer.getGameInfo()`, broadcast updated `GAME_INFO` across the room on `SET_INTERVAL`, and dynamically synchronized the speed selector across all connected clients.
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
- [ ] **Memory Leak Profiling & Verification (Server & Client)**
  - *Dedicated Plan:* [`docs/plans/2026-08-24-memory-leak-profiling-and-verification.md`](docs/plans/2026-08-24-memory-leak-profiling-and-verification.md)
  - *Problem:* High-concurrency room lifecycles and extended browser play sessions could accumulate unreaped references (timers, listener closures, socket Sets, detached DOM nodes) leading to memory creep.
  - *Proposed Solution:*
    - **Server:** Multi-cycle allocation/deallocation stress tests under `node --expose-gc` asserting baseline return ($\Delta < 1.5\text{MB}$ across 10 cycles of 50 rooms).
    - **Client:** Headless browser profiling (Puppeteer / DevTools 3-snapshot protocol) asserting bounded heap, zero listener accumulation, and clean DOM disposal on match exit.
- [x] **Server Concurrency & Capacity Limits**
  - *Dedicated Plan:* [`docs/plans/2026-08-23-server-concurrency-capacity-limits.md`](docs/plans/2026-08-23-server-concurrency-capacity-limits.md)
  - *Problem:* Unlimited concurrent games could overload a single Node.js event loop during high traffic.
  - *Solution:* Introduced configurable `MAX_ACTIVE_GAMES` (default 50) and `MAX_CLIENTS_PER_ROOM` (default 32) guardrails with friendly inline Lobby feedback. Retained and enhanced the 5-minute inactivity auto-cleanup (`IDLE_ROOM_TIMEOUT_MS`). Added headless multi-room benchmark tooling (`npm run benchmark`) confirming $<1\text{ms}$ event loop jitter across 50 simultaneous 40 FPS matches.
- [x] **Match State Persistence & Graceful Restart Recovery**
  - *Problem:* Restarting the Node server daemon terminates all active games and wipes accumulated scores.
  - *Solution:* Implemented crash-safe atomic JSON snapshot storage (`server/Storage.js`) persisting active game rooms, registered players, and accumulated scores across service reboots and deployments without any I/O overhead during the 40 FPS physics loop.
- [x] **Lobby Connection & Loading State Feedback**
  - *Dedicated Plan:* [`docs/plans/2026-08-21-lobby-loading-state.md`](docs/plans/2026-08-21-lobby-loading-state.md)
  - *Problem:* On initial page load or reload, the lobby games table is empty with no visual feedback while the WebSocket connects and waits for the initial `LOBBY_LIST`.
  - *Solution:* Added inline 5-column spanning status row in `views/index.pug` and `LobbyView.js` handling "Connecting to server & fetching games...", "No active games found...", and "Connection lost. Reconnecting to server..." with zero layout jumps.

---

## Milestone 3: Polish & Game Modes

Focus on scoring UX, visual artifact cleanups, retro audio, and single-player options.

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
