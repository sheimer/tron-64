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

const dataDir = mkdtempSync(path.join(tmpdir(), 'bitcycles-membership-'))
process.env.DATA_DIR = dataDir
const { gameServer } = await import('../server/GameServer.js')
const { setupWebSocketServer } = await import('../server/wsHandler.js')
const server = http.createServer()
setupWebSocketServer(server)
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const sockets = []
let requestNumber = 0
const nextRequest = () => `membership-${++requestNumber}`
function receive(ws, predicate) {
  const index = ws.messages.findIndex(predicate)
  if (index >= 0) {
    return Promise.resolve(ws.messages.splice(index, 1)[0])
  }
  return new Promise((resolve, reject) => {
    const waiter = { predicate, resolve, timer: null }
    waiter.timer = setTimeout(() => {
      ws.waiters.splice(ws.waiters.indexOf(waiter), 1)
      reject(new Error('Membership socket reply timed out'))
    }, 3000)
    ws.waiters.push(waiter)
  })
}
async function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`)
  sockets.push(ws)
  ws.messages = []
  ws.waiters = []
  ws.on('message', (data, binary) => {
    const msg = binary ? { binary: true, data } : JSON.parse(data.toString())
    const index = ws.waiters.findIndex((waiter) => waiter.predicate(msg))
    if (index < 0) {
      ws.messages.push(msg)
    } else {
      const [waiter] = ws.waiters.splice(index, 1)
      clearTimeout(waiter.timer)
      waiter.resolve(msg)
    }
  })
  await once(ws, 'open')
  await receive(ws, (msg) => msg.type === MSG_TYPE.LOBBY_LIST)
  return ws
}
function send(ws, type, payload, requestId = nextRequest()) {
  ws.send(
    JSON.stringify({
      type,
      payload,
      requestId,
      protocolVersion: PROTOCOL_VERSION,
    }),
  )
  return requestId
}
async function request(ws, type, payload) {
  const requestId = send(ws, type, payload)
  return receive(ws, (msg) => msg.requestId === requestId)
}
async function barrier(...clients) {
  await Promise.all(
    clients
      .filter((ws) => ws.readyState === WebSocket.OPEN)
      .map(async (ws) => {
        const t = nextRequest()
        ws.send(
          JSON.stringify({
            type: MSG_TYPE.PING,
            t,
            protocolVersion: PROTOCOL_VERSION,
          }),
        )
        await receive(ws, (msg) => msg.type === MSG_TYPE.PONG && msg.t === t)
      }),
  )
}
async function create(ws) {
  const result = await request(ws, MSG_TYPE.CREATE_GAME, {
    name: 'Membership',
    isPublic: false,
  })
  assert.equal(result.type, MSG_TYPE.GAME_CREATED)
  const room = result.payload
  room.game = gameServer.getGame(room.key)
  return room
}
async function join(ws, room, reconnect = [], owner = false) {
  return request(ws, MSG_TYPE.JOIN_GAME, {
    key: room.key,
    reconnect,
    ...(owner
      ? {
          roomOwner: {
            ownerClientId: room.ownerClientId,
            roomOwnerToken: room.roomOwnerToken,
          },
        }
      : {}),
  })
}
async function register(ws, id) {
  const result = await request(ws, MSG_TYPE.ADD_PLAYER, {
    id,
    name: id,
    color: 'water',
    left: 65,
    right: 68,
  })
  assert.equal(result.type, MSG_TYPE.PLAYER_REGISTERED)
  return result.payload
}
const claim = ({ id, reconnectToken }) => ({ id, reconnectToken })
const roomPackets = (ws) =>
  ws.messages.filter(
    (msg) =>
      msg.binary ||
      [
        MSG_TYPE.GAME_INFO,
        MSG_TYPE.GAME_STATE,
        MSG_TYPE.GAME_RESET,
        MSG_TYPE.GAME_FINISH,
      ].includes(msg.type),
  )
function ownerOf(room, id) {
  return room.game.ownership.owners.get(id)
}
function snapshot(room, socket) {
  const pending = room.game.pendingStart
  return {
    members: room.game.liveClients,
    roster: room.game.captureRoundRoster(),
    owners: [...room.game.ownership.owners],
    verifiers: room.game.ownership.serializeVerifiers(),
    scores: structuredClone(room.game.stats),
    creator: room.game.roomOwner.socket,
    pending,
    pendingState: pending && {
      startId: pending.startId,
      expected: [...pending.expectedClients],
      ready: [...pending.readyClients],
      fallback: pending.fallbackTimer,
      countdown: pending.startTimer,
    },
    handles: [...socket.handlesById],
    ids: [...socket.idsByHandle],
    retries: [...socket.registrationRetries],
    next: socket.nextInputHandle,
    key: socket.gameKey,
  }
}
try {
  const owner = await connect()
  const room = await create(owner)
  await join(owner, room, [], true)
  const bikes = [await register(owner, 'one'), await register(owner, 'two')]
  const ownerSocket = ownerOf(room, 'one')
  const spectators = []
  while (room.game.liveClients.length < MAX_CLIENTS_PER_ROOM) {
    const spectator = await connect()
    await join(spectator, room)
    spectators.push(spectator)
  }
  send(owner, MSG_TYPE.START_GAME)
  await receive(
    owner,
    (msg) =>
      msg.type === MSG_TYPE.GAME_STATE && msg.payload.stage === 'preparation',
  )
  const pending = room.game.pendingStart
  const handlers = [
    room.game.arena.ondraw,
    room.game.arena.onreset,
    room.game.arena.onfinish,
    room.game.onstate,
  ]
  for (let i = 0; i < 3; i++) {
    const joined = await join(owner, room, bikes.map(claim), true)
    assert.deepEqual(
      joined.payload.accepted,
      bikes.map(({ id, inputHandle }) => ({ id, inputHandle })),
    )
  }
  assert.equal(room.game.liveClients.length, MAX_CLIENTS_PER_ROOM)
  assert.equal(ownerSocket.nextInputHandle, 2)
  for (let i = 0; i < 3; i++) {
    assert.equal((await join(spectators[1], room)).type, MSG_TYPE.JOIN_RESULT)
    assert.equal(room.game.liveClients.length, MAX_CLIENTS_PER_ROOM)
  }
  assert.equal(room.game.pendingStart, pending)
  assert.deepEqual(
    [
      room.game.arena.ondraw,
      room.game.arena.onreset,
      room.game.arena.onfinish,
      room.game.onstate,
    ],
    handlers,
  )
  const outsider = await connect()
  assert.equal((await join(outsider, room)).code, 'ROOM_FULL')
  send(spectators[0], MSG_TYPE.LEAVE_GAME)
  await barrier(spectators[0])
  assert.equal((await join(outsider, room)).type, MSG_TYPE.JOIN_RESULT)
  assert.equal(room.game.liveClients.length, MAX_CLIENTS_PER_ROOM)

  // Rejected target/claim/handle preflights preserve both memberships and the
  // pending source attempt, including its current owner and active handles.
  const switching = await connect()
  const source = await create(switching)
  await join(switching, source, [], true)
  const sourceBikes = [
    await register(switching, 'one'),
    await register(switching, 'two'),
  ]
  const switchingSocket = ownerOf(source, 'one')
  send(switching, MSG_TYPE.START_GAME)
  await receive(
    switching,
    (msg) =>
      msg.type === MSG_TYPE.GAME_STATE && msg.payload.stage === 'preparation',
  )
  const before = snapshot(source, switchingSocket)
  const fullBefore = snapshot(room, ownerSocket)
  assert.equal(
    (await join(switching, room, [claim(bikes[0])], true)).code,
    'ROOM_FULL',
  )
  assert.deepEqual(snapshot(source, switchingSocket), before)
  assert.deepEqual(snapshot(room, ownerSocket), fullBefore)
  assert.equal(
    (await join(switching, { key: 'missing' })).code,
    'GAME_NOT_FOUND',
  )
  assert.deepEqual(snapshot(source, switchingSocket), before)
  assert.equal(
    (await join(switching, room, [claim(bikes[0]), claim(bikes[0])])).code,
    'INVALID_RECONNECT',
  )
  assert.deepEqual(snapshot(source, switchingSocket), before)
  const targetOwner = await connect()
  const target = await create(targetOwner)
  await join(targetOwner, target, [], true)
  const targetBike = await register(targetOwner, 'one')
  switchingSocket.nextInputHandle = 256
  const exhausted = snapshot(source, switchingSocket)
  const targetBefore = snapshot(target, ownerOf(target, 'one'))
  assert.equal(
    (await join(switching, target, [claim(targetBike)], true)).code,
    'INPUT_HANDLE_EXHAUSTED',
  )
  assert.deepEqual(snapshot(source, switchingSocket), exhausted)
  assert.deepEqual(snapshot(target, ownerOf(target, 'one')), targetBefore)
  switchingSocket.nextInputHandle = before.next
  assert.equal(source.game.pendingStart, before.pending)
  source.game.cancelPendingStart()
  room.game.cancelPendingStart()

  // A partial handover preserves the replacement's bike and creator role when
  // the former owner leaves or closes, even if its accelerator index is stale.
  const replacement = await connect()
  const transfer = await join(
    replacement,
    source,
    [claim(sourceBikes[0])],
    true,
  )
  assert.equal(transfer.payload.roomOwner.accepted, true)
  const replacementSocket = ownerOf(source, 'one')
  source.game.stats.players[0].total = 17
  switchingSocket.handlesById.set('one', sourceBikes[0].inputHandle)
  switchingSocket.idsByHandle.set(sourceBikes[0].inputHandle, 'one')
  switchingSocket.lobbyRooms.add(source.game)
  const retryCount = switchingSocket.creationRetries.size
  const releaseCalls = []
  const disconnectPlayer = source.game.disconnectPlayer.bind(source.game)
  source.game.disconnectPlayer = (id) => {
    releaseCalls.push(id)
    return disconnectPlayer(id)
  }
  send(switching, MSG_TYPE.LEAVE_GAME)
  await barrier(switching, replacement)
  assert.deepEqual(releaseCalls, ['two'])
  assert.equal(ownerOf(source, 'one'), replacementSocket)
  assert.equal(source.game.roomOwner.socket, replacementSocket)
  assert.equal(source.game.arena.players[0].connected, true)
  assert.equal(source.game.arena.players[1].connected, false)
  assert.equal(source.game.stats.players[0].total, 17)
  assert.equal(source.game.ownership.verifiers.size, 2)
  assert.equal(switchingSocket.handlesById.size, 0)
  assert.equal(switchingSocket.registrationRetries.size, 0)
  assert.equal(switchingSocket.nextInputHandle, 2)
  assert.equal(switchingSocket.creationRetries.size, retryCount)
  assert.equal(switchingSocket.lobbyRooms.has(source.game), true)
  assert.equal(source.game.pendingStart, null)
  replacement.messages.length = 0
  assert.equal(source.game.disconnect(switchingSocket), false)
  send(switching, MSG_TYPE.LEAVE_GAME)
  await barrier(switching, replacement)
  assert.deepEqual(releaseCalls, ['two'])
  assert.deepEqual(roomPackets(replacement), [])
  const rejoined = await join(switching, source, [claim(sourceBikes[1])])
  assert.equal(rejoined.payload.accepted[0].inputHandle, 2)
  const closed = once(switchingSocket, 'close')
  switching.close()
  await closed
  assert.deepEqual(releaseCalls, ['two', 'two'])
  assert.equal(source.game.roomOwner.socket, replacementSocket)
  assert.equal(ownerOf(source, 'one'), replacementSocket)
  assert.equal(source.game.arena.players[0].connected, true)

  // All room events, including binary draws, enumerate the same live room
  // members. Routing alone cannot subscribe a lobby socket or grant controls.
  const viewer = await connect()
  const mover = await connect()
  const lobby = await connect()
  const former = await connect()
  await join(former, source)
  send(former, MSG_TYPE.LEAVE_GAME)
  await barrier(former)
  await join(viewer, source)
  const viewerSocket = source.game.liveClients.find(
    (client) => client !== replacementSocket,
  )
  await join(mover, source)
  const sourceMover = source.game.liveClients.find(
    (client) => client !== replacementSocket && client !== viewerSocket,
  )
  await join(mover, target)
  assert.equal(source.game.clients.has(sourceMover), false)
  await join(lobby, source)
  const lobbySocket = source.game.liveClients.find(
    (client) => client !== replacementSocket && client !== viewerSocket,
  )
  source.game.clients.delete(lobbySocket)
  assert.equal(lobbySocket.gameKey, source.key)
  assert.equal(source.game.isJoined(lobbySocket), false)
  assert.equal(source.game.validateRound(lobbySocket).code, 'NOT_IN_ROOM')
  await barrier(viewer, mover, lobby, replacement, former)
  for (const ws of [viewer, mover, lobby, replacement, former]) {
    ws.messages.length = 0
  }
  source.game.arena.ondraw([[1, 2, 0]])
  source.game.arena.onreset([])
  source.game.publishStage()
  source.game.running = true
  source.game.arena.onfinish({
    kills: {},
    escaped: [],
    deadOnDeath: {},
    winner: null,
  })
  await barrier(viewer, mover, lobby, replacement, former)
  for (const ws of [viewer, replacement]) {
    const packets = roomPackets(ws)
    assert.equal(packets.filter((msg) => msg.binary).length, 1)
    for (const type of [
      MSG_TYPE.GAME_RESET,
      MSG_TYPE.GAME_STATE,
      MSG_TYPE.GAME_FINISH,
    ]) {
      assert.equal(packets.filter((msg) => msg.type === type).length, 1)
    }
    assert.equal(
      packets.filter((msg) => msg.type === MSG_TYPE.GAME_INFO).length,
      1,
    )
  }
  assert.deepEqual(roomPackets(mover), [])
  assert.deepEqual(roomPackets(lobby), [])
  assert.deepEqual(roomPackets(former), [])
  // A bare routing index does not bypass a full room's admission cap.
  lobbySocket.gameKey = room.key
  assert.equal((await join(lobby, room)).code, 'ROOM_FULL')
  lobbySocket.gameKey = null

  const terminated = once(replacementSocket, 'close')
  replacementSocket.terminate()
  await terminated
  assert.equal(source.game.ownership.owners.size, 0)
  assert.equal(source.game.roomOwner.socket, null)
  assert.equal(source.game.arena.players[0].connected, false)
  assert.equal(source.game.ownership.verifiers.size, 2)
  assert.equal(source.game.disconnect(replacementSocket), false)

  // A defensive prune releases actual old-room authority even with a stale
  // routing index, while preserving new-room indexes with the same player ID.
  const stale = ownerOf(target, 'one')
  const oldHandle = stale.handlesById.get('one')
  source.game.clients.add(stale)
  source.game.ownership.owners.set('one', stale)
  source.game.roomOwner.bind(stale)
  const targetState = snapshot(target, stale)
  source.game.pruneClients()
  assert.equal(source.game.clients.has(stale), false)
  assert.equal(source.game.ownership.owners.has('one'), false)
  assert.equal(source.game.roomOwner.socket, null)
  assert.deepEqual(snapshot(target, stale), targetState)
  assert.equal(stale.handlesById.get('one'), oldHandle)
  assert.equal(source.game.disconnect(stale), false)
  const dead = ownerSocket
  dead.terminate()
  // Prune immediately, before the asynchronous close handler can clean up.
  assert.notEqual(dead.readyState, WebSocket.OPEN)
  room.game.pruneClients()
  assert.equal(room.game.ownership.owners.size, 0)
  assert.equal(room.game.roomOwner.socket, null)
  assert.equal(room.game.clients.has(dead), false)
  const afterPrune = room.game.stats.players.map((player) => ({ ...player }))
  assert.equal(room.game.disconnect(dead), false)
  await once(dead, 'close')
  assert.deepEqual(room.game.stats.players, afterPrune)
  assert.equal(room.game.ownership.verifiers.size, 2)

  // Membership gates every network mutation, even when routing, creator,
  // handles and authoritative bike ownership all still point at this socket.
  const controls = await connect()
  const controlledRoom = await create(controls)
  await join(controls, controlledRoom, [], true)
  await register(controls, 'one')
  await register(controls, 'two')
  const controlsSocket = ownerOf(controlledRoom, 'one')
  send(controls, MSG_TYPE.START_GAME)
  await receive(
    controls,
    (msg) =>
      msg.type === MSG_TYPE.GAME_STATE && msg.payload.stage === 'preparation',
  )
  const controlledPending = controlledRoom.game.pendingStart
  controlledRoom.game.clients.delete(controlsSocket)
  assert.equal(controlledRoom.game.eligiblePlayerCount, 0)
  const attemptedMoves = []
  const changeDir = controlledRoom.game.changeDir
  controlledRoom.game.changeDir = (move) => attemptedMoves.push(move)
  controls.send(
    Buffer.from([
      BINARY_OPCODE.CHANGE_DIR,
      controlsSocket.handlesById.get('one'),
      0,
    ]),
  )
  send(controls, MSG_TYPE.ARENA_READY, {
    startId: controlledPending.startId,
  })
  assert.equal(
    (await request(controls, MSG_TYPE.START_GAME)).code,
    'NOT_IN_ROOM',
  )
  assert.equal(
    (await request(controls, MSG_TYPE.SET_INTERVAL, 50)).code,
    'NOT_IN_ROOM',
  )
  assert.equal(
    (await request(controls, MSG_TYPE.ADD_PLAYER, { id: 'three' })).code,
    'INVALID_REGISTRATION',
  )
  await barrier(controls)
  assert.deepEqual(attemptedMoves, [])
  assert.equal(controlledPending.readyClients.size, 0)
  assert.equal(controlledRoom.game.pendingStart, controlledPending)
  assert.equal(controlledRoom.game.stage, 'preparation')
  assert.equal(controlledRoom.game.arena.players.length, 2)
  controlledRoom.game.changeDir = changeDir
  controlledRoom.game.clients.add(controlsSocket)
  assert.equal(controlledRoom.game.eligiblePlayerCount, 2)
  controlledRoom.game.cancelPendingStart()

  // A successful authenticated switch releases both source bikes, cancels its
  // pending attempt and preserves its durable roster/proofs/scores for recovery.
  const switcher = await connect()
  const switchSource = await create(switcher)
  await join(switcher, switchSource, [], true)
  const retained = [
    await register(switcher, 'one'),
    await register(switcher, 'two'),
  ]
  const switchSocket = ownerOf(switchSource, 'one')
  const sourceProofs = switchSource.game.ownership.serializeVerifiers()
  switchSource.game.stats.players[0].total = 31
  send(switcher, MSG_TYPE.START_GAME)
  await receive(
    switcher,
    (msg) =>
      msg.type === MSG_TYPE.GAME_STATE && msg.payload.stage === 'preparation',
  )
  const switched = await join(switcher, target, [claim(targetBike)], true)
  assert.equal(switched.payload.accepted[0].inputHandle, 2)
  assert.equal(switched.payload.roomOwner.accepted, true)
  assert.equal(ownerOf(target, 'one'), switchSocket)
  assert.equal(switchSource.game.liveClients.length, 0)
  assert.equal(switchSource.game.ownership.owners.size, 0)
  assert.equal(switchSource.game.roomOwner.socket, null)
  assert.equal(switchSource.game.pendingStart, null)
  assert.equal(switchSource.game.stats.players[0].total, 31)

  // Invalid proof remains a per-claim rejection with spectator admission. A
  // successful switch still departs the source and preserves unrelated owners.
  const controlsBefore = snapshot(controlledRoom, controlsSocket)
  const rejectedClaims = await join(switcher, controlledRoom, [
    claim(targetBike),
  ])
  assert.deepEqual(rejectedClaims.payload.accepted, [])
  assert.deepEqual(rejectedClaims.payload.rejected, [
    { id: 'one', code: 'INVALID_CREDENTIAL' },
  ])
  assert.equal(rejectedClaims.payload.roomOwner, null)
  assert.equal(controlledRoom.game.isJoined(switchSocket), true)
  assert.deepEqual(
    [...controlledRoom.game.ownership.owners],
    controlsBefore.owners,
  )
  assert.equal(controlledRoom.game.roomOwner.socket, controlsSocket)
  assert.equal(target.game.ownership.owners.size, 0)
  assert.equal(switchSource.game.ownership.owners.size, 0)
  assert.equal(switchSource.game.stats.players[0].total, 31)
  assert.equal(switchSource.game.arena.players.length, 2)
  assert.ok(
    switchSource.game.arena.players.every((player) => !player.connected),
  )
  assert.deepEqual(
    switchSource.game.ownership.serializeVerifiers(),
    sourceProofs,
  )
  await join(switcher, switchSource)
  assert.equal(switchSource.game.ownership.owners.size, 0)
  assert.equal(switchSource.game.roomOwner.socket, null)
  assert.equal(switchSocket.nextInputHandle, 3)
  const recovered = await join(
    switcher,
    switchSource,
    retained.map(claim),
    true,
  )
  assert.deepEqual(
    recovered.payload.accepted.map(({ inputHandle }) => inputHandle),
    [3, 4],
  )
  assert.equal(recovered.payload.roomOwner.accepted, true)
  assert.ok(switchSource.game.arena.players.every((player) => player.connected))
  assert.equal(switchSource.game.stats.players[0].total, 31)
  console.log(
    'Room membership, atomic admission, safe departure and packet isolation passed',
  )
} finally {
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.terminate()
    }
  }
  for (const game of [...gameServer.games]) {
    game.destroy()
  }
  await new Promise((resolve) => server.close(resolve))
  rmSync(dataDir, { recursive: true, force: true })
}
