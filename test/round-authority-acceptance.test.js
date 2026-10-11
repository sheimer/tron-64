import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mock } from 'node:test'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { MAX_CLIENTS_PER_ROOM } from '../shared/constants.js'
import { MSG_TYPE, PROTOCOL_VERSION } from '../shared/protocol.js'

const here = fileURLToPath(import.meta.url)

async function serve() {
  // Only the server clock is controlled; requests still cross real WebSockets.
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  const { gameServer } = await import('../server/GameServer.js')
  const { storage } = await import('../server/Storage.js')
  const { setupWebSocketServer } = await import('../server/wsHandler.js')
  const originalSave = storage.saveGames.bind(storage)
  const server = http.createServer()
  setupWebSocketServer(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  process.send({ port: server.address().port })
  const timerIds = new WeakMap()
  let nextTimerId = 0
  const timerId = (timer) => {
    if (!timer) return null
    if (!timerIds.has(timer)) timerIds.set(timer, ++nextTimerId)
    return timerIds.get(timer)
  }
  process.on(
    'message',
    ({ id, command, key, playerId, enabled, milliseconds }) => {
      const game = gameServer.getGame(key)
      let result
      if (command === 'inspect') {
        result = game
          ? {
              info: gameServer.getGameInfo(key),
              positions: game.arena.players.map((player) => ({
                id: player.id,
                pos: player.pos,
                move: player.move,
                alive: player.alive,
                connected: player.connected,
              })),
              stats: game.stats,
              acceptingPlayers: game.acceptingPlayers,
              pending: Boolean(game.pendingStart),
              fallbackTimer: timerId(game.pendingStart?.fallbackTimer),
              startTimer: timerId(game.pendingStart?.startTimer),
              physicsTimer: timerId(game.timer),
              nextTickTime: game.nextTickTime,
              clients: game.clients.map((socket) => ({
                playerIds: [...socket.playerIds],
                handles: [...socket.handlesById],
                nextInputHandle: socket.nextInputHandle,
                creationRetries: socket.creationRetries.size,
                roomOwner: game.roomOwner.owns(socket),
              })),
            }
          : null
      } else if (command === 'games')
        result = gameServer.games.map((g) => g.key)
      else if (command === 'failWrites') {
        storage.saveGames = enabled ? () => false : originalSave
        result = true
      } else if (command === 'exhaustHandles') {
        // Trusted resource fixture: the connection has used its handle budget.
        game.ownership.owners.get(playerId).nextInputHandle = 256
        result = true
      } else if (command === 'tick') {
        mock.timers.tick(milliseconds)
        result = true
      } else if (command === 'finish') {
        game.arena.finish()
        result = true
      } else if (command === 'destroy') {
        game.destroy()
        result = !gameServer.getGame(key)
      } else if (command === 'shutdown') {
        process.send({ id, result: true }, () => process.exit(0))
        return
      }
      process.send({ id, result })
    },
  )
}

if (process.argv.includes('--round-authority-child')) await serve()
else await acceptance()

async function acceptance() {
  const dir = mkdtempSync(path.join(tmpdir(), 'bitcycles-round-authority-'))
  const sockets = []
  const secrets = []
  const secretRecipients = new Map()
  const verifiers = []
  let child
  let sequence = 0
  const nextId = () => `round-authority-${++sequence}`
  const snapshot = () => readFileSync(path.join(dir, 'games.json'), 'utf8')
  const bikeClaim = (binding) => ({
    id: binding.id,
    reconnectToken: binding.reconnectToken,
  })
  const ownerClaim = (creation) => ({
    ownerClientId: creation.ownerClientId,
    roomOwnerToken: creation.roomOwnerToken,
  })
  const rememberSecret = (token, socket) => {
    secrets.push(token)
    secretRecipients.set(token, socket)
    verifiers.push(createHash('sha256').update(token).digest('hex'))
  }

  function rpc(command, options = {}) {
    const id = nextId()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.off('message', onMessage)
        reject(new Error(`Server command ${command} timed out`))
      }, 4000)
      function onMessage(message) {
        if (message.id !== id) return
        clearTimeout(timer)
        child.off('message', onMessage)
        resolve(message.result)
      }
      child.on('message', onMessage)
      child.send({ id, command, ...options })
    })
  }

  function receive(ws, predicate) {
    const index = ws.queue.findIndex(predicate)
    if (index >= 0) return Promise.resolve(ws.queue.splice(index, 1)[0])
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve }
      waiter.timer = setTimeout(() => {
        ws.waiters.splice(ws.waiters.indexOf(waiter), 1)
        reject(new Error('Round-authority socket response timed out'))
      }, 4000)
      ws.waiters.push(waiter)
    })
  }

  async function connect(url) {
    const ws = new WebSocket(url)
    sockets.push(ws)
    ws.queue = []
    ws.waiters = []
    ws.history = []
    ws.on('message', (data, binary) => {
      if (binary) return
      const message = JSON.parse(data.toString())
      ws.history.push(message)
      const index = ws.waiters.findIndex((w) => w.predicate(message))
      if (index < 0) ws.queue.push(message)
      else {
        const [waiter] = ws.waiters.splice(index, 1)
        clearTimeout(waiter.timer)
        waiter.resolve(message)
      }
    })
    await once(ws, 'open')
    const lobby = await receive(ws, (m) => m.type === MSG_TYPE.LOBBY_LIST)
    assert.equal(lobby.protocolVersion, PROTOCOL_VERSION)
    return ws
  }

  function transmit(ws, type, payload, extra = {}) {
    const requestId = nextId()
    ws.send(
      JSON.stringify({
        type,
        payload,
        requestId,
        protocolVersion: PROTOCOL_VERSION,
        ...extra,
      }),
    )
    return Object.hasOwn(extra, 'requestId') ? extra.requestId : requestId
  }

  function request(ws, type, payload, extra) {
    const requestId = transmit(ws, type, payload, extra)
    return receive(ws, (m) => m.requestId === requestId)
  }

  async function fence(ws) {
    const t = nextId()
    transmit(ws, MSG_TYPE.PING, null, { t })
    await receive(ws, (m) => m.type === MSG_TYPE.PONG && m.t === t)
  }

  function expectError(message, code) {
    assert.equal(message.type, MSG_TYPE.ERROR)
    assert.equal(message.code, code)
    assert.equal(typeof message.payload, 'string')
    assert.ok(message.payload.length > 0)
  }

  async function create(ws, name = 'Round authority') {
    const response = await request(ws, MSG_TYPE.CREATE_GAME, {
      name,
      interval: 40,
      isPublic: true,
    })
    assert.equal(response.type, MSG_TYPE.GAME_CREATED)
    assert.equal(response.protocolVersion, 3)
    assert.match(response.payload.ownerClientId, /^[a-f0-9]{32}$/)
    assert.match(response.payload.roomOwnerToken, /^[A-Za-z0-9_-]{43}$/)
    rememberSecret(response.payload.roomOwnerToken, ws)
    return response.payload
  }

  async function join(ws, creation, { owner = false, reconnect = [] } = {}) {
    const result = await request(ws, MSG_TYPE.JOIN_GAME, {
      key: creation.key,
      reconnect,
      ...(owner ? { roomOwner: ownerClaim(creation) } : {}),
    })
    assert.equal(result.type, MSG_TYPE.JOIN_RESULT)
    assert.equal(result.payload.key, creation.key)
    return result.payload
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
    rememberSecret(result.payload.reconnectToken, ws)
    return result.payload
  }

  async function assertRejectedUnchanged(ws, key, type, payload, code) {
    const before = await rpc('inspect', { key })
    const disk = snapshot()
    const response = await request(ws, type, payload)
    expectError(response, code)
    assert.deepEqual(await rpc('inspect', { key }), before, code)
    assert.equal(snapshot(), disk, code)
  }

  async function startRound(ws, key) {
    const resets = ws.history.filter(
      (m) => m.type === MSG_TYPE.GAME_RESET,
    ).length
    const requestId = transmit(ws, MSG_TYPE.START_GAME)
    await receive(ws, (m) => m.type === MSG_TYPE.GAME_RESET)
    await fence(ws)
    assert.equal(
      ws.history.filter((m) => m.type === MSG_TYPE.GAME_RESET).length,
      resets + 1,
    )
    const admitted = await rpc('inspect', { key })
    assert.equal(admitted.pending, true)
    assert.equal(admitted.info.running, false)
    return requestId
  }

  try {
    child = fork(here, ['--round-authority-child'], {
      env: { ...process.env, DATA_DIR: dir },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    child.output = ''
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (data) => (child.output += data.toString()))
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Server startup timed out')),
        4000,
      )
      child.once('message', (message) => {
        clearTimeout(timer)
        resolve(message)
      })
      child.once('error', reject)
    })
    const url = `ws://127.0.0.1:${ready.port}/ws`
    const creator = await connect(url)
    const rider = await connect(url)
    const spectator = await connect(url)
    const lobbyClient = await connect(url)
    assert.equal(PROTOCOL_VERSION, 3)

    // Every mismatched version is rejected before a creation can mutate rooms.
    for (const protocolVersion of [undefined, null, '3', 2, 4]) {
      const response = await request(
        lobbyClient,
        MSG_TYPE.CREATE_GAME,
        { name: 'Stale' },
        { protocolVersion },
      )
      expectError(response, 'PROTOCOL_MISMATCH')
      assert.match(response.payload, /reload/i)
      assert.deepEqual(await rpc('games'), [])
    }
    for (const requestId of [null, '', 'invalid request', 'x'.repeat(65)]) {
      const responseId = transmit(
        creator,
        MSG_TYPE.CREATE_GAME,
        { name: 'Invalid' },
        { requestId },
      )
      const response = await receive(
        creator,
        (m) => m.requestId === responseId && m.type === MSG_TYPE.ERROR,
      )
      expectError(response, 'INVALID_CREATION')
      assert.deepEqual(await rpc('games'), [])
    }

    // The successful acknowledgement describes a room already durable with no bikes.
    const room = await create(creator)
    const record = JSON.parse(snapshot()).games.find((g) => g.key === room.key)
    assert.deepEqual(record.players, [])
    assert.equal(record.firstRoundStarted, false)
    assert.equal(record.private.roomOwner.ownerClientId, room.ownerClientId)
    assert.equal(record.private.roomOwner.verifier, verifiers[0])
    assert.equal(snapshot().includes(room.roomOwnerToken), false)
    const creationFrame = creator.history.find(
      (m) => m.type === MSG_TYPE.GAME_CREATED,
    )
    const retry = await request(
      creator,
      MSG_TYPE.CREATE_GAME,
      { name: 'Round authority', interval: 40, isPublic: true },
      { requestId: creationFrame.requestId },
    )
    assert.deepEqual(retry, creationFrame)
    assert.deepEqual(await rpc('games'), [room.key])
    expectError(
      await request(
        creator,
        MSG_TYPE.CREATE_GAME,
        { name: 'Changed' },
        { requestId: creationFrame.requestId },
      ),
      'REQUEST_ID_CONFLICT',
    )
    assert.deepEqual(await rpc('games'), [room.key])

    const diskBeforeFailure = snapshot()
    await rpc('failWrites', { enabled: true })
    const failedCreationId = nextId()
    expectError(
      await request(
        lobbyClient,
        MSG_TYPE.CREATE_GAME,
        { name: 'Failed creation' },
        { requestId: failedCreationId },
      ),
      'PERSISTENCE_FAILED',
    )
    assert.deepEqual(await rpc('games'), [room.key])
    assert.equal(snapshot(), diskBeforeFailure)
    assert.equal(
      lobbyClient.history.some(
        (m) =>
          m.requestId === failedCreationId && m.type === MSG_TYPE.GAME_CREATED,
      ),
      false,
    )
    await rpc('failWrites', { enabled: false })
    const retriedCreation = await request(
      lobbyClient,
      MSG_TYPE.CREATE_GAME,
      { name: 'Failed creation' },
      { requestId: failedCreationId },
    )
    assert.equal(retriedCreation.type, MSG_TYPE.GAME_CREATED)
    rememberSecret(retriedCreation.payload.roomOwnerToken, lobbyClient)
    await rpc('destroy', { key: retriedCreation.payload.key })
    expectError(
      await request(
        lobbyClient,
        MSG_TYPE.CREATE_GAME,
        { name: 'Failed creation' },
        { requestId: failedCreationId },
      ),
      'REQUEST_ID_CONFLICT',
    )
    assert.deepEqual(await rpc('games'), [room.key])

    assert.deepEqual((await join(creator, room, { owner: true })).roomOwner, {
      accepted: true,
      ownerClientId: room.ownerClientId,
    })
    await join(rider, room)
    await join(spectator, room)
    const emptyOwner = await rpc('inspect', { key: room.key })
    assert.equal(emptyOwner.info.ownerStatus, 'present')
    assert.deepEqual(emptyOwner.clients[0].handles, [])
    assert.equal(emptyOwner.clients[0].nextInputHandle, 0)
    await assertRejectedUnchanged(
      creator,
      room.key,
      MSG_TYPE.START_GAME,
      undefined,
      'INSUFFICIENT_PLAYERS',
    )
    await assertRejectedUnchanged(
      lobbyClient,
      room.key,
      MSG_TYPE.START_GAME,
      { key: room.key },
      'NOT_IN_ROOM',
    )
    const first = await register(rider, 'shared-first')
    const second = await register(rider, 'shared-second')
    assert.equal(
      (await rpc('inspect', { key: room.key })).info.eligiblePlayerCount,
      2,
    )
    for (const ws of [rider, spectator]) {
      await assertRejectedUnchanged(
        ws,
        room.key,
        MSG_TYPE.START_GAME,
        undefined,
        'CREATOR_REQUIRED',
      )
      await assertRejectedUnchanged(
        ws,
        room.key,
        MSG_TYPE.SET_INTERVAL,
        25,
        'CREATOR_REQUIRED',
      )
    }
    for (const interval of [9, 501, 10.5, '20', null])
      await assertRejectedUnchanged(
        creator,
        room.key,
        MSG_TYPE.SET_INTERVAL,
        interval,
        'INVALID_INTERVAL',
      )
    for (const interval of [10, 500, 40]) {
      transmit(creator, MSG_TYPE.SET_INTERVAL, interval)
      await fence(creator)
      assert.equal(
        (await rpc('inspect', { key: room.key })).info.interval,
        interval,
      )
      assert.equal(JSON.parse(snapshot()).games[0].interval, interval)
    }
    await rpc('failWrites', { enabled: true })
    await assertRejectedUnchanged(
      creator,
      room.key,
      MSG_TYPE.SET_INTERVAL,
      25,
      'PERSISTENCE_FAILED',
    )
    await rpc('failWrites', { enabled: false })

    // Bike proof cannot recover the independent creator role, and invalid owner
    // proof must not suppress a valid bike claim.
    const mixed = await request(spectator, MSG_TYPE.JOIN_GAME, {
      key: room.key,
      roomOwner: {
        ownerClientId: room.ownerClientId,
        roomOwnerToken: first.reconnectToken,
      },
      reconnect: [
        bikeClaim(first),
        { id: second.id, reconnectToken: room.roomOwnerToken },
      ],
    })
    assert.deepEqual(mixed.payload.roomOwner, {
      accepted: false,
      code: 'INVALID_OWNER_CREDENTIAL',
    })
    assert.deepEqual(
      mixed.payload.accepted.map((b) => b.id),
      [first.id],
    )
    assert.deepEqual(mixed.payload.rejected, [
      { id: second.id, code: 'INVALID_CREDENTIAL' },
    ])
    await assertRejectedUnchanged(
      spectator,
      room.key,
      MSG_TYPE.START_GAME,
      undefined,
      'CREATOR_REQUIRED',
    )
    await join(rider, room, { reconnect: [bikeClaim(first)] })

    // Resource preflight must occur before moving either the creator or bikes,
    // including a claimant who already owns a bike in another room.
    const claimant = await connect(url)
    const otherRoom = await create(claimant, 'Other room')
    await join(claimant, otherRoom, { owner: true })
    const otherBike = await register(claimant, 'other-bike')
    await rpc('exhaustHandles', { key: otherRoom.key, playerId: otherBike.id })
    const beforeRoom = await rpc('inspect', { key: room.key })
    const beforeOther = await rpc('inspect', { key: otherRoom.key })
    expectError(
      await request(claimant, MSG_TYPE.JOIN_GAME, {
        key: room.key,
        roomOwner: ownerClaim(room),
        reconnect: [bikeClaim(first), bikeClaim(second)],
      }),
      'INPUT_HANDLE_EXHAUSTED',
    )
    assert.deepEqual(await rpc('inspect', { key: room.key }), beforeRoom)
    assert.deepEqual(await rpc('inspect', { key: otherRoom.key }), beforeOther)
    await assertRejectedUnchanged(
      claimant,
      room.key,
      MSG_TYPE.START_GAME,
      { key: room.key },
      'INSUFFICIENT_PLAYERS',
    )

    // Room admission failure also leaves both complete authority graphs intact,
    // even when the valid target proofs would transfer the creator and bikes.
    const fillers = []
    for (let i = beforeRoom.clients.length; i < MAX_CLIENTS_PER_ROOM; i++) {
      const filler = await connect(url)
      await join(filler, room)
      fillers.push(filler)
    }
    const fullRoom = await rpc('inspect', { key: room.key })
    assert.equal(fullRoom.clients.length, MAX_CLIENTS_PER_ROOM)
    expectError(
      await request(claimant, MSG_TYPE.JOIN_GAME, {
        key: room.key,
        roomOwner: ownerClaim(room),
        reconnect: [bikeClaim(first), bikeClaim(second)],
      }),
      'ROOM_FULL',
    )
    assert.deepEqual(await rpc('inspect', { key: room.key }), fullRoom)
    assert.deepEqual(await rpc('inspect', { key: otherRoom.key }), beforeOther)
    for (const filler of fillers) {
      transmit(filler, MSG_TYPE.LEAVE_GAME)
      await fence(filler)
    }
    assert.deepEqual(await rpc('inspect', { key: room.key }), beforeRoom)

    // Owner-only recovery works with an exhausted handle budget. Switching
    // releases the old room's bike, while neither target bike transfers.
    const exhaustedOwner = await join(claimant, room, { owner: true })
    assert.deepEqual(exhaustedOwner.roomOwner, {
      accepted: true,
      ownerClientId: room.ownerClientId,
    })
    assert.deepEqual(exhaustedOwner.accepted, [])
    const ownerSocket = (await rpc('inspect', { key: room.key })).clients.find(
      (socket) => socket.roomOwner,
    )
    assert.deepEqual(ownerSocket.handles, [])
    assert.equal(ownerSocket.nextInputHandle, 256)
    assert.equal(
      (await rpc('inspect', { key: room.key })).info.eligiblePlayerCount,
      2,
    )

    // An invalid bike claim is reported separately from valid creator proof.
    const replacement = await connect(url)
    const validOwnerInvalidBike = await join(replacement, room, {
      owner: true,
      reconnect: [{ id: first.id, reconnectToken: room.roomOwnerToken }],
    })
    assert.deepEqual(validOwnerInvalidBike.roomOwner, {
      accepted: true,
      ownerClientId: room.ownerClientId,
    })
    assert.deepEqual(validOwnerInvalidBike.accepted, [])
    assert.deepEqual(validOwnerInvalidBike.rejected, [
      { id: first.id, code: 'INVALID_CREDENTIAL' },
    ])
    await receive(creator, (m) => m.type === MSG_TYPE.ROOM_OWNER_REVOKED)
    await assertRejectedUnchanged(
      creator,
      room.key,
      MSG_TYPE.SET_INTERVAL,
      25,
      'CREATOR_REQUIRED',
    )
    await assertRejectedUnchanged(
      creator,
      room.key,
      MSG_TYPE.START_GAME,
      undefined,
      'CREATOR_REQUIRED',
    )

    // The durable gate is consumed at launch, never admission or countdown.
    const firstAttempt = await startRound(replacement, room.key)
    assert.equal(
      (await rpc('inspect', { key: room.key })).info.firstRoundStarted,
      false,
    )
    assert.equal(
      JSON.parse(snapshot()).games.find((g) => g.key === room.key)
        .firstRoundStarted,
      false,
    )
    await assertRejectedUnchanged(
      replacement,
      room.key,
      MSG_TYPE.START_GAME,
      undefined,
      'ROUND_PENDING',
    )
    await assertRejectedUnchanged(
      replacement,
      room.key,
      MSG_TYPE.SET_INTERVAL,
      20,
      'ROUND_PENDING',
    )
    await rpc('tick', { milliseconds: 2000 })
    await fence(replacement)
    const countdown = await rpc('inspect', { key: room.key })
    assert.equal(countdown.info.firstRoundStarted, false)
    assert.equal(countdown.info.running, false)
    assert.ok(countdown.startTimer)
    await assertRejectedUnchanged(
      replacement,
      room.key,
      MSG_TYPE.START_GAME,
      undefined,
      'ROUND_PENDING',
    )
    await assertRejectedUnchanged(
      replacement,
      room.key,
      MSG_TYPE.SET_INTERVAL,
      20,
      'ROUND_PENDING',
    )
    await rpc('failWrites', { enabled: true })
    await rpc('tick', { milliseconds: 1000 })
    expectError(
      await receive(replacement, (m) => m.requestId === firstAttempt),
      'PERSISTENCE_FAILED',
    )
    const failedLaunch = await rpc('inspect', { key: room.key })
    assert.equal(failedLaunch.info.firstRoundStarted, false)
    assert.equal(failedLaunch.info.running, false)
    assert.equal(failedLaunch.pending, false)
    assert.equal(failedLaunch.physicsTimer, null)
    assert.equal(failedLaunch.startTimer, null)
    assert.equal(failedLaunch.fallbackTimer, null)
    assert.equal(failedLaunch.acceptingPlayers, true)
    assert.equal(failedLaunch.stats.gamecount, 0)
    await assertRejectedUnchanged(
      spectator,
      room.key,
      MSG_TYPE.START_GAME,
      undefined,
      'CREATOR_REQUIRED',
    )
    await rpc('failWrites', { enabled: false })

    await startRound(replacement, room.key)
    await rpc('tick', { milliseconds: 2000 })
    await rpc('tick', { milliseconds: 1000 })
    await fence(replacement)
    const launched = await rpc('inspect', { key: room.key })
    assert.equal(launched.info.firstRoundStarted, true)
    assert.equal(launched.info.running, true)
    assert.equal(launched.stats.gamecount, 0)
    assert.equal(
      JSON.parse(snapshot()).games.find((g) => g.key === room.key)
        .firstRoundStarted,
      true,
    )
    await assertRejectedUnchanged(
      replacement,
      room.key,
      MSG_TYPE.START_GAME,
      undefined,
      'ROUND_RUNNING',
    )
    await assertRejectedUnchanged(
      replacement,
      room.key,
      MSG_TYPE.SET_INTERVAL,
      20,
      'ROUND_RUNNING',
    )
    await assertRejectedUnchanged(
      spectator,
      room.key,
      MSG_TYPE.START_GAME,
      undefined,
      'ROUND_RUNNING',
    )
    await rpc('finish', { key: room.key })
    await receive(replacement, (m) => m.type === MSG_TYPE.GAME_FINISH)
    assert.equal((await rpc('inspect', { key: room.key })).stats.gamecount, 1)

    // A later spectator request needs no bike or creator role, even while the
    // creator is absent. New spectators can enter the registration-closed room.
    transmit(replacement, MSG_TYPE.LEAVE_GAME)
    await fence(replacement)
    const lateSpectator = await connect(url)
    await join(lateSpectator, room)
    assert.equal(
      (await rpc('inspect', { key: room.key })).info.ownerStatus,
      'away',
    )
    await assertRejectedUnchanged(
      lateSpectator,
      room.key,
      MSG_TYPE.SET_INTERVAL,
      25,
      'CREATOR_REQUIRED',
    )
    await startRound(lateSpectator, room.key)
    await rpc('tick', { milliseconds: 2000 })
    await rpc('tick', { milliseconds: 1000 })
    await fence(lateSpectator)
    assert.equal((await rpc('inspect', { key: room.key })).info.running, true)
    await rpc('finish', { key: room.key })
    await receive(lateSpectator, (m) => m.type === MSG_TYPE.GAME_FINISH)
    await startRound(rider, room.key)
    await rpc('tick', { milliseconds: 2000 })
    await rpc('tick', { milliseconds: 1000 })
    await fence(rider)
    assert.equal((await rpc('inspect', { key: room.key })).info.running, true)
    await rpc('finish', { key: room.key })
    await receive(rider, (m) => m.type === MSG_TYPE.GAME_FINISH)

    // Registered but disconnected bikes cannot meet the later-round minimum.
    transmit(rider, MSG_TYPE.LEAVE_GAME)
    await fence(rider)
    const disconnected = await rpc('inspect', { key: room.key })
    assert.equal(disconnected.info.players.length, 2)
    assert.equal(disconnected.info.eligiblePlayerCount, 0)
    await assertRejectedUnchanged(
      lateSpectator,
      room.key,
      MSG_TYPE.START_GAME,
      undefined,
      'INSUFFICIENT_PLAYERS',
    )
    await join(spectator, room, { reconnect: [bikeClaim(first)] })
    assert.equal(
      (await rpc('inspect', { key: room.key })).info.eligiblePlayerCount,
      1,
    )
    await assertRejectedUnchanged(
      lateSpectator,
      room.key,
      MSG_TYPE.START_GAME,
      undefined,
      'INSUFFICIENT_PLAYERS',
    )

    // A socket cannot retain unbounded private creation acknowledgements.
    const pressureClient = await connect(url)
    const pressureRooms = []
    for (let i = 0; i < 33; i++)
      pressureRooms.push(await create(pressureClient, `Bounded retry ${i}`))
    const latestCreation = pressureRooms.at(-1)
    await join(pressureClient, latestCreation)
    const retryEntries = (await rpc('inspect', { key: latestCreation.key }))
      .clients[0].creationRetries
    assert.ok(retryEntries > 0 && retryEntries <= 32)
    for (const creation of pressureRooms)
      await rpc('destroy', { key: creation.key })

    // Only correlated private credential acknowledgements may contain tokens;
    // verifier material never appears in any outbound frame or log.
    for (const ws of sockets) {
      await fence(ws)
      for (const message of ws.history) {
        const raw = JSON.stringify(message)
        for (const verifier of verifiers)
          assert.equal(raw.includes(verifier), false, message.type)
        for (const secret of secrets) {
          const acknowledged =
            (message.type === MSG_TYPE.GAME_CREATED &&
              message.payload.roomOwnerToken === secret) ||
            (message.type === MSG_TYPE.PLAYER_REGISTERED &&
              message.payload.reconnectToken === secret)
          assert.equal(
            raw.includes(secret),
            acknowledged && secretRecipients.get(secret) === ws,
            message.type,
          )
        }
      }
    }
    for (const secret of [...secrets, ...verifiers])
      assert.equal(child.output.includes(secret), false)
    console.log(
      'Round authority acceptance: durable creation/retry, mixed claims, preflight rollback, creator/spectator admission, controlled launch and rejection safety passed',
    )
  } finally {
    for (const ws of sockets) {
      for (const waiter of ws.waiters) clearTimeout(waiter.timer)
      if (ws.readyState === WebSocket.OPEN) ws.terminate()
    }
    if (child?.exitCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
    }
    rmSync(dir, { recursive: true, force: true })
  }
}
