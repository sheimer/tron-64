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

| Payload Type          | Format               | Structure / Encoding                                                               | Why                                                                                                                   |
| :-------------------- | :------------------- | :--------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------- |
| **Grid Draw Deltas**  | Binary `ArrayBuffer` | Repeated 5-byte cell records: `[Uint16 X, Uint16 Y, Int8 CellValue]`               | Avoids stringifying thousands of coordinates per second; zero-copy decoding via `DataView`.                           |
| **Player Movement**   | Binary `ArrayBuffer` | 3-byte frame: `[Opcode (0x02), inputHandle (Uint8), Direction (0 left / 1 right)]` | A handle is allocated for this socket only after acknowledged registration. The canonical player ID remains a string. |
| **Lifecycle & Setup** | JSON Text            | Typed messages: `{ type: MSG_TYPE.*, ...payload }`                                 | Low-frequency setup messages benefit from human-readable schema flexibility.                                          |

---

## 3. Registration, Ownership & Input Handles

Clients send protocol version `2` with JSON requests. The server requires the version before processing them and sends `PROTOCOL_MISMATCH` with reload guidance to older clients. The initial lobby response carries the version, and the browser waits for it before sending room actions. Binary movement is accepted only after a versioned room join.

`ADD_PLAYER` carries a unique `requestId` and player configuration. The room validates its registration state, ID, controls, and six-player limit before creating a player. `PLAYER_REGISTERED` privately returns the same `requestId`, room key, canonical string ID, 32-byte random base64url `reconnectToken`, and socket-local `inputHandle`. The browser commits controls and enables input only for a matching acknowledgement on its current socket and room. Duplicate identical requests with the same `requestId` on that socket return the cached private acknowledgement without registering another player; the cache holds at most 32 responses and vanishes with the socket. Errors include stable `code`, safe explanation in `payload`, and `requestId` when applicable.

The room owns the authoritative player-ID-to-socket map. The socket maintains an index of its owned IDs and two handle maps. Each binary movement frame must have exactly three bytes, the correct opcode and direction, an active handle, current room membership, and authoritative ownership before changing the player. Handles are never reused within a socket lifetime, including room switches. Once all 256 are allocated, registration returns `INPUT_HANDLE_EXHAUSTED` without modifying the roster or existing bindings. A fresh connection is necessary; in this interim phase, it can register new players in an eligible room or create a new room. Authenticated reclaim on a new socket is planned for Phase 2.

JSON `CHANGE_DIR` and `changeDir` requests are rejected with `BINARY_INPUT_REQUIRED` through `type` or legacy `action` envelopes, with reload guidance. Knowledge of a public ID does not grant control. A `JOIN_GAME` request with legacy `playerIds` or reconnection claims returns `RECONNECT_UNAVAILABLE`; a spectator joins with `{ key }` only. No ID-only recovery is available. Public `GAME_INFO` projects an explicit set of player and score fields and never carries secrets, verifiers, handles, or ownership.

## 4. Direction Input Queue & Fast-Path

- `Player.changeDir()` changes the current orientation by a quarter turn and appends the new vector to `dirStack`. Physics consumes queued vectors as the cycle advances.

---

## 5. In-Band Latency & Connection Quality (CQI)

- The client sends ping frames with timestamp `t1`.
- The server responds immediately with `{ type: 'pong', t: t1 }`.
- Client calculates RTT = `Date.now() - t1` and updates:
  - Persistent visual `#cqi` signal (🟢 $<60\text{ms}$, 🟡 $60–120\text{ms}$, 🔴 $>120\text{ms}$, ⚫ Disconnected).
  - Numeric `#ping` display in milliseconds.
