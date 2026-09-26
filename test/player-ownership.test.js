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

const dataDir = mkdtempSync(path.join(tmpdir(), 'bitcycles-ownership-'))
process.env.DATA_DIR = dataDir
const { gameServer } = await import('../server/GameServer.js')
const { setupWebSocketServer } = await import('../server/wsHandler.js')
const server = http.createServer()
setupWebSocketServer(server)
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const url = `ws://127.0.0.1:${server.address().port}/ws`
const sockets = []
const createdKeys = []

async function connect() {
  const ws = new WebSocket(url)
  sockets.push(ws)
  ws.messages = []
  ws.waiters = []
  ws.on('message', (data, binary) => {
    if (binary) return
    const msg = JSON.parse(data.toString())
    const waiter = ws.waiters.find((w) => w.predicate(msg))
    if (waiter) {
      ws.waiters.splice(ws.waiters.indexOf(waiter), 1)
      clearTimeout(waiter.timer)
      waiter.resolve(msg)
    } else ws.messages.push(msg)
  })
  await once(ws, 'open')
  assert.equal(
    (await receive(ws, (m) => m.type === MSG_TYPE.LOBBY_LIST)).protocolVersion,
    PROTOCOL_VERSION,
  )
  return ws
}

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

function send(ws, type, payload, extra = {}) {
  ws.send(
    JSON.stringify({
      type,
      payload,
      protocolVersion: PROTOCOL_VERSION,
      ...extra,
    }),
  )
}

function registration(id, index = 0) {
  return {
    id,
    name: `Player ${id}`,
    color: 'water',
    left: 65 + index,
    right: 75 + index,
  }
}

async function create(ws) {
  send(ws, MSG_TYPE.CREATE_GAME, {
    name: 'Ownership',
    isPublic: true,
    interval: 40,
  })
  const { payload: key } = await receive(
    ws,
    (m) => m.type === MSG_TYPE.GAME_CREATED,
  )
  createdKeys.push(key)
  return key
}

async function join(ws, key) {
  send(ws, MSG_TYPE.JOIN_GAME, { key })
  return receive(
    ws,
    (m) => m.type === MSG_TYPE.GAME_INFO && m.payload.key === key,
  )
}

async function register(ws, player, requestId) {
  send(ws, MSG_TYPE.ADD_PLAYER, player, { requestId })
  return receive(ws, (m) => m.requestId === requestId)
}

const turn = (ws, handle, direction = 0) =>
  ws.send(Buffer.from([BINARY_OPCODE.CHANGE_DIR, handle, direction]))

try {
  const owner = await connect()
  const spectator = await connect()
  owner.send(Buffer.from([BINARY_OPCODE.CHANGE_DIR, 0, 0]))
  owner.send(
    JSON.stringify({
      type: MSG_TYPE.CREATE_GAME,
      payload: { name: 'Legacy' },
    }),
  )
  assert.equal(
    (await receive(owner, (m) => m.code === 'PROTOCOL_MISMATCH')).type,
    MSG_TYPE.ERROR,
  )
  const key = await create(owner)
  await join(owner, key)
  await join(spectator, key)
  const game = gameServer.getGame(key)
  const player = registration('a1b2c3d4')

  send(owner, MSG_TYPE.ADD_PLAYER, player, { requestId: '../bad' })
  assert.equal(
    (await receive(owner, (m) => m.requestId === '../bad')).code,
    'INVALID_REGISTRATION',
  )
  assert.equal(game.arena.players.length, 0)
  owner.send(
    JSON.stringify({
      type: MSG_TYPE.ADD_PLAYER,
      payload: player,
      requestId: 'old-client',
    }),
  )
  assert.equal(
    (await receive(owner, (m) => m.requestId === 'old-client')).code,
    'PROTOCOL_MISMATCH',
  )
  assert.equal(game.arena.players.length, 0)

  for (const [candidate, code] of [
    [registration(''), 'INVALID_PLAYER_ID'],
    [{ ...player, id: 4 }, 'INVALID_PLAYER_ID'],
    [{ ...player, left: 'unsupported' }, 'INVALID_CONTROLS'],
    [{ ...player, right: player.left }, 'INVALID_CONTROLS'],
  ]) {
    const reply = await register(
      owner,
      candidate,
      `invalid-${code}-${Math.random().toString(36).slice(2)}`,
    )
    assert.equal(reply.code, code)
    assert.equal(game.arena.players.length, 0)
    assert.equal(
      owner.messages.some((m) => m.reconnectToken),
      false,
    )
  }
  const first = await register(owner, player, 'first')
  assert.equal(first.type, MSG_TYPE.PLAYER_REGISTERED)
  assert.equal(first.payload.id, player.id)
  assert.equal(first.payload.key, key)
  assert.match(first.payload.reconnectToken, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(first.payload.inputHandle, 0)
  assert.equal(game.ownership.owns(player.id, [...game.clients][0]), true)

  const retry = await register(owner, player, 'first')
  assert.deepEqual(retry, first)
  assert.equal(game.arena.players.length, 1)
  assert.equal(game.ownership.owners.size, 1)
  assert.equal(game.stats.players.length, 1)
  assert.equal(
    (await register(owner, { ...player, name: 'Changed' }, 'first')).code,
    'REQUEST_ID_CONFLICT',
  )
  assert.equal(
    (await register(spectator, player, 'duplicate')).code,
    'DUPLICATE_PLAYER_ID',
  )
  assert.equal(game.arena.players.length, 1)
  assert.equal(game.ownership.owners.size, 1)

  const other = await register(owner, registration('ff001122', 1), 'second')
  assert.equal(other.payload.inputHandle, 1)
  assert.notEqual(other.payload.reconnectToken, first.payload.reconnectToken)
  const original = game.arena.players[0].move
  turn(spectator, first.payload.inputHandle)
  turn(spectator, 255)
  turn(owner, 255)
  owner.send(
    Buffer.from([BINARY_OPCODE.CHANGE_DIR, first.payload.inputHandle, 2]),
  )
  owner.send(Buffer.from([BINARY_OPCODE.CHANGE_DIR, first.payload.inputHandle]))
  owner.send(Buffer.from([99, first.payload.inputHandle, 0]))
  owner.send(
    Buffer.from([BINARY_OPCODE.CHANGE_DIR, first.payload.inputHandle, 0, 0]),
  )
  for (const type of ['CHANGE_DIR', 'changeDir']) {
    send(spectator, type, { id: player.id, dir: 'left' })
    assert.equal(
      (await receive(spectator, (m) => m.code === 'BINARY_INPUT_REQUIRED'))
        .type,
      MSG_TYPE.ERROR,
    )
    spectator.send(
      JSON.stringify({
        action: type,
        payload: { id: player.id, dir: 'left' },
        protocolVersion: PROTOCOL_VERSION,
      }),
    )
    await receive(spectator, (m) => m.code === 'BINARY_INPUT_REQUIRED')
    spectator.send(
      JSON.stringify({
        type: MSG_TYPE.PING,
        action: type,
        payload: { id: player.id, dir: 'left' },
        protocolVersion: PROTOCOL_VERSION,
      }),
    )
    await receive(spectator, (m) => m.code === 'BINARY_INPUT_REQUIRED')
  }
  send(spectator, MSG_TYPE.JOIN_GAME, { key, playerIds: [player.id] })
  assert.equal(
    (await receive(spectator, (m) => m.code === 'RECONNECT_UNAVAILABLE')).type,
    MSG_TYPE.ERROR,
  )
  spectator.send(
    JSON.stringify({
      type: 'CHANGE_DIR',
      payload: { id: player.id, dir: 'left' },
    }),
  )
  assert.equal(
    (await receive(spectator, (m) => m.code === 'PROTOCOL_MISMATCH')).type,
    MSG_TYPE.ERROR,
  )
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(game.arena.players[0].move, original)
  turn(owner, first.payload.inputHandle, 0)
  await new Promise((r) => setTimeout(r, 30))
  assert.notEqual(game.arena.players[0].move, original)
  assert.equal(game.arena.players[1].move, null)

  // An unrelated socket's exit cannot disconnect the owner's players.
  send(spectator, MSG_TYPE.LEAVE_GAME)
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(game.arena.players[0].connected, true)
  spectator.close()
  await once(spectator, 'close')
  assert.equal(game.arena.players[0].connected, true)

  for (let i = 2; i < 6; i++) {
    const response = await register(
      owner,
      registration(`local-${i}`, i),
      `local-${i}`,
    )
    assert.equal(response.type, MSG_TYPE.PLAYER_REGISTERED)
    assert.equal(response.payload.inputHandle, i)
  }
  assert.equal(
    (await register(owner, registration('seventh'), 'seventh')).code,
    'PLAYER_LIMIT',
  )
  assert.equal(game.arena.players.length, 6)
  assert.equal(game.ownership.owners.size, 6)
  const publicInfo = gameServer.getGameInfo(key)
  assert.equal(
    JSON.stringify(publicInfo).includes(first.payload.reconnectToken),
    false,
  )
  assert.deepEqual(
    Object.keys(publicInfo.players[0]).sort(),
    ['id', 'name', 'color', 'left', 'right', 'connected'].sort(),
  )

  // Slots are never reused, even after releasing a whole room. Six bindings
  // across successive rooms reach all 256 byte values.
  for (let roomIndex = 1; roomIndex < 43; roomIndex++) {
    const nextKey = await create(owner)
    await join(owner, nextKey)
    const count = roomIndex === 42 ? 4 : 6
    if (roomIndex === 1) {
      const releasedMove = game.arena.players[0].move
      turn(owner, first.payload.inputHandle)
      await new Promise((r) => setTimeout(r, 30))
      assert.equal(game.arena.players[0].move, releasedMove)
      assert.equal(game.ownership.owners.size, 0)
    }
    for (let i = 0; i < count; i++) {
      const response = await register(
        owner,
        registration(`r${roomIndex}-${i}`, i),
        `r${roomIndex}-${i}`,
      )
      assert.equal(response.payload.inputHandle, roomIndex * 6 + i)
    }
  }
  assert.equal(createdKeys.length, 43)
  const exhaustedGame = gameServer.getGame(createdKeys.at(-1))
  const before = exhaustedGame.arena.players.length
  const exhausted = await register(owner, registration('overflow'), 'overflow')
  assert.equal(exhausted.code, 'INPUT_HANDLE_EXHAUSTED')
  assert.equal(exhaustedGame.arena.players.length, before)
  assert.equal(exhaustedGame.ownership.owners.size, before)
  assert.equal(exhaustedGame.stats.players.length, before)
  assert.equal(exhaustedGame.ownership.verifiers.size, before)
  const stillOwned = exhaustedGame.arena.players[0]
  const beforeTurn = stillOwned.move
  turn(owner, 252)
  await new Promise((r) => setTimeout(r, 30))
  assert.notEqual(stillOwned.move, beforeTurn)
  send(owner, MSG_TYPE.LEAVE_GAME)
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(exhaustedGame.ownership.owners.size, 0)
  assert.equal(stillOwned.connected, false)
  const afterLeave = stillOwned.move
  turn(owner, 252)
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(stillOwned.move, afterLeave)

  const fresh = await connect()
  const freshKey = await create(fresh)
  await join(fresh, freshKey)
  const freshRegistration = await register(
    fresh,
    registration('fresh'),
    'fresh',
  )
  assert.equal(freshRegistration.payload.inputHandle, 0)
  fresh.close()
  await once(fresh, 'close')
  assert.equal(gameServer.getGame(freshKey).arena.players[0].connected, false)
  assert.equal(gameServer.getGame(freshKey).ownership.owners.size, 0)
  console.log(
    'Player ownership: real socket authorization, retries, cleanup, and handle exhaustion passed',
  )
} finally {
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) ws.terminate()
  }
  for (const key of createdKeys) gameServer.getGame(key)?.destroy()
  await new Promise((resolve) => server.close(resolve))
  rmSync(dataDir, { recursive: true, force: true })
}
