import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import WebSocket from 'ws'
import {
  MSG_TYPE,
  PROTOCOL_VERSION,
  BINARY_OPCODE,
} from '../shared/protocol.js'

const dataDir = mkdtempSync(path.join(tmpdir(), 'bitcycles-reconnect-'))
process.env.DATA_DIR = dataDir
const { gameServer } = await import('../server/GameServer.js')
const { setupWebSocketServer } = await import('../server/wsHandler.js')
const server = http.createServer()
setupWebSocketServer(server)
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const sockets = []
const keys = []

function receive(ws, predicate) {
  const index = ws.messages.findIndex(predicate)
  if (index >= 0) return Promise.resolve(ws.messages.splice(index, 1)[0])
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Socket reply timed out')),
      3000,
    )
    ws.waiters.push((msg) => {
      if (!predicate(msg)) return false
      clearTimeout(timer)
      resolve(msg)
      return true
    })
  })
}
async function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`)
  sockets.push(ws)
  ws.messages = []
  ws.waiters = []
  ws.on('message', (data, binary) => {
    if (binary) return
    const msg = JSON.parse(data.toString())
    const index = ws.waiters.findIndex((waiter) => waiter(msg))
    if (index >= 0) ws.waiters.splice(index, 1)
    else ws.messages.push(msg)
  })
  await once(ws, 'open')
  await receive(ws, (m) => m.type === MSG_TYPE.LOBBY_LIST)
  return ws
}
function send(ws, type, payload, requestId) {
  ws.send(
    JSON.stringify({
      type,
      payload,
      requestId,
      protocolVersion: PROTOCOL_VERSION,
    }),
  )
}
async function create(ws) {
  send(ws, MSG_TYPE.CREATE_GAME, { name: 'Reconnection' })
  const reply = await receive(ws, (m) => m.type === MSG_TYPE.GAME_CREATED)
  keys.push(reply.payload)
  return reply.payload
}
async function join(ws, key, reconnect = [], requestId = 'join') {
  send(ws, MSG_TYPE.JOIN_GAME, { key, reconnect }, requestId)
  return receive(
    ws,
    (m) => m.type === MSG_TYPE.JOIN_RESULT && m.requestId === requestId,
  )
}
async function register(ws, id, requestId) {
  send(
    ws,
    MSG_TYPE.ADD_PLAYER,
    { id, name: id, color: 'water', left: 65, right: 68 },
    requestId,
  )
  const reply = await receive(ws, (m) => m.requestId === requestId)
  assert.equal(reply.type, MSG_TYPE.PLAYER_REGISTERED)
  return reply.payload
}
const claim = (binding) => ({
  id: binding.id,
  reconnectToken: binding.reconnectToken,
})
const tick = () => new Promise((resolve) => setTimeout(resolve, 30))

try {
  const a = await connect()
  const b = await connect()
  const c = await connect()
  const key = await create(a)
  await join(a, key)
  await join(b, key)
  await join(c, key)
  const room = gameServer.getGame(key)
  const [ownerSocket, claimantSocket, thirdSocket] = room.clients
  const first = await register(a, 'first', 'first')
  const second = await register(a, 'second', 'second')
  const p1 = room.arena.players.find((p) => p.id === 'first')
  const p2 = room.arena.players.find((p) => p.id === 'second')
  const oldMove = p1.move
  send(b, MSG_TYPE.JOIN_GAME, { key, playerIds: ['first'] }, 'legacy')
  assert.equal(
    (await receive(b, (m) => m.requestId === 'legacy')).code,
    'AUTHENTICATION_REQUIRED',
  )
  for (const [claims, code] of [
    [[claim(first), claim(first)], 'INVALID_RECONNECT'],
    [Array(7).fill(claim(first)), 'INVALID_RECONNECT'],
  ]) {
    send(b, MSG_TYPE.JOIN_GAME, { key, reconnect: claims }, code)
    assert.equal((await receive(b, (m) => m.requestId === code)).code, code)
  }
  const mixed = await join(
    b,
    key,
    [
      claim(first),
      { id: 'second', reconnectToken: first.reconnectToken },
      { id: 'unknown', reconnectToken: 'invalid' },
    ],
    'mixed',
  )
  assert.deepEqual(mixed.payload.accepted, [{ id: 'first', inputHandle: 0 }])
  assert.equal(mixed.payload.rejected.length, 2)
  assert.equal(room.ownership.owns('first', claimantSocket), true)
  assert.equal(room.ownership.owns('second', ownerSocket), true)
  assert.deepEqual(
    (await receive(a, (m) => m.type === MSG_TYPE.OWNERSHIP_REVOKED)).payload
      .ids,
    ['first'],
  )
  assert.equal(p1.connected, true)
  a.send(Buffer.from([BINARY_OPCODE.CHANGE_DIR, first.inputHandle, 0]))
  await tick()
  assert.equal(p1.move, oldMove)
  b.send(Buffer.from([BINARY_OPCODE.CHANGE_DIR, 0, 0]))
  await tick()
  assert.notEqual(p1.move, oldMove)
  const repeated = await join(b, key, [claim(first)], 'again')
  assert.equal(repeated.payload.accepted[0].inputHandle, 0)
  assert.equal(claimantSocket.nextInputHandle, 1)
  const stolen = await join(c, key, [claim(first)], 'last-wins')
  assert.equal(stolen.payload.accepted[0].inputHandle, 0)
  assert.equal(room.ownership.owns('first', thirdSocket), true)
  send(b, MSG_TYPE.LEAVE_GAME)
  await tick()
  assert.equal(p1.connected, true)
  assert.equal(p2.connected, true)
  a.close()
  await once(a, 'close')
  assert.equal(p1.connected, true)
  assert.equal(p2.connected, false)
  const fresh = await connect()
  const restored = await join(fresh, key, [claim(second)], 'restore')
  assert.equal(restored.payload.accepted[0].inputHandle, 0)
  assert.equal(p2.connected, true)
  assert.equal(
    room.stats.players.find((p) => p.id === 'second').connected,
    true,
  )
  c.close()
  await once(c, 'close')
  assert.equal(p1.connected, false)
  const replacement = await connect()
  const revived = await join(replacement, key, [claim(first)], 'revive')
  assert.equal(revived.payload.accepted[0].inputHandle, 0)
  assert.equal(p1.connected, true)
  assert.equal(room.ownership.owns('first', room.clients.at(-1)), true)
  console.log(
    'Authenticated per-player reconnect and owner-safe handover passed',
  )
} finally {
  for (const ws of sockets) if (ws.readyState === WebSocket.OPEN) ws.terminate()
  for (const key of keys) gameServer.getGame(key)?.destroy()
  await new Promise((resolve) => server.close(resolve))
  rmSync(dataDir, { recursive: true, force: true })
}
