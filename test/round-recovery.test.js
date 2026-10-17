import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mock } from 'node:test'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { MSG_TYPE, PROTOCOL_VERSION } from '../shared/protocol.js'

const here = fileURLToPath(import.meta.url)

async function serve() {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  const { gameServer } = await import('../server/GameServer.js')
  const { setupWebSocketServer } = await import('../server/wsHandler.js')
  const server = http.createServer()
  setupWebSocketServer(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  process.send({ port: server.address().port })
  process.on('message', ({ id, command, key, milliseconds }) => {
    const game = gameServer.getGame(key)
    let result
    if (command === 'inspect') {
      result = {
        info: gameServer.getGameInfo(key),
        acceptingPlayers: game.acceptingPlayers,
        pending: Boolean(game.pendingStart),
        physicsTimer: Boolean(game.timer),
        owners: game.ownership.owners.size,
        creatorBound: Boolean(game.roomOwner.socket),
        clients: game.liveClients.map((client) => ({
          ids: [...client.playerIds],
          handles: [...client.handlesById],
          owner: game.roomOwner.owns(client),
        })),
      }
    } else if (command === 'tick') {
      // Advance exactly to launch, leaving the first real physics tick queued.
      // The process crashes before a collision can manufacture completed scores.
      mock.timers.tick(milliseconds)
      result = true
    } else if (command === 'shutdown') {
      process.send({ id, result: true }, () => process.exit(0))
      return
    }
    process.send({ id, result })
  })
}

if (process.argv.includes('--recovery-child')) {
  await serve()
} else {
  await verify()
}

async function verify() {
  const dirs = []
  const children = []
  const sockets = []
  const previousDataDir = process.env.DATA_DIR
  const makeDir = () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bitcycles-round-recovery-'))
    dirs.push(dir)
    return dir
  }
  const initialDir = makeDir()
  process.env.DATA_DIR = initialDir
  const { storage } = await import('../server/Storage.js')
  const { GameServer } = await import('../server/GameServer.js')
  const snapshot = (dir) => path.join(dir, 'games.json')
  let sequence = 0
  const nextId = () => `recovery-${++sequence}`
  const baseRecord = () => ({
    key: '11223344',
    name: 'Recovery matrix',
    interval: 40,
    isPublic: true,
    players: [
      { id: 'one', name: 'One', color: 'water', left: 65, right: 68 },
      { id: 'two', name: 'Two', color: 'rose', left: 70, right: 71 },
    ],
    stats: {
      gamecount: 0,
      players: [
        { id: 'one', name: 'One', total: 17, kills: 3, connected: true },
        { id: 'two', name: 'Two', total: 9, killed: 2, connected: true },
      ],
      messages: [{ text: 'Only an actual historical result' }],
    },
  })
  function restore(records, legacy = false) {
    const dir = makeDir()
    const bytes =
      JSON.stringify(
        legacy ? records : { version: 1, games: records },
        null,
        2,
      ) + '\n'
    writeFileSync(snapshot(dir), bytes)
    Object.assign(storage, {
      dataDir: dir,
      filePath: snapshot(dir),
      tempPath: path.join(dir, 'games.json.tmp'),
      readOnly: false,
      loadError: null,
    })
    return { server: new GameServer(), dir, bytes }
  }
  function dispose(server) {
    for (const game of server.games) {
      game.onDestroy = null
      game.destroy()
    }
  }
  function restoredScores(record) {
    return {
      ...record.stats,
      gamecount: record.stats.gamecount ?? 0,
      players: record.stats.players.map((player) => ({
        ...player,
        connected: false,
      })),
    }
  }
  function assertIdle(server, record, played) {
    const game = server.getGame(record.key)
    const info = server.getGameInfo(record.key)
    assert.equal(storage.readOnly, false)
    assert.equal(game.firstRoundStarted, played)
    assert.equal(game.acceptingPlayers, !played)
    assert.equal(info.started, played)
    assert.equal(info.running, false)
    assert.deepEqual(info.round, {
      stage: played ? 'finished' : 'configuration',
      startId: null,
    })
    assert.deepEqual(game.stats, restoredScores(record))
    assert.equal(game.pendingStart, null)
    assert.equal(game.timer, null)
    assert.equal(game.gameStarted, null)
    assert.equal(game.nextTickTime, null)
    assert.equal(game.ownership.owners.size, 0)
    assert.equal(game.roomOwner.socket, null)
    assert.deepEqual(game.liveClients, [])
    assert.ok(game.arena.players.every((player) => player.connected === false))
    return game
  }
  function rpc(child, command, options = {}) {
    const id = nextId()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.off('message', receive)
        reject(new Error(`Recovery child command ${command} timed out`))
      }, 4000)
      function receive(message) {
        if (message.id !== id) {
          return
        }
        clearTimeout(timer)
        child.off('message', receive)
        resolve(message.result)
      }
      child.on('message', receive)
      child.send({ id, command, ...options })
    })
  }
  async function start(dir) {
    const child = fork(here, ['--recovery-child'], {
      env: { ...process.env, DATA_DIR: dir },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    children.push(child)
    child.output = ''
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => (child.output += chunk.toString()))
    }
    const { port } = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Recovery startup timed out: ${child.output}`)),
        5000,
      )
      child.once('message', (message) => {
        clearTimeout(timer)
        resolve(message)
      })
      child.once('error', reject)
    })
    return { child, url: `ws://127.0.0.1:${port}/ws` }
  }
  function receive(ws, predicate) {
    const index = ws.queue.findIndex(predicate)
    if (index >= 0) {
      return Promise.resolve(ws.queue.splice(index, 1)[0])
    }
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve }
      waiter.timer = setTimeout(() => {
        ws.waiters.splice(ws.waiters.indexOf(waiter), 1)
        reject(new Error('Recovery socket response timed out'))
      }, 4000)
      ws.waiters.push(waiter)
    })
  }
  async function connect(url) {
    const ws = new WebSocket(url)
    sockets.push(ws)
    ws.queue = []
    ws.history = []
    ws.waiters = []
    ws.on('message', (data, binary) => {
      if (binary) {
        return
      }
      const message = JSON.parse(data.toString())
      ws.history.push(message)
      const index = ws.waiters.findIndex((waiter) => waiter.predicate(message))
      if (index < 0) {
        ws.queue.push(message)
      } else {
        const [waiter] = ws.waiters.splice(index, 1)
        clearTimeout(waiter.timer)
        waiter.resolve(message)
      }
    })
    await once(ws, 'open')
    assert.equal(
      (await receive(ws, (m) => m.type === MSG_TYPE.LOBBY_LIST))
        .protocolVersion,
      PROTOCOL_VERSION,
    )
    return ws
  }
  function transmit(ws, type, payload) {
    const requestId = nextId()
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
  function request(ws, type, payload) {
    const id = transmit(ws, type, payload)
    return receive(ws, (m) => m.requestId === id)
  }
  const ownerClaim = ({ ownerClientId, roomOwnerToken }) => ({
    ownerClientId,
    roomOwnerToken,
  })
  const bikeClaim = ({ id, reconnectToken }) => ({ id, reconnectToken })
  async function join(ws, room, reconnect = [], owner = false) {
    const result = await request(ws, MSG_TYPE.JOIN_GAME, {
      key: room.key,
      reconnect,
      ...(owner ? { roomOwner: ownerClaim(room) } : {}),
    })
    assert.equal(result.type, MSG_TYPE.JOIN_RESULT)
    return result.payload
  }
  async function close(ws) {
    const exited = once(ws, 'close')
    ws.close()
    await exited
  }
  async function launch(child, ws, key) {
    transmit(ws, MSG_TYPE.START_GAME)
    await receive(ws, (m) => m.type === MSG_TYPE.GAME_RESET)
    await rpc(child, 'tick', { key, milliseconds: 2000 })
    await rpc(child, 'tick', { key, milliseconds: 1000 })
    const launched = await rpc(child, 'inspect', { key })
    assert.equal(launched.info.running, true)
    assert.equal(launched.physicsTimer, true)
  }
  try {
    // Every valid matrix row is restored through Storage and GameServer. Extra
    // transient fields deliberately challenge the cold-restore boundary.
    for (const marker of [false, true, undefined]) {
      for (const count of [0, undefined, 2, Number.MAX_SAFE_INTEGER]) {
        if (marker === false && count > 0) {
          continue
        }
        const record = baseRecord()
        if (marker !== undefined) {
          record.firstRoundStarted = marker
        }
        if (count === undefined) {
          delete record.stats.gamecount
        } else {
          record.stats.gamecount = count
        }
        Object.assign(record, {
          pendingStart: { startId: 'do-not-restore' },
          startId: 'old',
          timer: 123,
          running: true,
        })
        const { server } = restore([record])
        assertIdle(server, record, marker === true || count > 0)
        dispose(server)
      }
    }
    for (const played of [false, true]) {
      const record = baseRecord()
      record.players = []
      record.stats.players = []
      record.firstRoundStarted = played
      const { server } = restore([record])
      assertIdle(server, record, played)
      dispose(server)
    }
    const invalid = []
    for (const marker of [null, 0, 1, 'true', 'false', {}, []]) {
      const record = baseRecord()
      record.firstRoundStarted = marker
      invalid.push(record)
    }
    for (const marker of [false, true, undefined]) {
      for (const count of [
        -1,
        0.5,
        Number.MAX_SAFE_INTEGER + 1,
        null,
        '0',
        true,
        {},
        [],
      ]) {
        const record = baseRecord()
        if (marker !== undefined) {
          record.firstRoundStarted = marker
        }
        record.stats.gamecount = count
        invalid.push(record)
      }
    }
    const contradictory = baseRecord()
    contradictory.firstRoundStarted = false
    contradictory.stats.gamecount = 1
    invalid.push(contradictory)
    for (const bad of invalid) {
      // A good room before a bad one cannot be partially loaded and then saved.
      const good = {
        ...baseRecord(),
        key: '55667788',
        firstRoundStarted: false,
      }
      for (const records of [[bad], [good, bad], [bad, good]]) {
        const { server, dir, bytes } = restore(records)
        assert.equal(storage.loadError, 'INVALID_SNAPSHOT')
        assert.equal(storage.readOnly, true)
        assert.deepEqual(server.games, [])
        assert.equal(server.saveToStorage(), false)
        assert.equal(
          server.createGame({
            name: 'Must not overwrite',
            interval: 40,
            isPublic: true,
          }),
          null,
        )
        assert.equal(readFileSync(snapshot(dir), 'utf8'), bytes)
      }
    }

    // Credential failure stays per-role: launch history and valid bike proofs
    // survive malformed/missing creator metadata, while no client is elected.
    const ownerToken = 'A'.repeat(43)
    const bikeToken = 'B'.repeat(43)
    const { createHash } = await import('node:crypto')
    const hash = (token) => createHash('sha256').update(token).digest('hex')
    const ownerId = 'a'.repeat(32)
    for (const proof of [
      undefined,
      null,
      {},
      { ownerClientId: ownerId, verifier: 'bad' },
      { ownerClientId: 'bad', verifier: hash(ownerToken) },
    ]) {
      for (const played of [false, true]) {
        const record = baseRecord()
        record.firstRoundStarted = played
        record.private = {
          verifiers: { one: hash(bikeToken) },
          roomOwner: proof,
        }
        const { server } = restore([record])
        const game = assertIdle(server, record, played)
        assert.equal(game.roomOwner.status, 'unrecoverable')
        assert.equal(
          game.roomOwner.verify({
            ownerClientId: ownerId,
            roomOwnerToken: ownerToken,
          }),
          false,
        )
        assert.equal(game.ownership.verify('one', bikeToken), true)
        assert.equal(game.roomOwner.socket, null)
        dispose(server)
      }
    }
    for (const count of [0, 2]) {
      const record = baseRecord()
      record.stats.gamecount = count
      record.private = {
        roomOwner: { ownerClientId: ownerId, verifier: hash(ownerToken) },
        verifiers: { one: hash(bikeToken) },
      }
      const { server } = restore([record], true)
      const game = assertIdle(server, record, count > 0)
      assert.equal(game.roomOwner.status, 'unrecoverable')
      assert.equal(game.ownership.verifiers.size, 0)
      dispose(server)
    }

    const dir = makeDir()
    let { child, url } = await start(dir)
    const creator = await connect(url)
    const created = await request(creator, MSG_TYPE.CREATE_GAME, {
      name: 'Crash recovery',
      interval: 40,
      isPublic: false,
    })
    const room = created.payload
    await join(creator, room, [], true)
    const emptyBytes = readFileSync(snapshot(dir), 'utf8')
    assert.deepEqual(JSON.parse(emptyBytes).games[0].players, [])
    // Actual process death: no close/leave callback or shutdown save can help.
    let exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
    ;({ child, url } = await start(dir))
    let restored = await rpc(child, 'inspect', { key: room.key })
    assert.equal(restored.info.ownerStatus, 'away')
    assert.equal(restored.info.started, false)
    assert.equal(restored.creatorBound, false)
    assert.deepEqual(restored.clients, [])
    const owner = await connect(url)
    const recovered = await join(owner, room, [], true)
    assert.deepEqual(recovered.roomOwner, {
      accepted: true,
      ownerClientId: room.ownerClientId,
    })
    assert.deepEqual(recovered.accepted, [])
    assert.deepEqual(
      (await rpc(child, 'inspect', { key: room.key })).clients[0].handles,
      [],
    )
    const bindings = []
    for (const id of ['one', 'two']) {
      const response = await request(owner, MSG_TYPE.ADD_PLAYER, {
        id,
        name: id,
        color: 'water',
        left: 65,
        right: 68,
      })
      assert.equal(response.type, MSG_TYPE.PLAYER_REGISTERED)
      bindings.push(response.payload)
    }
    const rider = await connect(url)
    await join(rider, room, bindings.map(bikeClaim))
    assert.equal(
      (await rpc(child, 'inspect', { key: room.key })).clients.find(
        (client) => client.owner,
      ).ids.length,
      0,
      'All creator bikes transferred without transferring room authority',
    )
    assert.equal(
      (await request(rider, MSG_TYPE.START_GAME)).code,
      'CREATOR_REQUIRED',
    )
    const replacement = await connect(url)
    await join(replacement, room, [], true)
    await receive(owner, (m) => m.type === MSG_TYPE.ROOM_OWNER_REVOKED)
    await close(owner)
    assert.equal(
      (await rpc(child, 'inspect', { key: room.key })).info.ownerStatus,
      'present',
      'Former owner socket close cannot clear replacement authority',
    )
    await launch(child, replacement, room.key)
    const launched = JSON.parse(readFileSync(snapshot(dir), 'utf8'))
    assert.equal(launched.version, 1)
    assert.equal(launched.games[0].firstRoundStarted, true)
    assert.equal(launched.games[0].stats.gamecount, 0)
    for (const transient of [
      'pendingStart',
      'startId',
      'timer',
      'running',
      'clients',
      'handles',
    ]) {
      assert.equal(Object.hasOwn(launched.games[0], transient), false)
    }
    assert.equal(
      readFileSync(snapshot(dir), 'utf8').includes(room.roomOwnerToken),
      false,
    )
    exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
    ;({ child, url } = await start(dir))
    restored = await rpc(child, 'inspect', { key: room.key })
    assert.equal(restored.info.started, true)
    assert.equal(restored.info.running, false)
    assert.deepEqual(restored.info.round, { stage: 'finished', startId: null })
    assert.equal(restored.acceptingPlayers, false)
    assert.equal(restored.info.scores.gamecount, 0)
    assert.deepEqual(
      restored.info.scores.messages,
      launched.games[0].stats.messages,
    )
    assert.equal(restored.pending, false)
    assert.equal(restored.physicsTimer, false)
    assert.equal(restored.owners, 0)
    assert.equal(restored.creatorBound, false)
    assert.deepEqual(restored.clients, [])
    assert.ok(restored.info.players.every((player) => !player.connected))
    assert.ok(restored.info.scores.players.every((player) => !player.connected))
    const lateRider = await connect(url)
    const lateSpectator = await connect(url)
    assert.equal(
      (await join(lateRider, room, bindings.map(bikeClaim))).accepted.length,
      2,
    )
    await join(lateSpectator, room)
    assert.equal(
      (await request(lateSpectator, MSG_TYPE.SET_INTERVAL, 25)).code,
      'CREATOR_REQUIRED',
    )
    await launch(child, lateSpectator, room.key)
    const later = await rpc(child, 'inspect', { key: room.key })
    assert.equal(later.info.ownerStatus, 'away')
    assert.equal(later.info.scores.gamecount, 0)
    assert.equal(
      lateSpectator.history.some((m) => m.type === MSG_TYPE.GAME_FINISH),
      false,
    )
    // Older version-1 records retain independent bike recovery. Missing or
    // malformed creator proof cannot elect that rider; positive history alone
    // permits a spectator's later start, whereas unstarted rooms fail closed.
    for (const history of [0, 2]) {
      const legacyDir = makeDir()
      const record = structuredClone(launched.games[0])
      delete record.firstRoundStarted
      record.stats.gamecount = history
      record.private.roomOwner =
        history === 0
          ? null
          : { ownerClientId: room.ownerClientId, verifier: 'malformed' }
      writeFileSync(
        snapshot(legacyDir),
        JSON.stringify({ version: 1, games: [record] }),
      )
      const recoveredServer = await start(legacyDir)
      const recoveredRider = await connect(recoveredServer.url)
      const recoveredSpectator = await connect(recoveredServer.url)
      const mixed = await join(
        recoveredRider,
        room,
        bindings.map(bikeClaim),
        true,
      )
      assert.equal(mixed.accepted.length, 2)
      assert.deepEqual(mixed.roomOwner, {
        accepted: false,
        code: 'INVALID_OWNER_CREDENTIAL',
      })
      await join(recoveredSpectator, room)
      const before = await rpc(recoveredServer.child, 'inspect', {
        key: room.key,
      })
      assert.equal(before.info.ownerStatus, 'unrecoverable')
      assert.equal(before.creatorBound, false)
      assert.equal(before.info.eligiblePlayerCount, 2)
      assert.equal(
        (await request(recoveredRider, MSG_TYPE.SET_INTERVAL, 25)).code,
        'CREATOR_REQUIRED',
      )
      if (history === 0) {
        for (const ws of [recoveredRider, recoveredSpectator]) {
          assert.equal(
            (await request(ws, MSG_TYPE.START_GAME)).code,
            'CREATOR_REQUIRED',
          )
        }
        assert.deepEqual(
          await rpc(recoveredServer.child, 'inspect', { key: room.key }),
          before,
        )
        assert.equal(before.acceptingPlayers, true)
      } else {
        assert.equal(before.acceptingPlayers, false)
        await launch(recoveredServer.child, recoveredSpectator, room.key)
        assert.equal(
          (await rpc(recoveredServer.child, 'inspect', { key: room.key })).info
            .scores.gamecount,
          history,
        )
        assert.equal(
          recoveredSpectator.history.some(
            (m) => m.type === MSG_TYPE.GAME_FINISH,
          ),
          false,
        )
      }
    }
    console.log(
      `Round recovery: strict matrix (${invalid.length} invalid variants), snapshot-wide protection, independent proofs, legacy policy and real crash/restart passed`,
    )
  } finally {
    for (const ws of sockets) {
      ws.terminate()
    }
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit')
        child.kill('SIGKILL')
        await exited
      }
    }
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    if (previousDataDir === undefined) {
      delete process.env.DATA_DIR
    } else {
      process.env.DATA_DIR = previousDataDir
    }
  }
}
