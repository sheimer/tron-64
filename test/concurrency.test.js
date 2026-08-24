import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'

// Use a dedicated test data directory
const testDataDir = path.resolve(process.cwd(), 'data-test-concurrency')
process.env.DATA_DIR = testDataDir
process.env.MAX_ACTIVE_GAMES = '3' // Low limit for fast testing

if (fs.existsSync(testDataDir)) {
  fs.rmSync(testDataDir, { recursive: true, force: true })
}

const { gameServer } = await import('../server/GameServer.js')
const { MAX_ACTIVE_GAMES, MAX_CLIENTS_PER_ROOM } = await import('../shared/constants.js')

console.log('--- Testing Server Concurrency & Capacity Limits ---')

assert.strictEqual(MAX_ACTIVE_GAMES, 3, 'MAX_ACTIVE_GAMES should be 3 from process.env')

console.log('1. Creating games up to capacity...')
const key1 = gameServer.createGame({ name: 'Game 1', interval: 25, isPublic: true })
const key2 = gameServer.createGame({ name: 'Game 2', interval: 25, isPublic: true })
const key3 = gameServer.createGame({ name: 'Game 3', interval: 25, isPublic: true })

assert.ok(key1, 'Game 1 should be created')
assert.ok(key2, 'Game 2 should be created')
assert.ok(key3, 'Game 3 should be created')
assert.strictEqual(gameServer.games.length, 3, 'Should have 3 games in memory')

console.log('2. Attempting to create game beyond capacity...')
const key4 = gameServer.createGame({ name: 'Game 4 (Over capacity)', interval: 25, isPublic: true })
assert.strictEqual(key4, null, 'Game 4 creation must be rejected with null')
assert.strictEqual(gameServer.games.length, 3, 'Should still have 3 games')

console.log('3. Destroying a game and verifying a new game can now be created...')
const g1 = gameServer.getGame(key1)
g1.destroy()
assert.strictEqual(gameServer.games.length, 2, 'Should have 2 games after destroying Game 1')

const key5 = gameServer.createGame({ name: 'Game 5 (Replacement)', interval: 25, isPublic: true })
assert.ok(key5, 'Game 5 should now succeed since capacity freed up')
assert.strictEqual(gameServer.games.length, 3, 'Should be at capacity (3 games)')

console.log('4. Verifying room client capacity constant...')
assert.strictEqual(MAX_CLIENTS_PER_ROOM, 32, 'MAX_CLIENTS_PER_ROOM should be 32')

// Clean up remaining games
gameServer.games.slice().forEach((g) => g.destroy())
if (fs.existsSync(testDataDir)) {
  fs.rmSync(testDataDir, { recursive: true, force: true })
}

console.log('--- ALL CONCURRENCY UNIT TESTS PASSED! ---')
