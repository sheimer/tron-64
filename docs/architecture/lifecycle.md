# Game Lifecycle & Disconnect Architecture

> **Audience:** Reference for AI agents and maintainers working on room lifecycles, player disconnections, re-joining, or persistence.

---

## 1. Client Screen & View Architecture

The client application (`public/javascripts/main.js`, `public/javascripts/state.js`) coordinates four primary top-level screens:

```
┌──────────────┐     Enter Lobby     ┌──────────────┐     Join / Create     ┌──────────────┐
│   WELCOME    │ ──────────────────> │    LOBBY     │ ────────────────────> │    CONFIG    │
│  (Tribute &  │ <────────────────── │ (Games List) │                       │(Add Players) │
│  Modals)     │      #btn-info      └──────────────┘                       └──────┬───────┘
└──────────────┘                                                                   │
       ▲                                                                           │ START_GAME
       │                                     ← Lobby                               ▼
       └─────────────────────────────────── (#btn-header-lobby) ──────────── ┌──────────────┐
                   #btn-info                                                 │     GAME     │
                                                                             │(Arena/Scores)│
                                                                             └──────────────┘
```

- **Screen Store (`state.js`):** Reactive pub/sub store managing active `screen` (`'welcome' | 'lobby' | 'config' | 'game'`).
- **View Controllers:**
  - `WelcomeView` (`#welcome`): Landing tribute, controls overview, legal/privacy modals.
  - `LobbyView` (`#lobby`): Public room listing and room creation form.
  - `ConfigView` (`#playersconfig`): Player name entry and turn keycode selection.
  - `GameView` (`#arena`, `#scores`): Match rendering, score tally, in-game mobile turn controls.
- **Header Navigation Model:**
  - **Welcome View:** Displays "Enter Lobby →" (`#btn-header-enter-lobby`). Info and Lobby return buttons are hidden.
  - **Lobby View:** Displays Info button (`#btn-info`) to return to the welcome tribute.
  - **In-Room (Config / Arena / Scores):** Displays Info (`#btn-info`) and "← Lobby" (`#btn-header-lobby`) to leave the current room cleanly.

---

## 2. Match State Machine

Game sessions transition through the following states (`shared/constants.js`):

```
       ┌─────────────────────────────┐
       │           CONFIG            │
       │ (Players register & bind)   │
       └──────────────┬──────────────┘
                      │ START_GAME
                      ▼
       ┌─────────────────────────────┐
       │           RUNNING           │◄────────────────┐
       │ (40 FPS server physics loop)│                 │
       └──────────────┬──────────────┘                 │
                      │ Last cycle dies / crash / tie  │ Next round start
                      ▼                                │
       ┌─────────────────────────────┐                 │
       │           SCORES            │─────────────────┘
       │ (Scoreboard & round summary)│
       └─────────────────────────────┘
```

- **Server Coordinator:** `server/GameSession.js`
- **Server Registry:** `server/GameServer.js`

---

## 3. Disconnected Client Lifecycle & Trail Ghosting

When a player's browser disconnects mid-match (tab closed, carrier drop):

### Phase 1: Mid-Round Disconnect

1. The socket's `close` event fires on the server in `wsHandler.js`.
2. Associated active players are marked dead and explode into particle sparks.
3. **Trail Preservation:** The disconnected player's wall trail remains permanently on the grid for the remainder of the round as an obstacle.
4. Remaining connected players continue racing undisturbed.

### Phase 2: Subsequent Rounds with Offline Player

1. On round start ($t=0$), the offline player is exploded instantly at their starting coordinates.
2. **Zero Trail Start:** No wall trail is generated for the offline cycle, keeping the arena open.
3. The scoreboard marks the player with a `[disconnected]` badge and positions all players dynamically according to score-sorted rankings.

### Registration and authenticated recovery (ownership Phases 1–4)

1. Registration writes the roster, scores, and private credential verifier together in an atomic snapshot before privately acknowledging the player's ID, token, and input handle. A failed write rolls back the new roster, verifier, owner index, and score row without consuming a handle or broadcasting success. Only after the acknowledgement does the browser store a versioned room/player record in `sessionStorage` and mark that player locally controlled. Pending requests confer no control; a bounded retry uses the same request ID on the same socket.
2. A real disconnect removes only players still owned by that socket, preserving the existing mid-round explosion and trail behavior. Returning to the lobby or switching rooms performs the same owner-checked release. The old input handles become invalid immediately and are never reused on that socket.
3. A reconnect submits saved room/player credentials and restores controls only for IDs accepted in a private, current-socket `JOIN_RESULT`. Invalid/missing credentials stay unbound and show feedback; public game information never grants control. The browser stops automatic reclaim after an ownership-revoked notice, while explicitly selecting the room can authenticate again. A legacy ID-only claim fails closed.
4. Valid handover removes only the transferred player's former handle and index, retains other local owners, and leaves a live player's cycle and score connected. Closing the former socket cannot disconnect the replacement. A real disconnect still explodes the active cycle and preserves its trail; reconnect marks it eligible for the next round without resurrecting it mid-round. Exhausted handles require the visible fresh-connection action and new private acknowledgement. This action requires saved credentials for every currently controlled player and requests all-or-nothing authentication. Failed admission or authentication restores the still-live original connection and bindings without retrying automatically; if that original socket closes meanwhile, ordinary real-disconnect handling applies.
5. Version 1 snapshots contain a `games` array with each room's metadata, roster, scores, and a dedicated `private.verifiers` map of lowercase SHA-256 hex digests. Raw tokens, sockets, handles, and owner maps never enter the snapshot. `Storage` writes a temporary file and atomically renames it before acknowledging registration; it does not `fsync` the file or directory, so this protects ordinary process restarts and partial writes but does not guarantee a flush through sudden power loss. Cold restore keeps scores and rosters but marks all players disconnected, starts with no owners or handles, and discards in-progress physics. Matching room/player credentials can reconnect; malformed or missing verifiers fail closed for only those players.
6. A missing snapshot starts with an empty room list. Legacy array snapshots load as disconnected historical rosters without inventing credentials, even if an unexpected private field appears. Those IDs cannot be reclaimed; create a new room to continue playing. Unknown future versions and malformed files or room-record shapes stay untouched and block new writes/room creation with a safe diagnostic until compatible software or a valid backup is restored. A malformed credential within an otherwise valid room fails closed only for its player.

Before upgrading, stop the server and back up `data/games.json` (or `$DATA_DIR/games.json`) with the matching running client/server version. Upgrade client and server together. To roll back, stop the server, restore the corresponding old snapshot backup and its matching old client/server version, then restart. Any rooms, registrations, or score changes after that backup are lost. A newer snapshot must never be silently rewritten by older code.

---

## 4. Leaving Game & Return to Lobby

When a player clicks the "← Lobby" header button (`#btn-header-lobby`):

1. Client sends `MSG_TYPE.LEAVE_GAME`.
2. The server releases only IDs still owned by that socket, invalidates their handles, clears room membership, then broadcasts updated `GAME_INFO` to remaining players. This prevents the leaving socket from receiving room packets and being pulled back into the match screen.
3. Client resets its local match state (`players`, `scores`, `positions`), transitions to screen `'lobby'`, and requests the latest `LOBBY_LIST`.

---

## 5. Room Reaping & Inactivity Timeout

- **`IDLE_ROOM_TIMEOUT_MS` (5 Minutes):** When all clients disconnect from a room, a 5-minute inactivity countdown begins.
- **Non-Blocking Status Timer (`statusTimer.unref()`):** Periodic connection checks in `GameSession.js` execute via an unreferenced timer (`statusTimer.unref()`), ensuring background room status checks do not hold the Node.js event loop active or stall test runners and process termination.
- If no client reconnects within 5 minutes, `game.destroy()` is called:
  - Timers and physics tick loops are cleared.
  - Grid buffers and player references are unlinked for GC.
  - The room is removed from `gameServer.games` and snapshots on disk.

---

## 6. Round Reset & Explosion Lifecycle Hygiene

To guarantee zero visual or logical particle ghosting across consecutive match rounds:

- **Server State Flushing (`Arena.reset()` & `Arena.init()`):**
  - `Arena.init()` unconditionally flushes `this.explosions = []` and completely rebuilds `this.fields` (border cells set to `CELL_TYPE.BORDER`, all interior cells set to `CELL_TYPE.EMPTY`).
  - `this.fieldChanges` emits _only_ active player starting dots on reset, preventing stale explosion debris from transmitting over the network.
- **Duration Limits & Natural Particle Decay:**
  - Active explosions enforce duration limits: `EXPLOSION_MAX_MS_RUNNING` (6s while multiple players are alive) and `EXPLOSION_MAX_MS_FINISHED` (4s after match finish).
  - Upon particle expiration or completion, previous coordinates are explicitly cleared back to `CELL_TYPE.EMPTY` (including wall breach coordinates blasted through borders).
- **Client Grid Buffer & GPU Paint Synchronization:**
  - On `GAME_RESET`, the client immediately clears the canvas (`Renderer.clear()`) and transitions to `'start'` match state.
  - A 50ms paint synchronization tick ensures container DOM reflow completes before `Renderer.resetGrid()` resets the local `Int8Array` buffer to pristine border/empty state, sends `ARENA_READY`, and repaints cleanly.
- **Persistence Isolation:**
  - `Storage.js` serializes only room metadata and match score statistics. Grid buffers, active explosion objects, and particle arrays are never written to disk, ensuring clean cold reboot initialization.
