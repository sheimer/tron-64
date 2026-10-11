# Networking & Protocol Architecture

> **Audience:** Reference for AI agents and maintainers working on WebSocket messaging, binary streaming, or network synchronization.

---

## 1. Single WebSocket Connection Model

All client-server communication runs over a single persistent WebSocket connection (`/ws`), multiplexed across:

1. **Lobby operations:** Fetching active games, creating new rooms.
2. **Room operations:** Joining, configuring players, starting rounds, receiving state broadcasts.
3. **In-band latency monitoring:** Ping/pong heartbeat frames measuring round-trip time (RTT).

- **Server Handler:** `server/wsHandler.js`
- **Client Singleton:** `public/javascripts/network.js`
- **Protocol Constants:** `shared/protocol.js`

---

## 2. Binary vs. JSON Framing

To minimize string allocations, GC pressure, and serialization overhead during the 40 FPS game loop:

| Payload Type          | Format               | Structure / Encoding                                                                     | Why                                                                                                                                                                              |
| :-------------------- | :------------------- | :--------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Grid Draw Deltas**  | Binary `ArrayBuffer` | Opcode `0x01`, then repeated 5-byte cell records: `[Uint16 X, Uint16 Y, Int8 CellValue]` | Avoids stringifying thousands of coordinates per second; zero-copy decoding via `DataView`.                                                                                      |
| **Player Movement**   | Binary `ArrayBuffer` | 3-byte frame: `[Opcode (0x02), inputHandle (Uint8), Direction (0 left / 1 right)]`       | A handle is allocated for this socket only after acknowledged registration or reconnect. The canonical player ID remains a string, including hexadecimal or numeric-looking IDs. |
| **Lifecycle & Setup** | JSON Text            | Typed messages: `{ type: MSG_TYPE.*, ...payload }`                                       | Low-frequency setup messages benefit from human-readable schema flexibility.                                                                                                     |

---

## 3. Registration, Ownership & Input Handles

Clients send protocol version `3` with JSON requests. The server requires the version before processing them and sends `PROTOCOL_MISMATCH` with reload guidance to clients with a missing or mismatched version. The initial lobby response carries the version, and the browser waits for it before sending room actions. Binary movement is accepted only after a versioned room join.

Deploy the matching client bundle and server protocol together; stale cached clients must reload when they receive `PROTOCOL_MISMATCH`. JSON messages use the current `type` constants only; `action` envelopes and lowercase aliases are unsupported. Unknown message types return `UNKNOWN_MESSAGE_TYPE` with a correlated request ID when supplied. Keep the room snapshot backup and matching client/server build together for rollback; see [lifecycle](lifecycle.md#9-upgrade-and-rollback).

`CREATE_GAME` requires a valid correlated `requestId`. Before registering any bikes, it creates a separate logical creator client ID and random room credential, saves the private SHA-256 verifier with the room, then privately returns `GAME_CREATED` with `{ key, ownerClientId, roomOwnerToken }`, the request ID, and the current protocol version. Save failure removes the entire new room and returns `PERSISTENCE_FAILED`. The same socket/request/payload can replay its private result only while the same room instance remains live; a changed payload or expired room returns `REQUEST_ID_CONFLICT`. This retry cache holds at most 32 responses. The browser sends at most three identical creation attempts on the same socket generation and accepts only its pending correlated acknowledgement.

Creator recovery uses a separate `roomOwner: { ownerClientId, roomOwnerToken }` claim in `JOIN_GAME`. The private, versioned `JOIN_RESULT` includes `roomOwner: null` without a claim, `{ accepted: true, ownerClientId }` on success, or `{ accepted: false, code: 'INVALID_OWNER_CREDENTIAL' }` on rejection. Owner and bike claims are authenticated independently; all room/handle capacity checks finish before any membership or binding changes. An owner-only claim allocates no bike handles. A valid replacement binding revokes only the former socket's creator controls through `ROOM_OWNER_REVOKED`; bike control changes require their own claims. Public IDs and bike credentials cannot grant creator authority.

`ADD_PLAYER` carries a unique `requestId` and player configuration. The room validates its registration state, ID, controls, and six-player limit before creating a player. It atomically saves the roster and SHA-256 verifier before `PLAYER_REGISTERED` privately returns the same `requestId`, room key, canonical string ID, 32-byte random base64url `reconnectToken`, and socket-local `inputHandle`. A failed save returns `PERSISTENCE_FAILED` and rolls back registration without consuming a handle. The browser commits controls and enables input only for a matching acknowledgement on its current socket and room. Duplicate identical requests with the same `requestId` on that socket return the cached private acknowledgement without registering another player; the cache holds at most 32 responses and vanishes with the socket. Errors include stable `code`, safe explanation in `payload`, and `requestId` when applicable.

The room owns the authoritative player-ID-to-socket map. The socket maintains an index of its owned IDs and two handle maps. Each binary movement frame must have exactly three bytes, the correct opcode and direction, an active handle, current room membership, and authoritative ownership before changing the player. Public IDs remain canonical strings; the server looks up a handle to find that exact string without numeric coercion. Handles are never reused within a socket lifetime, including room switches. Once all 256 are allocated, registration or reconnect requiring a new handle returns `INPUT_HANDLE_EXHAUSTED` without modifying the roster or existing bindings. The browser offers an explicit reload action, then the player selects “rejoin” in the lobby to authenticate saved credentials. Reloading applies normal disconnect behavior; players can race again next round. Handles never wrap and recovery never automatically loops.

Movement uses binary frames exclusively; JSON movement messages follow the ordinary unknown-message path. Knowledge of a public ID does not grant control. `JOIN_GAME` accepts `{ key, reconnect: [{ id, reconnectToken }], roomOwner? }` with a correlated `requestId`; empty claims join as spectator. At most six claims are allowed, duplicate IDs reject the whole request, and each credential is validated independently. `JOIN_RESULT` privately returns `{ key, accepted: [{ id, inputHandle }], rejected: [{ id, code }], roomOwner }` without tokens. Only `reconnect` entries claim players; unrelated payload fields are ignored. Invalid credentials do not change other owners; handle capacity and room admission are checked before any ownership changes. Ordinary joins accept valid claims independently. A repeated claim by the current owner retains its active handle. Last authenticated transfer wins and the former owner receives `OWNERSHIP_REVOKED` for only the transferred IDs. Public `GAME_INFO` projects an explicit set of player and score fields and never carries secrets, verifiers, handles, or socket ownership maps. It may publish `ownerClientId`, `ownerStatus` (`present`, `away`, `unrecoverable`), `firstRoundStarted`, and the authenticated `eligiblePlayerCount`; these fields describe permissions and confer none.

Drawing deltas are binary-only on reception: the network routes opcode `0x01` packets after protocol negotiation to its internal `GAME_DRAW` event. The renderer alone validates framing, complete five-byte records, cell bounds, and values across the entire `DataView` before painting; neither a JSON `GAME_DRAW` nor an array delta reaches canvas. JSON `GAME_INFO`, `GAME_RESET`, and other control/full-state messages retain their existing behavior. The browser dispatches JSON using `type` alone and ignores unrelated envelope fields.

Snapshot version 1 keeps room metadata, roster, scores, `firstRoundStarted`, and a dedicated private player-ID-to-SHA-256-verifier map plus `private.roomOwner: { ownerClientId, verifier }`. Raw room-owner tokens never enter snapshots. The server restores no socket ownership; all players and scoreboard connection flags begin disconnected. Matching credentials remain valid across restart for that room/player only. Legacy snapshots have no credentials and are unclaimable; unknown future snapshot versions are preserved read-only with a safe error until compatible server data is available.

### Round and speed controls

The authenticated creator alone may request the first round, including a creator controlling no bikes. After a successfully committed first launch, any open joined client may request a later round, including a spectator, without the creator being present. At admission and final launch, require two to six registered slots and at least two connected bikes whose authoritative owners are open room members; two bikes on one socket qualify. Rejected starts do not reset positions, finish a round, add scores, or replace timers. A room-owned pending latch rejects repeated starts and interval changes during preparation/countdown; running physics rejects both too. The initial launch flag is saved before physics begins. A failed launch save rolls it back and clears the pending start, preserving the initial creator gate.

`SET_INTERVAL` requires the current authenticated creator between rounds and an integer in the inclusive 10–500 ms range. Save before broadcasting the new room interval; failure restores the old value. Control errors use `NOT_IN_ROOM`, `CREATOR_REQUIRED`, `INSUFFICIENT_PLAYERS`, `ROUND_PENDING`, `ROUND_RUNNING`, `INVALID_INTERVAL`, and `PERSISTENCE_FAILED`, with an explanation and supplied request ID.

This is Phase 1 scaffolding: reset/readiness/countdown messages retain their current unscoped payloads, and `GAME_STATE: 'running'` still signals the countdown. Full attempt identities, participant cancellation, authoritative client cancellation routing, and strict cold-restore validation are pending in [the approved plan](../plans/2026-10-11-registration-invariants-and-round-authority.md). This intermediate phase is not launch-ready.

## 4. Direction Input Queue & Fast-Path

- `Player.changeDir()` immediately changes `move` by a quarter turn and appends that orientation's vector to `dirStack`. On each physics step, `nextPos()` shifts the oldest vector only while more than one is queued; the last vector remains and is reused on subsequent steps. Multiple inputs can queue multiple vectors before movement advances.

---

## 5. In-Band Latency & Connection Quality (CQI)

- The client sends ping frames with timestamp `t1`.
- The server responds immediately with `{ type: 'PONG', t: t1 }`.
- Client calculates RTT = `Date.now() - t1` and updates:
  - Persistent visual `#cqi` signal (🟢 $<60\text{ms}$, 🟡 $60–120\text{ms}$, 🔴 $>120\text{ms}$, ⚫ Disconnected).
  - Numeric `#ping` display in milliseconds.
