import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = path.join(root, 'test/artifacts/ownership-flow')
const dataDir = await mkdtemp(path.join(tmpdir(), 'bitcycles-ownership-flow-'))
const diagnostics = []
const pages = []
const contexts = []
let browser
let server
let deadline

async function run() {
  // Import/launch failures are required-suite failures, including outside CI.
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
  for (const stream of [server.stdout, server.stderr])
    stream.on('data', (chunk) => diagnostics.push(chunk.toString()))
  const port = await new Promise((resolve, reject) => {
    server.once('message', resolve)
    server.once('error', reject)
    server.once('exit', (code, signal) =>
      reject(new Error(`Ownership server exited: ${code ?? signal}`)),
    )
  })
  const url = `http://127.0.0.1:${port}/`

  async function openPage(label, records) {
    // A fresh context has independent sessionStorage and its own socket.
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    })
    contexts.push(context)
    if (records)
      await context.addInitScript((saved) => {
        sessionStorage.setItem('connectedGames', JSON.stringify(saved))
      }, records)
    const page = await context.newPage()
    pages.push({ label, page })
    page.setDefaultTimeout(10000)
    page.on('pageerror', (error) =>
      diagnostics.push(`${label} PAGE ERROR: ${error.stack}`),
    )
    const response = await page.goto(url)
    assert.equal(response.status(), 200)
    await page.locator('#welcome').waitFor({ state: 'visible' })
    await page.locator('#btn-header-enter-lobby').click()
    await page.locator('#lobby').waitFor({ state: 'visible' })
    await page.waitForFunction(async () => {
      const { network } = await import('/javascripts/network.js')
      return network.isConnected()
    })
    return page
  }

  async function join(page, key) {
    await page
      .locator('#body-gamelisttable tr')
      .filter({ hasText: key })
      .getByRole('button', { name: 'join' })
      .click()
    await page.waitForFunction(async (roomKey) => {
      const { state } = await import('/javascripts/state.js')
      return state.currentGame.key === roomKey && state.players.length === 2
    }, key)
  }

  const owner = await openPage('owner')
  await owner.locator('#input-create-game').fill('Ownership acceptance')
  await owner.locator('#btn-create-game').click()
  await owner.locator('#playersconfig').waitFor({ state: 'visible' })
  const key = await owner.locator('#gameId').textContent()
  assert.match(key, /^[a-f0-9]{8}$/)

  for (const [name, keys] of [
    ['Alice', '66_78'],
    ['Bob', '89_88'],
  ]) {
    await owner.locator('#input-add-player').fill(name)
    await owner.locator('#select-keycodes').selectOption(keys)
    await owner.locator('#btn-add-player').click()
    await owner
      .locator('#body-playerstable')
      .getByText(name, { exact: true })
      .waitFor()
  }
  const registration = await owner.evaluate(async (roomKey) => {
    const { state } = await import('/javascripts/state.js')
    const { network } = await import('/javascripts/network.js')
    return {
      records: JSON.parse(sessionStorage.getItem('connectedGames')),
      ids: [...state.ownedPlayerIds],
      handles: [...network.inputHandles],
      publicIds: state.players.map((player) => player.id),
      roomKey,
    }
  }, key)
  assert.equal(registration.ids.length, 2)
  assert.deepEqual(new Set(registration.ids), new Set(registration.publicIds))
  assert.deepEqual(
    new Set(registration.handles.map(([id]) => id)),
    new Set(registration.ids),
  )
  assert.equal(
    new Set(registration.handles.map(([, handle]) => handle)).size,
    2,
  )
  const [transferredId, retainedId] = registration.ids
  const saved = registration.records[key].localPlayers
  assert.equal(Object.keys(saved).length, 2)
  for (const id of registration.ids)
    assert.match(saved[id].reconnectToken, /^[A-Za-z0-9_-]{43}$/)

  // Exhaustion recovery uses the visible reload action and the ordinary
  // saved-credential rejoin path, without a parallel socket.
  await owner.evaluate(async () => {
    const { network } = await import('/javascripts/network.js')
    const { MSG_TYPE } = await import('/shared/protocol.js')
    network.emit(MSG_TYPE.ERROR, 'Reload the page, then rejoin the room.', {
      code: 'INPUT_HANDLE_EXHAUSTED',
    })
  })
  const reloadButton = owner.locator('#btn-reload-connection')
  await reloadButton.waitFor({ state: 'visible' })
  assert.match(await reloadButton.textContent(), /disconnects players/)
  await Promise.all([owner.waitForEvent('load'), reloadButton.click()])
  await owner.locator('#btn-header-enter-lobby').click()
  await join(owner, key)
  await owner.waitForFunction(async (ids) => {
    const { state } = await import('/javascripts/state.js')
    const { network } = await import('/javascripts/network.js')
    return ids.every(
      (id) => state.isLocalPlayer(id) && network.inputHandles.has(id),
    )
  }, registration.ids)
  const restored = await owner.evaluate(async () => {
    const { network } = await import('/javascripts/network.js')
    return [...network.inputHandles]
  })
  assert.deepEqual(
    new Set(restored.map(([id]) => id)),
    new Set(registration.ids),
  )
  assert.equal(new Set(restored.map(([, handle]) => handle)).size, 2)

  // The spectator knows a public ID and submits a syntactically valid wrong
  // secret. Public roster visibility cannot create an input binding.
  const badRecords = {
    [key]: {
      localPlayers: {
        [transferredId]: {
          ...saved[transferredId],
          reconnectToken: 'A'.repeat(43),
        },
      },
    },
  }
  const spectator = await openPage('spectator', badRecords)
  await join(spectator, key)
  await spectator.locator('#connection-feedback').waitFor({ state: 'visible' })
  assert.match(
    await spectator.locator('#connection-feedback').textContent(),
    /saved player.*could not be restored/i,
  )
  const spectatorState = await spectator.evaluate(async () => {
    const { state } = await import('/javascripts/state.js')
    const { network } = await import('/javascripts/network.js')
    return {
      publicIds: state.players.map((player) => player.id),
      owners: [...state.ownedPlayerIds],
      handles: [...network.inputHandles],
      canSteer: network.changeDir({ id: state.players[0].id, dir: 'left' }),
    }
  })
  assert.deepEqual(new Set(spectatorState.publicIds), new Set(registration.ids))
  assert.deepEqual(spectatorState.owners, [])
  assert.deepEqual(spectatorState.handles, [])
  assert.equal(spectatorState.canSteer, false)

  const secondRecords = {
    [key]: { localPlayers: { [transferredId]: saved[transferredId] } },
  }
  const replacement = await openPage('replacement', secondRecords)
  await join(replacement, key)
  await replacement.waitForFunction(async (id) => {
    const { state } = await import('/javascripts/state.js')
    const { network } = await import('/javascripts/network.js')
    return state.isLocalPlayer(id) && network.inputHandles.has(id)
  }, transferredId)
  await owner.waitForFunction(
    async ([lost, kept]) => {
      const { state } = await import('/javascripts/state.js')
      const { network } = await import('/javascripts/network.js')
      return (
        !state.isLocalPlayer(lost) &&
        !network.inputHandles.has(lost) &&
        state.isLocalPlayer(kept) &&
        network.inputHandles.has(kept)
      )
    },
    [transferredId, retainedId],
  )
  assert.match(
    await owner.locator('#connection-feedback').textContent(),
    /control moved to another connection/i,
  )

  const oldControls = await owner.evaluate(
    async ([lost, kept]) => {
      const { network } = await import('/javascripts/network.js')
      const frames = []
      const original = network.socket.send.bind(network.socket)
      network.socket.send = (frame) => {
        if (frame instanceof Uint8Array) frames.push([...frame])
        return original(frame)
      }
      const rejected = network.changeDir({ id: lost, dir: 'left' })
      const retained = network.changeDir({ id: kept, dir: 'right' })
      return {
        rejected,
        retained,
        frames,
        handle: network.inputHandles.get(kept),
      }
    },
    [transferredId, retainedId],
  )
  assert.equal(oldControls.rejected, false)
  assert.equal(oldControls.retained, true)
  assert.deepEqual(oldControls.frames, [[2, oldControls.handle, 1]])
  const newControls = await replacement.evaluate(async (id) => {
    const { network } = await import('/javascripts/network.js')
    const frames = []
    const original = network.socket.send.bind(network.socket)
    network.socket.send = (frame) => {
      if (frame instanceof Uint8Array) frames.push([...frame])
      return original(frame)
    }
    const result = network.changeDir({ id, dir: 'left' })
    return { result, frames, handle: network.inputHandles.get(id) }
  }, transferredId)
  assert.equal(newControls.result, true)
  assert.deepEqual(newControls.frames, [[2, newControls.handle, 0]])

  // Observe the actual post-leave broadcast rather than sampling an already
  // connected value before the server has processed the former owner's leave.
  await replacement.evaluate(
    async ([lost, kept]) => {
      const { network } = await import('/javascripts/network.js')
      const { MSG_TYPE } = await import('/shared/protocol.js')
      window.afterOwnerLeave = new Promise((resolve) => {
        const unsubscribe = network.on(MSG_TYPE.GAME_INFO, (info) => {
          const first = info.players.find((player) => player.id === lost)
          const second = info.players.find((player) => player.id === kept)
          if (first?.connected && second?.connected === false) {
            unsubscribe()
            resolve({ first, second })
          }
        })
      })
    },
    [transferredId, retainedId],
  )
  await owner.locator('#btn-header-lobby').click()
  await owner.locator('#lobby').waitFor({ state: 'visible' })
  const leaveInfo = await replacement.evaluate(() => window.afterOwnerLeave)
  assert.equal(leaveInfo.first.connected, true)
  assert.equal(leaveInfo.second.connected, false)
  await owner.close()
  const afterClose = await replacement.evaluate(async (id) => {
    const { state } = await import('/javascripts/state.js')
    const { network } = await import('/javascripts/network.js')
    return {
      connected: state.players.find((player) => player.id === id)?.connected,
      owns: state.isLocalPlayer(id),
      handle: network.inputHandles.get(id),
    }
  }, transferredId)
  assert.deepEqual(afterClose, {
    connected: true,
    owns: true,
    handle: newControls.handle,
  })
  assert.equal(
    diagnostics.filter((line) => line.includes('PAGE ERROR:')).length,
    0,
    'No browser context may raise an uncaught exception',
  )
  console.log(
    'Ownership flow: independent contexts, spectator rejection, reload, partial handover, and former-owner leave/close passed',
  )
}

try {
  await rm(artifacts, { recursive: true, force: true })
  await Promise.race([
    run(),
    new Promise((resolve, reject) => {
      deadline = setTimeout(
        () => reject(new Error('Ownership flow exceeded 60 seconds')),
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
  for (const { label, page } of pages) {
    if (page.isClosed()) continue
    await page
      .screenshot({
        path: path.join(artifacts, `${label}.png`),
        fullPage: true,
        timeout: 5000,
      })
      .catch(console.error)
  }
} finally {
  clearTimeout(deadline)
  const cleanupDeadline = setTimeout(() => process.exit(1), 10000)
  if (server && server.exitCode === null && server.signalCode === null) {
    const stopped = once(server, 'exit')
    server.kill('SIGKILL')
    await stopped
  }
  if (browser) await browser.close()
  for (const context of contexts) await context.close()
  await rm(dataDir, { recursive: true, force: true })
  clearTimeout(cleanupDeadline)
}
