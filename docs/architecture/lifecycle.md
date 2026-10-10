# Game Lifecycle & Disconnect Architecture

> **Audience:** Reference for AI agents and maintainers working on room lifecycles, player disconnections, re-joining, or persistence.

---

## 1. Client Screens and Navigation

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

## 2. Match States

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

## 3. Player Registration and Ownership

Public player IDs identify players; they do not authorize control. Each registered player has an independent secret credential, and the room tracks the socket that currently owns that player. One connection may own multiple local players.

### Registration and acknowledgement

1. The server validates the registration and writes the roster, scores, and private credential verifier together in an atomic snapshot.
2. After the write succeeds, the server privately acknowledges the player's ID, token, and socket-local input handle.
3. Only after a matching acknowledgement does the browser store a versioned room/player record in `sessionStorage`, commit the local controls, and enable input.

A failed write rolls back the new roster entry, verifier, owner index, and score row without consuming a handle or broadcasting success. Pending requests confer no control; a bounded retry uses the same request ID on the same socket.

### Credential and input lifetime

Credentials survive ordinary disconnects, room changes, and server restarts while the corresponding room/player exists. Losing the browser's saved credential loses its recovery authority. Public game information never grants ownership.

Input handles belong to a single socket. Losing ownership immediately invalidates the player's mapping; handles are never reused during that socket's lifetime. The [protocol guide](protocol.md) describes the wire messages and binary input validation.

---

## 4. Disconnect, Reconnect, and Handover

### Mid-round disconnect

When a browser's socket closes, for example after a tab closes or a carrier connection drops:

1. The server's `close` handler in `wsHandler.js` releases only players still owned by that socket and invalidates their input handles.
2. Those active players are marked dead and explode into particle sparks. Their wall trails remain as obstacles for the rest of the round.
3. Remaining connected players continue racing undisturbed.

The roster and credentials remain available for authenticated recovery. Closing a superseded socket cannot disconnect players that have transferred to a replacement socket.

### Subsequent rounds with offline players

At the start of a subsequent round, an offline player explodes at its starting position without creating a wall trail. The scoreboard shows a `[disconnected]` badge and keeps players in score-sorted order.

### Authenticated reconnect

The lobby labels its action “rejoin” when usable saved credentials exist, including credentials marked revoked for explicit reclaim. This action remains available when registration is closed; saved credentials only enable the attempt, and the server still authenticates every claim.

A reconnect submits the saved room/player credentials. The browser restores controls only for IDs accepted in a private `JOIN_RESULT` matching the current socket, room, and pending request. Invalid or missing credentials remain unbound and produce feedback. A join without `reconnect` credentials admits a spectator and grants no player ownership.

A player that disconnected mid-round becomes eligible for the next round after authentication. Reconnection does not resurrect its dead cycle in the current round.

The browser shows the scoreboard in `scoresWaiting` while disconnected. The
rejoined room's `GAME_INFO` snapshot resolves that waiting state even when the
game screen is already visible: ongoing rounds keep the waiting overlay, while
finished rounds clear it and enable the next-round button for authenticated local
players. Ordinary roster updates preserve active gameplay and the score reveal.

After an ownership-revoked notice, the browser stops automatically reclaiming the transferred player. Explicitly selecting the room may authenticate that player again.

### Live ownership handover

A valid claim can transfer a player while the previous socket is still connected. The server removes only that player's former handle and ownership index, assigns the replacement owner, and notifies both sides. Other players on either socket retain their ownership.

Live handover leaves the transferred player's cycle alive and its score marked connected. Subsequent input, leave, or close from the former socket cannot affect that replacement-owned player.

### Recovery after input-handle exhaustion

Exhausted handles expose a “Reload, then rejoin” button. Reloading closes the
current socket and follows normal disconnect behavior, including eliminating
active cycles. Saved credentials remain in sessionStorage. Select the room’s
“rejoin” action in the lobby after reload; only accepted private acknowledgements
restore controls, and disconnected players can race again next round.

There is no parallel replacement socket or recovery rollback. Without saved
credentials, reload grants no recovery authority; join as spectator or register
new players where registration remains open.

---

## 5. Leaving and Switching Rooms

### Return to lobby

When a player clicks the “← Lobby” header button (`#btn-header-lobby`):

1. The client sends `MSG_TYPE.LEAVE_GAME`.
2. The server releases only IDs still owned by that socket, invalidates their handles, clears room membership, and broadcasts updated `GAME_INFO` to remaining room members. The leaving socket stops receiving room packets that could pull it back into the match screen.
3. The client clears its local match state (`players`, `scores`, `positions`), switches to the lobby screen, and requests the latest `LOBBY_LIST`.

Leaving releases current ownership, not the saved credential. Later re-entry requires authenticated reconnect.

### Switch to another room

The server validates target-room admission and required handle capacity before releasing ownership in the old room. Once admitted, it releases only players still owned by the switching socket, clears the old-room indexes and membership, and joins the target room. Old-room handles remain invalid and are not reused.

A failed admission leaves existing server-side ownership intact. Release of a live player follows the same disconnect and trail behavior described above.

---

## 6. Persistence and Restart Recovery

### Snapshot contents and write guarantees

Version 1 snapshots contain a `games` array with each room's metadata, roster, scores, and a dedicated `private.verifiers` map of lowercase SHA-256 hex digests. Raw tokens, sockets, handles, and active owner maps never enter the snapshot.

`Storage` writes a temporary file and atomically renames it before acknowledging registration. It does not `fsync` the file or directory: this supports ordinary process restart recovery and avoids partially replacing the snapshot, but does not guarantee a flush through sudden power loss.

### Cold restore

Cold restore preserves rosters and scores, marks every player disconnected, and starts with no owners or input handles. In-progress physics is discarded. Matching room/player credentials can restore ownership through authenticated reconnect.

### Missing, legacy, and malformed data

| Snapshot condition                                                         | Behavior                                                                                                                                                                                |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing file                                                               | Start with an empty room list.                                                                                                                                                          |
| Legacy array format                                                        | Load disconnected historical rosters and scores without credentials, even if an unexpected private field appears. Those IDs cannot be reclaimed; create a new room to continue playing. |
| Missing or malformed verifier in an otherwise valid room                   | Fail closed for that player; other valid credentials remain usable.                                                                                                                     |
| Unknown future version, malformed file, or malformed room-record structure | Preserve the original file, block new writes and room creation, and emit a safe diagnostic until compatible software or a valid backup is restored.                                     |

---

## 7. Room Inactivity and Destruction

`GameSession.checkConnectionStatus()` periodically prunes closed socket references. When no clients remain in the room, it records the start of inactivity. A later check destroys the room once inactivity exceeds `IDLE_ROOM_TIMEOUT_MS` (five minutes); reconnecting clears that inactivity timestamp.

The periodic `statusTimer` uses `unref()`, so it does not keep the Node.js process alive by itself. When `game.destroy()` runs:

- Timers and physics tick loops are cleared.
- Grid buffers, player references, and room ownership/credential state are released.
- The room is removed from `gameServer.games` and snapshots on disk.

Broader room-membership, capacity, and idle-reaping work remains tracked in the [roadmap](../../ROADMAP.md#accurate-room-membership-and-cleanup).

---

## 8. Round Reset and Explosion Cleanup

Round resets clear simulation and rendering state to prevent particle ghosting across consecutive matches:

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
  - Grid buffers, active explosion objects, and particle arrays are not persisted. See [Persistence and Restart Recovery](#6-persistence-and-restart-recovery) for the saved roster, score, and credential data and the cold-restore behavior.

---

## 9. Upgrade and Rollback

### Upgrade

1. Stop the server and back up `data/games.json` (or `$DATA_DIR/games.json`), retaining the matching running client/server version.
2. Upgrade the client assets and server together.
3. Restart the server and have players reload stale cached pages. Protocol mismatch errors explicitly request a reload.

### Rollback

1. Stop the server.
2. Restore the old snapshot backup and its matching old client/server version.
3. Restart the server.

Rooms, registrations, and score changes made after the backup are lost. A newer snapshot must never be silently rewritten by older code.

## Related Documents

- [Networking and protocol](protocol.md): wire formats, credentials, acknowledgements, and binary input.
- [Rendering](rendering.md): drawing deltas, grid buffers, and local redraws.
- [Testing](testing.md): lifecycle regression and browser coverage.
- [Player ownership and reconnection implementation plan](../plans/2026-09-25-player-ownership-and-reconnection.md): implementation history and acceptance criteria.
