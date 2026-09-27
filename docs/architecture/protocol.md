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

Clients send protocol version `2` with JSON requests. The server requires the version before processing them and sends `PROTOCOL_MISMATCH` with reload guidance to older clients. The initial lobby response carries the version, and the browser waits for it before sending room actions. Binary movement is accepted only after a versioned room join.

`ADD_PLAYER` carries a unique `requestId` and player configuration. The room validates its registration state, ID, controls, and six-player limit before creating a player. It atomically saves the roster and SHA-256 verifier before `PLAYER_REGISTERED` privately returns the same `requestId`, room key, canonical string ID, 32-byte random base64url `reconnectToken`, and socket-local `inputHandle`. A failed save returns `PERSISTENCE_FAILED` and rolls back registration without consuming a handle. The browser commits controls and enables input only for a matching acknowledgement on its current socket and room. Duplicate identical requests with the same `requestId` on that socket return the cached private acknowledgement without registering another player; the cache holds at most 32 responses and vanishes with the socket. Errors include stable `code`, safe explanation in `payload`, and `requestId` when applicable.

The room owns the authoritative player-ID-to-socket map. The socket maintains an index of its owned IDs and two handle maps. Each binary movement frame must have exactly three bytes, the correct opcode and direction, an active handle, current room membership, and authoritative ownership before changing the player. Public IDs remain canonical strings; the server looks up a handle to find that exact string without numeric coercion. Handles are never reused within a socket lifetime, including room switches. Once all 256 are allocated, registration or reconnect requiring a new handle returns `INPUT_HANDLE_EXHAUSTED` without modifying the roster or existing bindings. The browser offers an explicit fresh-connection action that authenticates saved credentials; it never wraps handles or automatically loops through reclaim attempts.

JSON `CHANGE_DIR` and `changeDir` requests are rejected with `BINARY_INPUT_REQUIRED` through `type` or legacy `action` envelopes, with reload guidance. Knowledge of a public ID does not grant control. `JOIN_GAME` accepts `{ key, reconnect: [{ id, reconnectToken }] }` with a correlated `requestId`; empty claims join as spectator. At most six claims are allowed, duplicate IDs reject the whole request, and each credential is validated independently. `JOIN_RESULT` privately returns `{ key, accepted: [{ id, inputHandle }], rejected: [{ id, code }] }` without tokens. A legacy `playerIds` claim returns `AUTHENTICATION_REQUIRED`. Invalid credentials do not change other owners; handle capacity and room admission are checked before any ownership changes. Ordinary joins accept valid claims independently. The explicit fresh-connection recovery sends `requireAll: true`: an invalid credential returns `RECONNECT_INCOMPLETE` before any transfer, allowing the browser to restore its still-live original socket and acknowledged handles. A repeated claim by the current owner retains its active handle. Last authenticated transfer wins and the former owner receives `OWNERSHIP_REVOKED` for only the transferred IDs. Public `GAME_INFO` projects an explicit set of player and score fields and never carries secrets, verifiers, handles, or ownership.

Drawing deltas are binary-only on reception: the browser requires negotiated protocol, opcode `0x01`, and a header followed by one or more complete five-byte records before emitting its internal `GAME_DRAW` event. The renderer validates the complete `DataView`, including cell bounds and values, before painting; neither a JSON `GAME_DRAW` type/action nor an array delta reaches canvas. JSON `GAME_INFO`, `GAME_RESET`, and other control/full-state messages retain their existing behavior.

Snapshot version 1 keeps room metadata, roster, scores, and a dedicated private player-ID-to-SHA-256-verifier map. The server restores no socket ownership; all players and scoreboard connection flags begin disconnected. Matching credentials remain valid across restart for that room/player only. Legacy snapshots have no credentials and are unclaimable; unknown future snapshot versions are preserved read-only with a safe error until compatible server data is available.

## 4. Direction Input Queue & Fast-Path

- `Player.changeDir()` immediately changes `move` by a quarter turn and appends that orientation's vector to `dirStack`. On each physics step, `nextPos()` shifts the oldest vector only while more than one is queued; the last vector remains and is reused on subsequent steps. Multiple inputs can queue multiple vectors before movement advances.

---

## 5. In-Band Latency & Connection Quality (CQI)

- The client sends ping frames with timestamp `t1`.
- The server responds immediately with `{ type: 'pong', t: t1 }`.
- Client calculates RTT = `Date.now() - t1` and updates:
  - Persistent visual `#cqi` signal (🟢 $<60\text{ms}$, 🟡 $60–120\text{ms}$, 🔴 $>120\text{ms}$, ⚫ Disconnected).
  - Numeric `#ping` display in milliseconds.
