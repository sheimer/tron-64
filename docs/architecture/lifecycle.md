# Game Lifecycle & Disconnect Architecture

> **Audience:** Reference for AI agents and maintainers working on room lifecycles, player disconnections, re-joining, or persistence.

---

## 1. Client Screens and Navigation

The client application coordinates four primary top-level screens. Its module boundaries are:

- [main.js](../../public/javascripts/main.js) is the browser entrypoint. It imports browser dependencies, constructs one `AppCoordinator`, and exports the existing `app` singleton.
- [AppCoordinator](../../public/javascripts/appCoordinator.js) is a named export with injected state, transport, renderer, theme functions, and view constructors. Importing the class does not start the application. It wires views and domain callbacks, routes screens, handles input/theme updates, and projects room controls.
- [LobbySession](../../public/javascripts/lobbySession.js) owns correlated room creation, bounded retries, personalized discovery batches, checked credential snapshots, and lobby subscriptions. The coordinator supplies its state, transport, settings, and presentation callbacks. Entering the lobby starts its subscriptions; leaving cancels pending work and clears discovery checks. `LobbyView` receives callbacks for creation, room selection, recovery labels, and session visibility; it owns DOM rendering and transient error display without importing application singletons.
- [RoomSession](../../public/javascripts/roomSession.js) owns the current room, pending joins and registrations, registration retry timers, recovered local control bindings, and reconnect/revocation handling. It validates private acknowledgements before restoring authority and projects room snapshots before invoking coordinator callbacks.
- [RoundLifecycle](../../public/javascripts/roundLifecycle.js) owns the current attempt, round stage and callback generation, canvas reset/readiness timer, score-reveal timer, and round event/snapshot routing. Its guards capture the room, socket generation, attempt and callback generation. Session transitions invalidate these callbacks before changing room identity.
- [state.js](../../public/javascripts/state.js) retains shared observable state, saved credentials and permission predicates. Views continue to own their markup and presentation behavior.

The lobby, session, and round controllers receive explicit dependencies and callbacks; none imports browser singletons or holds the entire coordinator. `GAME_INFO` applies authenticated local bindings and roster state first, then room-control feedback and scores, then round routing and readiness. Join, leave, close and protocol mismatch preserve their existing cleanup order.

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

### Creator-client and first/next-round authority

Creating a room durably establishes a logical creator client independently of any bike. The private correlated creation result saves an independent `roomOwner` credential alongside an empty `localPlayers` map in the room's `sessionStorage` record. Normalization preserves this owner-only record. Saved proof grants no live controls until a matching current join acknowledgement authenticates it; closing, leaving, switching rooms, or creator revocation clears live permission. Explicit rejoin can recover the creator without claiming bikes. Bike registration/handover never elects or transfers the creator role, and an old socket's cleanup cannot release a replacement creator binding.

Only the current authenticated creator starts the initial round. After the durable `firstRoundStarted` launch decision, any open joined room client, including a spectator, can request a later round between rounds. Two to six registered slots and at least two authenticated connected bikes are required before reset and again at launch. Two local bikes on one client qualify; the requesting creator may control none. There is no automatic creator takeover. Creator absence blocks only the initial start and creator-only speed changes; it does not block later starts.

The room owns explicit `configuration → preparation → countdown → running → finished` stages and a fresh opaque attempt ID. Preparation freezes registration and rejects duplicate starts/speed changes. It captures the complete roster's authoritative owner and connected eligibility, and deduplicates readiness from eligible bike-owner sockets only. A two-second fallback advances preparation; countdown lasts one second. Pending snapshots expose the same prepared positions to joiners, including spectators, without requiring an earlier reset event.

After a whole successful admission/handover commits, any captured roster ownership or eligibility change cancels the attempt, including a previously disconnected bike rejoining. Leave, switch and close release current bindings and reconcile the attempt. Before first launch the original creator socket must remain the current joined creator, even with no bikes; later pure spectator departures or creator-only binding changes do not cancel. Room/handle preflight failures mutate nothing. The launch callback rechecks the same live GameServer room instance, attempt, stage, full roster and initial creator. First-launch persistence succeeds before physics; failed writes keep the marker false, cancel and return `PERSISTENCE_FAILED`.

Cancellation clears both timers and retires its ID. A scoped cancellation event carries the retired ID; idle snapshots carry null. First cancellation returns clients to configuration and restores prior registration availability subject to six slots. Later cancellation returns even clients already on the game screen to finished scores, retaining the launch marker and closed registration. No cancellation scores a round or automatically restarts it. Reset/stop/destroy invalidate pending and physics callbacks; tick callbacks validate their generation, current timer and live room both before and after arena hooks, preventing old or reentrant callbacks from running/scheduling a replacement round.

Creator-only speed mutations accept integer intervals from 10 to 500 ms between rounds and roll back on save failure. Trusted internal simulation/fixture methods are separate from guarded network admission. The client displays creator present/away/unrecoverable status independently of bike rows. “You created this room” requires the correlated private accepted owner binding, the current room and socket generation, and an open protocol-ready connection. Saved proof and public creator identity alone grant no permission. Configuration, game and speed controls refresh on private results, revocation, snapshots, cancellation and membership/connection changes, even if the screen remains visible. Permanent reasons explain the two eligible-bike minimum, six-slot ceiling, first/later-start rules, room stage and creator recovery.

The settings select displays the acknowledged interval exactly, including a stable custom option for intervals outside the presets. A user speed selection sends one room mutation when authorized; snapshots and acknowledgements only update display. Room selections never overwrite the personal speed preference used outside rooms and when creating a room. Rejected changes retain the authoritative displayed interval and show the server explanation beside the room controls.

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

1. The server's `close` handler in `wsHandler.js` uses the same idempotent departure path as leaving, switching, termination, and defensive pruning. It removes membership and releases only players and the creator binding still owned by that socket, invalidating their input handles and registration retries.
2. Those active players are marked dead and explode into particle sparks. Their wall trails remain as obstacles for the rest of the round.
3. Remaining connected players continue racing undisturbed.

The roster and credentials remain available for authenticated recovery. Closing a superseded socket cannot disconnect players that have transferred to a replacement socket.

### Subsequent rounds with offline players

At the start of a subsequent round, an offline player explodes at its starting position without creating a wall trail. The scoreboard shows a `[disconnected]` badge and keeps players in score-sorted order.

### Authenticated reconnect

The lobby labels its action “rejoin” when usable saved credentials exist, including independent owner-only credentials and bike credentials marked revoked for explicit reclaim. New spectators can also join after registration closes, subject to the existing server room-capacity checks. Direct room entry uses `/?room=<eight-character lowercase hexadecimal key>` and makes one explicit correlated join after protocol negotiation. The URL carries no credential; saved owner and bike proofs are submitted separately.

A reconnect submits the saved room/player credentials. The browser restores controls only for IDs accepted in a private `JOIN_RESULT` matching the current socket, room, and pending request. Invalid or missing credentials remain unbound and produce feedback. A join without `reconnect` credentials admits a spectator and grants no player ownership.

Independent creator recovery needs no bike claim or handle. Only the matching private owner result restores creator controls; public creator IDs do not. Creator revocation suppresses automatic reclaim while retaining the credential for explicit rejoin. Bike transfers never transfer the creator role, and closing a superseded creator socket cannot release its replacement. Invalid owner and bike claims remain independent, and rejected room/handle preflights change neither binding.

Lobby discovery is personalized by the server. On entry, reconnect, or saved-credential changes while the lobby is visible, the browser submits saved room keys with creator and bike credentials in batches of at most 50. Verification is read-only: it never joins a room, claims controls, allocates handles, cancels rounds, or resets inactivity. Valid credentials reveal private rooms with their actual name, player count, registration status, and a private label. Unrelated private rooms are never sent. Discovery grants last for the socket and live room instance; subsequent lobby broadcasts remain personalized.

Saved owner-only and bike records survive public-only greetings, invalid credentials, capacity errors, and connection loss. A correlated discovery response can automatically retire a confirmed missing room only when its saved record and socket generation still match the check. Once checked, a personalized deletion broadcast can also retire the unchanged record. An existing room with invalid credentials is hidden without deleting its saved proof. A current explicit join's `GAME_NOT_FOUND` still removes its saved record and returns to the lobby; automatic reconnect failure preserves it. The browser renders server-listed rooms rather than fabricating unknown saved-room rows. Discovery authenticates visibility only; joining and taking controls remain separate explicit actions.

A player that disconnected mid-round becomes eligible for the next round after authentication. Reconnection does not resurrect its dead cycle in the current round.

The browser shows the scoreboard in `scoresWaiting` while disconnected. The
rejoined room's `GAME_INFO` snapshot resolves that waiting state even when the
game screen is already visible: ongoing rounds keep the waiting overlay, while
finished rounds clear it and enable the next-round button for any joined client
when at least two authenticated connected bikes are eligible. Ordinary roster updates preserve active gameplay and the score reveal.

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

### Live membership and admission

Each room records sockets in a deduplicated `Set`. A live member must be open,
recorded in that room, and indexed to that room by `gameKey`; a routing key alone
grants neither membership nor control. Capacity, room broadcasts, round
eligibility/readiness and inactivity checks share this predicate. Each joined
socket occupies one slot, including spectators and creators with no bikes;
multiple local bikes do not use extra client slots.

Repeated same-room joins retain one slot, the existing room event hooks, and
current input handles, even at capacity. Authenticated claims can still transfer
individual bike or creator bindings. Full/missing targets, malformed claim lists
and handle exhaustion reject before changing the source room or either room's
ownership or pending round. Independently rejected credentials retain the
existing spectator-admission and per-claim result behavior.

### Return to lobby

When a player clicks the “← Lobby” header button (`#btn-header-lobby`):

1. The client sends `MSG_TYPE.LEAVE_GAME`.
2. The server releases only IDs still owned by that socket, invalidates their handles, clears room membership, and broadcasts updated `GAME_INFO` to remaining room members. The leaving socket stops receiving room packets that could pull it back into the match screen.
3. The client clears its local match state (`players`, `scores`, `positions`), switches to the lobby screen, and requests the latest `LOBBY_LIST`.

Leaving releases current bike and creator socket bindings, not roster entries,
scores or saved credentials. Later re-entry requires authenticated reconnect.
Discovery grants and room-creation retries remain available on the open socket
while their referenced room exists. The input-handle counter never resets during
the connection's lifetime.

Departure removes membership before disconnect effects, reconciles a pending
round, then publishes the updated room snapshot. Repeating cleanup, including a
later `close` after termination or pruning, produces no second disconnection,
explosion or room event. Cleanup checks actual current room owners, so a partial
handover preserves replacement-owned bikes and creator authority. Pruning a stale
old-room reference also preserves any handles and indexes belonging to the
socket's different current room.

Binary draws and JSON reset/state/finish/info broadcasts enumerate the room's
live members. Former members in the lobby or another room receive none of these
old-room events. Personalized global lobby discovery remains separate.

### Switch to another room

The server validates target-room admission and required handle capacity before releasing bike and creator bindings in the old room. Once admitted, it releases only players still owned by the switching socket, clears the old-room indexes and membership, and joins the target room. Old-room handles remain invalid and are not reused.

A failed admission leaves existing server-side ownership intact. Release of a live player follows the same disconnect and trail behavior described above.

---

## 6. Persistence and Restart Recovery

### Snapshot contents and write guarantees

Version 1 snapshots contain a `games` array with each room's metadata, roster, scores, and a dedicated `private.verifiers` map of lowercase SHA-256 hex digests, independent `private.roomOwner` creator ID/verifier, and public `firstRoundStarted` launch marker. Raw tokens, sockets, handles, and active owner maps never enter the snapshot.

`Storage` writes a temporary file and atomically renames it before acknowledging creation, registration, first launch, or a speed mutation. It does not `fsync` the file or directory: this supports ordinary process restart recovery and avoids partially replacing the snapshot, but does not guarantee a flush through sudden power loss.

### Cold restore

Cold restore preserves actual rosters, scores, creator verifier and the first-launch marker, marks every player and score connection flag disconnected, and starts with no bike owners, creator socket, pending attempt, round timers, physics, or input handles. The ordinary unreferenced inactivity check still runs. Zero-player owner rooms are valid. Matching creator and bike credentials restore their separate bindings through authenticated reconnect.

A committed first launch restores with registration closed, `started: true`, `running: false`, and idle `finished` stage, even if no round completed. Scores and completed-round count remain unchanged; no result is invented. The browser shows “No completed rounds” and explains that saved bikes must reconnect before a later round can start. Any joined client can request that round once at least two authenticated bikes are eligible, without the creator present.

All rooms' launch metadata is validated before restoring any session. A present marker must be a boolean; a present completed-round count must be a nonnegative safe integer. Omitted counts normalize to zero. The additive version-1 migration matrix is:

| `firstRoundStarted` | Valid completed-round count | Restore policy                                                                  |
| ------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| `false`             | Zero or omitted             | Configuration; registration open subject to the ordinary roster/score slot cap. |
| `true`              | Zero, omitted, or positive  | Idle finished; registration closed; actual scores preserved.                    |
| Omitted             | Positive                    | Migrate marker to `true`; idle finished and closed registration.                |
| Omitted             | Zero or omitted             | Migrate marker to `false`; configuration and ordinary registration cap.         |
| `false`             | Positive                    | Reject the entire snapshot as `INVALID_SNAPSHOT`.                               |
| Present nonboolean  | Any                         | Reject the entire snapshot as `INVALID_SNAPSHOT`.                               |
| Any                 | Present invalid count       | Reject the entire snapshot as `INVALID_SNAPSHOT`.                               |

Rejected snapshots restore no rooms, preserve original bytes, and block writes and room creation until a valid snapshot is recovered manually. Missing/malformed creator verifier data instead makes only creator recovery unavailable. Valid bike credentials and later-round permission remain usable. Losing the creator credential or restoring an unstarted legacy room cannot grant the initial start or speed controls to another client: create a new room when the creator cannot recover. There is no election, grace takeover, or manual role transfer. Already-played legacy history establishes later-round permission but never creator identity. Historical bikes from legacy array snapshots remain unclaimable; version-1 snapshots can retain valid bike verifiers when the launch marker is absent.

### Missing, legacy, and malformed data

| Snapshot condition                                                         | Behavior                                                                                                                                                                                |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing file                                                               | Start with an empty room list.                                                                                                                                                          |
| Legacy array format                                                        | Load disconnected historical rosters and scores without credentials, even if an unexpected private field appears. Those IDs cannot be reclaimed; create a new room to continue playing. |
| Missing or malformed verifier in an otherwise valid room                   | Fail closed for that player; other valid credentials remain usable.                                                                                                                     |
| Missing or malformed independent creator verifier                          | Creator recovery is unavailable; do not elect an owner. Valid bikes and later-round permission remain independent.                                                                      |
| Malformed or contradictory launch metadata                                 | Restore no rooms, preserve original bytes, and block writes/creation with `INVALID_SNAPSHOT` until manual valid-snapshot recovery.                                                      |
| Unknown future version, malformed file, or malformed room-record structure | Preserve the original file, block new writes and room creation, and emit a safe diagnostic until compatible software or a valid backup is restored.                                     |

---

## 7. Room Inactivity and Destruction

A room's live membership is the activity source: each open joined socket counts
once, including spectators and creators with no bikes. The last live departure
starts `allDisconnected` immediately, including when defensive pruning observes
a dead or stale member. Repeated cleanup preserves that timestamp. Creation and
cold restoration start a fresh empty window; the timestamp is process-local and
is never saved. Rejoining clears it, and a later last departure starts a new
window. An open former member in the lobby or another room, offline roster,
creator proof, creation retry or read-only credential discovery cannot extend it.

`GameSession.checkConnectionStatus()` prunes stale members through the ordinary
departure path and destroys an empty room at or after `IDLE_ROOM_TIMEOUT_MS`
(five minutes) on the next 60-second check. Expiry is therefore checked
periodically, rather than promised at an exact second. Each session has one
`statusTimer`, which uses `unref()` and cannot keep Node.js alive by itself.

`GameSession.destroy()` and `GameServer.destroyGame()` use one idempotent
lifecycle for explicit deletion, idle expiry and failed-creation rollback:

- Invalidate pending preparation/countdown, physics and status callbacks before
  releasing room data. Captured queued callbacks and arena/event hooks become
  inert; repeated destruction emits no room events, writes or timers.
- Release arena buffers, player/score data, handlers, live membership, ownership
  and credential verifiers. Clear affected socket routing, registration retries
  and input handles without closing the connection or resetting its monotonically
  increasing handle counter. Other rooms' ownership and handles survive.
- Remove only the exact registered instance. A stale callback or disposal of an
  old object cannot remove a replacement with the same key. The socket's
  `gameSession` instance index protects replacement-room bindings alongside
  `gameKey`; neither routing index independently grants membership.
- Purge socket discovery grants and creation-retry references to that instance.
  The bounded creation cache retains only a request-ID tombstone, preserving
  `REQUEST_ID_CONFLICT` for an expired retry without retaining its room or secret
  response. Checked clients receive personalized `missingKeys` deletion notices; unrelated
  clients learn no private-room keys. Successful snapshot writes remove the room
  from disk, and runtime removal immediately frees server room capacity.

The existing storage policy still applies: failed deletion writes emit a safe
storage diagnostic but do not restore the runtime room or retry automatically.
The previous snapshot may restore that room after a restart. Read-only snapshots
remain protected. Failed creation is not acknowledged and disposes its exact
transient instance without another write or lobby announcement. No stronger disk
durability or deletion guarantee is implied after a failed snapshot write.

Browser membership acceptance and the final roadmap audit remain tracked in the
[approved plan](../plans/2026-10-17-accurate-room-membership-and-cleanup.md).

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
  - A 50ms paint synchronization tick validates room, socket generation and attempt before `Renderer.resetGrid()` resets the local `Int8Array` buffer and eligible local participants send attempt-scoped `ARENA_READY`. Spectators display prepared positions without acknowledging readiness.
  - The one-second score reveal uses the same guards. Close, leave, switch, cancellation and a replacement attempt clear both delayed callbacks; manually queued stale callbacks cannot repaint a replacement arena, acknowledge it, or change its screen.
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
