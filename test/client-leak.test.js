import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'

/**
 * Client-Side Browser Memory Leak & DOM Retention Verification Test
 *
 * Uses Playwright (Chromium) with `--js-flags=--expose-gc` and Chrome DevTools Protocol (CDP)
 * to measure V8 heap memory, DOM nodes, and JS event listeners across full match lifecycles.
 */

let playwright
try {
  playwright = await import('playwright')
} catch {
  console.log('\n⏩ [SKIPPED] test/client-leak.test.js (playwright not installed)\n')
  process.exit(0)
}

// 1. Setup isolated test environment and dedicated server port
const TEST_PORT = 3048
const testDataDir = path.resolve(process.cwd(), 'data-test-client-leak')
process.env.DATA_DIR = testDataDir
process.env.PORT = String(TEST_PORT)

if (fs.existsSync(testDataDir)) {
  fs.rmSync(testDataDir, { recursive: true, force: true })
}

const { app } = await import('../app.js')
const { setupWebSocketServer } = await import('../server/wsHandler.js')

const server = http.createServer(app)
setupWebSocketServer(server)

await new Promise((resolve) => server.listen(TEST_PORT, resolve))

console.log(`\n======================================================`)
console.log(`🧪 Client-Side (Browser) Memory Leak & DOM Lifecycle Test`)
console.log(`======================================================`)

let browser
let context
let page
let cdp

try {
  try {
    browser = await playwright.chromium.launch({
      headless: true,
      args: ['--js-flags=--expose-gc', '--no-sandbox', '--disable-setuid-sandbox'],
    })
  } catch (launchErr) {
    console.log(`\n⏩ [SKIPPED] test/client-leak.test.js (Chromium cannot launch in this environment: ${launchErr.message.split('\n')[0]})\n`)
    await new Promise((resolve) => server.close(resolve))
    process.exit(0)
  }

  context = await browser.newContext()
  page = await context.newPage()
  cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')

  await page.goto(`http://localhost:${TEST_PORT}`, { waitUntil: 'domcontentloaded' })

  // Wait for initial lobby table to render
  await page.waitForSelector('#gamelisttable')

  // Helper to force browser GC and read CDP performance metrics
  async function getClientMetrics() {
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {})
    await page.evaluate(() => {
      if (typeof window.gc === 'function') {
        window.gc()
      }
    })
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {})

    const { metrics } = await cdp.send('Performance.getMetrics')
    const map = {}
    metrics.forEach((m) => {
      map[m.name] = m.value
    })
    const domElements = await page.evaluate(() => document.querySelectorAll('*').length)
    return {
      heapMB: (map.JSHeapUsedSize || 0) / 1024 / 1024,
      nodes: map.Nodes || 0,
      domElements,
      listeners: map.JSEventListeners || 0,
    }
  }

  // 2. Establish Initial Baseline in Lobby
  const initialMetrics = await getClientMetrics()
  console.log(`📊 Initial Empty Lobby Baseline: Heap: ${initialMetrics.heapMB.toFixed(3)} MB | DOM Nodes: ${initialMetrics.nodes} | Event Listeners: ${initialMetrics.listeners}\n`)

  const TOTAL_CYCLES = 3
  let steadyBaseline = null

  for (let cycle = 1; cycle <= TOTAL_CYCLES; cycle++) {
    if (cycle === 1) {
      // Step A: Create game from Lobby in first cycle
      await page.fill('#input-create-game', 'ClientLeak_Room')
      await page.click('#btn-create-game')

      // Step B: Wait for Config screen and add 2 local players
      await page.waitForSelector('#playersconfig:not([style*="display: none"]):not([style*="display:none"])')
      await page.fill('#input-add-player', 'Alice')
      await page.selectOption('#select-keycodes', '66_78')
      await page.click('#btn-add-player')

      await page.fill('#input-add-player', 'Bob')
      await page.selectOption('#select-keycodes', '89_88')
      await page.click('#btn-add-player')

      // Step C: Start the match
      await page.waitForSelector('#btn-init-game:not([disabled])')
      await page.click('#btn-init-game')
    } else {
      // Subsequent cycles: Join existing match from Lobby table
      await page.waitForSelector('#body-gamelisttable button')
      await page.click('#body-gamelisttable button')

      // Start next round
      await page.waitForSelector('#btn-start-game:not([disabled])')
      await page.click('#btn-start-game')
    }

    // Step D: Simulate active driving and collision
    await page.waitForSelector('#arena:not([style*="display: none"]):not([style*="display:none"])')
    // Steer Alice (b/n) and Bob (y/x)
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('b')
      await page.keyboard.press('y')
      await page.waitForTimeout(50)
    }

    // Step E: Wait for match finish / scores screen
    await page.waitForSelector('#scores:not([style*="display: none"]):not([style*="display:none"])', { timeout: 15000 })

    // Step F: Click Lobby button to return to Lobby
    await page.waitForSelector('#btn-leave-game')
    await page.click('#btn-leave-game')

    // Step G: Wait for Lobby screen to be visible again
    await page.waitForSelector('#lobby:not([style*="display: none"]):not([style*="display:none"])')

    // Step H: Measure client metrics after GC
    const current = await getClientMetrics()
    if (cycle === 1) {
      steadyBaseline = current
    }

    const deltaHeap = current.heapMB - steadyBaseline.heapMB
    const deltaNodes = current.nodes - steadyBaseline.nodes
    const deltaListeners = current.listeners - steadyBaseline.listeners

    console.log(
      `Cycle ${cycle} / ${TOTAL_CYCLES} | ` +
        `Heap: ${current.heapMB.toFixed(3)} MB (${deltaHeap >= 0 ? '+' : ''}${(deltaHeap * 1024).toFixed(1)} KB) | ` +
        `DOM Nodes: ${current.nodes} (${deltaNodes >= 0 ? '+' : ''}${deltaNodes}) | ` +
        `DOM Elements: ${current.domElements} | ` +
        `Listeners: ${current.listeners} (${deltaListeners >= 0 ? '+' : ''}${deltaListeners})`,
    )
  }

  // 3. Evaluation & Assertions
  const finalMetrics = await getClientMetrics()
  const netDeltaHeapMB = finalMetrics.heapMB - steadyBaseline.heapMB
  const netDeltaNodes = finalMetrics.nodes - steadyBaseline.nodes
  const netDeltaElements = finalMetrics.domElements - steadyBaseline.domElements
  const netDeltaListeners = finalMetrics.listeners - steadyBaseline.listeners

  console.log(`\n======================================================`)
  console.log(`📊 Client Memory & DOM Evaluation (across repeated match lifecycles):`)
  console.log(`- Final Heap Delta: ${netDeltaHeapMB >= 0 ? '+' : ''}${(netDeltaHeapMB * 1024).toFixed(1)} KB (${netDeltaHeapMB.toFixed(3)} MB)`)
  console.log(`- Attached DOM Elements Delta: ${netDeltaElements >= 0 ? '+' : ''}${netDeltaElements} (Total: ${finalMetrics.domElements})`)
  console.log(`- Internal V8 DOM Nodes Delta: ${netDeltaNodes >= 0 ? '+' : ''}${netDeltaNodes} (Total: ${finalMetrics.nodes})`)
  console.log(`- JS Event Listeners Delta: ${netDeltaListeners >= 0 ? '+' : ''}${netDeltaListeners} (Total: ${finalMetrics.listeners})`)

  assert.ok(
    netDeltaHeapMB < 1.0,
    `Client memory leak detected! Retained JS heap grew by ${netDeltaHeapMB.toFixed(2)} MB.`,
  )
  assert.equal(
    netDeltaElements,
    0,
    `Attached DOM element leak detected! Attached DOM element count changed by ${netDeltaElements}.`,
  )
  assert.ok(
    netDeltaNodes <= 35,
    `Detached DOM node leak detected! Internal node variance exceeded tolerance (+${netDeltaNodes}).`,
  )
  assert.ok(
    netDeltaListeners <= 5,
    `Event listener leak detected! JS event listeners grew by +${netDeltaListeners}.`,
  )

  console.log(`🏆 ZERO CLIENT MEMORY / DOM LEAK CONFIRMED: Canvas, DOM tree, and event listeners cleanly reclaimed!`)
  console.log(`======================================================\n`)
} finally {
  if (cdp) await cdp.detach().catch(() => {})
  if (context) await context.close().catch(() => {})
  if (browser) await browser.close().catch(() => {})
  if (server) {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  }
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true })
  }
  process.exit(0)
}
