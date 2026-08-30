import assert from 'node:assert'
import http from 'node:http'
import { app } from '../app.js'
import { gameServer } from '../server/GameServer.js'
import {
  getMetrics,
  getContentType,
  crashesTotalCounter,
  roundsPlayedCounter,
  tickDurationSummary,
  wsClientsGauge,
  wsMessagesSentCounter,
  wsMessagesReceivedCounter,
} from '../server/metrics.js'

console.log('--- Testing Telemetry & Prometheus Metrics Module ---')

// 1. Check metric content type and initial output
console.log('1. Verifying Prometheus content-type and default process metrics...')
const contentType = getContentType()
assert.ok(contentType.includes('text/plain'), 'Content-Type must be text/plain')

const initialMetrics = await getMetrics()
assert.ok(initialMetrics.includes('nodejs_heap_size_used_bytes'), 'Should contain nodejs heap metric')
assert.ok(initialMetrics.includes('bitcycles_active_rooms'), 'Should contain bitcycles_active_rooms metric')
assert.ok(initialMetrics.includes('bitcycles_connected_players'), 'Should contain bitcycles_connected_players metric')

// 2. Test Gauge calculations with dynamic rooms and players
console.log('2. Verifying dynamic gauges for rooms and players...')
const pubKey = gameServer.createGame({
  name: 'Metrics Public Game',
  interval: 40,
  isPublic: true,
})
const privKey = gameServer.createGame({
  name: 'Metrics Private Game',
  interval: 40,
  isPublic: false,
})

const pubGame = gameServer.getGame(pubKey)
const privGame = gameServer.getGame(privKey)

pubGame.addPlayer({ id: '0', name: 'Alice', color: '#ff0000', left: 37, right: 39 })
pubGame.addPlayer({ id: '1', name: 'Bob', color: '#00ff00', left: 65, right: 68 })
privGame.addPlayer({ id: '2', name: 'Charlie', color: '#0000ff', left: 81, right: 87 })

const roomMetrics = await getMetrics()
assert.ok(
  roomMetrics.includes('bitcycles_active_rooms{visibility="public"} 1') ||
  roomMetrics.match(/bitcycles_active_rooms\{visibility="public"\}\s+[1-9]/),
  'Public room count must be >= 1',
)
assert.ok(
  roomMetrics.includes('bitcycles_active_rooms{visibility="private"} 1') ||
  roomMetrics.match(/bitcycles_active_rooms\{visibility="private"\}\s+[1-9]/),
  'Private room count must be >= 1',
)
assert.ok(
  roomMetrics.match(/bitcycles_connected_players\s+[3-9]/),
  'Connected players count must reflect added players',
)

// 3. Test Counter incrementation
console.log('3. Verifying counter incrementation (rounds, crashes, ws messages)...')
const beforeRounds = (await roundsPlayedCounter.get()).values[0]?.value || 0
pubGame.addStats({
  kills: { 0: 1 },
  escaped: [],
  deadOnDeath: { 1: 0 },
  winner: '0',
})
const afterRounds = (await roundsPlayedCounter.get()).values[0]?.value || 0
assert.strictEqual(afterRounds, beforeRounds + 1, 'roundsPlayedCounter must increment by 1 on round finish')

const beforeCrashes = (await crashesTotalCounter.get()).values[0]?.value || 0
pubGame.arena.killPlayer(0, pubGame.arena.players[0], -1)
const afterCrashes = (await crashesTotalCounter.get()).values[0]?.value || 0
assert.strictEqual(afterCrashes, beforeCrashes + 1, 'crashesTotalCounter must increment by 1 on killPlayer')

wsMessagesSentCounter.inc({ type: 'binary' })
wsMessagesReceivedCounter.inc({ type: 'text' })
wsClientsGauge.set(5)

const counterMetrics = await getMetrics()
assert.ok(counterMetrics.includes('bitcycles_ws_messages_sent_total{type="binary"}'), 'Binary WS sent metric present')
assert.ok(counterMetrics.includes('bitcycles_ws_messages_received_total{type="text"}'), 'Text WS received metric present')
assert.ok(counterMetrics.includes('bitcycles_ws_clients_active 5'), 'WS client gauge must equal 5')

// 4. Test Summary Timer
console.log('4. Verifying tick duration summary timer...')
const endTimer = tickDurationSummary.startTimer()
// simulate minimal computation
let sum = 0
for (let i = 0; i < 1000; i++) sum += i
endTimer()
assert.ok(sum > 0, 'Computation completed')

const summaryMetrics = await getMetrics()
assert.ok(summaryMetrics.includes('bitcycles_tick_duration_seconds'), 'Tick duration metric present')

// 5. Test Express Route GET /metrics & Authorization Rules
console.log('5. Verifying Express GET /metrics HTTP endpoint and security authorization...')
const testServer = http.createServer(app)
await new Promise((resolve) => testServer.listen(0, '127.0.0.1', resolve))
const port = testServer.address().port

// 5a. Localhost direct access (200 OK)
const resLocal = await fetch(`http://127.0.0.1:${port}/metrics`)
assert.strictEqual(resLocal.status, 200, 'GET /metrics from localhost must return HTTP 200')
const resText = await resLocal.text()
assert.ok(resText.includes('bitcycles_active_rooms'), 'Endpoint response must contain metrics payload')

// 5b. Unauthorized external IP (403 Forbidden)
const resBlocked = await fetch(`http://127.0.0.1:${port}/metrics`, {
  headers: { 'X-Forwarded-For': '203.0.113.199' },
})
assert.strictEqual(resBlocked.status, 403, 'Unauthorized external IP must return HTTP 403')

// 5c. Whitelisted external IP via METRICS_ALLOWED_IPS (200 OK)
process.env.METRICS_ALLOWED_IPS = '198.51.100.5,198.51.100.6'
const resAllowedIp = await fetch(`http://127.0.0.1:${port}/metrics`, {
  headers: { 'X-Forwarded-For': '198.51.100.5' },
})
assert.strictEqual(resAllowedIp.status, 200, 'Whitelisted IP must return HTTP 200')
delete process.env.METRICS_ALLOWED_IPS

// 5d. Bearer token authentication via METRICS_TOKEN (200 OK)
process.env.METRICS_TOKEN = 'secret-test-token-123'
const resToken = await fetch(`http://127.0.0.1:${port}/metrics`, {
  headers: {
    'X-Forwarded-For': '203.0.113.199',
    'Authorization': 'Bearer secret-test-token-123',
  },
})
assert.strictEqual(resToken.status, 200, 'Valid Bearer token must return HTTP 200')
delete process.env.METRICS_TOKEN

await new Promise((resolve) => testServer.close(resolve))

// Cleanup
gameServer.destroyGame(pubKey)
gameServer.destroyGame(privKey)

console.log('--- ALL TELEMETRY & METRICS TESTS PASSED! ---')
process.exit(0)


