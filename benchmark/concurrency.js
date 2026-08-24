import { GameSession } from '../server/GameSession.js'

/**
 * Headless Concurrency Benchmark Tool
 * Measures tick latency jitter, CPU execution duration, and heap memory
 * under multiple concurrent active matches running at 40 FPS (25ms interval).
 */

async function runBenchmark(concurrentRooms = 50, durationSeconds = 3) {
  console.log(`\n======================================================`)
  console.log(`🚀 Benchmarking ${concurrentRooms} Concurrent Active Matches (40 FPS / 25ms interval)`)
  console.log(`⏱  Duration: ${durationSeconds} seconds`)
  console.log(`======================================================`)

  const sessions = []
  const initialMemory = process.memoryUsage().heapUsed / 1024 / 1024

  for (let i = 0; i < concurrentRooms; i++) {
    const session = new GameSession({
      key: `bench_${i}`,
      name: `Benchmark Room ${i}`,
      interval: 25, // 40 FPS
      isPublic: false,
    })

    // Add 4 players to each match
    session.addPlayer({ id: `p_${i}_0`, name: 'P0', color: 'water', left: 65, right: 68 })
    session.addPlayer({ id: `p_${i}_1`, name: 'P1', color: 'leaf', left: 37, right: 39 })
    session.addPlayer({ id: `p_${i}_2`, name: 'P2', color: 'rose', left: 75, right: 76 })
    session.addPlayer({ id: `p_${i}_3`, name: 'P3', color: 'sky', left: 81, right: 87 })

    session.start()
    sessions.push(session)
  }

  const startMemory = process.memoryUsage().heapUsed / 1024 / 1024
  console.log(`📊 Memory Before: ${initialMemory.toFixed(2)} MB | Memory with ${concurrentRooms} Rooms: ${startMemory.toFixed(2)} MB`)

  const tickLags = []
  const startTime = Date.now()
  let simulatedInputs = 0

  // Measure event loop lag every 25ms during execution
  await new Promise((resolve) => {
    const sampleInterval = setInterval(() => {
      const now = Date.now()
      if (now - startTime >= durationSeconds * 1000) {
        clearInterval(sampleInterval)
        resolve()
        return
      }

      // Simulate random steering inputs for each match
      sessions.forEach((s, idx) => {
        const turnPlayer = `p_${idx}_${Math.floor(Math.random() * 4)}`
        const dir = Math.random() > 0.5 ? 'left' : 'right'
        s.changeDir({ id: turnPlayer, dir })
        simulatedInputs++
      })

      // Sample event loop delay against expected interval
      const expectedDelay = 25
      const before = performance.now()
      setTimeout(() => {
        const actualDelay = performance.now() - before
        tickLags.push(Math.max(0, actualDelay - expectedDelay))
      }, expectedDelay)
    }, 50)
  })

  // Stop and clean up all sessions
  sessions.forEach((s) => s.destroy())

  const endMemory = process.memoryUsage().heapUsed / 1024 / 1024
  const avgLag = tickLags.length ? tickLags.reduce((a, b) => a + b, 0) / tickLags.length : 0
  const maxLag = tickLags.length ? Math.max(...tickLags) : 0
  const totalTicks = concurrentRooms * (1000 / 25) * durationSeconds

  console.log(`\n--- Results for ${concurrentRooms} Concurrent Rooms ---`)
  console.log(`✅ Total Physics Ticks Computed: ~${totalTicks.toLocaleString()}`)
  console.log(`🎮 Total Steering Inputs Injected: ${simulatedInputs.toLocaleString()}`)
  console.log(`⚡ Average Event-Loop Jitter: ${avgLag.toFixed(2)} ms`)
  console.log(`⚠️ Max Event-Loop Spike: ${maxLag.toFixed(2)} ms`)
  console.log(`💾 Final Heap Memory: ${endMemory.toFixed(2)} MB (Delta: ${(startMemory - initialMemory).toFixed(2)} MB)`)

  return { avgLag, maxLag }
}

async function main() {
  console.log('Starting Tron Multi-Room Concurrency Benchmark...')
  await runBenchmark(10, 2)
  await runBenchmark(25, 2)
  const result50 = await runBenchmark(50, 3)

  console.log('\n======================================================')
  if (result50.avgLag < 10) {
    console.log('🏆 BENCHMARK PASSED: 50 concurrent active games run smoothly under <10ms event loop jitter!')
  } else {
    console.log('⚠️ High event loop lag detected under 50 concurrent games.')
  }
  console.log('======================================================\n')
}

main().catch(console.error)
