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

* **Screen Store (`state.js`):** Reactive pub/sub store managing active `screen` (`'welcome' | 'lobby' | 'config' | 'game'`).
* **View Controllers:**
  * `WelcomeView` (`#welcome`): Landing tribute, controls overview, legal/privacy modals.
  * `LobbyView` (`#lobby`): Public room listing and room creation form.
  * `ConfigView` (`#playersconfig`): Player name entry and turn keycode selection.
  * `GameView` (`#arena`, `#scores`): Match rendering, score tally, in-game mobile turn controls.
* **Header Navigation Model:**
  * **Welcome View:** Displays "Enter Lobby →" (`#btn-header-enter-lobby`). Info and Lobby return buttons are hidden.
  * **Lobby View:** Displays Info button (`#btn-info`) to return to the welcome tribute.
  * **In-Room (Config / Arena / Scores):** Displays Info (`#btn-info`) and "← Lobby" (`#btn-header-lobby`) to leave the current room cleanly.

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

* **Server Coordinator:** `server/GameSession.js`
* **Server Registry:** `server/GameServer.js`

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

### Phase 3: Player Reconnection
1. The client preserves room keys and player configurations in `sessionStorage.connectedGames`.
2. Upon reconnecting, the client calls `JOIN_GAME` with its stored player IDs.
3. If a round is actively running, the client is placed into `scoresWaiting` mode (spectating).
4. On the next round reset, the player is automatically restored to active status on the grid.

---

## 4. Leaving Game & Return to Lobby

When a player clicks the "← Lobby" header button (`#btn-header-lobby`):
1. Client sends `MSG_TYPE.LEAVE_GAME`.
2. **Crucial Server Sequence in `wsHandler.js`:**  
   The server *first* clears `ws.gameKey = null` and `ws.playerIds.clear()`, and *then* broadcasts updated `GAME_INFO` to remaining players. This prevents the leaving socket from receiving room packets and getting pulled back into the match screen.
3. Client resets its local match state (`players`, `scores`, `positions`), transitions to screen `'lobby'`, and requests the latest `LOBBY_LIST`.

---

## 5. Room Reaping & Inactivity Timeout

* **`IDLE_ROOM_TIMEOUT_MS` (5 Minutes):** When all clients disconnect from a room, a 5-minute timer starts.
* If no client reconnects within 5 minutes, `game.destroy()` is called:
  * Timers and loops are cleared via `clearInterval()`.
  * Grid buffers and references are unlinked for GC.
  * The room is removed from `gameServer.games` and snapshots on disk.
