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
  await page.evaluate(async () => {
    const { network } = await import('/javascripts/network.js')
    const { MSG_TYPE } = await import('/shared/protocol.js')
    window.smokePlayerDrawReceived = false
    const unsubscribe = network.on(MSG_TYPE.GAME_DRAW, (changes) => {
      let hasPlayerCell = false
      if (changes instanceof DataView) {
        for (let offset = 1; offset + 5 <= changes.byteLength; offset += 5) {
          if (changes.getInt8(offset + 4) >= 0) hasPlayerCell = true
        }
      } else {
        hasPlayerCell = changes.some((cell) => cell[2] >= 0)
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
  // The running announcement precedes simulation startup; require actual player deltas.
  await page.waitForFunction(() => window.smokePlayerDrawReceived === true)
  const rendered = await page.locator('#arena').evaluate(async (canvas) => {
    const { GRID_WIDTH, GRID_HEIGHT } = await import('/shared/constants.js')
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
  })
  assert.ok(
    rendered,
    'Gameplay must paint player trails inside the arena border',
  )
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
