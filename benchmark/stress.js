import WebSocket from 'ws'
import { GameSession } from '../server/GameSession.js'
import { BINARY_OPCODE } from '../shared/protocol.js'

/**
 * Headless Concurrency Stress Benchmark Tool
 *
 * Dynamically scales concurrent active matches in incremental stages until
 * event-loop jitter and maximum latency spikes indicate that performance is
 * no longer acceptable for real-time 40 FPS gameplay.
 *
 * At 40 FPS (25ms interval):
 * - Target interval: 25.0ms
 * - Max Spike >= 25.0ms: Single frame dropped / hitch perceptible to players
 * - Max Spike >= 40.0ms: Consecutive frames dropped (critical degradation)
 * - Average Jitter >= 10.0ms: 40%+ frame budget consumed by event loop lag
 */

function parseArgs() {
  const args = process.argv.slice(2)
  const isQuick =
    args.includes('--quick') || process.env.QUICK === '1' || process.env.QUICK === 'true'

  const config = {
    startRooms: isQuick ? 50 : parseInt(process.env.START_ROOMS, 10) || 100,
    stepRooms: isQuick ? 25 : parseInt(process.env.STEP_ROOMS, 10) || 100,
    maxRooms: isQuick ? 50 : parseInt(process.env.MAX_ROOMS, 10) || 3000,
    stepDurationMs: (parseFloat(process.env.STEP_DURATION, 10) || (isQuick ? 1.2 : 1.5)) * 1000,
    jitterThresholdMs: parseFloat(process.env.MAX_JITTER_MS, 10) || 10.0,
    spikeThresholdMs: parseFloat(process.env.MAX_SPIKE_MS, 10) || 40.0,
    isQuick,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--start' && args[i + 1]) {
      config.startRooms = parseInt(args[++i], 10)
    } else if (arg === '--step' && args[i + 1]) {
      config.stepRooms = parseInt(args[++i], 10)
    } else if (arg === '--max' && args[i + 1]) {
      config.maxRooms = parseInt(args[++i], 10)
    } else if (arg === '--duration' && args[i + 1]) {
      config.stepDurationMs = parseFloat(args[++i]) * 1000
    } else if (arg === '--jitter-threshold' && args[i + 1]) {
      config.jitterThresholdMs = parseFloat(args[++i])
    } else if (arg === '--spike-threshold' && args[i + 1]) {
      config.spikeThresholdMs = parseFloat(args[++i])
    } else if (arg === '--quick') {
      config.isQuick = true
      config.startRooms = 50
      config.maxRooms = 50
      config.stepDurationMs = 1200
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Tron Server Stress Benchmark Tool
Usage:
  npm run benchmark [options]         (runs fast --quick smoke test)
  npm run benchmark:stress [options]  (runs progressive saturation stress test)
  node benchmark/stress.js [options]

Options:
  --quick                   Fast smoke test capped at 50 rooms (default server limit)
  --start <num>             Initial room count to allocate (default: 100, quick: 50)
  --step <num>              Number of rooms to add per stage (default: 100, quick: 25)
  --max <num>               Maximum room safety ceiling (default: 3000, quick: 50)
  --duration <sec>          Sampling duration per stage in seconds (default: 1.5, quick: 1.2)
  --jitter-threshold <ms>   Average event-loop jitter threshold (default: 10.0)
  --spike-threshold <ms>    Max event-loop spike threshold (default: 40.0)
  -h, --help                Show this help message

Environment Variables:
  START_ROOMS, STEP_ROOMS, MAX_ROOMS, STEP_DURATION, MAX_JITTER_MS, MAX_SPIKE_MS, QUICK
`)
      process.exit(0)
    }
  }

  return config
}

/**
 * Simulates server-side binary draw frame encoding as executed in production wsHandler.
 */
function encodeBinaryDraw(changes) {
  if (!changes || !changes.length) return null
  const buf = Buffer.allocUnsafe(1 + changes.length * 5)
  buf.writeUInt8(BINARY_OPCODE.DRAW, 0)
  for (let i = 0; i < changes.length; i++) {
    const offset = 1 + i * 5
    buf.writeUInt16BE(changes[i][0], offset)
    buf.writeUInt16BE(changes[i][1], offset + 2)
    buf.writeInt8(changes[i][2], offset + 4)
  }
  return buf
}

/**
 * Instantiates an active 4-player match session running at 40 FPS.
 * Registers ondraw delta encoding and onfinish auto-reset to keep
 * physics active across multiple game rounds.
 */
function createActiveSession(id) {
  const session = new GameSession({
    key: `stress_${id}`,
    name: `Stress Room ${id}`,
    interval: 25, // 40 FPS
    isPublic: false,
  })

  // Populate 4 active competitors
  session.addPlayer({ id: `p_${id}_0`, name: 'P0', color: 'water', left: 65, right: 68 })
  session.addPlayer({ id: `p_${id}_1`, name: 'P1', color: 'leaf', left: 37, right: 39 })
  session.addPlayer({ id: `p_${id}_2`, name: 'P2', color: 'rose', left: 75, right: 76 })
  session.addPlayer({ id: `p_${id}_3`, name: 'P3', color: 'sky', left: 81, right: 87 })

  // Connect client handler simulating delta broadcasts and round auto-restarts
  session.connect({
    client: { readyState: WebSocket.OPEN },
    ondraw: (changes) => {
      encodeBinaryDraw(changes)
    },
    onfinish: () => {
      // Auto-restart round immediately so the room continues calculating physics
      session.reset()
      session.start()
    },
    onreset: () => {},
  })

  session.start()
  return session
}

async function runStressBenchmark(config) {
  const {
    startRooms,
    stepRooms,
    maxRooms,
    stepDurationMs,
    jitterThresholdMs,
    spikeThresholdMs,
    isQuick,
  } = config

  console.log('\n======================================================')
  console.log(
    isQuick
      ? '🚀 Tron Server Fast Concurrency Benchmark (50 Rooms / 40 FPS)'
      : '⚡ Tron Dynamic Server Stress & Saturation Benchmark',
  )
  console.log(
    isQuick
      ? 'Quick sanity verification of default server capacity'
      : 'Scaling active matches until event loop latency degrades',
  )
  console.log('======================================================')
  console.log(`Starting Rooms:      ${startRooms}`)
  if (!isQuick) {
    console.log(`Step Increment:      +${stepRooms} rooms per stage`)
  }
  console.log(`Sampling Duration:   ${(stepDurationMs / 1000).toFixed(1)}s per stage`)
  console.log(`Game Physics Rate:   40 FPS (25ms interval)`)
  console.log(
    `Degradation Limits:  ⚡ Avg Jitter >= ${jitterThresholdMs}ms OR ⚠️ Max Spike >= ${spikeThresholdMs}ms`,
  )
  console.log('======================================================\n')

  const sessions = []
  let totalSteeringInputs = 0
  const history = []
  let saturated = false
  let saturationReason = ''

  const cleanup = () => {
    if (sessions.length > 0) {
      process.stdout.write(`🧹 Cleaning up ${sessions.length} active sessions... `)
      sessions.forEach((s) => s.destroy())
      sessions.length = 0
      console.log('done.\n')
    }
  }

  process.on('SIGINT', () => {
    console.log('\n\nBenchmark interrupted by user (SIGINT).')
    cleanup()
    process.exit(130)
  })

  try {
    while (sessions.length < maxRooms && !saturated) {
      const nextTarget = sessions.length === 0 ? startRooms : sessions.length + stepRooms
      const addedThisStep = nextTarget - sessions.length

      process.stdout.write(`Allocating +${addedThisStep} rooms (${nextTarget} total)... `)
      const allocStart = performance.now()
      while (sessions.length < nextTarget) {
        sessions.push(createActiveSession(sessions.length))
      }
      const allocDuration = performance.now() - allocStart
      process.stdout.write(`done in ${allocDuration.toFixed(0)}ms\n`)

      const roomCount = sessions.length
      const playerCount = roomCount * 4
      const ticksPerSec = roomCount * 40

      const tickLags = []
      let stepInputs = 0
      const startTime = Date.now()

      await new Promise((resolve) => {
        const sampleInterval = setInterval(() => {
          if (Date.now() - startTime >= stepDurationMs) {
            clearInterval(sampleInterval)
            resolve()
            return
          }

          // Inject random steering inputs to active rooms
          const steerBatch = Math.min(sessions.length, 300)
          for (let i = 0; i < steerBatch; i++) {
            const randomSessionIdx = Math.floor(Math.random() * sessions.length)
            const s = sessions[randomSessionIdx]
            const pIdx = Math.floor(Math.random() * 4)
            const dir = Math.random() > 0.5 ? 'left' : 'right'
            s.changeDir({ id: `p_${randomSessionIdx}_${pIdx}`, dir })
            stepInputs++
            totalSteeringInputs++
          }

          // High-frequency event loop lag sampling against 20ms baseline
          const expectedDelay = 20
          const before = performance.now()
          setTimeout(() => {
            const actualDelay = performance.now() - before
            tickLags.push(Math.max(0, actualDelay - expectedDelay))
          }, expectedDelay)
        }, 40)
      })

      const avgLag = tickLags.length ? tickLags.reduce((a, b) => a + b, 0) / tickLags.length : 0
      const maxLag = tickLags.length ? Math.max(...tickLags) : 0
      const sortedLags = [...tickLags].sort((a, b) => a - b)
      const p95Lag = sortedLags.length ? sortedLags[Math.floor(sortedLags.length * 0.95)] : 0
      const heapMB = process.memoryUsage().heapUsed / 1024 / 1024

      let statusText = '🟢 HEALTHY'
      if (avgLag >= jitterThresholdMs || maxLag >= spikeThresholdMs) {
        statusText = '🔴 NOT GOOD ANYMORE (SATURATED)'
        saturated = true
        saturationReason =
          avgLag >= jitterThresholdMs
            ? `Average Jitter (${avgLag.toFixed(2)}ms) exceeded critical threshold (${jitterThresholdMs}ms)`
            : `Max Event-Loop Spike (${maxLag.toFixed(2)}ms) exceeded critical threshold (${spikeThresholdMs}ms)`
      } else if (avgLag >= 5.0 || maxLag >= 25.0) {
        statusText = '🟡 DEGRADED (Frame Drops)'
      }

      console.log(
        `[Stage ${String(history.length + 1).padStart(2, ' ')}] ` +
          `Rooms: ${String(roomCount).padStart(5, ' ')} | ` +
          `Players: ${String(playerCount).padStart(5, ' ')} | ` +
          `~${ticksPerSec.toLocaleString()} ticks/s | ` +
          `Heap: ${heapMB.toFixed(1).padStart(6, ' ')} MB`,
      )
      console.log(
        `         ⚡ Average Event-Loop Jitter: ${avgLag.toFixed(2)} ms (p95: ${p95Lag.toFixed(2)} ms)`,
      )
      console.log(
        `         ⚠️ Max Event-Loop Spike:      ${maxLag.toFixed(2)} ms`,
      )
      console.log(`         Status: ${statusText}\n`)

      history.push({
        roomCount,
        playerCount,
        ticksPerSec,
        heapMB,
        avgLag,
        p95Lag,
        maxLag,
        statusText,
        stepInputs,
      })
    }

    console.log('======================================================')
    console.log(
      isQuick ? '📊 QUICK BENCHMARK SUMMARY' : '📊 STRESS BENCHMARK SUMMARY',
    )
    console.log('======================================================')

    if (saturated) {
      const lastEntry = history[history.length - 1]
      const lastHealthy = history.filter((h) => !h.statusText.includes('NOT GOOD')).pop()

      console.log(
        `🛑 SATURATION POINT: ${lastEntry.roomCount} Concurrent Rooms (${lastEntry.playerCount.toLocaleString()} players)`,
      )
      console.log(`   Degradation Cause:            ${saturationReason}`)
      console.log(`   ⚡ Average Event-Loop Jitter:   ${lastEntry.avgLag.toFixed(2)} ms`)
      console.log(`   ⚠️ Max Event-Loop Spike:        ${lastEntry.maxLag.toFixed(2)} ms`)
      console.log(
        `   ⏱ Physics Throughput:         ~${lastEntry.ticksPerSec.toLocaleString()} ticks/s on single Node.js thread`,
      )
      console.log(`   🎮 Steering Inputs Injected:   ${totalSteeringInputs.toLocaleString()}`)
      console.log(`   💾 Peak Heap Memory:           ${lastEntry.heapMB.toFixed(1)} MB`)

      if (lastHealthy) {
        console.log(`\n✅ Recommended Maximum Safe Operating Capacity:`)
        console.log(
          `   ${lastHealthy.roomCount} concurrent rooms (${lastHealthy.playerCount.toLocaleString()} players) with ` +
            `${lastHealthy.avgLag.toFixed(2)}ms avg jitter and ${lastHealthy.maxLag.toFixed(2)}ms max spike.`,
        )
      }
    } else if (isQuick) {
      const result = history[history.length - 1]
      if (result && result.avgLag < 10) {
        console.log(
          `🏆 QUICK BENCHMARK PASSED: 50 concurrent active games run smoothly under <10ms event loop jitter!`,
        )
        console.log(`   ⚡ Average Jitter: ${result.avgLag.toFixed(2)} ms`)
        console.log(`   ⚠️ Max Spike:      ${result.maxLag.toFixed(2)} ms`)
        console.log(`   💾 Heap Used:      ${result.heapMB.toFixed(1)} MB`)
      } else {
        console.log(`⚠️ Degraded performance observed during quick benchmark.`)
      }
    } else {
      console.log(
        `🏆 SAFETY CEILING REACHED (${maxRooms} rooms) without crossing degradation thresholds!`,
      )
    }
    console.log('======================================================\n')
  } finally {
    cleanup()
  }
}

const config = parseArgs()
runStressBenchmark(config).catch((err) => {
  console.error('Benchmark failed:', err)
  process.exit(1)
})
