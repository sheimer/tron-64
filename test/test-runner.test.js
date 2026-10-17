import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseConcurrency, runSuites } from './helpers/test-runner.js'

const fixture = fileURLToPath(
  new URL('./helpers/runner-child.js', import.meta.url),
)
const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'bitcycles-runner-test-'),
)
const inherited = path.join(directory, 'inherited-data')
fs.mkdirSync(inherited)
fs.writeFileSync(path.join(inherited, 'keep'), 'caller data')
const eventsFile = path.join(directory, 'events')
fs.writeFileSync(eventsFile, '')
const events = () =>
  fs
    .readFileSync(eventsFile, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
const suite = (id, mode = 'gate', exclusive = false) => ({
  name: id,
  filePath: fixture,
  exclusive,
  env: {
    RUNNER_FIXTURE_DIR: directory,
    RUNNER_FIXTURE_ID: id,
    RUNNER_FIXTURE_MODE: mode,
  },
})
const options = {
  env: { ...process.env, DATA_DIR: inherited },
}

// File events synchronize the fixtures; no scheduling assertion depends on a
// machine-dependent sleep or elapsed-time threshold.
const untilStarted = (ids) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      watcher.close()
      reject(
        new Error(
          `Fixtures did not start: ${ids.join(', ')}; events: ${JSON.stringify(events())}`,
        ),
      )
    }, 10_000)
    const check = () => {
      const started = events()
        .filter(({ event }) => event === 'start')
        .map(({ id }) => id)
      if (ids.every((id) => started.includes(id))) {
        clearTimeout(timer)
        watcher.close()
        resolve()
      }
    }
    const watcher = fs.watch(directory, check)
    check()
  })
const release = (...ids) => {
  for (const id of ids) {
    fs.writeFileSync(path.join(directory, `release-${id}`), '')
  }
}

try {
  assert.equal(parseConcurrency(), 2)
  assert.equal(parseConcurrency('1'), 1)
  assert.equal(parseConcurrency('8'), 8)
  for (const value of ['', '0', '-1', '9', '2.5', 'Infinity', '2x', ' 2']) {
    assert.throws(() => parseConcurrency(value), /TEST_CONCURRENCY/)
  }
  await assert.rejects(runSuites([], { concurrency: 0 }), /TEST_CONCURRENCY/)

  const reports = []
  const running = runSuites(
    [
      suite('a'),
      suite('b'),
      suite('c'),
      suite('exclusive', 'gate', true),
      suite('d'),
      suite('e'),
    ],
    { ...options, onResult: (result) => reports.push(result) },
  )
  await untilStarted(['a', 'b'])
  release('a')
  await untilStarted(['c'])
  release('b', 'c')
  await untilStarted(['exclusive'])
  release('exclusive')
  await untilStarted(['d', 'e'])
  release('d', 'e')
  const results = await running
  assert.equal(results.length, 6)
  assert.equal(reports.length, 6)
  assert(results.every(({ passed }) => passed))
  assert.deepEqual(
    results.map(({ suite }) => suite.name),
    ['a', 'b', 'c', 'exclusive', 'd', 'e'],
  )

  const active = new Set()
  let maximum = 0
  const dataDirs = new Set()
  for (const event of events()) {
    assert(event.gc, 'every fixture receives --expose-gc')
    if (event.event === 'start') {
      assert(!active.has('exclusive'))
      if (event.id === 'exclusive') {
        assert.equal(active.size, 0)
      }
      active.add(event.id)
      maximum = Math.max(maximum, active.size)
      dataDirs.add(event.dataDir)
    } else {
      active.delete(event.id)
    }
  }
  assert.equal(maximum, 2)
  assert.equal(active.size, 0)
  assert.equal(dataDirs.size, 6)
  for (const dataDir of dataDirs) {
    assert.notEqual(dataDir, inherited)
    assert.equal(fs.existsSync(dataDir), false, 'runner cleans owned data')
  }
  for (const result of reports) {
    for (const stream of ['stdout', 'stderr']) {
      const text = Buffer.concat(
        result.output
          .filter((entry) => entry.stream === stream)
          .map(({ chunk }) => chunk),
      ).toString()
      assert.equal(text, `${stream}:${result.suite.name}\n`)
    }
  }

  const sequential = await runSuites(
    [suite('serial-a', 'auto'), suite('serial-b', 'auto')],
    { ...options, concurrency: 1 },
  )
  assert(sequential.every(({ passed }) => passed))
  assert.deepEqual(
    events()
      .filter(({ id }) => id.startsWith('serial-'))
      .map(({ id, event }) => `${id}:${event}`),
    ['serial-a:start', 'serial-a:end', 'serial-b:start', 'serial-b:end'],
  )

  const failures = await runSuites(
    [
      suite('failure', 'fail'),
      suite('signal', 'signal'),
      suite('after', 'auto'),
    ],
    options,
  )
  assert.equal(failures[0].passed, false)
  assert.equal(failures[0].code, 7)
  assert.equal(failures[1].passed, false)
  assert.equal(failures[1].signal, 'SIGTERM')
  assert.equal(failures[2].passed, true, 'failure does not drop later suites')

  const [startup] = await runSuites([suite('startup')], {
    ...options,
    executable: path.join(directory, 'missing-node'),
  })
  assert.equal(startup.passed, false)
  assert.equal(startup.error.code, 'ENOENT')

  const [timeout] = await runSuites([suite('timeout', 'hang')], {
    ...options,
    timeoutMs: 200,
  })
  assert.equal(timeout.passed, false)
  assert.equal(timeout.timedOut, true)
  assert.equal(timeout.signal, 'SIGKILL')

  if (process.platform !== 'win32') {
    const [descendant] = await runSuites([suite('descendant', 'descendant')], {
      ...options,
      timeoutMs: 5000,
    })
    assert.equal(descendant.passed, false)
    assert.equal(descendant.timedOut, true)
    assert.equal(
      descendant.code,
      0,
      'the direct child exited before its descendant',
    )
  }

  const controller = new AbortController()
  const interrupted = runSuites(
    [suite('interrupted', 'hang'), suite('cancelled', 'auto')],
    { ...options, concurrency: 1, signal: controller.signal },
  )
  await untilStarted(['interrupted'])
  controller.abort()
  const aborted = await interrupted
  assert.equal(aborted.length, 2)
  assert(aborted.every(({ passed, interrupted }) => !passed && interrupted))
  assert(!events().some(({ id }) => id === 'cancelled'))
  assert.equal(
    fs.readFileSync(path.join(inherited, 'keep'), 'utf8'),
    'caller data',
  )
  for (const { dataDir } of events()) {
    assert.equal(fs.existsSync(dataDir), false)
  }
  console.log('Test runner scheduling, isolation and failure checks passed')
} finally {
  fs.rmSync(directory, { recursive: true, force: true })
}
