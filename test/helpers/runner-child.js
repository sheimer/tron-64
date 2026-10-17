import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const { RUNNER_FIXTURE_DIR: directory, RUNNER_FIXTURE_ID: id } = process.env
const mode = process.env.RUNNER_FIXTURE_MODE || 'gate'
const record = (event) =>
  fs.appendFileSync(
    path.join(directory, 'events'),
    `${JSON.stringify({
      event,
      id,
      dataDir: process.env.DATA_DIR,
      gc: typeof global.gc === 'function',
    })}\n`,
  )

fs.writeFileSync(path.join(process.env.DATA_DIR, 'fixture'), id)
process.stdout.write(`stdout:${id}\n`)
process.stderr.write(`stderr:${id}\n`)
record('start')

if (mode === 'fail') {
  process.exit(7)
} else if (mode === 'signal') {
  process.kill(process.pid, 'SIGTERM')
} else if (mode === 'hang') {
  setInterval(() => {}, 60_000)
} else if (mode === 'descendant') {
  // The immediate child exits successfully, but its descendant keeps the
  // captured pipes open. The runner's deadline must still reap that process.
  spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], {
    stdio: 'inherit',
  }).unref()
} else if (mode === 'auto') {
  record('end')
} else {
  const release = path.join(directory, `release-${id}`)
  const watcher = fs.watch(directory, () => {
    if (fs.existsSync(release)) {
      watcher.close()
      record('end')
    }
  })
  if (fs.existsSync(release)) {
    watcher.close()
    record('end')
  }
}
