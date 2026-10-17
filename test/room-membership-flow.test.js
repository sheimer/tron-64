import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IDLE_ROOM_TIMEOUT_MS } from '../shared/constants.js'
import { exposeBrowserFixture } from './helpers/browser-client.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = path.join(root, 'test/artifacts/room-membership-flow')
const dataDir = await mkdtemp(path.join(tmpdir(), 'bitcycles-membership-flow-'))
const contexts = []
const diagnostics = []
let browser
let server
let port
let sequence = 0
let deadline
let step = 'launch Chromium'
const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
const safe = (value) =>
  String(value)
    .replace(/\b[a-f0-9]{64}\b/g, '[private verifier]')
    .replace(/[A-Za-z0-9_-]{43}/g, '[private credential]')

async function startServer() {
  server = fork(path.join(root, 'test/helpers/room-membership-server.js'), {
    cwd: root,
    env: { ...process.env, DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', (chunk) => diagnostics.push(safe(chunk)))
  }
  port = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error('Fixture startup timeout')),
      6000,
    )
    const ready = (message) => {
      if (message.ready && Number.isInteger(message.port)) {
        finish(null, message.port)
      }
    }
    const failed = () => finish(new Error('Fixture exited before startup'))
    function finish(error, value) {
      clearTimeout(timer)
      server.off('message', ready)
      server.off('error', failed)
      server.off('exit', failed)
      if (error) {
        reject(error)
      } else {
        resolve(value)
      }
    }
    server.on('message', ready)
    server.once('error', failed)
    server.once('exit', failed)
  })
}
function rpc(command, key, milliseconds) {
  const id = ++sequence
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error(`Fixture ${command} timeout`)),
      5000,
    )
    const receive = (message) => {
      if (message.id === id) {
        finish(message.error && new Error(message.error), message.result)
      }
    }
    const failed = () => finish(new Error('Fixture disconnected'))
    function finish(error, value) {
      clearTimeout(timer)
      server.off('message', receive)
      server.off('exit', failed)
      server.off('error', failed)
      if (error) {
        reject(error)
      } else {
        resolve(value)
      }
    }
    server.on('message', receive)
    server.once('exit', failed)
    server.once('error', failed)
    server.send({ id, command, key, milliseconds })
  })
}
async function waitServer(key, predicate) {
  const end = Date.now() + 7000
  do {
    const room = await rpc('inspect', key)
    if (predicate(room)) {
      return room
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  } while (Date.now() < end)
  throw new Error(`Server condition timeout at ${step}`)
}
async function openPage(label, key, records) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  })
  contexts.push(context)
  if (records) {
    await context.addInitScript((saved) => {
      sessionStorage.setItem('connectedGames', JSON.stringify(saved))
    }, records)
  }
  const page = await context.newPage()
  page.setDefaultTimeout(9000)
  page.on('pageerror', (error) =>
    diagnostics.push(`${label} PAGE ERROR: ${safe(error.message)}`),
  )
  const response = await page.goto(
    `http://127.0.0.1:${port}/${key ? `?room=${key}` : ''}`,
  )
  assert.equal(response.status(), 200)
  await exposeBrowserFixture(page)
  await page.waitForFunction(() => window.browserFixture.network.protocolReady)
  await page.evaluate(() => {
    const { network, MSG_TYPE } = window.browserFixture
    window.membershipProbe = { room: [], errors: [], missing: [] }
    for (const type of [
      MSG_TYPE.GAME_INFO,
      MSG_TYPE.GAME_STATE,
      MSG_TYPE.GAME_DRAW,
      MSG_TYPE.GAME_RESET,
      MSG_TYPE.GAME_FINISH,
    ]) {
      network.on(type, () => window.membershipProbe.room.push(type))
    }
    network.on(MSG_TYPE.ERROR, (payload, envelope) => {
      window.membershipProbe.errors.push(envelope.code)
    })
    network.on(MSG_TYPE.LOBBY_LIST, (payload, envelope) => {
      window.membershipProbe.missing.push(...(envelope.missingKeys || []))
    })
  })
  if (!key) {
    await page.locator('#btn-header-enter-lobby').click()
  }
  return page
}
async function joined(page, key) {
  await page.waitForFunction((roomKey) => {
    const { app, state } = window.browserFixture
    return (
      app.roomSession.pendingJoin === null &&
      state.isJoinedRoom() &&
      state.roundInfo?.key === roomKey
    )
  }, key)
}
async function recordsOf(page) {
  return page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('connectedGames')),
  )
}
async function viewOf(page) {
  return page.evaluate(() => {
    const { state, network, app } = window.browserFixture
    // Hash the whole actual renderer buffer without recording packet payloads.
    let grid = 0
    for (const column of app.renderer.fields || []) {
      for (const cell of column) {
        grid = (Math.imul(grid, 31) + cell) | 0
      }
    }
    return {
      screen: state.screen,
      key: state.currentGame.key,
      match: state.matchState,
      ids: [...state.ownedPlayerIds].sort(),
      handles: [...network.inputHandles].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
      owner: state.isRoomOwner(),
      connected: network.isConnected(),
      players: state.players,
      scores: state.scores,
      grid,
      layout: document.getElementById('layout').className,
    }
  })
}
async function leave(page) {
  await page.locator('#btn-header-lobby').click()
  await page.locator('#lobby').waitFor({ state: 'visible' })
  assert.equal((await viewOf(page)).connected, true)
}
async function rejoin(page, key) {
  await page
    .locator('#body-gamelisttable tr')
    .filter({ hasText: key })
    .getByRole('button', { name: 'rejoin' })
    .click()
  await joined(page, key)
}
async function transportBarrier(page) {
  // The correlated reply follows all room packets already queued on this socket.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const { network, MSG_TYPE } = window.browserFixture
        const requestId = 'membership-barrier'
        const stop = network.on(MSG_TYPE.LOBBY_LIST, (payload, envelope) => {
          if (envelope.requestId === requestId) {
            stop()
            resolve()
          }
        })
        network.requestLobbyList([], requestId)
      }),
  )
}
async function finished(page, key, gamecount) {
  await page.waitForFunction(
    ({ key, gamecount }) => {
      const { state, app } = window.browserFixture
      return (
        state.roundInfo?.key === key &&
        state.scores.gamecount === gamecount &&
        state.matchState === 'finished' &&
        app.roundLifecycle.scoreTimer === null
      )
    },
    { key, gamecount },
  )
}
async function launch(page, key, selector) {
  await page.locator(selector).click()
  await waitServer(key, (room) => room.info.round.stage === 'countdown')
  const room = await rpc('advance', key, 1000)
  assert.equal(room.info.running, true)
  await page.waitForFunction(
    () => window.browserFixture.state.roundInfo?.round.stage === 'running',
  )
}
function durableScores(info) {
  return {
    ...info.scores,
    players: info.scores.players.map((player) => {
      const score = { ...player }
      // Connection is live state; GameView adds ranking annotations in place.
      // Preserve every other wire score field in the recovery comparison.
      delete score.connected
      delete score._rank
      delete score._rankLabel
      return score
    }),
  }
}
async function savedRoom(key) {
  const snapshot = JSON.parse(
    await readFile(path.join(dataDir, 'games.json'), 'utf8'),
  )
  return snapshot.games.find((room) => room.key === key)
}

async function run() {
  // This journey is required locally and in CI; missing Chromium must fail.
  const { chromium } = await import('playwright')
  browser = await chromium.launch({ headless: true, timeout: 15000 })
  await startServer()
  step = 'zero-bike creator, shared keyboard and spectator membership'
  const creator = await openPage('creator')
  await creator.locator('#input-create-game').fill('Membership acceptance')
  await creator.locator('#btn-create-game').click()
  await creator.locator('#playersconfig').waitFor({ state: 'visible' })
  const key = await creator.locator('#gameId').textContent()
  await joined(creator, key)
  const creatorAlone = await rpc('advance', key, IDLE_ROOM_TIMEOUT_MS)
  assert.equal(creatorAlone.exists, true)
  assert.equal(creatorAlone.emptySince, null)
  assert.equal(creatorAlone.clients.length, 1)
  assert.deepEqual(creatorAlone.clients[0].ids, [])
  assert.equal(creatorAlone.clients[0].owner, true)
  const rider = await openPage('rider', key)
  const spectator = await openPage('spectator', key)
  await joined(rider, key)
  await joined(spectator, key)
  for (const [name, keys] of [
    ['Alice', '66_78'],
    ['Bob', '89_88'],
  ]) {
    await rider.locator('#input-add-player').fill(name)
    await rider.locator('#select-keycodes').selectOption(keys)
    await rider.locator('#btn-add-player').click()
    await rider
      .locator('#body-playerstable')
      .getByText(name, { exact: true })
      .waitFor()
  }
  await creator.waitForFunction(
    () => window.browserFixture.state.roundInfo?.eligiblePlayerCount === 2,
  )
  await rider.waitForFunction(
    () =>
      window.browserFixture.state.ownedPlayerIds.size === 2 &&
      window.browserFixture.network.inputHandles.size === 2,
  )
  const initial = await waitServer(
    key,
    (room) =>
      room.clients.length === 3 &&
      room.clients.some((client) => client.ids.length === 2),
  )
  assert.equal(initial.clients.find((client) => client.owner).ids.length, 0)
  assert.equal(
    initial.clients.filter((client) => client.ids.length === 0).length,
    2,
  )
  const riderBefore = await viewOf(rider)
  assert.equal(riderBefore.ids.length, 2)
  for (const page of [creator, rider, spectator]) {
    for (let repeat = 0; repeat < 3; repeat++) {
      await page.evaluate(() => {
        const { app, state } = window.browserFixture
        app.joinGame(state.currentGame.key)
      })
      // joinGame sets pendingJoin synchronously; only the new correlated private
      // JOIN_RESULT clears it, so this cannot pass on an earlier joined state.
      await joined(page, key)
    }
  }
  assert.deepEqual(
    (await rpc('inspect', key)).clients,
    initial.clients,
    'Repeated joins preserve slots, handles and handle counters',
  )
  assert.deepEqual((await viewOf(rider)).handles, riderBefore.handles)

  step = 'real completed scores, leave and successful direct switch'
  await launch(creator, key, '#btn-init-game')
  const completed = await rpc('finishPhysics', key)
  assert.equal(completed.info.scores.gamecount, 1)
  await Promise.all(
    [creator, rider, spectator].map((page) => finished(page, key, 1)),
  )
  const proofs = digest((await savedRoom(key)).private)
  const riderRecords = await recordsOf(rider)
  const creatorRecords = await recordsOf(creator)
  await leave(rider)
  const target = await rpc('createTarget')
  // Ordinary room-selection coordinator path, without an intervening LEAVE_GAME.
  await creator.evaluate(({ key }) => {
    const { state, app } = window.browserFixture
    state.setCurrentGame(key, 'Other membership room')
    app.joinGame(key)
  }, target)
  await joined(creator, target.key)
  await creator.locator('#playersconfig').waitFor({ state: 'visible' })
  const offline = await waitServer(
    key,
    (room) =>
      room.clients.length === 1 &&
      room.info.players.every((player) => !player.connected),
  )
  assert.equal(offline.clients[0].owner, false)
  assert.deepEqual(offline.clients[0].ids, [])
  assert.equal(
    offline.emptySince,
    null,
    'A joined spectator keeps offline bikes recoverable',
  )
  assert.equal(offline.info.ownerStatus, 'away')
  assert.deepEqual(durableScores(offline.info), durableScores(completed.info))
  assert.deepEqual(
    offline.info.players.map((player) => player.id).sort(),
    riderBefore.ids,
  )
  assert.equal(digest((await recordsOf(rider))[key]), digest(riderRecords[key]))
  assert.equal(
    digest((await recordsOf(creator))[key]),
    digest(creatorRecords[key]),
  )
  await spectator.waitForFunction(() =>
    window.browserFixture.state.players.every((player) => !player.connected),
  )
  assert.match(
    await spectator.locator('#body-scoretable').textContent(),
    /disconnected/i,
  )
  assert.equal((await rpc('advance', key, IDLE_ROOM_TIMEOUT_MS)).exists, true)
  assert.equal((await rpc('inspect', key)).emptySince, null)

  step = 'explicit saved rejoin preserves roster, scores and proof'
  await rejoin(rider, key)
  const recovered = await waitServer(key, (room) =>
    room.info.players.every((player) => player.connected),
  )
  await finished(rider, key, 1)
  const recoveredView = await viewOf(rider)
  assert.deepEqual(recoveredView.ids, riderBefore.ids)
  assert.deepEqual(
    recoveredView.players.map((player) => player.id).sort(),
    riderBefore.ids,
  )
  assert.deepEqual(durableScores(recoveredView), durableScores(completed.info))
  assert.deepEqual(durableScores(recovered.info), durableScores(completed.info))
  assert.equal(digest((await savedRoom(key)).private), proofs)
  const rebound = (await viewOf(rider)).handles
  assert.equal(rebound.length, 2)
  assert.ok(
    rebound.every(
      ([, handle]) =>
        handle > Math.max(...riderBefore.handles.map(([, old]) => old)),
    ),
  )
  await leave(rider)

  step = 'real former-room packets cannot alter lobby or switched screen'
  const replacement = await openPage(
    'saved-bike-recovery',
    key,
    await recordsOf(rider),
  )
  await joined(replacement, key)
  await waitServer(
    key,
    (room) => room.clients.length === 2 && room.info.eligiblePlayerCount === 2,
  )
  // Settle the departure, discovery and replacement join before the barriers.
  for (const page of [rider, creator, spectator]) {
    await transportBarrier(page)
    await page.evaluate(() => {
      window.membershipProbe.room = []
    })
  }
  const lobbyBefore = await viewOf(rider)
  const switchedBefore = await viewOf(creator)
  await launch(spectator, key, '#btn-start-game')
  await rpc('advance', key, 40)
  const next = await rpc('finishPhysics', key)
  assert.equal(next.info.scores.gamecount, 2)
  await finished(spectator, key, 2)
  // A correlated request is a same-socket transport barrier after old-room events.
  for (const page of [rider, creator]) {
    await transportBarrier(page)
    assert.deepEqual(await page.evaluate(() => window.membershipProbe.room), [])
  }
  assert.deepEqual(await viewOf(rider), lobbyBefore)
  assert.deepEqual(await viewOf(creator), switchedBefore)
  const received = await spectator.evaluate(() => {
    const { MSG_TYPE } = window.browserFixture
    return [
      MSG_TYPE.GAME_INFO,
      MSG_TYPE.GAME_STATE,
      MSG_TYPE.GAME_DRAW,
      MSG_TYPE.GAME_RESET,
      MSG_TYPE.GAME_FINISH,
    ].map(
      (type) =>
        window.membershipProbe.room.filter((value) => value === type).length,
    )
  })
  assert.ok(received.slice(0, 3).every((count) => count > 0))
  assert.deepEqual(
    received.slice(3),
    [1, 1],
    'One reset and finish despite repeated spectator joins',
  )

  step = 'empty expiry, checked credential retirement and missing-room join'
  await leave(replacement)
  await leave(spectator)
  const empty = await waitServer(key, (room) => room.clients.length === 0)
  assert.ok(empty.emptySince !== null)
  for (const page of [rider, replacement]) {
    await page.waitForFunction(
      (roomKey) =>
        window.browserFixture.app.lobbySession.verifiedLobbyRecords.has(
          roomKey,
        ),
      key,
    )
    assert.ok((await recordsOf(page))[key])
  }
  assert.equal(
    (await rpc('advance', key, IDLE_ROOM_TIMEOUT_MS - 1)).exists,
    true,
  )
  assert.equal(digest((await savedRoom(key)).private), proofs)
  assert.equal((await rpc('advance', key, 1)).exists, false)
  for (const page of [rider, replacement]) {
    await page.waitForFunction((roomKey) => {
      const { state } = window.browserFixture
      const saved = JSON.parse(sessionStorage.getItem('connectedGames'))
      return (
        !state.gamesList.some((room) => room.key === roomKey) &&
        !state.connectedGames[roomKey] &&
        !saved[roomKey]
      )
    }, key)
    assert.equal(
      await page
        .locator('#body-gamelisttable tr')
        .filter({ hasText: key })
        .count(),
      0,
    )
    assert.equal((await viewOf(page)).connected, true)
    assert.ok(
      await page.evaluate(
        (roomKey) => window.membershipProbe.missing.includes(roomKey),
        key,
      ),
    )
  }
  await spectator.waitForFunction(
    (roomKey) =>
      !window.browserFixture.state.gamesList.some(
        (room) => room.key === roomKey,
      ),
    key,
  )
  assert.equal(
    await spectator
      .locator('#body-gamelisttable tr')
      .filter({ hasText: key })
      .count(),
    0,
  )
  assert.equal(await savedRoom(key), undefined)
  assert.equal((await rpc('inspect', target.key)).clients.length, 1)
  await creator.evaluate((roomKey) => {
    const { network, MSG_TYPE } = window.browserFixture
    network.send(
      MSG_TYPE.JOIN_GAME,
      { key: roomKey },
      { requestId: 'expired-room' },
    )
  }, key)
  await creator.waitForFunction(() =>
    window.membershipProbe.errors.includes('GAME_NOT_FOUND'),
  )
  assert.deepEqual(await viewOf(creator), switchedBefore)
  assert.equal((await rpc('inspect', target.key)).clients.length, 1)
  // A creator proof checked on returning to the lobby retires through the same
  // correlated missing-room path, without requiring a failed rejoin.
  await leave(creator)
  await creator.waitForFunction((roomKey) => {
    const { state } = window.browserFixture
    return (
      !state.connectedGames[roomKey] &&
      !JSON.parse(sessionStorage.getItem('connectedGames'))[roomKey]
    )
  }, key)
  assert.equal(
    diagnostics.some((line) => line.includes('PAGE ERROR:')),
    false,
  )
  console.log(
    'Room membership flow: real independent Chromium contexts, idempotent shared-keyboard joins, zero-bike creator/spectator activity, leave/switch/saved recovery, retained scores/proofs, real packet isolation and deterministic expiry/credential retirement passed',
  )
}

try {
  await rm(artifacts, { recursive: true, force: true })
  await Promise.race([
    run(),
    new Promise((resolve, reject) => {
      deadline = setTimeout(
        () => reject(new Error('Membership flow exceeded 90 seconds')),
        90000,
      )
    }),
  ])
} catch (error) {
  process.exitCode = 1
  console.error(safe(error.stack))
  await mkdir(artifacts, { recursive: true })
  // No traces/private frame archives: only sanitized step/server/page diagnostics.
  await writeFile(
    path.join(artifacts, 'diagnostics.log'),
    `Step: ${step}\n${safe(error.stack)}\n${diagnostics.join('\n')}`,
  )
} finally {
  clearTimeout(deadline)
  const cleanupDeadline = setTimeout(() => process.exit(1), 10000)
  if (server?.exitCode === null && server.signalCode === null) {
    const stopped = once(server, 'exit')
    server.kill('SIGKILL')
    await stopped
  }
  await Promise.allSettled(contexts.map((context) => context.close()))
  await browser?.close()
  await rm(dataDir, { recursive: true, force: true })
  clearTimeout(cleanupDeadline)
}
