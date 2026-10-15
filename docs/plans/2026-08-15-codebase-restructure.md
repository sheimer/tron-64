# Plan: Tron Codebase Restructuring & Simplification

**Date:** 2026-08-15 (Updated: 2026-08-16)  
**Goal:** Restructure the Tron codebase to cleanly separate **Server**, **Client**, and **Shared** logic, unify the multi-socket WebSocket architecture into a single connection, optimize canvas rendering to true delta drawing, and eliminate state race conditions—while preserving the zero-build vanilla ES modules workflow and retro gameplay. Every phase produces a **runnable, reviewable commit**.

---

## 1. How Shared Files Work Without a Build Step

To keep the project a simple, zero-build playground (pure vanilla JavaScript and native browser ES modules):

1. Put shared pure JavaScript modules into a top-level `shared/` directory.
2. In `app.js`, expose the directory with a single static route:
   ```javascript
   app.use('/shared', express.static(path.join(__dirname, 'shared')))
   ```
3. **In the browser** (ES modules):
   ```javascript
   import { Player } from '/shared/Player.js'
   import { GRID_SIZE, CELL_TYPE } from '/shared/constants.js'
   ```
4. **On the Node server**:
   ```javascript
   import { Player } from '../shared/Player.js'
   import { GRID_SIZE, CELL_TYPE } from '../shared/constants.js'
   ```

No bundlers (Vite, Webpack), no transpilers, and no build scripts required.

---

## 2. Target File Structure

```
tron/
├── app.js                          # Express setup, static routes (/ & /shared), HTTP/WS upgrade
├── bin/
│   └── www.js                      # Server startup script
│
├── shared/                         # Pure JS (zero dependencies, runs in Node & Browser)
│   ├── constants.js                # Field values (-3..5), grid dimensions (320x200), speeds
│   ├── protocol.js                 # WebSocket message types & payload contracts
│   ├── Player.js                   # Pure player model (direction stack, position, killzone)
│   └── utils.js                    # Pure math helpers (fisherYatesShuffle, getRandomInt)
│
├── server/                         # Server-only (Node.js)
│   ├── GameServer.js               # In-memory registry of active game sessions
│   ├── GameSession.js              # Match coordinator (tick loop, player scores, state)
│   ├── Arena.js                    # 2D collision grid & physics simulation
│   ├── Explosion.js                # Particle physics for player explosions
│   └── wsHandler.js                # Unified WebSocket router (lobby, game, ping)
│
├── public/                         # Client-only (Browser assets & scripts)
│   ├── favicon/ & images/          # Static assets
│   ├── stylesheets/                # CSS styles
│   └── javascripts/
│       ├── main.js                 # Frontend entry point & view coordinator
│       ├── state.js                # Reactive client state store (screen & game state)
│       ├── network.js              # Unified WebSocket client (handles lobby, game, ping)
│       ├── renderer.js             # High-performance delta canvas renderer
│       ├── settings.js             # User preferences (theme, speed, ping toggle)
│       ├── theme.js                # Direct CSS variable color resolver
│       └── ui/
│           ├── dropdown.js         # Dropdown helper
│           ├── lobbyView.js        # Game list & creation UI
│           ├── configView.js       # Player setup & key bindings UI
│           ├── gameView.js         # Scoreboard, kill messages, touch controls
│           └── settingsView.js     # Settings modal & theme controls
│
└── views/                          # Pug templates
    ├── layout.pug
    ├── index.pug
    └── controls.pug
```

---

## 3. Key Architectural Changes

### A. Unified WebSocket Connection

- **Current:** Opens 3 separate WebSocket connections (`/ws/echo`, `/ws/lobby`, `/ws/game/:id`).
- **Proposed:** **1 WebSocket connection** (`/ws`) per client.
  - **Ping/Latency:** Client sends `{ type: 'PING', timestamp }`, server responds with `{ type: 'PONG', timestamp }`.
  - **Lobby:** Client receives automatic game list updates (`LOBBY_LIST`) when not in a match; sends `CREATE_GAME` or `JOIN_GAME`.
  - **Gameplay:** Real-time messages (`GAME_DRAW`, `GAME_FINISH`, `GAME_RESET`, `CHANGE_DIR`) routed by current session ID on the single socket.

### B. Hybrid Canvas Rendering (Local Grid State + Delta Painting)

- **Current:** `Renderer.js` clears the canvas and loops over 64,000 cells (`320 x 200`) every single frame using `fillRect`.
- **Proposed (Best of both worlds):**
  1. **Maintain Local Grid Buffer:** Keep the 2D grid `fields[x][y]` in the client renderer as the absolute ground truth.
  2. **Delta Painting on Frame Ticks:** When receiving delta updates (`[x, y, cellValue]`), update the local grid buffer and **only call `fillRect` on those specific modified pixels**:
     - `cellValue >= 0`: Draw player trail pixel with player's color.
     - `cellValue === -3`: Draw explosion particle pixel.
     - `cellValue === -1`: Clear pixel back to background color.
  3. **Full Redraw (`redrawAll`):** Reserved strictly for **theme switches (Dark/Light)**, **window resizes / zoom changes**, **match initializations**, or **mid-match spectator re-joins**.
  4. **Benefits:** Drops per-frame work from 64,000 checks to ~5–20 pixel writes, while preserving instant theme switching, particle accuracy without hole-punching artifacts, and seamless reconnection.

### C. Server Game Loop Optimization

- **Current:** Recursive `setTimeout(run, 0)` continuous polling loop.
- **Proposed:** Accurate timer scheduled for the exact frame interval, stopping immediately when the round finishes or all players disconnect.

### D. Simplified Color Resolution

- **Current:** `cssColors.js` injects dummy DOM elements and parses stylesheets.
- **Proposed:** Directly read computed CSS variables from `document.documentElement` using `getComputedStyle`.

---

## 4. Step-by-Step Implementation Strategy (6 Runnable Commits)

Each phase is designed to leave the entire application fully functional and playable.

### Phase 1: Shared Modules & Static Route

- **Actions:**
  1. Create `shared/` directory:
     - `shared/constants.js`: Grid size (320x200), cell types (`EMPTY: -1`, `BORDER: -2`, `EXPLOSION: -3`), speeds.
     - `shared/protocol.js`: Message action types (`PING`, `PONG`, `LOBBY_LIST`, `CREATE_GAME`, `JOIN_GAME`, `GAME_STATE`, `GAME_DRAW`, `CHANGE_DIR`, etc.).
     - `shared/Player.js`: Clean player model.
     - `shared/utils.js`: Fisher-Yates shuffle and math functions.
  2. Mount `/shared` in `app.js` via `express.static`.
  3. Wire server `lib/` and client to import from `shared/`.
- **Runnable State:** ✅ App is 100% playable. Zero disruption to existing WebSocket routes.
- **Commit:** `feat(shared): extract shared constants, player model, and math utils`

---

### Phase 2: Theme System & Canvas Delta Renderer

- **Actions:**
  1. Create `public/javascripts/theme.js`: Read CSS variables directly from DOM without stylesheet hacks.
  2. Upgrade `public/javascripts/Renderer.js`: Implement hybrid delta canvas rendering with local grid buffer and targeted dirty-rect drawing.
  3. Wire `theme.js` and upgraded renderer into `public/javascripts/Game.js`.
- **Runnable State:** ✅ App is 100% playable. Instant theme toggling and 60+ FPS rendering live.
- **Commit:** `perf(client): introduce getThemeColors and hybrid delta canvas renderer`

---

### Phase 3: Server Domain Logic & Accurate Game Loop

- **Actions:**
  1. Create `server/` directory:
     - `server/Explosion.js`: Pure explosion/particle class using `shared/utils.js`.
     - `server/Arena.js`: Collision grid using `shared/constants.js` and `shared/utils.js`.
     - `server/GameSession.js`: Match coordinator, scoring, and interval timer.
     - `server/GameServer.js`: Match registry and cleanup.
  2. Wire `server/` models to back existing `websockets/` handlers.
- **Runnable State:** ✅ App is 100% playable. Server loop efficiency and physics accuracy live.
- **Commit:** `refactor(server): modernize game session coordinator, arena, and explosion physics`

---

### Phase 4: Client State Store & Modular UI Views

- **Actions:**
  1. Create `public/javascripts/state.js`: Central reactive client state store.
  2. Create modular views in `public/javascripts/ui/`:
     - `lobbyView.js`: Game list table & create form.
     - `configView.js`: Player creation & key bindings.
     - `gameView.js`: Scoreboard table, kill messages, touch controls.
     - `settingsView.js`: Dropdown and theme toggles.
  3. Decouple DOM manipulation from network logic.
- **Runnable State:** ✅ App is 100% playable with modular UI views.
- **Commit:** `refactor(client): extract reactive state store and modular UI view controllers`

---

### Phase 5: Unified WebSocket Protocol (Client + Server)

- **Actions:**
  1. Create `server/wsHandler.js`: Single `/ws` WebSocket upgrade router handling ping, lobby, and games.
  2. Create `public/javascripts/network.js`: Single WebSocket client with automatic reconnection and typed dispatching.
  3. Create `public/javascripts/main.js`: Main client entry point.
  4. Update `views/layout.pug` to load `main.js`.
  5. Connect `server/wsHandler.js` in `app.js`.
- **Runnable State:** ✅ App is 100% playable across the single WebSocket connection.
- **Commit:** `feat(network): unify multi-socket connections into single WebSocket protocol`

---

### Phase 6: Final Cleanup & Verification

- **Actions:**
  1. Remove obsolete files (`lib/`, `websockets/`, `public/javascripts/page/`, `public/javascripts/ws/`, `cssColors.js`, `PlayerFE.js`).
  2. Run full verification checklist.
- **Runnable State:** ✅ Clean codebase matching target structure.
- **Commit:** `chore(cleanup): remove legacy multi-socket handlers and unused files`

---

## 5. Verification Checklist

- [x] `/` loads without console errors.
- [x] Joining and creating games works instantly across multiple browser windows.
- [x] Ping displays live round-trip latency over the single WebSocket.
- [x] Canvas rendering runs at stable 60+ FPS with minimal CPU usage.
- [x] Round finishes, score table updates, and new round starts correctly.
- [x] Touch buttons work on touch-enabled screen / mobile viewport.
- [x] Theme switching (Dark/Light/Auto) updates canvas and UI colors dynamically.
