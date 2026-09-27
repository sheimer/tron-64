import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = path.join(root, 'test/artifacts/browser-smoke')
const dataDir = await mkdtemp(path.join(tmpdir(), 'bitcycles-browser-smoke-'))
const diagnostics = []
let server
let browser
let context
let page
let deadline

async function bounded(operation, milliseconds) {
  let timer
  try {
    return await Promise.race([
      operation,
      new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Diagnostic capture timed out')),
          milliseconds,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function assertFeedbackClearOfNavigation(page, screen) {
  await page.evaluate(() => window.scrollTo(0, 0))
  const geometry = await page.evaluate(() => {
    const rect = (selector) => {
      const bounds = document.querySelector(selector).getBoundingClientRect()
      return {
        top: bounds.top,
        bottom: bounds.bottom,
        left: bounds.left,
        right: bounds.right,
      }
    }
    return {
      feedback: rect('#connection-feedback'),
      header: rect('#head'),
      navigation: rect('#controls'),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }
  })
  const { feedback, header, navigation, viewportWidth, viewportHeight } =
    geometry
  assert.ok(
    feedback.bottom <= Math.min(header.top, navigation.top) + 1,
    `${screen}: feedback must reserve space above the header and navigation: ${JSON.stringify(geometry)}`,
  )
  assert.ok(
    feedback.left >= -1 && feedback.right <= viewportWidth + 1,
    `${screen}: feedback must fit the portrait viewport: ${JSON.stringify(geometry)}`,
  )
  assert.ok(
    feedback.top >= -1 && feedback.bottom <= viewportHeight + 1,
    `${screen}: feedback guidance must appear in the portrait viewport: ${JSON.stringify(geometry)}`,
  )
}

async function smokeTest() {
  // Import and launch errors are failures: this suite must never silently skip.
  const { chromium } = await import('playwright')
  browser = await chromium.launch({ headless: true, timeout: 15000 })
  server = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { server } from './app.js';
       server.listen(0, '127.0.0.1', () => process.send(server.address().port));`,
    ],
    {
      cwd: root,
      env: { ...process.env, DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  )
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', (chunk) => diagnostics.push(chunk.toString()))
  }
  const port = await new Promise((resolve, reject) => {
    server.once('message', resolve)
    server.once('error', reject)
    server.once('exit', (code, signal) => {
      reject(new Error(`Smoke server exited: ${code ?? signal}`))
    })
  })
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  })
  page = await context.newPage()
  page.setDefaultTimeout(10000)
  const pageErrors = []
  page.on('pageerror', (error) => {
    pageErrors.push(error.message)
    diagnostics.push(`PAGE ERROR: ${error.stack}`)
  })
  page.on('console', (message) => {
    diagnostics.push(`BROWSER ${message.type()}: ${message.text()}`)
  })
  const response = await page.goto(`http://127.0.0.1:${port}/`)
  assert.equal(response.status(), 200)
  await page.locator('#welcome').waitFor({ state: 'visible' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(async () => {
    const { network } = await import('/javascripts/network.js')
    const { MSG_TYPE } = await import('/shared/protocol.js')
    network.emit(
      MSG_TYPE.ERROR,
      'Game protocol changed. Reload this page to continue.',
      { code: 'PROTOCOL_MISMATCH' },
    )
  })
  await page.locator('#connection-feedback').waitFor({ state: 'visible' })
  assert.match(
    await page.locator('#connection-feedback').textContent(),
    /reload/i,
  )
  await assertFeedbackClearOfNavigation(page, 'welcome portrait')
  await page.locator('#btn-header-enter-lobby').click()
  await page.locator('#lobby').waitFor({ state: 'visible' })
  await assertFeedbackClearOfNavigation(page, 'lobby portrait')
  await page.locator('#btn-info').click()
  await page.locator('#welcome').waitFor({ state: 'visible' })
  await page.reload()
  await page.locator('#welcome').waitFor({ state: 'visible' })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.locator('#btn-header-enter-lobby').click()
  await page.locator('#lobby').waitFor({ state: 'visible' })
  await page.waitForFunction(async () => {
    const { network } = await import('/javascripts/network.js')
    return network.isConnected()
  })
  await page.locator('#input-create-game').fill('CI smoke room')
  await page.locator('#btn-create-game').click()
  await page.locator('#playersconfig').waitFor({ state: 'visible' })
  assert.equal(await page.locator('#gameName').textContent(), 'CI smoke room')

  for (const [name, keys] of [
    ['Alice', '66_78'],
    ['Bob', '89_88'],
  ]) {
    await page.locator('#input-add-player').fill(name)
    await page.locator('#select-keycodes').selectOption(keys)
    await page.locator('#btn-add-player').click()
    await page
      .locator('#body-playerstable')
      .getByText(name, { exact: true })
      .waitFor()
  }
  assert.equal(await page.locator('#body-playerstable tr').count(), 2)
  const roomKey = await page.locator('#gameId').textContent()
  await page.reload()
  await page.locator('#btn-header-enter-lobby').click()
  await page
    .locator('#body-gamelisttable tr')
    .filter({ hasText: roomKey })
    .getByRole('button', { name: 'join' })
    .click()
  await page.waitForFunction(async () => {
    const { state } = await import('/javascripts/state.js')
    const { network } = await import('/javascripts/network.js')
    return state.ownedPlayerIds.size === 2 && network.inputHandles.size === 2
  })
  await page.evaluate(async () => {
    const { network } = await import('/javascripts/network.js')
    const { MSG_TYPE } = await import('/shared/protocol.js')
    window.smokeMovementFrames = []
    const send = network.socket.send.bind(network.socket)
    network.socket.send = (frame) => {
      if (frame instanceof Uint8Array)
        window.smokeMovementFrames.push(Array.from(frame))
      return send(frame)
    }
    window.smokePlayerDrawReceived = false
    const unsubscribe = network.on(MSG_TYPE.GAME_DRAW, (changes) => {
      let hasPlayerCell = false
      for (let offset = 1; offset + 5 <= changes.byteLength; offset += 5) {
        if (changes.getInt8(offset + 4) >= 0) hasPlayerCell = true
      }
      if (hasPlayerCell) {
        window.smokePlayerDrawReceived = true
        unsubscribe()
      }
    })
  })
  await page.locator('#btn-init-game').click()
  await page.locator('#arena').waitFor({ state: 'visible' })
  await page.waitForFunction(async () => {
    const { state } = await import('/javascripts/state.js')
    return state.screen === 'game' && state.matchState === 'running'
  })
  // A reset can emit player dots before the canvas is cleared. The running
  // announcement also precedes simulation startup by one second, so wait for
  // real interior pixels after that countdown rather than sampling once.
  await page.waitForFunction(() => window.smokePlayerDrawReceived === true)
  const rendered = await page.waitForFunction(
    async () => {
      const { GRID_WIDTH, GRID_HEIGHT } = await import('/shared/constants.js')
      const canvas = document.getElementById('arena')
      const { width, height } = canvas
      if (!width || !height) return false
      const insetX = Math.ceil(width / GRID_WIDTH)
      const insetY = Math.ceil(height / GRID_HEIGHT)
      const pixels = canvas
        .getContext('2d')
        .getImageData(
          insetX,
          insetY,
          width - 2 * insetX,
          height - 2 * insetY,
        ).data
      // Exclude the static border: the interior must contain painted player trails.
      for (let i = 4; i < pixels.length; i += 4) {
        if (
          pixels[i] !== pixels[0] ||
          pixels[i + 1] !== pixels[1] ||
          pixels[i + 2] !== pixels[2]
        )
          return true
      }
      return false
    },
    null,
    { timeout: 10000 },
  )
  assert.equal(
    await rendered.jsonValue(),
    true,
    'Gameplay must paint player trails inside the arena border',
  )
  const restoredHandles = await page.evaluate(async () => {
    const { state } = await import('/javascripts/state.js')
    const { network } = await import('/javascripts/network.js')
    return [66, 89].map((left) => {
      const id = [...network.inputHandles.keys()].find(
        (candidate) => state.getLocalPlayerConfig(candidate)?.left === left,
      )
      return network.inputHandles.get(id)
    })
  })
  assert.ok(restoredHandles.every((handle) => Number.isInteger(handle)))
  assert.notEqual(restoredHandles[0], restoredHandles[1])
  await page.keyboard.press('b')
  await page.keyboard.press('y')
  await page.waitForFunction(() => window.smokeMovementFrames.length >= 2)
  assert.deepEqual(
    (await page.evaluate(() => window.smokeMovementFrames)).slice(-2),
    restoredHandles.map((handle) => [2, handle, 0]),
    'Both restored keyboard players must steer with binary socket handles',
  )
  // A second tab authenticates one of the two saved players. The original
  // tab keeps its other binding, and the transfer cannot mark Alice offline.
  const saved = await page.evaluate((key) => {
    const records = JSON.parse(sessionStorage.getItem('connectedGames'))
    const players = records[key].localPlayers
    const first = Object.keys(players)[0]
    records[key].localPlayers = { [first]: players[first] }
    return { records, first }
  }, roomKey)
  const secondTab = await context.newPage()
  await secondTab.addInitScript((records) => {
    sessionStorage.setItem('connectedGames', JSON.stringify(records))
  }, saved.records)
  await secondTab.goto(page.url())
  await secondTab.locator('#btn-header-enter-lobby').click()
  // Public late-join buttons remain disabled during an active match; invoke
  // the same authenticated coordinator action for this recovery fixture.
  await secondTab.evaluate(async (key) => {
    const { state } = await import('/javascripts/state.js')
    const { app } = await import('/javascripts/main.js')
    state.setCurrentGame(key, 'CI smoke room')
    app.joinGame(key)
  }, roomKey)
  await secondTab.waitForFunction(async (id) => {
    const { state } = await import('/javascripts/state.js')
    const { network } = await import('/javascripts/network.js')
    return state.isLocalPlayer(id) && network.inputHandles.has(id)
  }, saved.first)
  const transferredFrame = await secondTab.evaluate(async (id) => {
    const { network } = await import('/javascripts/network.js')
    const frames = []
    const handle = network.inputHandles.get(id)
    const send = network.socket.send.bind(network.socket)
    network.socket.send = (frame) => {
      if (frame instanceof Uint8Array) frames.push(Array.from(frame))
      return send(frame)
    }
    network.changeDir({ id, dir: 'right' })
    return { frames, handle }
  }, saved.first)
  assert.deepEqual(transferredFrame.frames, [[2, transferredFrame.handle, 1]])
  await page.waitForFunction(async (id) => {
    const { state } = await import('/javascripts/state.js')
    const { network } = await import('/javascripts/network.js')
    return (
      !state.isLocalPlayer(id) &&
      !network.inputHandles.has(id) &&
      state.ownedPlayerIds.size === 1
    )
  }, saved.first)
  const staleFrameCount = await page.evaluate(async (id) => {
    const { network } = await import('/javascripts/network.js')
    const before = window.smokeMovementFrames.length
    return [
      network.changeDir({ id, dir: 'left' }),
      before,
      window.smokeMovementFrames.length,
    ]
  }, saved.first)
  assert.deepEqual(staleFrameCount, [
    false,
    staleFrameCount[1],
    staleFrameCount[1],
  ])
  await page.waitForFunction(async (id) => {
    const { state } = await import('/javascripts/state.js')
    return state.players.find((player) => player.id === id)?.connected === true
  }, saved.first)
  await secondTab.close()
  await page.waitForFunction(async (id) => {
    const { state } = await import('/javascripts/state.js')
    return (
      state.players.find((player) => player.id === id)?.connected === false &&
      state.ownedPlayerIds.size === 1
    )
  }, saved.first)
  assert.deepEqual(pageErrors, [], 'The game must not raise browser exceptions')
  console.log(
    'Browser smoke passed: welcome, lobby, room, two players, running arena.',
  )
}

try {
  await rm(artifacts, { recursive: true, force: true })
  await Promise.race([
    smokeTest(),
    new Promise((resolve, reject) => {
      deadline = setTimeout(
        () => reject(new Error('Browser smoke exceeded 60 seconds')),
        60000,
      )
    }),
  ])
} catch (error) {
  process.exitCode = 1
  console.error(error)
  await mkdir(artifacts, { recursive: true })
  await writeFile(
    path.join(artifacts, 'diagnostics.log'),
    `${error.stack}\n${diagnostics.join('\n')}`,
  )
  if (page)
    await page
      .screenshot({
        path: path.join(artifacts, 'failure.png'),
        fullPage: true,
        timeout: 5000,
      })
      .catch(console.error)
  if (context)
    await bounded(
      context.tracing.stop({ path: path.join(artifacts, 'trace.zip') }),
      5000,
    ).catch(console.error)
} finally {
  clearTimeout(deadline)
  const cleanupDeadline = setTimeout(() => process.exit(1), 10000)
  // Kill the isolated server first: application timers and WebSockets cannot hang teardown.
  if (server && server.exitCode === null && server.signalCode === null) {
    const stopped = once(server, 'exit')
    server.kill('SIGKILL')
    await stopped
  }
  if (browser) await browser.close()
  await rm(dataDir, { recursive: true, force: true })
  clearTimeout(cleanupDeadline)
}
