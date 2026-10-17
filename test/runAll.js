import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseConcurrency, runSuites } from './helpers/test-runner.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const testFiles = fs
  .readdirSync(__dirname)
  .filter((file) => file.endsWith('.test.js'))
  .sort()

let concurrency
try {
  concurrency = parseConcurrency(process.env.TEST_CONCURRENCY)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

console.log(`\n======================================================`)
console.log(
  `Running Tron Test Suite (${testFiles.length} suites, concurrency ${concurrency})`,
)
console.log(`======================================================\n`)

const startTime = Date.now()
const controller = new AbortController()
const interrupt = (signal) => controller.abort(signal)
process.on('SIGINT', interrupt)
process.on('SIGTERM', interrupt)

let results
try {
  results = await runSuites(
    testFiles
      .map((file) => ({
        name: `test/${file}`,
        filePath: path.join(__dirname, file),
        exclusive: [
          'client-leak.test.js',
          'leak.test.js',
          'lobby-discovery.test.js',
        ].includes(file),
      }))
      .sort((a, b) => Number(a.exclusive) - Number(b.exclusive)),
    {
      concurrency,
      cwd: path.resolve(__dirname, '..'),
      signal: controller.signal,
      onResult(result) {
        console.log(`[SUITE] ${result.suite.name}`)
        for (const { stream, chunk } of result.output) {
          process[stream].write(chunk)
        }
        if (result.error) {
          console.error(result.error.message)
        }
        const status = result.passed ? 'PASSED' : 'FAILED'
        const reason = result.timedOut
          ? 'timed out after 120000ms'
          : result.interrupted
            ? 'interrupted'
            : `exit code: ${result.code}${result.signal ? `, signal: ${result.signal}` : ''}`
        console.log(
          `[${status}] ${result.suite.name} (${reason}, ${result.duration}ms)\n`,
        )
      },
    },
  )
} finally {
  process.removeListener('SIGINT', interrupt)
  process.removeListener('SIGTERM', interrupt)
}

const passed = results.filter((result) => result.passed).length
const failed = results.length - passed
const totalDuration = Date.now() - startTime
console.log(`======================================================`)
console.log(
  `Test Summary: ${passed} passed, ${failed} failed in ${totalDuration}ms`,
)
console.log(`======================================================\n`)

if (failed > 0) {
  process.exitCode = 1
}
