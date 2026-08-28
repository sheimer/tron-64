# Networking & Protocol Architecture

> **Audience:** Reference for AI agents and maintainers working on WebSocket messaging, binary streaming, or network synchronization.

---

## 1. Single WebSocket Connection Model

All client-server communication runs over a single persistent WebSocket connection (`/ws`), multiplexed across:
1. **Lobby operations:** Fetching active games, creating new rooms.
2. **Room operations:** Joining, configuring players, starting rounds, receiving state broadcasts.
3. **In-band latency monitoring:** Ping/pong heartbeat frames measuring round-trip time (RTT).

* **Server Handler:** `server/wsHandler.js`
* **Client Singleton:** `public/javascripts/network.js`
* **Protocol Constants:** `shared/protocol.js`

---

## 2. Binary vs. JSON Framing

To minimize string allocations, GC pressure, and serialization overhead during the 40 FPS game loop:

| Payload Type | Format | Structure / Encoding | Why |
| :--- | :--- | :--- | :--- |
| **Grid Draw Deltas** | Binary `ArrayBuffer` | Repeated 5-byte cell records: `[Uint16 X, Uint16 Y, Int8 CellValue]` | Avoids stringifying thousands of coordinates per second; zero-copy decoding via `DataView`. |
| **Player Movement (`CHANGE_DIR`)** | Binary `ArrayBuffer` | 3-byte frame: `[Opcode (0x02), PlayerID (Uint8), Direction (Uint8)]` | Direct binary fast-path on server event loop, bypassing `JSON.parse()`. |
| **Lifecycle & Setup** | JSON Text | Typed messages: `{ type: MSG_TYPE.*, ...payload }` | Low-frequency setup messages benefit from human-readable schema flexibility. |

---

## 3. Direction Input Queue & Fast-Path

* Light-cycle directions are represented by `DIRECTION` constants: `UP (0)`, `RIGHT (1)`, `DOWN (2)`, `LEFT (3)`.
* Player inputs push to an internal direction queue on the `Player` model (`player.pushDirection()`) with immediate 180-degree reversal rejection (e.g. `UP` cannot directly follow `DOWN`).
* On each physics tick, `player.processDirection()` applies the next valid buffered turn.

---

## 4. In-Band Latency & Connection Quality (CQI)

* The client sends ping frames with timestamp `t1`.
* The server responds immediately with `{ type: 'pong', t: t1 }`.
* Client calculates RTT = `Date.now() - t1` and updates:
  * Persistent visual `#cqi` signal (🟢 $<60\text{ms}$, 🟡 $60–120\text{ms}$, 🔴 $>120\text{ms}$, ⚫ Disconnected).
  * Numeric `#ping` display in milliseconds.
