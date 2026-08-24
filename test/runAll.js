import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const testFiles = fs
  .readdirSync(__dirname)
  .filter((file) => file.endsWith('.test.js'))
  .sort()

console.log(`\n======================================================`)
console.log(`🧪 Running Tron Test Suite (${testFiles.length} suites)`)
console.log(`======================================================\n`)

const startTime = Date.now()
let passed = 0
let failed = 0

for (const file of testFiles) {
  const filePath = path.join(__dirname, file)
  const fileStart = Date.now()
  console.log(`▶ [RUNNING] test/${file}`)

  const result = spawnSync(process.execPath, [filePath], {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
  })

  const duration = Date.now() - fileStart

  if (result.status === 0) {
    passed++
    console.log(`✔ [PASSED] test/${file} (${duration}ms)\n`)
  } else {
    failed++
    console.error(`✖ [FAILED] test/${file} (exit code: ${result.status}, ${duration}ms)\n`)
  }
}

const totalDuration = Date.now() - startTime
console.log(`======================================================`)
console.log(`📊 Test Summary: ${passed} passed, ${failed} failed in ${totalDuration}ms`)
console.log(`======================================================\n`)

if (failed > 0) {
  process.exit(1)
}
