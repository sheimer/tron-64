import assert from 'node:assert/strict'
import { Arena } from '../server/Arena.js'
import { GameSession } from '../server/GameSession.js'
import { Player } from '../shared/Player.js'
import { CELL_TYPE } from '../shared/constants.js'

console.log('--- Testing Disconnected Client Lifecycle ---')

// 1. Setup Arena and Players
const arena = new Arena()
const p1 = new Player({ id: 'p1', name: 'Alice', color: 'rose', left: 65, right: 68 })
const p2 = new Player({ id: 'p2', name: 'Bob', color: 'leaf', left: 37, right: 39 })

arena.addPlayer(p1)
arena.addPlayer(p2)
arena.reset()

assert.strictEqual(arena.players.length, 2, 'Arena should have 2 players')
assert.strictEqual(p1.connected, true, 'p1 should be connected')
assert.strictEqual(p2.connected, true, 'p2 should be connected')

// Check initial positions on grid
const p1Start = { ...p1.pos }
const p2Start = { ...p2.pos }
assert.strictEqual(arena.fields[p1Start.x][p1Start.y], 0, 'Grid should have p1 start dot at index 0')
assert.strictEqual(arena.fields[p2Start.x][p2Start.y], 1, 'Grid should have p2 start dot at index 1')

// 2. Simulate Mid-Round Movement & Disconnect
arena.run() // Tick 1
arena.run() // Tick 2

const p1TrailPos = { ...p1Start }
assert.strictEqual(arena.fields[p1TrailPos.x][p1TrailPos.y], 0, 'p1 initial dot should still be on grid as trail')

// Disconnect p1 mid-round
console.log('Testing Phase 1: Mid-round disconnect')
const disconnected = arena.disconnectPlayer('p1')
assert.strictEqual(disconnected.id, 'p1', 'Should return disconnected player')
assert.strictEqual(p1.connected, false, 'p1.connected should be false')
assert.strictEqual(p1.alive, false, 'p1 should be dead immediately')
assert.strictEqual(arena.explosions.length > 0, true, 'Explosion should be triggered for p1')
assert.strictEqual(arena.fields[p1TrailPos.x][p1TrailPos.y], 0, 'p1 trail must remain intact on the grid as an obstacle')
assert.strictEqual(p2.alive, true, 'p2 should still be alive')

// 3. Subsequent Round with Disconnected Player (0 Trail at Start)
console.log('Testing Phase 2: Subsequent round with disconnected player (0 trail start)')
arena.reset()
assert.strictEqual(p1.connected, false, 'p1 should still be disconnected')
assert.strictEqual(p2.connected, true, 'p2 should still be connected')

const newP1Start = { ...p1.pos }
arena.startRound()

assert.strictEqual(p1.alive, false, 'p1 should be immediately eliminated in startRound')
assert.strictEqual(arena.fields[newP1Start.x][newP1Start.y], CELL_TYPE.EMPTY, 'p1 starting dot must be cleared to EMPTY (no ghost trail)')
assert.strictEqual(p2.alive, true, 'p2 should remain alive to drive')

// 4. Reconnection Handling
console.log('Testing Phase 3: Player reconnection and resumption')
arena.reconnectPlayer('p1')
assert.strictEqual(p1.connected, true, 'p1 should now be connected')

arena.reset()
const reconnectP1Start = { ...p1.pos }
arena.startRound()

assert.strictEqual(p1.alive, true, 'p1 should be alive on round start after reconnect')
assert.strictEqual(p2.alive, true, 'p2 should be alive')
assert.strictEqual(arena.fields[reconnectP1Start.x][reconnectP1Start.y], 0, 'p1 start dot should be placed on grid')

// 5. GameSession Lifecycle
console.log('Testing Phase 4: GameSession integration')
const session = new GameSession({ key: 'test', name: 'Test Game', interval: 25 })
session.addPlayer({ id: 's1', name: 'Player1', color: 'rose', left: 65, right: 68 })
session.addPlayer({ id: 's2', name: 'Player2', color: 'leaf', left: 37, right: 39 })

assert.strictEqual(session.arena.players.length, 2, 'Session should have 2 players')
session.disconnectPlayer('s1')
assert.strictEqual(session.arena.players[0].connected, false, 'Player 1 should be marked disconnected in session')
session.reconnectPlayer('s1')
assert.strictEqual(session.arena.players[0].connected, true, 'Player 1 should be marked reconnected in session')
session.destroy()

console.log('--- ALL DISCONNECTED LIFECYCLE TESTS PASSED! ---')
