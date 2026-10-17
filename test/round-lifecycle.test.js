import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'
import { GameSession } from '../server/GameSession.js'

// A cleared timer can already be queued by the host. Keep its callback available
// so cleanup assertions challenge the callback guards as well as clearTimeout.
const original = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  now: Date.now,
}
let now = 1000
let timerId = 0
const timers = new Map()
const callbacks = new Map()
const rooms = []
const dataDir = mkdtempSync(path.join(tmpdir(), 'tron-round-lifecycle-'))
const previousDataDir = process.env.DATA_DIR
process.env.DATA_DIR = dataDir
const { GameServer } = await import('../server/GameServer.js')
if (previousDataDir === undefined) {
  delete process.env.DATA_DIR
} else {
  process.env.DATA_DIR = previousDataDir
}
const publicInfo = (game) =>
  GameServer.prototype.getGameInfo.call({ getGame: () => game }, game.key)
globalThis.setTimeout = (callback, delay) => {
  const id = ++timerId
  timers.set(id, { callback, at: now + delay, delay })
  callbacks.set(id, callback)
  return id
}
globalThis.clearTimeout = (id) => timers.delete(id)
Date.now = () => now
function advance(ms) {
  const until = now + ms
  for (;;) {
    const next = [...timers].filter(([, timer]) => timer.at <= until)
    next.sort((a, b) => a[1].at - b[1].at || a[0] - b[0])
    if (!next.length) {
      break
    }
    const [id, timer] = next[0]
    now = timer.at
    timers.delete(id)
    timer.callback()
  }
  now = until
}
const socket = (game) => ({
  readyState: WebSocket.OPEN,
  gameKey: game.key,
  playerIds: new Set(),
  handlesById: new Map(),
  idsByHandle: new Map(),
})
function fixture({
  split = false,
  disconnected = false,
  six = false,
  physics = false,
} = {}) {
  const events = { states: [], resets: [], finishes: [] }
  const game = new GameSession({
    key: `lifecycle-${rooms.length}`,
    interval: 25,
  })
  rooms.push(game)
  const creator = socket(game)
  const bikes = socket(game)
  const second = split ? socket(game) : bikes
  const spectator = socket(game)
  for (const client of new Set([creator, bikes, second, spectator])) {
    game.connect({
      client,
      onstate: (event) => events.states.push(structuredClone(event)),
      onreset: (event) => events.resets.push(structuredClone(event)),
      onfinish: (event) => events.finishes.push(structuredClone(event)),
    })
  }
  game.roomOwner.create()
  game.roomOwner.bind(creator)
  for (const id of [
    'one',
    'two',
    ...(six ? ['three', 'four', 'five', 'six'] : []),
  ]) {
    assert.equal(game.addPlayer({ id, left: 65, right: 68 }).ok, true)
    game.ownership.register(id, id === 'two' ? second : bikes)
  }
  if (disconnected) {
    assert.equal(game.addPlayer({ id: 'away', left: 70, right: 71 }).ok, true)
    game.ownership.register('away', spectator)
    game.ownership.release('away', spectator)
    game.disconnectPlayer('away')
  }
  let launches = 0
  const startRound = game.arena.startRound.bind(game.arena)
  game.arena.startRound = () => {
    launches++
    startRound()
  }
  // Physics scheduling is observed without allowing incidental collisions to
  // end a round while the controlled clock exercises preparation/countdown.
  if (!physics) {
    game.scheduleNextTick = () => {}
  }
  let saves = 0
  let current = true
  const errors = []
  const options = {
    save: () => {
      saves++
      assert.equal(game.firstRoundStarted, true)
      assert.equal(game.running, false, 'The durable marker precedes physics')
      return true
    },
    isCurrent: () => current,
    onError: (...args) => errors.push(args),
    requestId: 'round-request',
  }
  const begin = (requester = creator, extra = {}) => {
    const result = game.beginRound(requester, { ...options, ...extra })
    assert.equal(result.ok, true)
    assert.ok(game.startId && typeof game.startId === 'string')
    return { id: game.startId, pending: result.pending }
  }
  return {
    game,
    creator,
    bikes,
    second,
    spectator,
    events,
    begin,
    errors,
    launches: () => launches,
    saves: () => saves,
    supersede: () => {
      current = false
    },
  }
}
function pendingCallbacks(game) {
  return [game.pendingStart.fallbackTimer, game.pendingStart.startTimer]
    .filter((id) => id != null)
    .map((id) => callbacks.get(id))
}
const observable = (game) =>
  JSON.stringify({
    stage: game.stage,
    id: game.startId,
    positions: game.arena?.players.map((player) => player.pos),
    stats: game.stats,
    interval: game.interval,
    registration: game.acceptingPlayers,
    launched: game.firstRoundStarted,
  })
const scoreSnapshot = (game) =>
  JSON.stringify({
    ...game.stats,
    players: game.stats.players.map(({ connected, ...player }) => player),
  })
function idleAfterCancel(f, previousStats, canRegister = true) {
  assert.equal(f.game.pendingStart, null)
  assert.equal(f.game.startId, null)
  assert.equal(f.game.running, false)
  assert.equal(
    f.game.stage,
    f.game.firstRoundStarted ? 'finished' : 'configuration',
  )
  assert.equal(f.game.acceptingPlayers, canRegister)
  assert.equal(scoreSnapshot(f.game), previousStats)
  assert.equal(
    f.events.finishes.length,
    0,
    'Cancellation cannot fabricate a result',
  )
}
try {
  // Two bikes sharing a keyboard contribute exactly one expected owner ACK.
  const f = fixture()
  assert.equal(f.game.stage, 'configuration')
  const first = f.begin()
  assert.equal(f.game.stage, 'preparation')
  assert.equal(f.game.firstRoundStarted, false)
  assert.equal(
    publicInfo(f.game).started,
    true,
    'Preparation is publicly started before physics',
  )
  assert.equal(publicInfo(f.game).running, false)
  assert.equal(publicInfo(f.game).round.startId, first.id)
  assert.deepEqual(
    publicInfo(f.game).round.positions,
    f.game.pendingStart.positions,
  )
  assert.deepEqual(f.events.resets.at(-1), {
    key: f.game.key,
    startId: first.id,
    positions: structuredClone(f.game.pendingStart.positions),
  })
  const fallback = pendingCallbacks(f.game)[0]
  for (const [client, id] of [
    [f.spectator, first.id],
    [f.creator, first.id],
    [f.bikes, 'retired-attempt'],
    [socket({ key: 'elsewhere' }), first.id],
  ]) {
    f.game.acknowledgeReady(client, id)
    assert.equal(f.game.stage, 'preparation')
  }
  f.game.acknowledgeReady(f.bikes, first.id)
  assert.equal(f.game.stage, 'countdown')
  const countdownTimer = f.game.pendingStart.startTimer
  f.game.acknowledgeReady(f.bikes, first.id)
  fallback()
  assert.equal(f.game.pendingStart.startTimer, countdownTimer)
  advance(999)
  assert.equal(f.launches(), 0)
  advance(1)
  assert.equal(f.launches(), 1)
  assert.equal(f.saves(), 1)
  assert.equal(f.game.stage, 'running')
  assert.equal(f.game.startId, first.id)
  fallback()
  callbacks.get(countdownTimer)()
  assert.equal(
    f.launches(),
    1,
    'Readiness/fallback/stale countdown launch once',
  )
  f.game.arena.finish()
  assert.equal(f.game.stage, 'finished')
  assert.equal(f.game.startId, first.id)
  assert.equal(f.events.finishes.at(-1).key, f.game.key)
  assert.equal(f.events.finishes.at(-1).startId, first.id)
  assert.equal(f.events.finishes.at(-1).scores.gamecount, 1)

  const separate = fixture({ split: true })
  separate.begin()
  separate.game.acknowledgeReady(separate.bikes, separate.game.startId)
  separate.game.acknowledgeReady(separate.bikes, separate.game.startId)
  assert.equal(separate.game.stage, 'preparation')
  separate.game.acknowledgeReady(separate.second, separate.game.startId)
  assert.equal(separate.game.stage, 'countdown')
  advance(1000)
  assert.equal(separate.launches(), 1)

  const timeout = fixture()
  timeout.begin()
  advance(1999)
  assert.equal(timeout.game.stage, 'preparation')
  advance(1)
  assert.equal(timeout.game.stage, 'countdown')
  advance(1000)
  assert.equal(timeout.launches(), 1, 'Fallback launches without readiness')

  // Every captured roster slot matters, including one absent at admission.
  for (const stage of ['preparation', 'countdown']) {
    for (const mutation of [
      'leave',
      'switch',
      'close',
      'handover',
      'late-admit',
      'creator-release',
      'creator-replace',
      'creator-switch',
      'creator-close',
    ]) {
      const other = fixture({ disconnected: mutation === 'late-admit' })
      other.begin()
      if (stage === 'countdown') {
        other.game.acknowledgeReady(other.bikes, other.game.startId)
      }
      const stale = pendingCallbacks(other.game)
      const stats = scoreSnapshot(other.game)
      if (mutation === 'leave') {
        other.game.ownership.release('one', other.bikes)
        other.game.disconnectPlayer('one')
      } else if (mutation === 'switch') {
        other.bikes.gameKey = 'replacement-room'
      } else if (mutation === 'close') {
        other.bikes.readyState = WebSocket.CLOSED
      } else if (mutation === 'handover') {
        other.game.ownership.transfer('one', other.spectator)
      } else if (mutation === 'late-admit') {
        other.game.ownership.transfer('away', other.spectator)
        other.game.reconnectPlayer('away')
      } else if (mutation === 'creator-release') {
        other.game.roomOwner.release(other.creator)
      } else if (mutation === 'creator-switch') {
        other.creator.gameKey = 'other-room'
      } else if (mutation === 'creator-close') {
        other.creator.readyState = WebSocket.CLOSED
      } else {
        other.game.roomOwner.bind(other.spectator)
      }
      other.game.reconcilePendingStart()
      idleAfterCancel(other, stats)
      assert.equal(
        other.events.states.at(-1).startId,
        other.events.resets.at(-1).startId,
        'Cancellation identifies the retired attempt',
      )
      assert.ok(
        other.events.states.at(-1).reason,
        `${mutation} explains cancellation`,
      )
      for (const callback of stale) {
        callback()
      }
      advance(4000)
      assert.equal(
        other.launches(),
        0,
        `${stage}/${mutation}: no stale physics`,
      )
    }
  }

  const retry = fixture()
  const retired = retry.begin()
  const oldPreparation = pendingCallbacks(retry.game)
  retry.game.acknowledgeReady(retry.bikes, retired.id)
  const oldCountdown = pendingCallbacks(retry.game)
  retry.game.cancelPendingStart('EXPLICIT_CANCEL')
  const replacementAttempt = retry.begin()
  assert.notEqual(replacementAttempt.id, retired.id)
  const pristineRetry = observable(retry.game)
  const retryEvents = JSON.stringify(retry.events)
  retry.game.acknowledgeReady(retry.bikes, retired.id)
  for (const callback of [...oldPreparation, ...oldCountdown]) {
    callback()
  }
  assert.equal(observable(retry.game), pristineRetry)
  assert.equal(JSON.stringify(retry.events), retryEvents)
  retry.game.stop()

  for (const stage of ['preparation', 'countdown']) {
    for (const operation of ['reset', 'stop', 'destroy']) {
      const other = fixture()
      other.begin()
      if (stage === 'countdown') {
        other.game.acknowledgeReady(other.bikes, other.game.startId)
      }
      const stale = pendingCallbacks(other.game)
      const stats = scoreSnapshot(other.game)
      other.game[operation]()
      if (operation === 'destroy') {
        assert.equal(other.game.stage, 'destroyed')
      } else {
        idleAfterCancel(other, stats)
      }
      const state = observable(other.game)
      const events = JSON.stringify(other.events)
      for (const callback of stale) {
        callback()
      }
      advance(4000)
      assert.equal(observable(other.game), state)
      assert.equal(
        JSON.stringify(other.events),
        events,
        'Retired callbacks cannot broadcast',
      )
      assert.equal(other.launches(), 0)
    }
  }

  // Spectator-only changes do not modify captured participant readiness.
  const spectators = fixture()
  spectators.begin()
  const pending = spectators.game.pendingStart
  const arrival = socket(spectators.game)
  spectators.game.connect({ client: arrival })
  spectators.spectator.gameKey = null
  spectators.game.reconcilePendingStart()
  assert.equal(spectators.game.pendingStart, pending)
  spectators.game.acknowledgeReady(spectators.bikes, spectators.game.startId)
  advance(1000)
  spectators.game.stop()
  const previous = spectators.game.startId
  const later = spectators.begin(arrival)
  assert.notEqual(later.id, previous, 'Every new attempt has fresh identity')
  spectators.game.roomOwner.bind(spectators.spectator)
  arrival.gameKey = null
  spectators.game.reconcilePendingStart()
  assert.equal(spectators.game.stage, 'preparation')
  advance(3000)
  assert.equal(spectators.launches(), 2)
  assert.equal(spectators.saves(), 1, 'The durable launch marker is saved once')
  spectators.game.stop()
  spectators.begin(spectators.bikes)
  const playedStats = scoreSnapshot(spectators.game)
  spectators.game.cancelPendingStart('TEST_CANCELLED')
  idleAfterCancel(spectators, playedStats, false)

  for (const stage of ['preparation', 'countdown']) {
    const rejected = fixture()
    rejected.begin()
    if (stage === 'countdown') {
      rejected.game.acknowledgeReady(rejected.bikes, rejected.game.startId)
    }
    const pending = rejected.game.pendingStart
    const before = observable(rejected.game)
    const timerEntries = [...timers]
    for (const operation of [
      () => rejected.game.beginRound(rejected.creator),
      () => rejected.game.changeInterval(rejected.creator, 40, () => true),
      () => rejected.game.beginRound(socket({ key: 'different' })),
    ]) {
      assert.equal(operation().ok, false)
      assert.equal(observable(rejected.game), before)
      assert.equal(rejected.game.pendingStart, pending)
      assert.deepEqual([...timers], timerEntries)
    }
    assert.equal(
      rejected.game.addPlayer({ id: 'new', left: 70, right: 71 }).ok,
      false,
    )
    assert.equal(observable(rejected.game), before)
    rejected.game.stop()
  }

  // A queued physics callback from the previous attempt must not acquire the
  // next attempt merely because this.running becomes true again.
  const ticking = fixture({ physics: true })
  ticking.begin()
  ticking.game.acknowledgeReady(ticking.bikes, ticking.game.startId)
  advance(1000)
  const retiredTick = callbacks.get(ticking.game.timer)
  ticking.game.stop()
  ticking.begin(ticking.spectator)
  ticking.game.acknowledgeReady(ticking.bikes, ticking.game.startId)
  advance(1000)
  let physicsTicks = 0
  ticking.game.arena.run = () => {
    physicsTicks++
  }
  const activeTimer = ticking.game.timer
  const nextTickTime = ticking.game.nextTickTime
  retiredTick()
  assert.equal(
    physicsTicks,
    0,
    'Retired physics callback cannot run a replacement attempt',
  )
  assert.equal(ticking.game.timer, activeTimer)
  assert.equal(ticking.game.nextTickTime, nextTickTime)
  ticking.game.stop()

  const reentrant = fixture({ physics: true })
  reentrant.begin()
  reentrant.game.acknowledgeReady(reentrant.bikes, reentrant.game.startId)
  advance(1000)
  let replacementTimer
  let replacementTime
  reentrant.game.arena.run = () => {
    reentrant.game.stop()
    const next = reentrant.begin(reentrant.spectator)
    assert.equal(reentrant.game.launchRound(next.pending, () => true).ok, true)
    replacementTimer = reentrant.game.timer
    replacementTime = reentrant.game.nextTickTime
  }
  callbacks.get(reentrant.game.timer)()
  assert.equal(
    reentrant.game.timer,
    replacementTimer,
    'A tick retired during arena.run cannot reschedule its replacement',
  )
  assert.equal(
    reentrant.game.nextTickTime,
    replacementTime,
    'The replacement tick deadline is independent of the retired tick',
  )
  reentrant.game.stop()

  const replacedRoom = fixture({ physics: true })
  replacedRoom.begin()
  replacedRoom.game.acknowledgeReady(
    replacedRoom.bikes,
    replacedRoom.game.startId,
  )
  advance(1000)
  let invalidPhysics = 0
  replacedRoom.game.arena.run = () => {
    invalidPhysics++
  }
  replacedRoom.supersede()
  const liveRoomTick = callbacks.get(replacedRoom.game.timer)
  liveRoomTick()
  assert.equal(
    invalidPhysics,
    0,
    'A removed room instance cannot run physics even when its local stage is running',
  )
  replacedRoom.game.destroy()
  liveRoomTick()
  assert.equal(
    invalidPhysics,
    0,
    'Destroyed room physics callbacks cannot touch their retired arena',
  )

  const full = fixture({ six: true })
  assert.equal(
    publicInfo(full.game).started,
    false,
    'A full roster in configuration has not started',
  )
  full.begin()
  full.game.cancelPendingStart()
  const cancelledFull = publicInfo(full.game)
  assert.equal(cancelledFull.started, false)
  assert.equal(cancelledFull.running, false)
  assert.deepEqual(cancelledFull.round, {
    stage: 'configuration',
    startId: null,
  })
  assert.equal(
    full.game.acceptingPlayers,
    false,
    'Cancellation respects the six-slot limit',
  )

  const failed = fixture()
  const stats = scoreSnapshot(failed.game)
  failed.begin(failed.creator, { save: () => false })
  advance(3000)
  idleAfterCancel(failed, stats)
  assert.equal(failed.launches(), 0)
  assert.equal(
    failed.errors.length,
    1,
    'Failed durable launch reports its error',
  )
  assert.match(JSON.stringify(failed.errors), /PERSISTENCE_FAILED/)
  assert.equal(failed.events.states.at(-1).reason, 'PERSISTENCE_FAILED')

  for (const mutation of [
    'room-replaced',
    'roster-changed',
    'creator-replaced',
  ]) {
    const final = fixture()
    final.begin()
    final.game.acknowledgeReady(final.bikes, final.game.startId)
    if (mutation === 'room-replaced') {
      final.supersede()
    } else if (mutation === 'roster-changed') {
      final.game.ownership.transfer('one', final.spectator)
    } else {
      final.game.roomOwner.bind(final.spectator)
    }
    advance(1000)
    assert.equal(
      final.launches(),
      0,
      `${mutation} is revalidated at final callback`,
    )
    assert.equal(final.game.firstRoundStarted, false)
  }
  console.log(
    'Round lifecycle: controlled readiness, cancellation, final authority and exactly-once durable launch passed',
  )
} finally {
  for (const game of rooms) {
    if (game.arena) {
      game.destroy()
    }
  }
  globalThis.setTimeout = original.setTimeout
  globalThis.clearTimeout = original.clearTimeout
  Date.now = original.now
  rmSync(dataDir, { recursive: true, force: true })
}
