import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { Storage } from '../server/Storage.js'
import { GameSession } from '../server/GameSession.js'

// Diagnostic measurements, not timing assertions. Run on the target browser
// and deployment filesystem before using these results to choose a policy.
const root = fileURLToPath(new URL('../', import.meta.url))
const baselineIndex = process.argv.indexOf('--baseline')
const baseline = baselineIndex < 0 ? null : process.argv[baselineIndex + 1]
if (baselineIndex >= 0 && !baseline)
  throw new Error(
    'Usage: node benchmark/ownership-performance.js [--baseline HEAD]',
  )

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    p50: +sorted[Math.floor(sorted.length * 0.5)].toFixed(3),
    p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(3),
    max: +sorted.at(-1).toFixed(3),
  }
}

async function rendering() {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(
      '<canvas id="arena" width="640" height="400"></canvas>',
    )
    const versions = [
      {
        label: 'working tree',
        source: readFileSync(
          path.join(root, 'public/javascripts/Renderer.js'),
          'utf8',
        ),
      },
    ]
    if (baseline)
      versions.unshift({
        label: baseline,
        source: execFileSync(
          'git',
          ['show', `${baseline}:public/javascripts/Renderer.js`],
          { cwd: root, encoding: 'utf8' },
        ),
      })
    const results = await page.evaluate(async (versions) => {
      const renderers = []
      for (const { label, source } of versions) {
        const module = source.replace(/^import .*\n/gm, '')
        const { Renderer } = await import(
          `data:text/javascript,${encodeURIComponent(`const CELL_TYPE = { EMPTY: -1, BORDER: -2, EXPLOSION: -3 }; const BINARY_OPCODE = { DRAW: 1 };\n${module}`)}`
        )
        const renderer = new Renderer({
          bgColor: '#000',
          bordercolor: '#fff',
          explosioncolor: '#f00',
          playercolors: ['#00f', '#0f0', '#ff0', '#0ff', '#f0f', '#fff'],
        })
        renderers.push({ label, renderer })
      }
      const results = []
      for (const cells of [6, 256, 4096, 64000]) {
        const packet = new DataView(new ArrayBuffer(1 + cells * 5))
        packet.setUint8(0, 1)
        for (let i = 0; i < cells; i++) {
          const offset = 1 + i * 5
          packet.setUint16(offset, i % 320)
          packet.setUint16(offset + 2, Math.floor(i / 320))
          packet.setInt8(offset + 4, i % 2 ? -3 : i % 6)
        }
        const batchSize = cells >= 64000 ? 1 : 10
        for (const { renderer } of renderers)
          for (let i = 0; i < batchSize * 10; i++) renderer.draw(packet)
        const samples = renderers.map(() => [])
        // Alternate order to reduce warm-up/order bias. Batches avoid timer
        // resolution overwhelming the smallest frames; no per-frame allocation.
        for (let trial = 0; trial < 100; trial++) {
          const order =
            trial % 2 ? [...renderers.keys()].reverse() : [...renderers.keys()]
          for (const index of order) {
            const start = performance.now()
            for (let i = 0; i < batchSize; i++)
              renderers[index].renderer.draw(packet)
            samples[index].push((performance.now() - start) / batchSize)
          }
        }
        for (let index = 0; index < renderers.length; index++)
          results.push({
            version: renderers[index].label,
            cells,
            samples: samples[index],
          })
      }
      for (const { renderer } of renderers) renderer.destroy()
      return results
    }, versions)
    console.log(
      'Canvas draw CPU time (ms/packet; batched samples, not GPU completion):',
    )
    console.table(
      results.map(({ samples, ...row }) => ({ ...row, ...summarize(samples) })),
    )
  } finally {
    await browser.close()
  }
}

async function persistence() {
  const directory = mkdtempSync(
    path.join(process.env.BENCHMARK_DATA_DIR || tmpdir(), 'tron-ownership-'),
  )
  const storage = new Storage()
  storage.dataDir = directory
  storage.filePath = path.join(directory, 'games.json')
  storage.tempPath = path.join(directory, 'games.json.tmp')
  const rows = []
  try {
    for (const rooms of [1, 10, 50]) {
      const games = []
      try {
        for (let room = 0; room < rooms; room++) {
          const game = new GameSession({
            key: `room-${room}`,
            name: 'Benchmark',
            interval: 25,
            isPublic: false,
          })
          games.push(game)
          const socket = {
            gameKey: game.key,
            playerIds: new Set(),
            handlesById: new Map(),
            idsByHandle: new Map(),
          }
          for (let player = 0; player < 6; player++) {
            const id = `player-${player}`
            const result = game.addPlayer(
              {
                id,
                name: id,
                color: 'water',
                left: player * 2 + 65,
                right: player * 2 + 66,
              },
              { deferChange: true },
            )
            if (!result.ok) throw new Error(result.code)
            game.ownership.register(id, socket)
          }
          // Same synchronous persistence callback used by the server, without
          // lobby serialization or network traffic. This isolates save cost.
          game.onChange = () => {
            if (!storage.saveGames(games))
              throw new Error('Snapshot save failed')
          }
        }
        for (const players of [1, 2, 6]) {
          const durations = []
          const delays = []
          for (let trial = 0; trial < 35; trial++) {
            const started = performance.now()
            const delayed = new Promise((resolve) =>
              setTimeout(() => resolve(performance.now() - started), 0),
            )
            for (let player = 0; player < players; player++) {
              games[0].arena.players[player].connected = false
              games[0].reconnectPlayer(`player-${player}`)
            }
            const duration = performance.now() - started
            const delay = await delayed
            if (trial >= 5) {
              durations.push(duration)
              delays.push(delay)
            }
          }
          rows.push({
            rooms,
            players,
            writes: players,
            bytes: statSync(storage.filePath).size,
            ...summarize(durations),
            timerDelayP95: summarize(delays).p95,
          })
        }
      } finally {
        for (const game of games) game.destroy()
      }
    }
    console.log('Reconnect snapshot cost (ms/batch; current per-player saves):')
    console.table(rows)
    console.log('Temporary fixture filesystem:', directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

await rendering()
await persistence()
