import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import {
  BINARY_OPCODE,
  MSG_TYPE,
  PROTOCOL_VERSION,
} from '../shared/protocol.js'

const here = fileURLToPath(import.meta.url)

async function serve() {
  const { gameServer } = await import('../server/GameServer.js')
  const { setupWebSocketServer } = await import('../server/wsHandler.js')
  const server = http.createServer()
  setupWebSocketServer(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  process.send({ port: server.address().port })
  process.on('message', ({ id, command, key }) => {
    const game = gameServer.getGame(key)
    let result
    if (command === 'inspect') {
      result = {
        players: game.arena.players.map((p) => ({
          id: p.id,
          move: p.move,
          connected: p.connected,
        })),
        scores: game.stats.players.map((p) => ({
          id: p.id,
          connected: p.connected,
        })),
        owners: game.ownership.owners.size,
      }
    } else if (command === 'drawAndFinish') {
      game.arena.fieldChanges.push([3, 3, 1])
      game.arena.draw()
      game.arena.finish()
      result = true
    } else if (command === 'shutdown') {
      process.send({ id, result: true }, () => process.exit(0))
      return
    }
    process.send({ id, result })
  })
}

if (process.argv.includes('--ownership-child')) await serve()
else await acceptance()

async function acceptance() {
  const dir = mkdtempSync(path.join(tmpdir(), 'bitcycles-acceptance-'))
  const children = []
  const sockets = []
  const frames = []
  let sequence = 0
  const nextId = () => `accept-${++sequence}`
  const claim = (binding) => ({
    id: binding.id,
    reconnectToken: binding.reconnectToken,
  })

  async function start() {
    const child = fork(here, ['--ownership-child'], {
      env: { ...process.env, DATA_DIR: dir },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    children.push(child)
    child.output = ''
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (data) => (child.output += data.toString()))
    const ready = await Promise.race([
      once(child, 'message').then(([message]) => message),
      once(child, 'exit').then(([code]) => {
        throw new Error(`Server exited before ready: ${code}`)
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Server startup timed out')), 4000),
      ),
    ])
    return { child, url: `ws://127.0.0.1:${ready.port}/ws` }
  }

  function rpc(child, command, key) {
    const id = nextId()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${command} timed out`)),
        3000,
      )
      const onMessage = (message) => {
        if (message.id !== id) return
        clearTimeout(timer)
        child.off('message', onMessage)
        resolve(message.result)
      }
      child.on('message', onMessage)
      child.send({ id, command, key })
    })
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
      const waiter = { predicate, resolve, reject }
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
    ws.on('message', (data, binary) => {
      if (binary) {
        frames.push({ receiver: ws, binary: true, data: Buffer.from(data) })
        return
      }
      const raw = data.toString()
      const message = JSON.parse(raw)
      frames.push({ receiver: ws, binary: false, raw, message })
      const index = ws.waiters.findIndex((waiter) => waiter.predicate(message))
      if (index < 0) ws.queue.push(message)
      else {
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

  function send(ws, type, payload, extra = {}) {
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
    return receive(ws, (m) => m.requestId === requestId)
  }

  async function create(ws) {
    ws.send(
      JSON.stringify({
        type: MSG_TYPE.CREATE_GAME,
        payload: { name: 'Acceptance' },
        protocolVersion: PROTOCOL_VERSION,
      }),
    )
    return (await receive(ws, (m) => m.type === MSG_TYPE.GAME_CREATED)).payload
  }

  async function register(ws, id) {
    const result = await send(ws, MSG_TYPE.ADD_PLAYER, {
      id,
      name: id,
      color: 'water',
      left: 65,
      right: 68,
    })
    assert.equal(result.type, MSG_TYPE.PLAYER_REGISTERED)
    return result.payload
  }

  async function movement(ws, handle, key, id) {
    const before = (await rpc(running, 'inspect', key)).players.find(
      (p) => p.id === id,
    ).move
    ws.send(Buffer.from([BINARY_OPCODE.CHANGE_DIR, handle, 0]))
    await new Promise((resolve) => setTimeout(resolve, 35))
    const after = (await rpc(running, 'inspect', key)).players.find(
      (p) => p.id === id,
    ).move
    return after !== before
  }

  let running
  try {
    let url
    ;({ child: running, url } = await start())
    const old = await connect(url)
    const replacement = await connect(url)
    const spectator = await connect(url)
    const key = await create(old)
    for (const ws of [old, replacement, spectator])
      assert.equal(
        (await send(ws, MSG_TYPE.JOIN_GAME, { key })).type,
        MSG_TYPE.JOIN_RESULT,
      )
    const first = await register(old, 'string-first')
    const second = await register(old, 'string-second')
    assert.notEqual(first.reconnectToken, second.reconnectToken)
    const snapshot = readFileSync(path.join(dir, 'games.json'), 'utf8')
    const privateRecord = JSON.parse(snapshot).games[0].private.verifiers
    const secrets = [first.reconnectToken, second.reconnectToken]
    const verifiers = secrets.map((token) =>
      createHash('sha256').update(token).digest('hex'),
    )
    assert.equal(privateRecord[first.id], verifiers[0])
    assert.equal(privateRecord[second.id], verifiers[1])
    for (const secret of secrets) assert.equal(snapshot.includes(secret), false)

    const idOnly = await send(spectator, MSG_TYPE.JOIN_GAME, {
      key,
      playerIds: [first.id],
    })
    assert.equal(idOnly.type, MSG_TYPE.JOIN_RESULT)
    assert.deepEqual(idOnly.payload.accepted, [])
    assert.equal((await rpc(running, 'inspect', key)).owners, 2)
    assert.equal(
      await movement(spectator, first.inputHandle, key, first.id),
      false,
    )
    assert.equal(await movement(old, first.inputHandle, key, first.id), true)
    const transferred = await send(replacement, MSG_TYPE.JOIN_GAME, {
      key,
      reconnect: [
        claim(first),
        { id: second.id, reconnectToken: first.reconnectToken },
      ],
    })
    assert.deepEqual(
      transferred.payload.accepted.map((b) => b.id),
      [first.id],
    )
    assert.deepEqual(
      transferred.payload.rejected.map((b) => b.id),
      [second.id],
    )
    assert.deepEqual(
      (await receive(old, (m) => m.type === MSG_TYPE.OWNERSHIP_REVOKED)).payload
        .ids,
      [first.id],
    )
    assert.equal(await movement(old, first.inputHandle, key, first.id), false)
    assert.equal(
      await movement(
        replacement,
        transferred.payload.accepted[0].inputHandle,
        key,
        first.id,
      ),
      true,
    )
    assert.equal(await movement(old, second.inputHandle, key, second.id), true)
    old.send(
      JSON.stringify({
        type: MSG_TYPE.LEAVE_GAME,
        protocolVersion: PROTOCOL_VERSION,
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 35))
    old.close()
    await once(old, 'close')
    assert.equal(
      (await rpc(running, 'inspect', key)).players.find(
        (p) => p.id === first.id,
      ).connected,
      true,
    )
    assert.equal(
      await movement(
        replacement,
        transferred.payload.accepted[0].inputHandle,
        key,
        first.id,
      ),
      true,
    )

    const beforeStale = await rpc(running, 'inspect', key)
    const stale = await send(spectator, 'CHANGE_DIR', {
      id: first.id,
      dir: 'left',
    })
    assert.equal(stale.code, 'UNKNOWN_MESSAGE_TYPE')
    const mismatched = await send(spectator, MSG_TYPE.PING, null, {
      protocolVersion: PROTOCOL_VERSION - 1,
    })
    assert.equal(mismatched.code, 'PROTOCOL_MISMATCH')
    assert.match(mismatched.payload, /reload/i)
    assert.deepEqual(await rpc(running, 'inspect', key), beforeStale)
    spectator.send(
      JSON.stringify({
        type: MSG_TYPE.PING,
        t: 123,
        protocolVersion: PROTOCOL_VERSION,
      }),
    )
    await receive(spectator, (m) => m.type === MSG_TYPE.PONG)
    replacement.send(
      JSON.stringify({
        type: MSG_TYPE.START_GAME,
        protocolVersion: PROTOCOL_VERSION,
      }),
    )
    await receive(replacement, (m) => m.type === MSG_TYPE.GAME_RESET)
    for (const ws of [replacement, spectator])
      ws.send(
        JSON.stringify({
          type: MSG_TYPE.ARENA_READY,
          protocolVersion: PROTOCOL_VERSION,
        }),
      )
    await receive(replacement, (m) => m.type === MSG_TYPE.GAME_STATE)
    assert.equal(await rpc(running, 'drawAndFinish', key), true)
    await receive(replacement, (m) => m.type === MSG_TYPE.GAME_FINISH)
    assert.ok(frames.some((f) => f.binary && f.data[0] === BINARY_OPCODE.DRAW))
    await stop(running)

    ;({ child: running, url } = await start())
    const restored = await rpc(running, 'inspect', key)
    assert.deepEqual(
      restored.players.map((p) => p.connected),
      [false, false],
    )
    assert.deepEqual(
      restored.scores.map((p) => p.connected),
      [false, false],
    )
    assert.equal(restored.owners, 0)
    const fresh = await connect(url)
    const restoredClaim = await send(fresh, MSG_TYPE.JOIN_GAME, {
      key,
      reconnect: [claim(first), claim(second)],
    })
    assert.deepEqual(
      restoredClaim.payload.accepted.map((b) => b.id),
      [first.id, second.id],
    )
    assert.equal(
      await movement(
        fresh,
        restoredClaim.payload.accepted[0].inputHandle,
        key,
        first.id,
      ),
      true,
    )
    assert.equal(
      await movement(
        fresh,
        restoredClaim.payload.accepted[1].inputHandle,
        key,
        second.id,
      ),
      true,
    )
    await stop(running)

    const types = new Set(
      frames.filter((f) => !f.binary).map((f) => f.message.type),
    )
    assert.deepEqual(
      [...types].sort(),
      [
        MSG_TYPE.ERROR,
        MSG_TYPE.GAME_CREATED,
        MSG_TYPE.GAME_FINISH,
        MSG_TYPE.GAME_INFO,
        MSG_TYPE.GAME_RESET,
        MSG_TYPE.GAME_STATE,
        MSG_TYPE.JOIN_RESULT,
        MSG_TYPE.LOBBY_LIST,
        MSG_TYPE.OWNERSHIP_REVOKED,
        MSG_TYPE.PLAYER_REGISTERED,
        MSG_TYPE.PONG,
      ].sort(),
    )
    for (const frame of frames) {
      if (frame.binary) {
        for (const secret of [...secrets, ...verifiers])
          assert.equal(frame.data.includes(Buffer.from(secret)), false)
        continue
      }
      for (const verifier of verifiers)
        assert.equal(frame.raw.includes(verifier), false, frame.message.type)
      if (frame.message.type === MSG_TYPE.PLAYER_REGISTERED) {
        assert.equal(frame.receiver, old)
        assert.equal(
          frame.raw.includes(frame.message.payload.reconnectToken),
          true,
        )
        for (const secret of secrets)
          assert.equal(
            frame.raw.includes(secret),
            frame.message.payload.reconnectToken === secret,
          )
      } else {
        for (const secret of secrets)
          assert.equal(frame.raw.includes(secret), false, frame.message.type)
      }
    }
    for (const child of children)
      for (const secret of [...secrets, ...verifiers])
        assert.equal(child.output.includes(secret), false)
    console.log(
      'Ownership acceptance: integrated sockets, restart, outbound secrets passed',
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
    rmSync(dir, { recursive: true, force: true })
  }
}
