import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import WebSocket from 'ws'
import {
  BINARY_OPCODE,
  MSG_TYPE,
  PROTOCOL_VERSION,
} from '../shared/protocol.js'
import { MAX_CLIENTS_PER_ROOM } from '../shared/constants.js'

const dataDir = mkdtempSync(path.join(tmpdir(), 'bitcycles-reconnect-'))
process.env.DATA_DIR = dataDir
const { gameServer } = await import('../server/GameServer.js')
const { setupWebSocketServer } = await import('../server/wsHandler.js')
const server = http.createServer()
setupWebSocketServer(server)
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const url = `ws://127.0.0.1:${server.address().port}/ws`
const sockets = []
const keys = []
let requestNumber = 0
const nextRequest = () => `test-${++requestNumber}`

function receive(ws, predicate) {
  const index = ws.messages.findIndex(predicate)
  if (index >= 0) return Promise.resolve(ws.messages.splice(index, 1)[0])
  return new Promise((resolve, reject) => {
    const waiter = { predicate, resolve, timer: null }
    waiter.timer = setTimeout(() => {
      ws.waiters.splice(ws.waiters.indexOf(waiter), 1)
      reject(new Error('Timed out waiting for socket response'))
    }, 3000)
    ws.waiters.push(waiter)
  })
}

async function connect() {
  const ws = new WebSocket(url)
  sockets.push(ws)
  ws.messages = []
  ws.waiters = []
  ws.on('message', (data, binary) => {
    if (binary) return
    const message = JSON.parse(data.toString())
    const index = ws.waiters.findIndex((w) => w.predicate(message))
    if (index >= 0) {
      const [waiter] = ws.waiters.splice(index, 1)
      clearTimeout(waiter.timer)
      waiter.resolve(message)
    } else ws.messages.push(message)
  })
  await once(ws, 'open')
  assert.equal(
    (await receive(ws, (m) => m.type === MSG_TYPE.LOBBY_LIST)).protocolVersion,
    PROTOCOL_VERSION,
  )
  return ws
}

function send(ws, type, payload, requestId = undefined) {
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
  send(ws, MSG_TYPE.CREATE_GAME, { name: 'Reconnection', interval: 40 })
  const response = await receive(ws, (m) => m.type === MSG_TYPE.GAME_CREATED)
  keys.push(response.payload)
  return response.payload
}

async function join(ws, key, reconnect = [], options = {}) {
  const requestId = nextRequest()
  send(ws, MSG_TYPE.JOIN_GAME, { key, reconnect, ...options }, requestId)
  return receive(ws, (m) => m.requestId === requestId)
}

async function register(ws, id) {
  const requestId = nextRequest()
  send(
    ws,
    MSG_TYPE.ADD_PLAYER,
    { id, name: id, color: 'water', left: 65, right: 68 },
    requestId,
  )
  const response = await receive(ws, (m) => m.requestId === requestId)
  assert.equal(
    response.type,
    MSG_TYPE.PLAYER_REGISTERED,
    JSON.stringify(response),
  )
  return response.payload
}

const claim = (player) => ({
  id: player.id,
  reconnectToken: player.reconnectToken,
})
const turn = (ws, handle) =>
  ws.send(Buffer.from([BINARY_OPCODE.CHANGE_DIR, handle, 0]))
const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

try {
  const a = await connect()
  const b = await connect()
  const c = await connect()
  const key = await create(a)
  assert.deepEqual((await join(a, key)).payload.accepted, [])
  assert.deepEqual((await join(b, key)).payload.accepted, [])
  assert.deepEqual((await join(c, key)).payload.accepted, [])
  const first = await register(a, 'shared-first')
  const second = await register(a, 'shared-second')
  const game = gameServer.getGame(key)
  const ownerA = game.ownership.owners.get(first.id)
  const ownerB = [...game.clients].find(
    (client) => client !== ownerA && client.playerIds.size === 0,
  )
  assert.ok(ownerB)

  for (const reconnect of [
    [claim(first), claim(first)],
    [
      claim(first),
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `unknown-${i}`,
        reconnectToken: first.reconnectToken,
      })),
    ],
  ]) {
    const result = await join(b, key, reconnect)
    assert.equal(result.code, 'INVALID_RECONNECT')
    assert.equal(game.ownership.owners.get(first.id), ownerA)
    assert.equal(game.ownership.owners.get(second.id), ownerA)
    assert.equal(game.ownership.owners.size, 2)
  }
  const idOnlyRequest = nextRequest()
  send(b, MSG_TYPE.JOIN_GAME, { key, playerIds: [first.id] }, idOnlyRequest)
  const idOnly = await receive(b, (m) => m.requestId === idOnlyRequest)
  assert.equal(idOnly.type, MSG_TYPE.JOIN_RESULT)
  assert.deepEqual(idOnly.payload.accepted, [])
  assert.equal(game.ownership.owners.get(first.id), ownerA)

  const mixed = await join(b, key, [
    { id: first.id, reconnectToken: 'A'.repeat(43) },
    { id: second.id, reconnectToken: first.reconnectToken },
    { id: 'missing-player', reconnectToken: first.reconnectToken },
    { id: first.id, reconnectToken: first.reconnectToken },
  ])
  // A duplicate public ID makes the entire request invalid, even with one valid token.
  assert.equal(mixed.code, 'INVALID_RECONNECT')
  assert.equal(game.ownership.owners.get(first.id), ownerA)

  const partial = await join(b, key, [
    { id: second.id, reconnectToken: 'A'.repeat(43) },
    { id: 'missing-player', reconnectToken: first.reconnectToken },
    { id: 'malformed-token', reconnectToken: 'short' },
    claim(first),
  ])
  assert.deepEqual(
    partial.payload.accepted.map((p) => p.id),
    [first.id],
  )
  assert.deepEqual(
    partial.payload.rejected.map((p) => p.code),
    ['INVALID_CREDENTIAL', 'INVALID_CREDENTIAL', 'INVALID_CREDENTIAL'],
  )
  assert.equal(JSON.stringify(partial).includes(first.reconnectToken), false)
  assert.equal(game.ownership.owners.get(second.id), ownerA)
  assert.equal(game.ownership.owners.get(first.id), ownerB)
  assert.equal(game.arena.players[0].connected, true)
  assert.notEqual(game.stats.players[0].connected, false)
  assert.deepEqual(
    (await receive(a, (m) => m.type === MSG_TYPE.OWNERSHIP_REVOKED)).payload
      .ids,
    [first.id],
  )

  const repeat = await join(b, key, [claim(first)])
  assert.deepEqual(repeat.payload.accepted, partial.payload.accepted)
  assert.equal(game.ownership.owners.get(first.id), ownerB)
  const before = game.arena.players[0].move
  turn(a, first.inputHandle)
  await settle()
  assert.equal(game.arena.players[0].move, before)
  turn(b, partial.payload.accepted[0].inputHandle)
  await settle()
  assert.notEqual(game.arena.players[0].move, before)

  // An old owner can retain a second keyboard binding without controlling the transferred one.
  const secondBefore = game.arena.players[1].move
  turn(a, second.inputHandle)
  await settle()
  assert.notEqual(game.arena.players[1].move, secondBefore)
  send(a, MSG_TYPE.LEAVE_GAME)
  await settle()
  assert.equal(game.ownership.owners.get(first.id), ownerB)
  assert.equal(game.arena.players[0].connected, true)
  assert.equal(game.ownership.owners.has(second.id), false)

  // Two valid claimants transfer in message order; the last one owns the handle.
  game.reset()
  assert.equal(game.arena.players[0].alive, true)
  const liveExplosionCount = game.arena.explosions.length
  const claimedByC = await join(c, key, [claim(first)])
  assert.equal(claimedByC.payload.accepted[0].id, first.id)
  assert.equal(game.arena.players[0].alive, true)
  assert.equal(game.arena.explosions.length, liveExplosionCount)
  assert.notEqual(game.stats.players[0].connected, false)
  assert.equal(
    game.ownership.owners.get(first.id),
    [...game.clients].find((client) => client !== ownerA && client !== ownerB),
  )
  assert.deepEqual(
    (await receive(b, (m) => m.type === MSG_TYPE.OWNERSHIP_REVOKED)).payload
      .ids,
    [first.id],
  )
  b.close()
  await once(b, 'close')
  assert.equal(game.arena.players[0].connected, true)
  a.close()
  await once(a, 'close')
  assert.equal(game.arena.players[0].connected, true)

  // A genuine disconnect kills an active cycle once; reconnect restores the
  // connection flag but never resurrects that cycle before the next reset.
  game.reset()
  const player = game.arena.players[0]
  assert.equal(player.alive, true)
  const beforeExplosions = game.arena.explosions.length
  c.close()
  await once(c, 'close')
  assert.equal(player.alive, false)
  assert.equal(player.connected, false)
  assert.equal(game.arena.explosions.length, beforeExplosions + 1)
  const d = await connect()
  const restored = await join(d, key, [claim(first)])
  assert.equal(restored.payload.accepted[0].inputHandle, 0)
  assert.equal(player.connected, true)
  assert.equal(game.stats.players[0].connected, true)
  assert.equal(player.alive, false)
  assert.equal(game.arena.explosions.length, beforeExplosions + 1)
  game.reset()
  assert.equal(player.alive, true)

  // Accumulate 255 non-reusable handles on one socket. A two-player batch
  // must fail before releasing its prior room or taking either target owner.
  const exhausted = await connect()
  for (let room = 0; room < 43; room++) {
    const roomKey = await create(exhausted)
    await join(exhausted, roomKey)
    const count = room === 42 ? 3 : 6
    for (let i = 0; i < count; i++) {
      const registered = await register(exhausted, `capacity-${room}-${i}`)
      if (room === 42 && i === 0) assert.equal(registered.inputHandle, 252)
    }
  }
  const oldKey = keys.at(-1)
  const oldGame = gameServer.getGame(oldKey)
  const oldOwner = oldGame.ownership.owners.get('capacity-42-0')
  const target = await create(d)
  await join(d, target)
  const targetFirst = await register(d, 'target-first')
  const targetSecond = await register(d, 'target-second')
  const targetGame = gameServer.getGame(target)
  const targetOwner = targetGame.ownership.owners.get(targetFirst.id)
  const denied = await join(exhausted, target, [
    claim(targetFirst),
    claim(targetSecond),
  ])
  assert.equal(denied.code, 'INPUT_HANDLE_EXHAUSTED')
  assert.match(denied.payload, /reload the page/i)
  assert.equal(oldGame.ownership.owners.get('capacity-42-0'), oldOwner)
  assert.equal(targetGame.ownership.owners.get(targetFirst.id), targetOwner)
  assert.equal(targetGame.ownership.owners.get(targetSecond.id), targetOwner)
  assert.equal(
    targetGame.arena.players.every((p) => p.connected),
    true,
  )
  assert.equal(oldOwner.gameKey, oldKey)
  assert.equal(oldOwner.idsByHandle.get(252), 'capacity-42-0')

  const fresh = await connect()
  const reclaimed = await join(fresh, target, [
    claim(targetFirst),
    claim(targetSecond),
  ])
  assert.deepEqual(
    reclaimed.payload.accepted.map((p) => p.inputHandle),
    [0, 1],
  )
  assert.equal(
    targetGame.ownership.owners.get(targetFirst.id),
    targetGame.ownership.owners.get(targetSecond.id),
  )

  // Equal public IDs in separate rooms have independent credentials and handles.
  const switching = await connect()
  const roomOne = await create(switching)
  await join(switching, roomOne)
  const duplicateOne = await register(switching, 'reused-id')
  const roomTwo = await create(switching)
  await join(switching, roomTwo)
  const duplicateTwo = await register(switching, 'reused-id')
  assert.notEqual(duplicateOne.reconnectToken, duplicateTwo.reconnectToken)
  assert.notEqual(duplicateOne.inputHandle, duplicateTwo.inputHandle)
  const firstRoom = gameServer.getGame(roomOne)
  const secondRoom = gameServer.getGame(roomTwo)
  assert.equal(firstRoom.ownership.owners.size, 0)
  assert.equal(firstRoom.arena.players[0].connected, false)
  assert.equal(secondRoom.ownership.owners.size, 1)
  const rejectedAcrossRooms = await join(switching, roomTwo, [
    claim(duplicateOne),
  ])
  assert.deepEqual(rejectedAcrossRooms.payload.accepted, [])
  assert.equal(
    rejectedAcrossRooms.payload.rejected[0].code,
    'INVALID_CREDENTIAL',
  )
  assert.equal(secondRoom.ownership.owners.size, 1)
  const beforeOldHandle = secondRoom.arena.players[0].move
  turn(switching, duplicateOne.inputHandle)
  await settle()
  assert.equal(secondRoom.arena.players[0].move, beforeOldHandle)
  turn(switching, duplicateTwo.inputHandle)
  await settle()
  assert.notEqual(secondRoom.arena.players[0].move, beforeOldHandle)
  const switchingOwner = secondRoom.ownership.owners.get(duplicateTwo.id)

  // Admission to a full target room fails before releasing the old room or
  // taking an authenticated player in the target.
  while (
    targetGame.clients.filter((client) => client.readyState === WebSocket.OPEN)
      .length < MAX_CLIENTS_PER_ROOM
  ) {
    const spectator = await connect()
    await join(spectator, target)
  }
  assert.equal(targetGame.clients.length, MAX_CLIENTS_PER_ROOM)
  const roomFull = await join(switching, target, [claim(targetFirst)])
  assert.equal(roomFull.code, 'ROOM_FULL')
  assert.equal(secondRoom.ownership.owners.size, 1)
  assert.equal(secondRoom.ownership.owners.get(duplicateTwo.id), switchingOwner)
  assert.equal(secondRoom.arena.players[0].connected, true)
  assert.equal(
    targetGame.ownership.owners.get(targetFirst.id),
    targetGame.ownership.owners.get(targetSecond.id),
  )
  turn(switching, duplicateTwo.inputHandle)
  await settle()
  assert.equal(switching.readyState, WebSocket.OPEN)
  console.log(
    'Reconnection ownership: atomic claims, handover, lifecycle, and fresh handles passed',
  )
} finally {
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) ws.terminate()
  }
  for (const key of keys) gameServer.getGame(key)?.destroy()
  await new Promise((resolve) => server.close(resolve))
  rmSync(dataDir, { recursive: true, force: true })
}
