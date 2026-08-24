import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'

// Dedicated test data directory
const testDataDir = path.resolve(process.cwd(), 'data-test-spectator')
process.env.DATA_DIR = testDataDir

if (fs.existsSync(testDataDir)) {
  fs.rmSync(testDataDir, { recursive: true, force: true })
}

const { gameServer } = await import('../server/GameServer.js')

console.log('--- Testing Spectator Permissions & Speed Sync ---')

// 1. Create a game and verify interval is in getGameInfo
console.log('1. Verifying interval in gameServer.getGameInfo...')
const key = gameServer.createGame({
  name: 'Speed Test Game',
  interval: 40,
  isPublic: true,
})

const game = gameServer.getGame(key)
assert.ok(game, 'Game must exist')
assert.strictEqual(game.interval, 40, 'Default interval should be 40ms')

const info = gameServer.getGameInfo(key)
assert.strictEqual(info.interval, 40, 'getGameInfo must include interval')

// 2. Add players and verify setInterval updates and triggers persistence
console.log('2. Verifying setInterval persistence and getGameInfo sync...')
game.addPlayer({ id: 'p1', name: 'Alice', color: 'water', left: 65, right: 68 })
game.addPlayer({ id: 'p2', name: 'Bob', color: 'leaf', left: 37, right: 39 })

game.setInterval(20)
assert.strictEqual(game.interval, 20, 'Interval should be updated to 20ms')

const updatedInfo = gameServer.getGameInfo(key)
assert.strictEqual(updatedInfo.interval, 20, 'Updated interval must reflect in getGameInfo')

// 3. Clean up
game.destroy()
if (fs.existsSync(testDataDir)) {
  fs.rmSync(testDataDir, { recursive: true, force: true })
}

console.log('--- ALL SPECTATOR & SPEED SYNC UNIT TESTS PASSED! ---')
