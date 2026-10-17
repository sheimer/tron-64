import assert from 'node:assert/strict'
import { fork, execFile } from 'node:child_process'
import { once } from 'node:events'
import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exposeBrowserFixture } from './helpers/browser-client.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = path.join(root, 'test/artifacts/round-authority-flow')
const dataDir = await mkdtemp(path.join(tmpdir(), 'bitcycles-authority-flow-'))
const diagnostics = []
const pages = []
const contexts = []
const children = []
const secrets = new Set()
const redactors = new Set()
let browser
let server
let port
let sequence = 0
let deadline
let step = 'launch Chromium'
const safe = (value) =>
  String(value)
    .replace(/\b[a-f0-9]{64}\b/g, '[private verifier]')
    .replace(/[A-Za-z0-9_-]{43}/g, '[private credential]')

function rememberSecrets(value) {
  if (
    typeof value === 'string' &&
    (/^[A-Za-z0-9_-]{43}$/.test(value) || /^[a-f0-9]{64}$/.test(value))
  )
    secrets.add(value)
  else if (value && typeof value === 'object')
    for (const item of Object.values(value)) rememberSecrets(item)
}
function redactArchive(args) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'python3',
      args,
      {
        timeout: 5000,
        killSignal: 'SIGKILL',
        maxBuffer: 64 * 1024,
      },
      (error) => {
        redactors.delete(child)
        if (error) reject(error)
        else resolve()
      },
    )
    redactors.add(child)
  })
}
async function preserveTrace(context, label) {
  const raw = path.join(dataDir, `${label}-raw-trace.zip`)
  const clean = path.join(dataDir, `${label}-clean-trace.zip`)
  const secretFile = path.join(dataDir, `${label}-trace-secrets.json`)
  try {
    await context.tracing.stop({ path: raw })
    await writeFile(secretFile, JSON.stringify([...secrets]), { mode: 0o600 })
    // Python's standard zipfile runs asynchronously with bounded SIGKILL so
    // multiple traces cannot block the overall cleanup deadline. Artifacts
    // receive only a complete sanitized archive after successful redaction.
    await redactArchive([
      '-c',
      `import json, re, sys, zipfile
secrets = [s.encode() for s in json.load(open(sys.argv[3]))]
with zipfile.ZipFile(sys.argv[1]) as source, zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED) as target:
    for info in source.infolist():
        payload = source.read(info.filename)
        for secret in secrets: payload = payload.replace(secret, b'[private credential]')
        payload = re.sub(rb'(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])', b'[private credential]', payload)
        payload = re.sub(rb'\\b[a-f0-9]{64}\\b', b'[private verifier]', payload)
        target.writestr(info.filename, payload)
`,
      raw,
      clean,
      secretFile,
    ])
    await rename(clean, path.join(artifacts, `${label}-trace.zip`))
  } finally {
    await Promise.all(
      [raw, clean, secretFile].map((file) => rm(file, { force: true })),
    )
  }
}
async function startServer() {
  server = fork(path.join(root, 'test/helpers/round-authority-server.js'), {
    cwd: root,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      ROUND_AUTHORITY_PORT: String(port || 0),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  children.push(server)
  for (const stream of [server.stdout, server.stderr])
    stream.on('data', (chunk) => diagnostics.push(safe(chunk)))
  port = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Fixture startup timeout')),
      6000,
    )
    server.once('message', (message) => {
      clearTimeout(timer)
      resolve(message.port)
    })
    server.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    server.once('exit', (code, signal) => {
      clearTimeout(timer)
      reject(new Error(`Fixture exited ${code ?? signal}`))
    })
  })
}
function rpc(command, key, extra = {}) {
  const child = server
  const id = ++sequence
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('message', receive)
      reject(new Error(`Fixture ${command} timeout`))
    }, 5000)
    function receive(message) {
      if (message.id !== id) return
      clearTimeout(timer)
      child.off('message', receive)
      if (message.error) reject(new Error(message.error))
      else resolve(message.result)
    }
    child.on('message', receive)
    child.send({ id, command, key, ...extra })
  })
}
async function waitServer(key, predicate) {
  const end = Date.now() + 7000
  do {
    const current = await rpc('inspect', key)
    if (predicate(current)) return current
    await new Promise((resolve) => setTimeout(resolve, 20))
  } while (Date.now() < end)
  throw new Error(`Server condition timed out at ${step}`)
}
async function stopServer() {
  if (server?.exitCode === null && server.signalCode === null) {
    const stopped = once(server, 'exit')
    server.kill('SIGKILL')
    await stopped
  }
}
async function probe(page) {
  await page.evaluate(() => {
    const { network, MSG_TYPE } = window.browserFixture
    window.authorityProbe = {
      errors: [],
      outbound: [],
      binary: [],
      ready: [],
      hold: false,
    }
    const originalSend = network.socket.send.bind(network.socket)
    network.socket.send = (frame) => {
      if (frame instanceof Uint8Array)
        window.authorityProbe.binary.push([...frame])
      else {
        const message = JSON.parse(frame)
        window.authorityProbe.outbound.push({
          type: message.type,
          payload:
            message.type === MSG_TYPE.SET_INTERVAL
              ? message.payload
              : undefined,
        })
      }
      return originalSend(frame)
    }
    network.on(MSG_TYPE.ERROR, (message, envelope) =>
      window.authorityProbe.errors.push({ message, code: envelope.code }),
    )
    const ready = network.arenaReady.bind(network)
    network.arenaReady = (startId) => {
      window.authorityProbe.ready.push(startId)
      if (!window.authorityProbe.hold) return ready(startId)
    }
  })
}
async function openPage(label, records, directKey) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  })
  contexts.push({ label, context })
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  })
  if (records)
    await context.addInitScript((saved) => {
      if (!sessionStorage.getItem('connectedGames'))
        sessionStorage.setItem('connectedGames', JSON.stringify(saved))
    }, records)
  const page = await context.newPage()
  pages.push({ label, page })
  page.setDefaultTimeout(9000)
  page.on('pageerror', (error) =>
    diagnostics.push(`${label} PAGE ERROR: ${safe(error.stack)}`),
  )
  const response = await page.goto(
    `http://127.0.0.1:${port}/${directKey ? `?room=${directKey}` : ''}`,
  )
  assert.equal(response.status(), 200)
  await exposeBrowserFixture(page)
  await page.waitForFunction(() => window.browserFixture.network.isConnected())
  if (!directKey) await page.locator('#btn-header-enter-lobby').click()
  await probe(page)
  return page
}
async function joined(page, key) {
  await page.waitForFunction((roomKey) => {
    const { app, state } = window.browserFixture
    return (
      app.roomSession.pendingJoin === null &&
      state.roundInfo?.key === roomKey &&
      state.isJoinedRoom()
    )
  }, key)
}
async function explicitJoin(page, key) {
  // The ordinary selection path sets both coordinator and state room identity.
  // Leave first to discover the room, including revoked/private owner proof.
  if (
    await page.evaluate(() =>
      Boolean(window.browserFixture.app.roomSession.currentGameKey),
    )
  )
    await page.locator('#btn-header-lobby').click()
  await page.locator('#lobby').waitFor({ state: 'visible' })
  await page
    .locator('#body-gamelisttable tr')
    .filter({ hasText: key })
    .getByRole('button', { name: 'rejoin' })
    .click()
  await joined(page, key)
}

async function stateOf(page) {
  return page.evaluate(() => {
    const { state, network } = window.browserFixture
    return {
      owner: state.isRoomOwner(),
      ids: [...state.ownedPlayerIds],
      handles: [...network.inputHandles],
      canStart: state.canStartRound(),
      first: state.roundInfo?.firstRoundStarted,
      stage: state.roundInfo?.round.stage,
    }
  })
}
async function forceError(page, type, payload, code) {
  const previous = await page.evaluate(
    () => window.authorityProbe.errors.length,
  )
  await page.evaluate(
    ({ type, payload }) => {
      const { network, MSG_TYPE } = window.browserFixture
      network.send(MSG_TYPE[type], payload)
    },
    { type, payload },
  )
  await page.waitForFunction(
    ({ previous, code }) =>
      window.authorityProbe.errors
        .slice(previous)
        .some((error) => error.code === code),
    { previous, code },
  )
}
async function launch(page, key, selector, activationKey) {
  if (activationKey) await page.keyboard.press(activationKey)
  else await page.locator(selector).click()
  await waitServer(key, (room) => room.info.round.stage === 'countdown')
  const launched = await rpc('tick', key, { milliseconds: 1000 })
  assert.equal(launched.info.running, true)
  assert.equal(launched.physicsTimer, true)
  await page.waitForFunction(
    () => window.browserFixture.state.roundInfo?.round.stage === 'running',
  )
  return launched
}
async function run() {
  // Missing Playwright/Chromium is a required failure even outside CI.
  const { chromium } = await import('playwright')
  browser = await chromium.launch({ headless: true, timeout: 15000 })
  await startServer()
  step = 'zero-bike creator and private saved rejoin'
  const creator = await openPage('creator')
  await creator.locator('#input-create-game').fill('Authority acceptance')
  await creator.locator('#btn-create-game').click()
  await creator.locator('#playersconfig').waitFor({ state: 'visible' })
  const key = await creator.locator('#gameId').textContent()
  await joined(creator, key)
  assert.match(key, /^[a-f0-9]{8}$/)
  assert.equal((await stateOf(creator)).owner, true)
  assert.deepEqual((await stateOf(creator)).ids, [])
  assert.equal(await creator.locator('#btn-init-game').isDisabled(), true)
  assert.match(
    await creator.locator('#room-owner-status').textContent(),
    /you created/i,
  )
  assert.match(
    await creator.locator('#config-start-feedback').textContent(),
    /two|2/i,
  )
  const creatorRecords = await creator.evaluate(() =>
    JSON.parse(sessionStorage.getItem('connectedGames')),
  )
  rememberSecrets(creatorRecords)
  assert.deepEqual(Object.keys(creatorRecords[key].localPlayers), [])
  await rpc('public', key, { value: false })
  await creator.locator('#btn-header-lobby').click()
  await creator.waitForFunction(
    (roomKey) =>
      window.browserFixture.state.gamesList.some(
        (room) => room.key === roomKey && room.isPublic === false,
      ),
    key,
  )
  const savedRow = creator
    .locator('#body-gamelisttable tr')
    .filter({ hasText: key })
  await savedRow.getByRole('button', { name: 'rejoin' }).waitFor()
  assert.match(
    await savedRow.textContent(),
    /Authority acceptance.*private; registration open.*rejoin/i,
  )
  assert.equal((await stateOf(creator)).owner, false)
  assert.equal(
    (await rpc('inspect', key)).creatorBound,
    false,
    'Private lobby discovery must not reclaim creator controls',
  )
  assert.deepEqual(
    await creator.evaluate(() =>
      JSON.parse(sessionStorage.getItem('connectedGames')),
    ),
    creatorRecords,
  )
  await savedRow.getByRole('button', { name: 'rejoin' }).click()
  await joined(creator, key)
  assert.equal((await stateOf(creator)).owner, true)

  const rider = await openPage('shared-keyboard-rider', undefined, key)
  const spectator = await openPage('spectator', undefined, key)
  for (const page of [rider, spectator]) await joined(page, key)
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
  assert.equal(await creator.locator('#btn-init-game').isEnabled(), true)
  assert.equal(await creator.locator('#game-speed').isEnabled(), true)
  for (const page of [rider, spectator]) {
    assert.equal(await page.locator('#btn-init-game').isDisabled(), true)
    assert.equal(await page.locator('#game-speed').isDisabled(), true)
    assert.equal((await stateOf(page)).owner, false)
  }
  const beforeRejected = await rpc('inspect', key)
  for (const page of [rider, spectator])
    await forceError(page, 'START_GAME', undefined, 'CREATOR_REQUIRED')
  assert.deepEqual(
    await rpc('inspect', key),
    beforeRejected,
    'Forced first starts mutate no server state',
  )

  step = 'authoritative speed and rejection rollback'
  await rpc('interval', key, { value: 37 })
  await creator.waitForFunction(
    () => window.browserFixture.state.roundInfo.interval === 37,
  )
  assert.equal(await creator.locator('#game-speed').inputValue(), 'CUSTOM')
  assert.match(await creator.locator('#speed-feedback').textContent(), /37/)
  const pref = await creator.evaluate(
    async () => (await import('/javascripts/settings.js')).settings.speed,
  )
  await creator.locator('#btn-settings').click()
  await creator.locator('#game-speed').selectOption('FAST')
  await waitServer(key, (room) => room.info.interval === 20)
  await creator.waitForFunction(
    () => window.browserFixture.state.roundInfo.interval === 20,
  )
  assert.equal(
    await creator.evaluate(
      async () => (await import('/javascripts/settings.js')).settings.speed,
    ),
    pref,
  )
  await forceError(spectator, 'SET_INTERVAL', 500, 'CREATOR_REQUIRED')
  assert.equal((await rpc('inspect', key)).info.interval, 20)
  await rpc('failWrite', key)
  await creator.locator('#game-speed').selectOption('SLOW')
  await creator.waitForFunction(() =>
    window.authorityProbe.errors.some(
      (error) => error.code === 'PERSISTENCE_FAILED',
    ),
  )
  assert.equal(await creator.locator('#game-speed').inputValue(), 'FAST')
  assert.equal((await rpc('inspect', key)).info.interval, 20)
  assert.equal(
    await creator.evaluate(
      () =>
        window.authorityProbe.outbound.filter(
          (message) =>
            message.type === window.browserFixture.MSG_TYPE.SET_INTERVAL,
        ).length,
    ),
    2,
    'Only two intentional UI mutations; snapshots/rejection never echo',
  )

  step = 'independent creator handover and bike transfer'
  const replacement = await openPage('replacement-creator', creatorRecords, key)
  await joined(replacement, key)
  await creator.waitForFunction(
    () => !window.browserFixture.state.isRoomOwner(),
  )
  assert.deepEqual((await stateOf(replacement)).ids, [])
  assert.equal((await stateOf(replacement)).owner, true)
  const riderRecords = await rider.evaluate(() =>
    JSON.parse(sessionStorage.getItem('connectedGames')),
  )
  const ids = (await stateOf(rider)).ids
  assert.equal(ids.length, 2)
  rememberSecrets(riderRecords)
  const bikeRecipient = await openPage(
    'bike-recipient',
    {
      [key]: {
        localPlayers: { [ids[0]]: riderRecords[key].localPlayers[ids[0]] },
      },
    },
    key,
  )
  await joined(bikeRecipient, key)
  await rider.waitForFunction(
    (id) => !window.browserFixture.state.isLocalPlayer(id),
    ids[0],
  )
  assert.equal((await stateOf(bikeRecipient)).owner, false)
  assert.equal((await stateOf(replacement)).owner, true)
  await explicitJoin(rider, key)
  await bikeRecipient.waitForFunction(
    () => window.browserFixture.network.inputHandles.size === 0,
  )
  assert.equal((await stateOf(rider)).ids.length, 2)
  await bikeRecipient.close()
  // A revoked owner reconnects automatically without reclaiming; explicit proof remains usable.
  await creator.evaluate(() => window.browserFixture.network.socket.close())
  await creator.waitForFunction(
    () =>
      window.browserFixture.network.isConnected() &&
      window.browserFixture.app.roomSession.pendingJoin === null &&
      !window.browserFixture.state.isRoomOwner(),
  )
  assert.equal((await stateOf(replacement)).owner, true)
  await explicitJoin(creator, key)
  await replacement.waitForFunction(
    () => !window.browserFixture.state.isRoomOwner(),
  )
  assert.equal((await stateOf(creator)).owner, true)
  await explicitJoin(replacement, key)
  await creator.waitForFunction(
    () => !window.browserFixture.state.isRoomOwner(),
  )
  await creator.locator('#btn-header-lobby').click()
  await creator.close()
  const afterFormerClose = await waitServer(
    key,
    (room) => room.clients.length === 3,
  )
  assert.equal(afterFormerClose.creatorBound, true)
  assert.equal(
    afterFormerClose.clients.find((client) => client.owner).ids.length,
    0,
  )
  assert.equal((await stateOf(replacement)).owner, true)

  step = 'first cancellation and zero-result committed launch'
  await rider.evaluate(() => {
    window.authorityProbe.hold = true
  })
  await replacement.locator('#btn-init-game').click()
  await waitServer(key, (room) => room.info.round.stage === 'preparation')
  await replacement.waitForFunction(
    () => window.browserFixture.state.matchState === 'start',
  )
  assert.equal(await replacement.locator('#game-speed').isDisabled(), true)
  assert.equal(
    await replacement.evaluate(() => window.authorityProbe.ready.length),
    0,
  )
  await rider.evaluate(() => window.browserFixture.app.leaveCurrentGame())
  await waitServer(key, (room) => room.info.round.stage === 'configuration')
  await replacement.locator('#playersconfig').waitFor({ state: 'visible' })
  assert.equal((await stateOf(replacement)).first, false)
  assert.equal((await rpc('inspect', key)).info.scores.gamecount, 0)
  await explicitJoin(rider, key)
  await rider.evaluate(() => {
    window.authorityProbe.hold = false
  })
  const committed = await launch(replacement, key, '#btn-init-game')
  assert.equal(committed.info.eligiblePlayerCount, 2)
  assert.equal(committed.clients.find((client) => client.owner).ids.length, 0)
  assert.equal(committed.info.firstRoundStarted, true)
  assert.equal(committed.info.scores.gamecount, 0)
  assert.equal(committed.pending, false)
  assert.equal((await stateOf(replacement)).owner, true)
  for (const page of [replacement, spectator]) {
    const unauthorized = await page.evaluate(
      (ids) =>
        ids.map((id) =>
          window.browserFixture.network.changeDir({ id, dir: 'left' }),
        ),
      ids,
    )
    assert.deepEqual(unauthorized, [false, false])
    await page.keyboard.press('b')
    await page.keyboard.press('x')
    assert.deepEqual(
      await page.evaluate(() => window.authorityProbe.binary),
      [],
    )
  }
  assert.deepEqual(
    await rpc('inspect', key),
    committed,
    'Authenticated zero-bike creator and spectator have no bike input authority',
  )

  const persisted = JSON.parse(
    await readFile(path.join(dataDir, 'games.json'), 'utf8'),
  )
  rememberSecrets(persisted)
  assert.equal(persisted.games[0].firstRoundStarted, true)
  assert.equal(persisted.games[0].stats.gamecount, 0)
  assert.deepEqual(persisted.games[0].stats.messages, [])
  for (const page of [replacement, rider, spectator])
    await page.evaluate(() => {
      window.browserFixture.network.maxReconnectAttempts = 0
    })
  // Actual cold death before the first queued physics tick can invent a result.
  await stopServer()
  await rider.waitForFunction(
    () => !window.browserFixture.network.isConnected(),
  )
  await startServer()
  const restored = await rpc('inspect', key)
  assert.equal(restored.info.firstRoundStarted, true)
  assert.equal(restored.info.running, false)
  assert.deepEqual(restored.info.round, { stage: 'finished', startId: null })
  assert.equal(restored.acceptingPlayers, false)
  assert.equal(restored.info.scores.gamecount, 0)
  assert.deepEqual(restored.info.scores.messages, [])
  for (const name of [
    'pending',
    'physicsTimer',
    'nextTick',
    'gameStarted',
    'creatorBound',
  ])
    assert.equal(restored[name], false)
  assert.equal(restored.owners, 0)
  assert.deepEqual(restored.clients, [])

  step = 'same-origin sessionStorage bike recovery and late spectator entry'
  await rider.reload()
  await exposeBrowserFixture(rider)
  await probe(rider)
  await joined(rider, key)
  assert.deepEqual(new Set((await stateOf(rider)).ids), new Set(ids))
  assert.equal((await stateOf(rider)).owner, false)
  assert.equal((await stateOf(rider)).canStart, true)
  assert.match(
    await rider.locator('#connection-feedback').textContent(),
    /no round completed/i,
  )
  await spectator.reload()
  await exposeBrowserFixture(spectator)
  await probe(spectator)
  await joined(spectator, key)
  assert.deepEqual((await stateOf(spectator)).ids, [])
  assert.equal(await spectator.locator('#btn-start-game').isEnabled(), true)
  assert.equal(await spectator.locator('#game-speed').isDisabled(), true)
  // Recover independent owner-only proof through real retained sessionStorage.
  await replacement.reload()
  await exposeBrowserFixture(replacement)
  await probe(replacement)
  await joined(replacement, key)
  assert.equal((await stateOf(replacement)).owner, true)
  assert.deepEqual((await stateOf(replacement)).handles, [])
  await replacement.locator('#btn-header-lobby').click()
  await waitServer(key, (room) => !room.creatorBound)
  await rpc('public', key, { value: true })
  const late = await openPage('late-new-spectator')
  await late
    .locator('#body-gamelisttable tr')
    .filter({ hasText: key })
    .getByRole('button', { name: 'join' })
    .click()
  await joined(late, key)
  assert.deepEqual((await stateOf(late)).ids, [])
  assert.equal(await late.locator('#btn-start-game').isEnabled(), true)
  assert.equal(await late.locator('#game-speed').isDisabled(), true)

  step =
    'creator-absent spectator launch and actual binary shared keyboard physics'
  await launch(late, key, '#btn-start-game')
  const initial = await rpc('inspect', key)
  assert.equal(initial.creatorBound, false)
  const bound = await stateOf(rider)
  assert.equal(bound.handles.length, 2)
  await rider.keyboard.press('b')
  await rider.keyboard.press('x')
  const turned = await waitServer(
    key,
    (room) =>
      room.bikes[0].move !== initial.bikes[0].move &&
      room.bikes[1].move !== initial.bikes[1].move,
  )
  assert.equal(turned.bikes[0].move, (initial.bikes[0].move + 3) % 4)
  assert.equal(turned.bikes[1].move, (initial.bikes[1].move + 1) % 4)
  const frames = await rider.evaluate(() => window.authorityProbe.binary)
  assert.deepEqual(frames.slice(-2), [
    [2, bound.handles.find(([id]) => id === ids[0])[1], 0],
    [2, bound.handles.find(([id]) => id === ids[1])[1], 1],
  ])
  for (const page of [late, spectator, replacement]) {
    const results = await page.evaluate(
      (ids) =>
        ids.map((id) =>
          window.browserFixture.network.changeDir({ id, dir: 'left' }),
        ),
      ids,
    )
    assert.deepEqual(results, [false, false])
  }
  await rpc('tick', key, { milliseconds: initial.info.interval * 2 })
  const moved = await rpc('inspect', key)
  assert.notDeepEqual(
    moved.bikes.map((bike) => bike.pos),
    initial.bikes.map((bike) => bike.pos),
  )
  await rider.waitForFunction(
    (bikes) =>
      bikes.every(
        (bike, index) =>
          window.browserFixture.app.renderer.fields[bike.pos.x][bike.pos.y] ===
          index,
      ),
    moved.bikes,
  )
  const finished = await rpc('finishPhysics', key)
  assert.equal(finished.info.scores.gamecount, 1)
  await late.waitForFunction(
    () => window.browserFixture.state.matchState === 'finished',
  )
  assert.equal(await late.locator('#btn-start-game').isEnabled(), true)
  assert.equal(await rider.locator('#btn-start-game').isEnabled(), true)
  assert.equal(
    await late.evaluate(() => document.activeElement.id),
    'btn-start-game',
    'Finished scores focus Start for native keyboard activation',
  )
  await late.locator('#btn-header-lobby').focus()
  await late.evaluate(() => window.browserFixture.app.refreshRoomControls())
  assert.equal(
    await late.evaluate(() => document.activeElement.id),
    'btn-header-lobby',
    'Routine permission updates preserve deliberate focus changes',
  )
  await late.locator('#btn-start-game').focus()

  step = 'later cancellation preserves actual scores and ordinary retry'
  await rider.evaluate(() => {
    window.authorityProbe.hold = true
  })
  await late.keyboard.press('Space')
  await waitServer(key, (room) => room.info.round.stage === 'preparation')
  await rider.evaluate(() => window.browserFixture.app.leaveCurrentGame())
  await waitServer(key, (room) => room.info.round.stage === 'finished')
  await late.waitForFunction(
    () => window.browserFixture.state.matchState === 'finished',
  )
  const cancelled = await rpc('inspect', key)
  assert.equal(cancelled.info.scores.gamecount, 1)
  const scores = (value) =>
    value.players.map(({ connected, ...score }) => {
      void connected
      return score
    })
  assert.deepEqual(scores(cancelled.info.scores), scores(finished.info.scores))
  assert.deepEqual(
    cancelled.info.scores.messages,
    finished.info.scores.messages,
  )
  await explicitJoin(rider, key)
  await rider.evaluate(() => {
    window.authorityProbe.hold = false
  })
  assert.equal(
    await rider.evaluate(() => document.activeElement.id),
    'btn-start-game',
    'Rejoining with eligible bikes restores Start focus',
  )
  await launch(rider, key, '#btn-start-game', 'Enter')
  assert.equal(
    diagnostics.some((line) => line.includes('PAGE ERROR:')),
    false,
  )
  console.log(
    'Round authority flow: real independent Chromium contexts, zero-bike creator, shared keyboard/binary physics, independent owner/bike handover, private saved rejoin, initial/later permissions, speed rollback, cancellation and SIGKILL zero-result recovery passed',
  )
}

try {
  await rm(artifacts, { recursive: true, force: true })
  await Promise.race([
    run(),
    new Promise((resolve, reject) => {
      deadline = setTimeout(
        () => reject(new Error('Authority flow exceeded 90 seconds')),
        90000,
      )
    }),
  ])
} catch (error) {
  process.exitCode = 1
  console.error(safe(error.stack))
  await mkdir(artifacts, { recursive: true })
  await writeFile(
    path.join(artifacts, 'diagnostics.log'),
    `Step: ${step}\n${safe(error.stack)}\n${diagnostics.join('\n')}`,
  )
  await Promise.allSettled(
    pages.map(async ({ label, page }) => {
      if (page.isClosed()) return
      await page
        .screenshot({
          path: path.join(artifacts, `${label}.png`),
          fullPage: true,
          timeout: 2000,
        })
        .catch(() => {})
      const state = await Promise.race([
        stateOf(page).catch(() => ({ unavailable: true })),
        new Promise((resolve) =>
          setTimeout(() => resolve({ unavailable: true }), 1000),
        ),
      ])
      await writeFile(
        path.join(artifacts, `${label}-state.json`),
        JSON.stringify(state, null, 2),
      )
    }),
  )
} finally {
  clearTimeout(deadline)
  const cleanupDeadline = setTimeout(() => {
    for (const child of redactors) child.kill('SIGKILL')
    process.exit(1)
  }, 12000)
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit')
      child.kill('SIGKILL')
      await stopped
    }
  const traceResults = await Promise.allSettled(
    contexts.map(async ({ label, context }) => {
      // Raw traces are held only in the private temporary fixture directory.
      if (process.exitCode) await preserveTrace(context, label)
      else await context.tracing.stop()
      await context.close()
    }),
  )
  for (const result of traceResults)
    if (result.status === 'rejected') {
      process.exitCode = 1
      console.error(`Trace preservation failed: ${safe(result.reason)}`)
    }
  if (browser) await browser.close()
  await rm(dataDir, { recursive: true, force: true })
  clearTimeout(cleanupDeadline)
}
