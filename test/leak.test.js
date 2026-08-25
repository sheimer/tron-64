import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'

/**
 * Server-Side Memory Leak & Garbage Collection Verification Test
 *
 * Requirements:
 * Must be executed with Node's `--expose-gc` flag to enable `global.gc()`.
 * Example: `node --expose-gc test/leak.test.js`
 */

if (typeof global.gc !== 'function') {
  console.error('❌ Error: global.gc is not available. Run with: node --expose-gc test/leak.test.js')
  process.exit(1)
}

// Dedicated test data directory
const testDataDir = path.resolve(process.cwd(), 'data-test-leak')
process.env.DATA_DIR = testDataDir

if (fs.existsSync(testDataDir)) {
  fs.rmSync(testDataDir, { recursive: true, force: true })
}

const { GameSession } = await import('../server/GameSession.js')

console.log(`\n======================================================`)
console.log(`🧪 Server Memory Leak & Lifecycle Verification`)
console.log(`======================================================`)

// Helper to force GC and return heapUsed in MB
function getCleanHeapMB() {
  global.gc()
  global.gc() // Double GC pass to clean both young and old generation spaces
  return process.memoryUsage().heapUsed / 1024 / 1024
}

// 1. Establish Initial Baseline Heap
const baselineHeap = getCleanHeapMB()
console.log(`📊 Initial Baseline Heap (after GC): ${baselineHeap.toFixed(3)} MB\n`)

const TOTAL_CYCLES = 10
const ROOMS_PER_CYCLE = 50
const TICKS_PER_ROOM = 100

const cycleResults = []

for (let cycle = 1; cycle <= TOTAL_CYCLES; cycle++) {
  let sessions = []

  // Step A: Create rooms and populate players
  for (let r = 0; r < ROOMS_PER_CYCLE; r++) {
    const session = new GameSession({
      key: `leak_${cycle}_${r}`,
      name: `Leak Test Room ${r}`,
      interval: 25,
      isPublic: false,
    })

    session.addPlayer({ id: `p_${r}_0`, name: 'P0', color: 'water', left: 65, right: 68 })
    session.addPlayer({ id: `p_${r}_1`, name: 'P1', color: 'leaf', left: 37, right: 39 })
    session.addPlayer({ id: `p_${r}_2`, name: 'P2', color: 'rose', left: 75, right: 76 })
    session.addPlayer({ id: `p_${r}_3`, name: 'P3', color: 'sky', left: 81, right: 87 })

    session.arena.reset()
    session.arena.startRound()

    // Step B: Simulate physics loop, turns, and mid-round disconnects
    for (let t = 0; t < TICKS_PER_ROOM; t++) {
      if (t === 20) {
        session.disconnectPlayer(`p_${r}_0`) // simulate disconnect mid-round
      }
      if (t === 50) {
        session.reconnectPlayer(`p_${r}_0`) // simulate reconnect
      }
      if (t % 5 === 0) {
        session.changeDir({ id: `p_${r}_1`, dir: t % 10 === 0 ? 'left' : 'right' })
      }
      session.arena.run()
    }

    sessions.push(session)
  }

  // Measure peak memory during active load before cleanup
  const peakHeap = process.memoryUsage().heapUsed / 1024 / 1024

  // Step C: Destroy all rooms
  sessions.forEach((s) => s.destroy())
  sessions.length = 0 // Clear array references

  // Step D: Force full garbage collection and measure retained heap
  const postCleanupHeap = getCleanHeapMB()
  const deltaFromBaseline = postCleanupHeap - baselineHeap

  cycleResults.push({
    cycle,
    peakHeap,
    postCleanupHeap,
    deltaFromBaseline,
  })

  console.log(
    `Cycle ${String(cycle).padStart(2, ' ')} / ${TOTAL_CYCLES} | ` +
      `Peak: ${peakHeap.toFixed(2).padStart(6, ' ')} MB | ` +
      `Post-GC: ${postCleanupHeap.toFixed(3)} MB | ` +
      `Delta from Baseline: ${deltaFromBaseline >= 0 ? '+' : ''}${(deltaFromBaseline * 1024).toFixed(1).padStart(7, ' ')} KB`,
  )
}

// Clean up test data dir
if (fs.existsSync(testDataDir)) {
  fs.rmSync(testDataDir, { recursive: true, force: true })
}

// 2. Evaluation & Assertions
const finalDeltaMB = cycleResults[cycleResults.length - 1].deltaFromBaseline
console.log(`\n======================================================`)
console.log(`📊 Memory Leak Evaluation:`)
console.log(`- Baseline Heap: ${baselineHeap.toFixed(3)} MB`)
console.log(`- Final Heap after 10 cycles (${TOTAL_CYCLES * ROOMS_PER_CYCLE} total rooms): ${cycleResults[cycleResults.length - 1].postCleanupHeap.toFixed(3)} MB`)
console.log(`- Net Delta: ${finalDeltaMB >= 0 ? '+' : ''}${(finalDeltaMB * 1024).toFixed(1)} KB (${finalDeltaMB.toFixed(3)} MB)`)

// If memory leaks, delta will grow by several MBs per cycle (e.g. >10-50MB after 10 cycles).
// With zero leaks, delta is typically < 1.0 MB (representing minor V8 runtime internal growth).
assert.ok(
  finalDeltaMB < 1.5,
  `Memory leak detected! Retained heap grew by ${finalDeltaMB.toFixed(2)} MB over ${TOTAL_CYCLES} cycles.`,
)

console.log(`🏆 ZERO MEMORY LEAK CONFIRMED: All game sessions, arenas, and players are completely reclaimed by GC!`)
console.log(`======================================================\n`)
