import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

// Test with a dedicated test data directory
const testDataDir = path.resolve(process.cwd(), 'data-test-persistence')
process.env.DATA_DIR = testDataDir

// Clean up test dir
if (fs.existsSync(testDataDir)) {
  fs.rmSync(testDataDir, { recursive: true, force: true })
}

const { gameServer } = await import('../server/GameServer.js')
const { storage } = await import('../server/Storage.js')

console.log('--- Testing Match State Persistence & Recovery ---')

console.log('1. Creating a game session...')
const gameKey = gameServer.createGame({
  name: 'Persistence Test Arena',
  interval: 40,
  isPublic: true,
})

const game = gameServer.getGame(gameKey)
assert.ok(game, 'Game should exist in memory')

console.log('2. Adding players...')
game.addPlayer({ id: '0', name: 'Alice', color: '#ff0000', left: 37, right: 39 })
game.addPlayer({ id: '1', name: 'Bob', color: '#00ff00', left: 65, right: 68 })

console.log('3. Simulating a round finish and score tally...')
game.addStats({
  kills: { 0: 1 },
  escaped: [],
  deadOnDeath: { 1: 0 },
  winner: '0',
})

const info = gameServer.getGameInfo(gameKey)
assert.strictEqual(info.players.length, 2)
assert.strictEqual(info.scores.gamecount, 1)
assert.strictEqual(info.scores.players[0].name, 'Alice')
assert.strictEqual(info.scores.players[0].total, 6) // killer + winner

console.log('4. Verifying atomic snapshot file on disk...')
const snapshotFile = path.join(testDataDir, 'games.json')
assert.ok(fs.existsSync(snapshotFile), 'games.json must exist')
const raw = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'))
assert.strictEqual(raw.length, 1)
assert.strictEqual(raw[0].key, gameKey)
assert.strictEqual(raw[0].players.length, 2)
assert.strictEqual(raw[0].stats.gamecount, 1)

console.log('5. Simulating cold server restart...')
const savedGames = storage.loadGames()
assert.strictEqual(savedGames.length, 1)
assert.strictEqual(savedGames[0].players[0].name, 'Alice')
assert.strictEqual(savedGames[0].stats.players[0].total, 6)

// Clean up test dir and game session
game.destroy()
if (fs.existsSync(testDataDir)) {
  fs.rmSync(testDataDir, { recursive: true, force: true })
}

console.log('--- ALL PERSISTENCE TESTS PASSED! ---')
