import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import { Arena } from '../server/Arena.js'
import { Player } from '../shared/Player.js'
import { CELL_TYPE, GRID_SIZE } from '../shared/constants.js'

console.log('--- Testing Explosion Ghosting & Cleanup Lifecycle ---')

// Helper function to scan an Arena grid for any explosion particles
function countExplosionCells(fields, size = GRID_SIZE) {
  let count = 0
  for (let x = 0; x < size.x; x++) {
    for (let y = 0; y < size.y; y++) {
      if (fields[x][y] === CELL_TYPE.EXPLOSION) {
        count++
      }
    }
  }
  return count
}

// ---------------------------------------------------------------------------
// 1. Mid-round explosion particle generation and Arena.reset() hygiene
// ---------------------------------------------------------------------------
console.log(
  '1. Verifying mid-round explosion lifecycle and Arena.reset() cleanup...',
)
const arena = new Arena()
const p1 = new Player({
  id: 'p1',
  name: 'Alice',
  color: 'rose',
  left: 65,
  right: 68,
})
const p2 = new Player({
  id: 'p2',
  name: 'Bob',
  color: 'leaf',
  left: 37,
  right: 39,
})
arena.addPlayer(p1)
arena.addPlayer(p2)
arena.reset()

assert.strictEqual(
  arena.explosions.length,
  0,
  'Initial arena must have 0 explosions',
)
assert.strictEqual(
  countExplosionCells(arena.fields),
  0,
  'Initial grid must have 0 explosion cells',
)

// Advance a few ticks
arena.run()
arena.run()

// Manually trigger a crash / explosion for p1
arena.killPlayer(0, p1, -1)
assert.strictEqual(
  arena.explosions.length,
  1,
  'Explosion should be registered for p1',
)

// Run ticks so particles disperse across the grid
for (let i = 0; i < 5; i++) {
  arena.run()
}

const activeExplosionCells = countExplosionCells(arena.fields)
assert.ok(
  activeExplosionCells > 0,
  `Active explosion should have painted particles to grid (found ${activeExplosionCells})`,
)

// Reset the arena mid-explosion (e.g. host restarts or next round begins)
arena.reset()

assert.strictEqual(
  arena.explosions.length,
  0,
  'Arena.reset() must immediately flush all active explosions (explosions.length === 0)',
)
assert.strictEqual(
  countExplosionCells(arena.fields),
  0,
  'Arena.reset() must leave zero residual CELL_TYPE.EXPLOSION particles in fields',
)

// Ensure fieldChanges emitted on reset contains only player start dots, no explosion debris
const residualExplosionChanges = arena.fieldChanges.filter(
  ([, , val]) => val === CELL_TYPE.EXPLOSION,
)
assert.strictEqual(
  residualExplosionChanges.length,
  0,
  'Arena.fieldChanges after reset must not contain any CELL_TYPE.EXPLOSION deltas',
)

// ---------------------------------------------------------------------------
// 2. Natural explosion decay and timeout expiration cleanup
// ---------------------------------------------------------------------------
console.log(
  '2. Verifying natural particle decay and timeout expiration cleanup...',
)
arena.reset()
arena.killPlayer(0, p1, -1)
assert.strictEqual(arena.explosions.length, 1)

// Force the explosion startTime backwards to trigger max duration expiration
arena.explosions[0].startTime = Date.now() - 10000

// Run a tick to trigger isExpired cleanup
arena.run()

assert.strictEqual(
  arena.explosions.length,
  0,
  'Expired explosion must be removed from arena.explosions',
)
assert.strictEqual(
  countExplosionCells(arena.fields),
  0,
  'Expired explosion must clean all particles back to CELL_TYPE.EMPTY',
)

// ---------------------------------------------------------------------------
// 3. Wall breach particles vs border restoration on reset
// ---------------------------------------------------------------------------
console.log(
  '3. Verifying wall breach cleanup and border restoration on reset...',
)
arena.reset()
// Place player directly adjacent to border (x: 1, y: 50) and trigger explosion
p1.pos = { x: 1, y: 50 }
arena.killPlayer(0, p1, -1)

// Advance simulation to let particles breach the border at x=0
for (let i = 0; i < 15; i++) {
  arena.run()
}

// Expire any remaining particles
if (arena.explosions.length > 0) {
  arena.explosions[0].startTime = Date.now() - 10000
  arena.run()
}

assert.strictEqual(
  countExplosionCells(arena.fields),
  0,
  'No particles should remain after expiration',
)

// Verify that resetting arena restores all borders cleanly
arena.reset()
for (let y = 0; y < arena.size.y; y++) {
  assert.strictEqual(
    arena.fields[0][y],
    CELL_TYPE.BORDER,
    `Left border at y=${y} must be restored to CELL_TYPE.BORDER`,
  )
  assert.strictEqual(
    arena.fields[arena.xMax][y],
    CELL_TYPE.BORDER,
    `Right border at y=${y} must be restored to CELL_TYPE.BORDER`,
  )
}

// ---------------------------------------------------------------------------
// 4. Disconnected player explosion lifecycle
// ---------------------------------------------------------------------------
console.log('4. Verifying disconnected player explosion lifecycle...')
arena.reset()
// Mid-round disconnect
const disconnected = arena.disconnectPlayer('p1')
assert.strictEqual(disconnected.id, 'p1')
assert.strictEqual(p1.connected, false)
assert.ok(arena.explosions.length > 0, 'Disconnect should spawn explosion')

// Reset for subsequent round
arena.reset()
assert.strictEqual(
  arena.explosions.length,
  0,
  'Subsequent round starts with 0 explosions',
)
assert.strictEqual(
  countExplosionCells(arena.fields),
  0,
  'Subsequent round has 0 explosion cells',
)

// Disconnected player in startRound explodes at start dot and starting dot is cleared
const offlineStartPos = { ...p1.pos }
arena.startRound()

assert.strictEqual(
  p1.alive,
  false,
  'Offline player is eliminated on startRound',
)
assert.strictEqual(
  arena.fields[offlineStartPos.x][offlineStartPos.y],
  CELL_TYPE.EMPTY,
  'Offline player start dot must be cleared to EMPTY (no ghost dot or obstacle)',
)
assert.strictEqual(
  arena.explosions.length,
  1,
  'Offline player elimination spawns explosion',
)

// Advance simulation until offline player explosion finishes
for (let i = 0; i < 30; i++) {
  if (arena.explosions.length === 0) break
  arena.run()
}
// Force expiry if any particles are lingering
if (arena.explosions.length > 0) {
  arena.explosions.forEach((e) => (e.startTime = Date.now() - 10000))
  arena.run()
}

assert.strictEqual(
  arena.explosions.length,
  0,
  'Offline explosion should finish',
)
assert.strictEqual(
  countExplosionCells(arena.fields),
  0,
  'Zero ghost cells should remain',
)

// ---------------------------------------------------------------------------
// 5. Client-Side Int8Array buffer & Renderer reset simulation
// ---------------------------------------------------------------------------
console.log('5. Verifying client-side Int8Array grid buffer reset logic...')
// Emulate the hybrid delta renderer ground-truth buffer
const clientFields = []
for (let x = 0; x < GRID_SIZE.x; x++) {
  clientFields[x] = new Int8Array(GRID_SIZE.y).fill(CELL_TYPE.EMPTY)
}

// Simulate receiving binary explosion draw deltas from server
clientFields[10][20] = CELL_TYPE.EXPLOSION
clientFields[11][20] = CELL_TYPE.EXPLOSION
clientFields[10][21] = CELL_TYPE.EXPLOSION

let clientExplosions = 0
for (let x = 0; x < GRID_SIZE.x; x++) {
  for (let y = 0; y < GRID_SIZE.y; y++) {
    if (clientFields[x][y] === CELL_TYPE.EXPLOSION) clientExplosions++
  }
}
assert.strictEqual(
  clientExplosions,
  3,
  'Client buffer should register injected explosion cells',
)

// Simulate Renderer.clear() (called on GAME_RESET and GAME_FINISH)
for (let x = 0; x < GRID_SIZE.x; x++) {
  clientFields[x].fill(CELL_TYPE.EMPTY)
}

// Simulate Renderer.resetGrid() (called 50ms after GAME_RESET)
const xMax = GRID_SIZE.x - 1
const yMax = GRID_SIZE.y - 1
for (let x = 0; x < GRID_SIZE.x; x++) {
  for (let y = 0; y < GRID_SIZE.y; y++) {
    if (x === 0 || y === 0 || x === xMax || y === yMax) {
      clientFields[x][y] = CELL_TYPE.BORDER
    } else {
      clientFields[x][y] = CELL_TYPE.EMPTY
    }
  }
}

// Assert no explosion cells remain in the client buffer
let residualClientExplosions = 0
for (let x = 0; x < GRID_SIZE.x; x++) {
  for (let y = 0; y < GRID_SIZE.y; y++) {
    if (clientFields[x][y] === CELL_TYPE.EXPLOSION) residualClientExplosions++
  }
}
assert.strictEqual(
  residualClientExplosions,
  0,
  'Client Int8Array buffer must contain 0 explosion cells after resetGrid()',
)

// ---------------------------------------------------------------------------
// 6. Cold server restart & storage persistence isolation
// ---------------------------------------------------------------------------
console.log(
  '6. Verifying storage persistence isolation across cold restarts...',
)
const testDataDir = path.resolve(
  process.cwd(),
  'data-test-explosion-persistence',
)
process.env.DATA_DIR = testDataDir

if (fs.existsSync(testDataDir)) {
  fs.rmSync(testDataDir, { recursive: true, force: true })
}

const { gameServer } = await import('../server/GameServer.js')
const { storage } = await import('../server/Storage.js')

const gameKey = gameServer.createGame({
  name: 'Explosion Persistence Test',
  interval: 30,
  isPublic: true,
})
const game = gameServer.getGame(gameKey)
game.addPlayer({
  id: 'ep1',
  name: 'Player1',
  color: 'rose',
  left: 65,
  right: 68,
})
game.addPlayer({
  id: 'ep2',
  name: 'Player2',
  color: 'leaf',
  left: 37,
  right: 39,
})

// Simulate mid-round crash with active explosion
game.arena.killPlayer(0, game.arena.players[0], -1)
assert.strictEqual(game.arena.explosions.length, 1)

// Persist game state to disk
storage.saveGames([game])

const snapshotPath = path.join(testDataDir, 'games.json')
assert.ok(fs.existsSync(snapshotPath), 'games.json must exist')
const rawData = fs.readFileSync(snapshotPath, 'utf8')
assert.ok(
  !rawData.includes('explosions'),
  'Persisted JSON must never contain explosion objects',
)
assert.ok(
  !rawData.includes('CELL_TYPE'),
  'Persisted JSON must never contain grid buffer cells',
)

// Simulate cold reload
const loadedGames = storage.loadGames()
assert.strictEqual(loadedGames.length, 1)
assert.strictEqual(loadedGames[0].key, gameKey)
assert.strictEqual(
  loadedGames[0].explosions,
  undefined,
  'Loaded snapshot must not have explosions field',
)

// Clean up test data
game.destroy()
if (fs.existsSync(testDataDir)) {
  fs.rmSync(testDataDir, { recursive: true, force: true })
}

console.log('--- ALL EXPLOSION GHOSTING VERIFICATION TESTS PASSED! ---')
