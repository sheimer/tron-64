import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'
import { MSG_TYPE, PROTOCOL_VERSION } from '../shared/protocol.js'
import { LOBBY_CHECK_BATCH_SIZE } from '../shared/constants.js'

const dataDir = await mkdtemp(path.join(tmpdir(), 'bitcycles-lobby-'))
process.env.DATA_DIR = dataDir
const { gameServer } = await import('../server/GameServer.js')
const { setupWebSocketServer } = await import('../server/wsHandler.js')
const server = http.createServer()
setupWebSocketServer(server)
const sockets = []
let sequence = 0

async function connect() {
  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`)
  sockets.push(socket)
  socket.frames = []
  socket.on('message', (raw) => socket.frames.push(JSON.parse(raw.toString())))
  await once(socket, 'open')
  await next(socket, (frame) => frame.type === MSG_TYPE.LOBBY_LIST)
  return socket
}

async function next(socket, predicate) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const index = socket.frames.findIndex(predicate)
    if (index >= 0) {
      return socket.frames.splice(index, 1)[0]
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Lobby response timed out')
}

function query(socket, rooms) {
  const requestId = `lobby-${++sequence}`
  socket.send(
    JSON.stringify({
      type: MSG_TYPE.LOBBY_LIST,
      payload: { rooms },
      protocolVersion: PROTOCOL_VERSION,
      requestId,
    }),
  )
  return next(socket, (frame) => frame.requestId === requestId)
}

try {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const creator = {}
  const publicKey = gameServer.createGame({
    name: 'Public',
    interval: 20,
    isPublic: true,
  })
  const privateKey = gameServer.createGame({
    name: 'Private secret name',
    interval: 20,
    isPublic: false,
    creator,
  })
  const game = gameServer.getGame(privateKey)
  const owner = {
    readyState: WebSocket.OPEN,
    gameKey: privateKey,
    handlesById: new Map(),
    idsByHandle: new Map(),
  }
  game.roomOwner.bind(owner)
  game.connect({ client: owner })
  const credentials = ['one', 'two'].map((id) => {
    assert.equal(game.addPlayer({ id, name: id, left: 65, right: 68 }).ok, true)
    return { id, reconnectToken: game.ownership.register(id, owner) }
  })
  const attempt = game.beginRound(owner)
  assert.equal(attempt.ok, true)
  const pending = game.pendingStart
  const fallback = pending.fallbackTimer
  const awaySince = game.allDisconnected
  const anonymous = await connect()
  const reader = await connect()
  const bikeReader = await connect()

  const publicOnly = await query(anonymous, [{ key: privateKey }])
  assert.deepEqual(
    publicOnly.payload.map((room) => room.key),
    [publicKey],
  )
  assert.deepEqual(publicOnly.missingKeys, [])
  assert.equal(JSON.stringify(publicOnly).includes(game.name), false)

  const invalid = await query(anonymous, [
    {
      key: privateKey,
      roomOwner: { ...creator.credentials, roomOwnerToken: 'A'.repeat(43) },
      reconnect: [{ id: 'one', reconnectToken: 'B'.repeat(43) }],
    },
  ])
  assert.deepEqual(
    invalid.payload.map((room) => room.key),
    [publicKey],
  )
  assert.deepEqual(
    invalid.missingKeys,
    [],
    'Rejected credentials do not mean deleted',
  )

  const ownerList = await query(reader, [
    { key: privateKey, roomOwner: creator.credentials },
  ])
  assert.deepEqual(
    ownerList.payload.find((room) => room.key === privateKey),
    {
      key: privateKey,
      name: game.name,
      numPlayers: 2,
      acceptingPlayers: false,
      isPublic: false,
    },
  )
  const bikeList = await query(bikeReader, [
    { key: privateKey, reconnect: [credentials[0]] },
  ])
  assert.ok(bikeList.payload.some((room) => room.key === privateKey))
  assert.equal(game.roomOwner.socket, owner)
  assert.equal(game.ownership.owners.get('one'), owner)
  assert.equal(game.ownership.owners.get('two'), owner)
  assert.deepEqual(
    game.liveClients,
    [owner],
    'Discovery adds no room membership',
  )
  assert.equal(
    game.pendingStart,
    pending,
    'Discovery does not cancel an attempt',
  )
  assert.equal(game.pendingStart.fallbackTimer, fallback)
  assert.equal(
    game.allDisconnected,
    awaySince,
    'Discovery does not keep a room alive',
  )
  const serialized = JSON.stringify(ownerList)
  for (const secret of [
    creator.credentials.roomOwnerToken,
    credentials[0].reconnectToken,
    ...Object.values(game.ownership.serializeVerifiers()),
  ]) {
    assert.equal(
      serialized.includes(secret),
      false,
      'Discovery never returns credentials',
    )
  }

  const gone =
    'ffffffff' === privateKey || 'ffffffff' === publicKey
      ? 'eeeeeeee'
      : 'ffffffff'
  assert.deepEqual((await query(reader, [{ key: gone }])).missingKeys, [gone])
  const malformed = await query(
    reader,
    Array.from({ length: LOBBY_CHECK_BATCH_SIZE + 1 }, () => ({
      key: privateKey,
    })),
  )
  assert.equal(malformed.code, 'INVALID_LOBBY_QUERY')
  assert.equal(
    (await query(reader, [{ key: 12345678 }])).code,
    'INVALID_LOBBY_QUERY',
  )

  // Broadcasts stay personalized after registration/status changes.
  game.cancelPendingStart()
  game.setInterval(25)
  const update = await next(
    reader,
    (frame) =>
      frame.type === MSG_TYPE.LOBBY_LIST && frame.requestId === undefined,
  )
  assert.ok(update.payload.some((room) => room.key === privateKey))
  const strangerUpdate = await next(
    anonymous,
    (frame) =>
      frame.type === MSG_TYPE.LOBBY_LIST && frame.requestId === undefined,
  )
  assert.equal(
    strangerUpdate.payload.some((room) => room.key === privateKey),
    false,
  )

  // Reconnection starts with no private discovery grants.
  const fresh = await connect()
  assert.deepEqual(
    (await query(fresh, [])).payload.map((room) => room.key),
    [publicKey],
  )
  game.destroy()
  const deleted = await next(
    reader,
    (frame) =>
      frame.type === MSG_TYPE.LOBBY_LIST &&
      frame.missingKeys?.includes(privateKey),
  )
  assert.equal(
    deleted.payload.some((room) => room.key === privateKey),
    false,
  )
  const strangerDeleted = await next(
    anonymous,
    (frame) =>
      frame.type === MSG_TYPE.LOBBY_LIST &&
      frame.requestId === undefined &&
      !frame.payload.some((room) => room.key === privateKey),
  )
  assert.equal(strangerDeleted.missingKeys.includes(privateKey), false)
  assert.deepEqual(
    (
      await query(bikeReader, [
        { key: privateKey, reconnect: [credentials[0]] },
      ])
    ).missingKeys,
    [privateKey],
  )
  console.log(
    'Lobby discovery: private visibility, read-only checks, isolated broadcasts, expiry and bounded queries passed',
  )
} finally {
  for (const socket of sockets) {
    socket.terminate()
  }
  for (const game of [...gameServer.games]) {
    game.destroy()
  }
  await new Promise((resolve) => server.close(resolve))
  await rm(dataDir, { recursive: true, force: true })
}
