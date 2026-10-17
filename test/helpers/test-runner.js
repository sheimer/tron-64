import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export function parseConcurrency(value = '2') {
  if (!/^[1-8]$/.test(value)) {
    throw new Error('TEST_CONCURRENCY must be an integer between 1 and 8')
  }
  return Number(value)
}

function runSuite(suite, { cwd, env, executable, timeoutMs, signal }) {
  const start = Date.now()
  const output = []
  let dataDir
  let child
  let timer
  let error
  let timedOut = false
  let interrupted = false

  return new Promise((resolve) => {
    const finish = (code, childSignal) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (dataDir) {
        try {
          rmSync(dataDir, { recursive: true, force: true })
        } catch (cleanupError) {
          error ||= cleanupError
        }
      }
      resolve({
        suite,
        code,
        signal: childSignal,
        error,
        timedOut,
        interrupted,
        output,
        duration: Date.now() - start,
        passed: code === 0 && !error && !timedOut && !interrupted,
      })
    }
    const kill = () => {
      if (!child?.pid) return
      try {
        // Suites may launch server/browser descendants. Reap the whole process
        // group on timeout or interruption before admitting another suite.
        if (process.platform === 'win32') child.kill('SIGKILL')
        else process.kill(-child.pid, 'SIGKILL')
      } catch (killError) {
        if (killError.code !== 'ESRCH') error ||= killError
      }
    }
    const abort = () => {
      interrupted = true
      kill()
    }

    try {
      // Never write to or remove a caller's inherited DATA_DIR. Suites that
      // supply their own fixtures can still override this environment locally.
      dataDir = mkdtempSync(path.join(tmpdir(), 'bitcycles-test-'))
      child = spawn(executable, ['--expose-gc', suite.filePath], {
        cwd,
        env: { ...env, ...suite.env, DATA_DIR: dataDir },
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      child.stdout.on('data', (chunk) =>
        output.push({ stream: 'stdout', chunk }),
      )
      child.stderr.on('data', (chunk) =>
        output.push({ stream: 'stderr', chunk }),
      )
      child.on('error', (spawnError) => {
        error ||= spawnError
      })
      child.on('close', finish)
      timer = setTimeout(() => {
        timedOut = true
        kill()
      }, timeoutMs)
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    } catch (spawnError) {
      error = spawnError
      finish(null, null)
    }
  })
}

export async function runSuites(
  suites,
  {
    concurrency = 2,
    cwd = process.cwd(),
    env = process.env,
    executable = process.execPath,
    timeoutMs = 120_000,
    signal,
    onResult = () => {},
  } = {},
) {
  parseConcurrency(String(concurrency))
  const results = new Array(suites.length)
  const active = new Map()
  let next = 0

  while (next < suites.length || active.size) {
    // An exclusive suite is a FIFO barrier: drain prior children, run it alone,
    // then admit later suites. This keeps memory measurements uncontended.
    while (next < suites.length && active.size < concurrency) {
      const suite = suites[next]
      if (signal?.aborted) {
        const result = {
          suite,
          passed: false,
          interrupted: true,
          code: null,
          output: [],
          duration: 0,
        }
        results[next++] = result
        onResult(result)
        continue
      }
      if (
        (suite.exclusive && active.size) ||
        [...active.values()].some(({ suite }) => suite.exclusive)
      ) {
        break
      }
      const index = next++
      const promise = runSuite(suite, {
        cwd,
        env,
        executable,
        timeoutMs,
        signal,
      }).then((result) => ({ index, result }))
      active.set(index, { suite, promise })
      if (suite.exclusive) break
    }
    if (!active.size) continue
    const { index, result } = await Promise.race(
      [...active.values()].map(({ promise }) => promise),
    )
    active.delete(index)
    results[index] = result
    onResult(result)
  }
  return results
}
