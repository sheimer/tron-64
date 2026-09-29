import assert from 'node:assert/strict'
import http from 'node:http'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { MSG_TYPE, PROTOCOL_VERSION } from '../shared/protocol.js'

const here = fileURLToPath(import.meta.url)

async function childServer() {
  const { gameServer } = await import('../server/GameServer.js')
  const { storage } = await import('../server/Storage.js')
  const { setupWebSocketServer } = await import('../server/wsHandler.js')
  const server = http.createServer()
  setupWebSocketServer(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  process.send({ port: server.address().port })
  const originalSave = storage.saveGames.bind(storage)
  process.on('message', ({ id, command, key, enabled }) => {
    let result
    if (command === 'inspect') {
      const game = gameServer.getGame(key)
      result = game
        ? {
            players: game.arena.players.map((player) => ({
              id: player.id,
              connected: player.connected,
            })),
            stats: game.stats,
            acceptingPlayers: game.acceptingPlayers,
            owners: game.ownership.owners.size,
            verifiers: game.ownership.verifiers.size,
            sockets: game.clients.map((socket) => ({
              playerIds: [...socket.playerIds],
              handles: [...socket.handlesById],
              nextInputHandle: socket.nextInputHandle,
              retries: socket.registrationRetries.size,
            })),
          }
        : null
    } else if (command === 'games') {
      result = gameServer.games.map((game) => game.key)
    } else if (command === 'save') {
      result = gameServer.saveToStorage()
    } else if (command === 'failWrites') {
      storage.saveGames = enabled ? () => false : originalSave
      result = true
    } else if (command === 'poisonSerialization') {
      gameServer.getGame(key).stats.messages = enabled ? null : []
      result = true
    } else if (command === 'destroy') {
      const game = gameServer.getGame(key)
      game?.destroy()
      result = !gameServer.getGame(key)
    } else if (command === 'shutdown') {
      process.send({ id, result: true }, () => process.exit(0))
      return
    }
    process.send({ id, result })
  })
}

if (process.argv.includes('--credential-child')) {
  await childServer()
} else {
  await parentTest()
}

async function parentTest() {
  const dirs = []
  const children = []
  const sockets = []
  let request = 0
  const nextId = () => `credential-${++request}`
  const makeDir = () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bitcycles-credentials-'))
    dirs.push(dir)
    return dir
  }
  const snapshot = (dir) => path.join(dir, 'games.json')

  function rpc(child, command, options = {}) {
    const id = nextId()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.off('message', onMessage)
        reject(new Error(`Child command ${command} timed out`))
      }, 3000)
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

  async function start(dir) {
    const child = fork(here, ['--credential-child'], {
      env: { ...process.env, DATA_DIR: dir },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    children.push(child)
    child.output = ''
    child.stdout.on('data', (chunk) => (child.output += chunk.toString()))
    child.stderr.on('data', (chunk) => (child.output += chunk.toString()))
    const message = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Child server timed out')),
        4000,
      )
      child.once('message', (reply) => {
        clearTimeout(timer)
        resolve(reply)
      })
      child.once('error', reject)
    })
    return { child, url: `ws://127.0.0.1:${message.port}/ws` }
  }

  async function stop(child) {
    if (child.exitCode !== null) return
    const exited = once(child, 'exit')
    await rpc(child, 'shutdown')
    await exited
  }

  function receive(ws, predicate) {
    const index = ws.queue.findIndex(predicate)
    if (index >= 0) return Promise.resolve(ws.queue.splice(index, 1)[0])
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: null }
      waiter.timer = setTimeout(() => {
        ws.waiters.splice(ws.waiters.indexOf(waiter), 1)
        reject(new Error('Socket response timed out'))
      }, 3000)
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
      const index = ws.waiters.findIndex((waiter) => waiter.predicate(message))
      if (index >= 0) {
        const [waiter] = ws.waiters.splice(index, 1)
        clearTimeout(waiter.timer)
        waiter.resolve(message)
      } else ws.queue.push(message)
    })
    await once(ws, 'open')
    const lobby = await receive(
      ws,
      (message) => message.type === MSG_TYPE.LOBBY_LIST,
    )
    assert.equal(lobby.protocolVersion, PROTOCOL_VERSION)
    return ws
  }

  function send(ws, type, payload, requestId = nextId()) {
    ws.send(
      JSON.stringify({
        type,
        payload,
        requestId,
        protocolVersion: PROTOCOL_VERSION,
      }),
    )
    return receive(ws, (message) => message.requestId === requestId)
  }

  async function create(ws) {
    ws.send(
      JSON.stringify({
        type: MSG_TYPE.CREATE_GAME,
        payload: { name: 'Credentials', interval: 40, isPublic: true },
        protocolVersion: PROTOCOL_VERSION,
      }),
    )
    return (
      await receive(ws, (message) => message.type === MSG_TYPE.GAME_CREATED)
    ).payload
  }

  async function join(ws, key, reconnect = []) {
    return send(ws, MSG_TYPE.JOIN_GAME, { key, reconnect })
  }

  async function register(ws, id, requestId = nextId()) {
    return send(
      ws,
      MSG_TYPE.ADD_PLAYER,
      {
        id,
        name: `Player ${id}`,
        color: 'water',
        left: 65,
        right: 68,
      },
      requestId,
    )
  }

  const claim = (binding) => ({
    id: binding.id,
    reconnectToken: binding.reconnectToken,
  })

  try {
    const dir = makeDir()
    let { child: running, url } = await start(dir)
    // A missing snapshot loads as an empty registry on the first server start.
    assert.deepEqual(await rpc(running, 'games'), [])
    const owner = await connect(url)
    const key = await create(owner)
    assert.equal((await join(owner, key)).type, MSG_TYPE.JOIN_RESULT)
    const firstReply = await register(owner, 'first')
    const secondReply = await register(owner, 'second')
    assert.equal(firstReply.type, MSG_TYPE.PLAYER_REGISTERED)
    assert.equal(secondReply.type, MSG_TYPE.PLAYER_REGISTERED)
    const first = firstReply.payload
    const second = secondReply.payload
    assert.notEqual(first.reconnectToken, second.reconnectToken)
    const raw = readFileSync(snapshot(dir), 'utf8')
    const parsed = JSON.parse(raw)
    assert.equal(parsed.version, 1)
    assert.equal(parsed.games[0].key, key)
    assert.equal(parsed.games[0].private.verifiers[first.id].length, 64)
    const firstVerifier = parsed.games[0].private.verifiers[first.id]
    assert.equal(raw.includes(first.reconnectToken), false)
    assert.equal(raw.includes(second.reconnectToken), false)
    assert.equal(raw.includes('inputHandle'), false)
    assert.equal(raw.includes('handlesById'), false)
    assert.equal(
      JSON.stringify((await rpc(running, 'inspect', { key })).stats).includes(
        first.reconnectToken,
      ),
      false,
    )

    await rpc(running, 'failWrites', { enabled: true })
    const failedRequest = nextId()
    const failed = await register(owner, 'rolled-back', failedRequest)
    assert.equal(failed.type, MSG_TYPE.ERROR)
    assert.equal(failed.requestId, failedRequest)
    assert.equal(
      owner.history.some(
        (message) =>
          message.type === MSG_TYPE.PLAYER_REGISTERED &&
          message.requestId === failedRequest,
      ),
      false,
    )
    const afterFailure = await rpc(running, 'inspect', { key })
    assert.deepEqual(
      afterFailure.players.map((player) => player.id),
      ['first', 'second'],
    )
    assert.deepEqual(
      afterFailure.stats.players.map((player) => player.id),
      ['first', 'second'],
    )
    assert.equal(afterFailure.owners, 2)
    assert.equal(afterFailure.verifiers, 2)
    assert.equal(afterFailure.acceptingPlayers, true)
    assert.deepEqual(
      afterFailure.sockets[0].handles.map(([id]) => id),
      ['first', 'second'],
    )
    assert.equal(afterFailure.sockets[0].nextInputHandle, 2)
    assert.equal(afterFailure.sockets[0].retries, 2)
    assert.equal(readFileSync(snapshot(dir), 'utf8'), raw)
    await rpc(running, 'failWrites', { enabled: false })
    const retry = await register(owner, 'rolled-back', failedRequest)
    assert.equal(retry.type, MSG_TYPE.PLAYER_REGISTERED)
    const third = retry.payload
    const beforeSerializationFailure = readFileSync(snapshot(dir), 'utf8')
    await rpc(running, 'poisonSerialization', { key, enabled: true })
    const serializationRequest = nextId()
    const serializationFailure = await register(
      owner,
      'serialization-failed',
      serializationRequest,
    )
    assert.equal(serializationFailure.type, MSG_TYPE.ERROR)
    assert.equal(serializationFailure.requestId, serializationRequest)
    const afterSerializationFailure = await rpc(running, 'inspect', { key })
    assert.deepEqual(
      afterSerializationFailure.players.map((player) => player.id),
      ['first', 'second', 'rolled-back'],
    )
    assert.equal(afterSerializationFailure.owners, 3)
    assert.equal(afterSerializationFailure.verifiers, 3)
    assert.equal(afterSerializationFailure.sockets[0].nextInputHandle, 3)
    assert.equal(afterSerializationFailure.sockets[0].retries, 3)
    assert.equal(
      readFileSync(snapshot(dir), 'utf8'),
      beforeSerializationFailure,
    )
    await rpc(running, 'poisonSerialization', { key, enabled: false })
    const publicFrames = JSON.stringify(
      owner.history.filter(
        (message) => message.type !== MSG_TYPE.PLAYER_REGISTERED,
      ),
    )
    assert.equal(publicFrames.includes(first.reconnectToken), false)
    assert.equal(publicFrames.includes(second.reconnectToken), false)
    assert.equal(publicFrames.includes(firstVerifier), false)
    await stop(running)
    assert.equal(
      [first, second, third].some((binding) =>
        running.output.includes(binding.reconnectToken),
      ),
      false,
    )
    assert.equal(running.output.includes(firstVerifier), false)

    ;({ child: running, url } = await start(dir))
    const restored = await rpc(running, 'inspect', { key })
    assert.deepEqual(
      restored.players.map((player) => player.connected),
      [false, false, false],
    )
    assert.deepEqual(
      restored.stats.players.map((player) => player.connected),
      [false, false, false],
    )
    assert.equal(restored.owners, 0)
    assert.equal(restored.verifiers, 3)
    const claimant = await connect(url)
    const wrong = await join(claimant, key, [
      { id: first.id, reconnectToken: second.reconnectToken },
    ])
    assert.deepEqual(wrong.payload.accepted, [])
    assert.equal(wrong.payload.rejected[0].code, 'INVALID_CREDENTIAL')
    const absent = await join(claimant, key)
    assert.deepEqual(absent.payload.accepted, [])
    const accepted = await join(claimant, key, [claim(first), claim(second)])
    assert.deepEqual(
      accepted.payload.accepted.map((binding) => binding.id),
      ['first', 'second'],
    )
    assert.deepEqual(
      accepted.payload.accepted.map((binding) => binding.inputHandle),
      [0, 1],
    )
    const rejoined = await rpc(running, 'inspect', { key })
    assert.deepEqual(
      rejoined.players.map((player) => player.connected),
      [true, true, false],
    )
    assert.deepEqual(
      rejoined.stats.players.map((player) => player.connected),
      [true, true, false],
    )
    assert.equal(rejoined.owners, 2)
    assert.equal(
      JSON.stringify(claimant.history).includes(first.reconnectToken),
      false,
    )
    assert.equal(
      JSON.stringify(claimant.history).includes(firstVerifier),
      false,
    )
    await stop(running)

    const malformed = JSON.parse(readFileSync(snapshot(dir), 'utf8'))
    malformed.games[0].private.verifiers[second.id] = 'bad-verifier'
    delete malformed.games[0].private.verifiers[third.id]
    writeFileSync(snapshot(dir), JSON.stringify(malformed))
    ;({ child: running, url } = await start(dir))
    const afterCorruption = await rpc(running, 'inspect', { key })
    assert.equal(afterCorruption.verifiers, 1)
    const malformedClaimant = await connect(url)
    const mixed = await join(malformedClaimant, key, [
      claim(first),
      claim(second),
      claim(third),
    ])
    assert.deepEqual(
      mixed.payload.accepted.map((binding) => binding.id),
      ['first'],
    )
    assert.deepEqual(
      mixed.payload.rejected.map((binding) => binding.id),
      ['second', 'rolled-back'],
    )
    await stop(running)

    ;({ child: running, url } = await start(dir))
    assert.equal(await rpc(running, 'destroy', { key }), true)
    assert.equal(
      JSON.stringify(JSON.parse(readFileSync(snapshot(dir), 'utf8'))).includes(
        first.id,
      ),
      false,
    )
    const recreated = await connect(url)
    const replacementKey = await create(recreated)
    await join(recreated, replacementKey)
    const replacement = (await register(recreated, first.id)).payload
    assert.notEqual(replacement.reconnectToken, first.reconnectToken)
    const stale = await join(recreated, replacementKey, [claim(first)])
    assert.deepEqual(stale.payload.accepted, [])
    assert.equal(stale.payload.rejected[0].code, 'INVALID_CREDENTIAL')
    await stop(running)

    const legacyDir = makeDir()
    const legacyKey = 'legacy01'
    writeFileSync(
      snapshot(legacyDir),
      JSON.stringify([
        {
          key: legacyKey,
          name: 'Legacy Scores',
          interval: 40,
          isPublic: true,
          createdAt: Date.now(),
          stats: {
            gamecount: 1,
            players: [{ id: 'old', name: 'Old', total: 7 }],
            messages: [],
          },
          private: { verifiers: { old: firstVerifier } },
          players: [
            { id: 'old', name: 'Old', color: 'water', left: 65, right: 68 },
          ],
        },
      ]),
    )
    ;({ child: running, url } = await start(legacyDir))
    const legacy = await rpc(running, 'inspect', { key: legacyKey })
    assert.equal(legacy.players[0].connected, false)
    assert.equal(legacy.stats.players[0].connected, false)
    assert.equal(legacy.stats.players[0].total, 7)
    assert.equal(legacy.verifiers, 0)
    const legacyClaimant = await connect(url)
    const deniedLegacy = await join(legacyClaimant, legacyKey, [
      { id: 'old', reconnectToken: first.reconnectToken },
    ])
    assert.deepEqual(deniedLegacy.payload.accepted, [])
    await stop(running)

    const futureDir = makeDir()
    const futureRaw = JSON.stringify({
      version: 99,
      games: [{ key: 'future', private: { sentinel: first.reconnectToken } }],
    })
    writeFileSync(snapshot(futureDir), futureRaw)
    ;({ child: running, url } = await start(futureDir))
    assert.deepEqual(await rpc(running, 'games'), [])
    assert.equal(await rpc(running, 'save'), false)
    assert.equal(readFileSync(snapshot(futureDir), 'utf8'), futureRaw)
    const futureClient = await connect(url)
    futureClient.send(
      JSON.stringify({
        type: MSG_TYPE.CREATE_GAME,
        payload: { name: 'Blocked Future' },
        protocolVersion: PROTOCOL_VERSION,
      }),
    )
    await receive(
      futureClient,
      (message) =>
        message.type === MSG_TYPE.GAME_CREATED ||
        message.type === MSG_TYPE.ERROR,
    )
    assert.equal(readFileSync(snapshot(futureDir), 'utf8'), futureRaw)
    await stop(running)
    assert.equal(readFileSync(snapshot(futureDir), 'utf8'), futureRaw)
    assert.match(running.output, /version|snapshot|unsupported/i)
    assert.equal(running.output.includes(first.reconnectToken), false)

    // Malformed versioned rooms must not become an empty, writable registry.
    // Each case uses a fresh child to catch startup crashes and unsafe logs.
    const validRecord = {
      key: 'room0001',
      players: [{ id: 'first' }],
      stats: { players: [{ id: 'first' }], messages: [] },
    }
    const malformedRooms = [
      ['null room', null],
      ['missing key', { ...validRecord, key: null }],
      ['null player', { ...validRecord, players: [null] }],
      ['missing stats', { ...validRecord, stats: null }],
      [
        'null message',
        { ...validRecord, stats: { ...validRecord.stats, messages: [null] } },
      ],
    ]
    for (const [description, record] of malformedRooms) {
      const malformedDir = makeDir()
      const malformedRaw = JSON.stringify({
        version: 1,
        games: [record],
        private: { sentinel: first.reconnectToken },
      })
      writeFileSync(snapshot(malformedDir), malformedRaw)
      ;({ child: running, url } = await start(malformedDir))
      assert.deepEqual(await rpc(running, 'games'), [], description)
      assert.equal(await rpc(running, 'save'), false, description)
      assert.equal(
        readFileSync(snapshot(malformedDir), 'utf8'),
        malformedRaw,
        description,
      )
      const malformedClient = await connect(url)
      malformedClient.send(
        JSON.stringify({
          type: MSG_TYPE.CREATE_GAME,
          payload: { name: 'Blocked Malformed' },
          protocolVersion: PROTOCOL_VERSION,
        }),
      )
      const blocked = await receive(
        malformedClient,
        (message) =>
          message.type === MSG_TYPE.GAME_CREATED ||
          message.type === MSG_TYPE.ERROR,
      )
      assert.equal(blocked.type, MSG_TYPE.ERROR, description)
      assert.equal(
        readFileSync(snapshot(malformedDir), 'utf8'),
        malformedRaw,
        description,
      )
      await stop(running)
      assert.equal(
        readFileSync(snapshot(malformedDir), 'utf8'),
        malformedRaw,
        description,
      )
      assert.match(running.output, /invalid|malformed|snapshot/i, description)
      assert.equal(running.output.includes(first.reconnectToken), false)
    }
    console.log(
      'Credential persistence: cold restart, migration, rollback, and verifier isolation passed',
    )
  } finally {
    for (const ws of sockets)
      if (ws.readyState === WebSocket.OPEN) ws.terminate()
    for (const child of children) {
      if (child.exitCode !== null) continue
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
    }
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  }
}
