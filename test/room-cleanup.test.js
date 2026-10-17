import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'
import { IDLE_ROOM_TIMEOUT_MS, MAX_ACTIVE_GAMES } from '../shared/constants.js'
import { MSG_TYPE, PROTOCOL_VERSION } from '../shared/protocol.js'

const dataDir = mkdtempSync(path.join(tmpdir(), 'bitcycles-cleanup-'))
process.env.DATA_DIR = dataDir
const { GameSession } = await import('../server/GameSession.js')
const { GameServer, gameServer } = await import('../server/GameServer.js')
const { storage } = await import('../server/Storage.js')
const { setupWebSocketServer } = await import('../server/wsHandler.js')
const original = {
  now: Date.now,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
}
let now = 1000
let nextTimer = 0
const timers = new Map()
const callbacks = new Map()
const rooms = []
const socket = (game) => ({
  readyState: WebSocket.OPEN,
  gameKey: game.key,
  protocolReady: true,
  playerIds: new Set(),
  handlesById: new Map(),
  idsByHandle: new Map(),
  nextInputHandle: 3,
  registrationRetries: new Map(),
})
function room() {
  const game = new GameSession({ key: `cleanup-${rooms.length}`, interval: 25 })
  rooms.push(game)
  return game
}
function advance(ms) {
  const until = now + ms
  for (;;) {
    const entries = [...timers].filter(([, timer]) => timer.at <= until)
    entries.sort((a, b) => a[1].at - b[1].at || a[0].id - b[0].id)
    if (!entries.length) {
      break
    }
    const [id, timer] = entries[0]
    now = timer.at
    timers.delete(id)
    timer.callback()
  }
  now = until
}
const savedKeys = () =>
  JSON.parse(readFileSync(storage.filePath, 'utf8')).games.map(
    (game) => game.key,
  )
const create = (registry) => {
  const key = registry.createGame({
    name: 'Cleanup',
    interval: 25,
    isPublic: true,
  })
  assert.ok(key)
  const game = registry.getGame(key)
  rooms.push(game)
  return game
}

try {
  Date.now = () => now
  globalThis.setTimeout = (callback, delay) => {
    const timer = {
      id: ++nextTimer,
      unrefs: 0,
      unref() {
        this.unrefs++
      },
    }
    timers.set(timer, { at: now + delay, callback, delay })
    callbacks.set(timer, callback)
    return timer
  }
  globalThis.clearTimeout = (timer) => timers.delete(timer)

  // Initial emptiness starts at creation, at >= the boundary on a 60s check.
  const initial = room()
  assert.equal(initial.allDisconnected, now)
  assert.equal(timers.get(initial.statusTimer).delay, 60_000)
  assert.equal(initial.statusTimer.unrefs, 1)
  const oldStatus = callbacks.get(initial.statusTimer)
  initial.checkConnectionStatus()
  const timer = initial.statusTimer
  oldStatus()
  assert.equal(
    initial.statusTimer,
    timer,
    'Superseded checks cannot fork timers',
  )
  advance(IDLE_ROOM_TIMEOUT_MS - 1)
  assert.equal(initial.destroyed, false)
  advance(1)
  assert.equal(initial.destroyed, true)
  assert.equal(initial.statusTimer, null)

  // A departure between checks expires on the first later check, not early.
  const cadence = room()
  const watcher = socket(cadence)
  cadence.connect({ client: watcher })
  const created = now
  advance(12_345)
  cadence.disconnect(watcher)
  const deadline = now + IDLE_ROOM_TIMEOUT_MS
  advance(IDLE_ROOM_TIMEOUT_MS)
  assert.equal(now, deadline)
  assert.equal(cadence.destroyed, false)
  const nextCheck = created + 6 * 60_000
  advance(nextCheck - now - 1)
  assert.equal(cadence.destroyed, false)
  advance(1)
  assert.equal(cadence.destroyed, true)
  assert.equal(watcher.readyState, WebSocket.OPEN)

  // Recording an incorrectly routed socket cannot refresh initial emptiness.
  const routed = room()
  const routedSince = routed.allDisconnected
  advance(123)
  const wrongRoom = socket(routed)
  wrongRoom.gameKey = 'elsewhere'
  routed.connect({ client: wrongRoom })
  assert.equal(routed.allDisconnected, routedSince)
  routed.destroy()
  assert.equal(wrongRoom.gameKey, 'elsewhere')
  assert.equal(wrongRoom.gameSession, null)

  // Spectators retain activity. An open former socket/offline roster does not.
  const active = room()
  const rider = socket(active)
  const spectator = socket(active)
  active.connect({ client: rider })
  active.connect({ client: spectator })
  active.addPlayer({ id: 'bike', left: 65, right: 68 })
  const proof = active.ownership.register('bike', rider)
  const creatorProof = active.roomOwner.create()
  active.roomOwner.bind(rider)
  advance(IDLE_ROOM_TIMEOUT_MS + 1234)
  active.disconnect(rider)
  assert.equal(active.allDisconnected, null)
  assert.equal(active.arena.players[0].connected, false)
  advance(IDLE_ROOM_TIMEOUT_MS)
  assert.equal(active.destroyed, false)
  const departure = now
  active.disconnect(spectator)
  assert.equal(active.allDisconnected, departure)
  advance(10_000)
  active.disconnect(spectator)
  assert.equal(active.allDisconnected, departure, 'Double leave keeps deadline')
  assert.equal(active.ownership.verify('bike', proof), true)
  assert.equal(active.roomOwner.verify(creatorProof), true)
  assert.equal(active.allDisconnected, departure, 'Discovery is read-only')
  advance(IDLE_ROOM_TIMEOUT_MS - 10_001)
  rider.gameKey = active.key
  active.connect({ client: rider })
  assert.equal(active.allDisconnected, null)
  advance(IDLE_ROOM_TIMEOUT_MS)
  assert.equal(active.destroyed, false)
  active.disconnect(rider)
  const secondDeparture = now
  assert.equal(active.allDisconnected, secondDeparture)
  advance(IDLE_ROOM_TIMEOUT_MS - 1)
  active.checkConnectionStatus()
  assert.equal(active.destroyed, false)
  advance(1)
  active.checkConnectionStatus()
  assert.equal(active.destroyed, true)
  assert.equal(rider.readyState, WebSocket.OPEN)

  // Defensive pruning starts the window when the dead membership is observed.
  const pruned = room()
  const dead = socket(pruned)
  pruned.connect({ client: dead })
  pruned.addPlayer({ id: 'dead', left: 65, right: 68 })
  pruned.ownership.register('dead', dead)
  advance(321)
  dead.readyState = WebSocket.CLOSED
  pruned.pruneClients()
  assert.equal(pruned.allDisconnected, now)
  assert.equal(pruned.ownership.owners.size, 0)
  assert.equal(pruned.arena.players[0].connected, false)
  const observed = now
  advance(200)
  pruned.pruneClients()
  assert.equal(pruned.allDisconnected, observed)
  pruned.destroy()

  // Cancellation/destruction invalidates captured timers AND arena/event hooks.
  for (const phase of ['preparation', 'countdown', 'running']) {
    const game = room()
    const owner = socket(game)
    let events = 0
    let saves = 0
    let errors = 0
    const event = () => events++
    game.connect({
      client: owner,
      ondraw: event,
      onreset: event,
      onfinish: event,
      onstate: event,
      onleave: event,
    })
    game.roomOwner.create()
    game.roomOwner.bind(owner)
    for (const id of ['one', 'two']) {
      game.addPlayer({ id, left: 65, right: 68 })
      game.ownership.register(id, owner)
      owner.handlesById.set(id, owner.nextInputHandle++)
      owner.idsByHandle.set(owner.handlesById.get(id), id)
    }
    const { pending } = game.beginRound(owner, {
      save: () => {
        saves++
        return true
      },
      onError: () => errors++,
    })
    if (phase !== 'preparation') {
      pending.launchCountdown()
    }
    if (phase === 'running') {
      advance(1000)
    }
    assert.equal(game.stage, phase)
    const arena = game.arena
    const hooks = [
      arena.ondraw,
      arena.onreset,
      arena.onfinish,
      game.onstate,
      game.onleave,
    ]
    const captured = [...callbacks.values()]
    const beforeEvents = events
    const beforeSaves = saves
    const handle = owner.nextInputHandle
    assert.equal(game.destroy(), true)
    assert.equal(
      events,
      beforeEvents,
      'Destroy emits no cancellation/room events',
    )
    assert.equal(game.pendingStart, null)
    assert.equal(game.timer, null)
    assert.equal(game.statusTimer, null)
    assert.equal(game.arena, null)
    assert.equal(game.stats, null)
    assert.equal(arena.ondraw, null)
    assert.equal(arena.onreset, null)
    assert.equal(arena.onfinish, null)
    assert.equal(arena.fields, null)
    assert.equal(arena.fieldChanges, null)
    assert.equal(arena.escaped, null)
    assert.deepEqual(arena.explosions, [])
    assert.deepEqual(arena.players, [])
    assert.equal(game.clients.size, 0)
    assert.equal(game.ownership.owners.size, 0)
    assert.equal(game.ownership.verifiers.size, 0)
    assert.equal(game.roomOwner.verifier, null)
    assert.equal(owner.gameKey, null)
    assert.equal(owner.gameSession, null)
    assert.equal(owner.protocolReady, false)
    assert.equal(owner.handlesById.size, 0)
    assert.equal(owner.idsByHandle.size, 0)
    assert.equal(owner.nextInputHandle, handle)
    const remaining = timers.size
    for (const callback of captured) {
      callback()
    }
    for (const hook of hooks) {
      hook?.([])
    }
    pending.launchCountdown()
    assert.equal(game.destroy(), false)
    game.checkConnectionStatus()
    assert.equal(game.disconnect(owner), false)
    assert.equal(events, beforeEvents)
    assert.equal(saves, beforeSaves, 'Stale callbacks cannot persist a launch')
    assert.equal(errors, 0, 'Disposal does not report a late launch error')
    assert.equal(timers.size, remaining, 'Stale callbacks schedule no timers')
  }

  // Owner references outside membership are disposed without closing sockets.
  const detached = room()
  const detachedRider = socket(detached)
  const detachedCreator = socket(detached)
  detached.ownership.register('detached', detachedRider)
  detachedRider.handlesById.set('detached', 2)
  detachedRider.idsByHandle.set(2, 'detached')
  detachedRider.registrationRetries.set('registration', { retained: true })
  detached.roomOwner.create()
  detached.roomOwner.bind(detachedCreator)
  detached.destroy()
  for (const client of [detachedRider, detachedCreator]) {
    assert.equal(client.gameKey, null)
    assert.equal(client.protocolReady, false)
    assert.equal(client.playerIds.size, 0)
    assert.equal(client.handlesById.size, 0)
    assert.equal(client.idsByHandle.size, 0)
    assert.equal(client.registrationRetries.size, 0)
    assert.equal(client.nextInputHandle, 3)
    assert.equal(client.readyState, WebSocket.OPEN)
  }

  // Actual snapshots, cold restore and explicit/session/idle deletion paths.
  const registry = new GameServer()
  const persisted = create(registry)
  assert.ok(savedKeys().includes(persisted.key))
  advance(999)
  const restored = new GameServer()
  rooms.push(...restored.games)
  const cold = restored.getGame(persisted.key)
  assert.equal(cold.allDisconnected, now, 'Cold restore starts a fresh window')
  assert.equal(cold.liveClients.length, 0)
  let changes = 0
  registry.setChangeHandler(() => changes++)
  const capturedRemove = persisted.onDestroy
  assert.equal(registry.destroyGame(persisted.key), true)
  assert.equal(persisted.destroyed, true)
  assert.equal(registry.getGame(persisted.key), undefined)
  assert.ok(!savedKeys().includes(persisted.key))
  assert.equal(changes, 1)
  const bytes = readFileSync(storage.filePath, 'utf8')
  assert.equal(registry.destroyGame(persisted.key), false)
  persisted.destroy()
  assert.equal(readFileSync(storage.filePath, 'utf8'), bytes)
  assert.equal(changes, 1)

  // A queued callback from the old object cannot remove a same-key replacement.
  const replacement = new GameSession({ key: persisted.key, interval: 25 })
  rooms.push(replacement)
  registry.games.push(replacement)
  const replacementSocket = socket(replacement)
  replacement.connect({ client: replacementSocket })
  replacementSocket.playerIds.add('shared')
  replacementSocket.handlesById.set('shared', 7)
  replacementSocket.idsByHandle.set(7, 'shared')
  capturedRemove(persisted)
  assert.equal(registry.getGame(persisted.key), replacement)
  assert.equal(replacement.destroyed, false)
  assert.equal(changes, 1)

  // Stale old-room owners must preserve another room's same-ID indexes.
  for (const sameKey of [false, true]) {
    const old = room()
    const current = new GameSession({
      key: sameKey ? old.key : 'other',
      interval: 25,
    })
    rooms.push(current)
    const client = socket(old)
    old.connect({ client })
    old.ownership.register('shared', client)
    client.gameKey = current.key
    current.connect({ client })
    current.ownership.register('shared', client)
    client.handlesById.set('shared', 9)
    client.idsByHandle.set(9, 'shared')
    old.destroy()
    assert.equal(current.isJoined(client), true)
    assert.equal(current.ownership.owns('shared', client), true)
    assert.equal(client.playerIds.has('shared'), true)
    assert.equal(client.handlesById.get('shared'), 9)
    assert.equal(client.idsByHandle.get(9), 'shared')
    current.destroy()
  }
  replacement.destroy()
  registry.games = []
  for (const game of restored.games.slice()) {
    game.destroy()
  }

  // A still-live orphan can be disposed after replacement without a registry
  // write/event, or clearing a socket that has joined the replacement instance.
  const orphan = create(registry)
  const staleChange = orphan.onChange
  const fresh = new GameSession({ key: orphan.key, interval: 25 })
  rooms.push(fresh)
  const moved = socket(orphan)
  orphan.connect({ client: moved })
  orphan.ownership.register('shared', moved)
  registry.games.splice(registry.games.indexOf(orphan), 1, fresh)
  fresh.connect({ client: moved })
  fresh.ownership.register('shared', moved)
  moved.handlesById.set('shared', 12)
  moved.idsByHandle.set(12, 'shared')
  const beforeOrphan = readFileSync(storage.filePath, 'utf8')
  const beforeChanges = changes
  assert.equal(registry.destroyGame(orphan.key, orphan), false)
  orphan.destroy()
  staleChange()
  assert.equal(registry.getGame(fresh.key), fresh)
  assert.equal(fresh.isJoined(moved), true)
  assert.equal(moved.handlesById.get('shared'), 12)
  assert.equal(readFileSync(storage.filePath, 'utf8'), beforeOrphan)
  assert.equal(changes, beforeChanges)
  registry.destroyGame(fresh.key)

  // At capacity, successful removal frees one slot and deletes its disk record.
  for (let i = 0; i < MAX_ACTIVE_GAMES; i++) {
    create(registry)
  }
  assert.equal(registry.createGame({ name: 'Full' }), null)
  const reaped = registry.games[0]
  registry.destroyGame(reaped.key)
  assert.ok(!savedKeys().includes(reaped.key))
  const newGame = create(registry)
  assert.equal(registry.games.length, MAX_ACTIVE_GAMES)
  assert.ok(savedKeys().includes(newGame.key))
  for (const game of registry.games.slice()) {
    game.destroy()
  }

  // Cold-restored rooms receive a full new window and remove their snapshot.
  const beforeRestart = create(registry)
  registry.destroyGame(beforeRestart.key, beforeRestart, { persist: false })
  advance(IDLE_ROOM_TIMEOUT_MS + 17)
  const afterRestart = new GameServer()
  rooms.push(...afterRestart.games)
  const restarted = afterRestart.getGame(beforeRestart.key)
  const freshWindow = now
  assert.equal(restarted.allDisconnected, freshWindow)
  advance(IDLE_ROOM_TIMEOUT_MS - 1)
  assert.equal(afterRestart.getGame(restarted.key), restarted)
  assert.ok(savedKeys().includes(restarted.key))
  advance(1)
  assert.equal(restarted.destroyed, true)
  assert.equal(afterRestart.getGame(restarted.key), undefined)
  assert.ok(!savedKeys().includes(restarted.key))

  // Read-only deletion still disposes memory, retaining bytes for recovery.
  const protectedRoom = create(registry)
  const protectedBytes = readFileSync(storage.filePath, 'utf8')
  storage.readOnly = true
  try {
    assert.equal(registry.destroyGame(protectedRoom.key), true)
    assert.equal(protectedRoom.destroyed, true)
    assert.equal(registry.getGame(protectedRoom.key), undefined)
    assert.equal(readFileSync(storage.filePath, 'utf8'), protectedBytes)
    const recovered = new GameServer()
    rooms.push(...recovered.games)
    assert.ok(recovered.getGame(protectedRoom.key))
    for (const game of recovered.games.slice()) {
      game.destroy()
    }
    assert.equal(readFileSync(storage.filePath, 'utf8'), protectedBytes)
  } finally {
    storage.readOnly = false
  }
  registry.saveToStorage()

  // Failed deletion leaves the old snapshot: no retry/durability claim is made.
  const failed = create(registry)
  const beforeFailure = readFileSync(storage.filePath, 'utf8')
  const tempPath = storage.tempPath
  const diagnostics = []
  const error = console.error
  console.error = (...args) => diagnostics.push(args.join(' '))
  storage.tempPath = dataDir // Writing to a directory fails without changing bytes.
  try {
    assert.equal(registry.destroyGame(failed.key), true)
    assert.equal(failed.destroyed, true)
    assert.equal(registry.games.length, 0)
    assert.equal(readFileSync(storage.filePath, 'utf8'), beforeFailure)
    assert.deepEqual(diagnostics, [
      '[Storage] Error writing atomic games snapshot.',
    ])
    diagnostics.length = 0
    const creator = {}
    const rollbackChanges = changes
    assert.equal(registry.createGame({ creator }), null)
    assert.equal(creator.credentials, null)
    assert.equal(registry.games.length, 0)
    assert.equal(
      changes,
      rollbackChanges,
      'Rollback publishes no transient room',
    )
    assert.equal(
      diagnostics.length,
      1,
      'Rollback does not retry the failed write',
    )
    assert.equal(timers.size, 0, 'Failed creation leaves no room timers')
    storage.readOnly = true
    assert.equal(registry.createGame({}), null)
    assert.equal(readFileSync(storage.filePath, 'utf8'), beforeFailure)
    assert.equal(diagnostics.length, 1, 'Read-only creation does not write')
  } finally {
    storage.readOnly = false
    storage.tempPath = tempPath
    console.error = error
  }
  registry.saveToStorage()
} finally {
  for (const game of rooms) {
    game.destroy()
  }
  Date.now = original.now
  globalThis.setTimeout = original.setTimeout
  globalThis.clearTimeout = original.clearTimeout
  timers.clear()
  callbacks.clear()
}

// Real sockets prove the registry hook purges references held outside a room.
const server = http.createServer()
setupWebSocketServer(server)
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const sockets = []
let requestId = 0
function receive(ws, predicate) {
  const found = ws.messages.findIndex(predicate)
  if (found >= 0) {
    return Promise.resolve(ws.messages.splice(found, 1)[0])
  }
  return new Promise((resolve, reject) => {
    const onMessage = (message) => {
      if (predicate(message)) {
        clearTimeout(timer)
        ws.removeListener('packet', onMessage)
        ws.messages.splice(ws.messages.indexOf(message), 1)
        resolve(message)
      }
    }
    const timer = setTimeout(() => {
      ws.removeListener('packet', onMessage)
      reject(new Error('Cleanup socket response timed out'))
    }, 3000)
    ws.on('packet', onMessage)
  })
}
async function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`)
  sockets.push(ws)
  ws.messages = []
  ws.on('message', (raw, binary) => {
    const message = binary ? { binary } : JSON.parse(raw.toString())
    ws.messages.push(message)
    ws.emit('packet', message)
  })
  await once(ws, 'open')
  await receive(ws, (message) => message.type === MSG_TYPE.LOBBY_LIST)
  return ws
}
async function request(ws, type, payload) {
  const id = `cleanup-${++requestId}`
  ws.send(
    JSON.stringify({
      type,
      payload,
      requestId: id,
      protocolVersion: PROTOCOL_VERSION,
    }),
  )
  return receive(ws, (message) => message.requestId === id)
}
try {
  const client = await connect()
  const stranger = await connect()
  const creation = await request(client, MSG_TYPE.CREATE_GAME, {
    isPublic: false,
  })
  const other = await request(client, MSG_TYPE.CREATE_GAME, { isPublic: false })
  const game = gameServer.getGame(creation.payload.key)
  const target = gameServer.getGame(other.payload.key)
  await request(client, MSG_TYPE.JOIN_GAME, {
    key: game.key,
    roomOwner: creation.payload,
  })
  const serverSocket = game.liveClients[0]
  await request(client, MSG_TYPE.LOBBY_LIST, {
    rooms: [
      { key: game.key, roomOwner: creation.payload },
      { key: target.key, roomOwner: other.payload },
    ],
  })
  assert.equal(serverSocket.lobbyRooms.has(game), true)
  assert.equal(serverSocket.creationRetries.size, 2)
  const staleHooks = [
    game.arena.ondraw,
    game.arena.onreset,
    game.arena.onfinish,
    game.onleave,
    game.onstate,
  ]
  await request(client, MSG_TYPE.JOIN_GAME, { key: target.key })
  const leftAt = game.allDisconnected
  assert.ok(leftAt !== null)
  assert.equal(game.liveClients.length, 0)
  assert.equal(serverSocket.gameSession, target)
  // Switching and credential discovery do not refresh the idle timestamp.
  await request(client, MSG_TYPE.LOBBY_LIST, {
    rooms: [{ key: game.key, roomOwner: creation.payload }],
  })
  assert.equal(game.allDisconnected, leftAt)
  const now = Date.now
  Date.now = () => leftAt + IDLE_ROOM_TIMEOUT_MS
  try {
    game.checkConnectionStatus()
  } finally {
    Date.now = now
  }
  const deletionNotice = await receive(
    client,
    (message) =>
      message.type === MSG_TYPE.LOBBY_LIST &&
      message.missingKeys?.includes(game.key),
  )
  assert.ok(!deletionNotice.payload.some((room) => room.key === game.key))
  assert.equal(gameServer.getGame(game.key), undefined)
  assert.equal(serverSocket.lobbyRooms.has(game), false)
  assert.equal(serverSocket.lobbyRooms.has(target), true)
  assert.equal(serverSocket.creationRetries.size, 2)
  assert.deepEqual(serverSocket.creationRetries.get(creation.requestId), {
    game: null,
  })
  assert.equal(serverSocket.creationRetries.get(other.requestId).game, target)
  const expiredRetry = await new Promise((resolve, reject) => {
    client.send(
      JSON.stringify({
        type: MSG_TYPE.CREATE_GAME,
        payload: { isPublic: false },
        requestId: creation.requestId,
        protocolVersion: PROTOCOL_VERSION,
      }),
    )
    receive(client, (message) => message.requestId === creation.requestId).then(
      resolve,
      reject,
    )
  })
  assert.equal(expiredRetry.code, 'REQUEST_ID_CONFLICT')
  assert.equal(target.isJoined(serverSocket), true)
  assert.ok(!savedKeys().includes(game.key))
  const missing = await request(client, MSG_TYPE.LOBBY_LIST, {
    rooms: [{ key: game.key }],
  })
  assert.ok(missing.missingKeys.includes(game.key))
  assert.ok(!missing.payload.some((room) => room.key === game.key))
  const joinMissing = await request(client, MSG_TYPE.JOIN_GAME, {
    key: game.key,
  })
  assert.equal(joinMissing.code, 'GAME_NOT_FOUND')
  assert.equal(target.isJoined(serverSocket), true)
  await request(stranger, MSG_TYPE.LOBBY_LIST, { rooms: [] })
  assert.equal(
    stranger.messages.some((message) =>
      message.missingKeys?.includes(game.key),
    ),
    false,
  )

  // Captured old callbacks cannot deliver packets into a replacement room.
  const replacement = new GameSession({
    key: game.key,
    interval: 25,
    isPublic: false,
  })
  gameServer.games.push(replacement)
  const oldCredentialDiscovery = await request(client, MSG_TYPE.LOBBY_LIST, {
    rooms: [{ key: replacement.key, roomOwner: creation.payload }],
  })
  assert.ok(
    !oldCredentialDiscovery.payload.some(
      (room) => room.key === replacement.key,
    ),
    'Old private grants cannot reveal a same-key replacement',
  )
  assert.equal(serverSocket.lobbyRooms.has(replacement), false)
  await request(client, MSG_TYPE.JOIN_GAME, { key: replacement.key })
  const registration = await request(client, MSG_TYPE.ADD_PLAYER, {
    id: 'replacement',
    name: 'Replacement',
    left: 65,
    right: 68,
  })
  assert.equal(registration.type, MSG_TYPE.PLAYER_REGISTERED)
  assert.equal(registration.payload.inputHandle, 0)
  assert.equal(serverSocket.registrationRetries.size, 1)
  assert.equal(serverSocket.handlesById.size, 1)

  // The registry hook also clears routing-only sockets absent from clients.
  await request(stranger, MSG_TYPE.JOIN_GAME, { key: target.key })
  const routingOnly = target.liveClients.find(
    (member) => member !== serverSocket,
  )
  assert.ok(routingOnly)
  target.disconnect(routingOnly)
  routingOnly.gameKey = replacement.key
  routingOnly.protocolReady = true
  routingOnly.playerIds.add('stale')
  routingOnly.handlesById.set('stale', 12)
  routingOnly.idsByHandle.set(12, 'stale')
  routingOnly.registrationRetries.set('stale', { retained: true })
  assert.equal(replacement.clients.has(routingOnly), false)
  client.messages.length = 0
  staleHooks[0]?.([[10, 20, 1]])
  for (const hook of staleHooks.slice(1)) {
    hook?.([])
  }
  await request(client, MSG_TYPE.LOBBY_LIST, { rooms: [] })
  assert.equal(
    client.messages.some(
      (message) =>
        message.binary ||
        [
          MSG_TYPE.GAME_INFO,
          MSG_TYPE.GAME_STATE,
          MSG_TYPE.GAME_RESET,
          MSG_TYPE.GAME_FINISH,
        ].includes(message.type),
    ),
    false,
  )
  gameServer.destroyGame(replacement.key)
  assert.equal(serverSocket.gameKey, null)
  assert.equal(serverSocket.gameSession, null)
  assert.equal(serverSocket.protocolReady, false)
  assert.equal(client.readyState, WebSocket.OPEN)
  assert.equal(serverSocket.nextInputHandle, 1)
  for (const affected of [serverSocket, routingOnly]) {
    assert.equal(affected.gameKey, null)
    assert.equal(affected.gameSession, null)
    assert.equal(affected.protocolReady, false)
    assert.equal(affected.playerIds.size, 0)
    assert.equal(affected.handlesById.size, 0)
    assert.equal(affected.idsByHandle.size, 0)
    assert.equal(affected.registrationRetries.size, 0)
    assert.equal(affected.readyState, WebSocket.OPEN)
  }
  const usable = await request(client, MSG_TYPE.CREATE_GAME, { isPublic: true })
  await request(client, MSG_TYPE.JOIN_GAME, { key: usable.payload.key })
  const nextRegistration = await request(client, MSG_TYPE.ADD_PLAYER, {
    id: 'replacement',
    name: 'Replacement',
    left: 65,
    right: 68,
  })
  assert.equal(nextRegistration.type, MSG_TYPE.PLAYER_REGISTERED)
  assert.equal(nextRegistration.payload.inputHandle, 1)
  gameServer.destroyGame(usable.payload.key)
  gameServer.destroyGame(target.key)
  console.log(
    'Room cleanup: controlled expiry, disposal, storage and socket references passed.',
  )
} finally {
  for (const game of gameServer.games.slice()) {
    game.destroy()
  }
  for (const ws of sockets) {
    if (ws.readyState !== WebSocket.CLOSED) {
      const closed = once(ws, 'close')
      ws.terminate()
      await closed
    }
  }
  await new Promise((resolve) => server.close(resolve))
  rmSync(dataDir, { recursive: true, force: true })
}
