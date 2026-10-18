import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { GameSession } from '../server/GameSession.js'

const games = []
const socket = (game) => ({
  readyState: WebSocket.OPEN,
  gameKey: game.key,
  handlesById: new Map(),
  idsByHandle: new Map(),
})
function room() {
  const game = new GameSession({ key: `room-${games.length}`, interval: 25 })
  games.push(game)
  game.scheduleNextTick = () => {}
  const creator = socket(game)
  const bikes = socket(game)
  const spectator = socket(game)
  for (const client of [creator, bikes, spectator]) {
    game.connect({ client })
  }
  const credential = game.roomOwner.create()
  assert.equal(game.roomOwner.verify(credential), true)
  game.roomOwner.bind(creator)
  for (const id of ['one', 'two']) {
    assert.equal(game.addPlayer({ id, left: 65, right: 68 }).ok, true)
    game.ownership.register(id, bikes)
  }
  return { game, creator, bikes, spectator, credential }
}
const snapshot = (game) =>
  JSON.stringify({
    positions: game.arena.players.map((player) => player.pos),
    scores: game.stats,
    interval: game.interval,
    acceptingPlayers: game.acceptingPlayers,
    firstRoundStarted: game.firstRoundStarted,
  })
function rejectsUnchanged(game, operation, code) {
  const before = snapshot(game)
  const pending = game.pendingStart
  const timer = game.timer
  assert.deepEqual(operation(), { ok: false, code })
  assert.equal(snapshot(game), before)
  assert.equal(game.pendingStart, pending)
  assert.equal(game.timer, timer)
}
try {
  const { game, creator, bikes, spectator } = room()
  assert.equal([...game.ownership.owners.values()].includes(creator), false)
  assert.equal(game.eligiblePlayerCount, 2, 'Two bikes on one client qualify')
  rejectsUnchanged(game, () => game.beginRound(bikes), 'CREATOR_REQUIRED')
  rejectsUnchanged(game, () => game.beginRound(spectator), 'CREATOR_REQUIRED')
  rejectsUnchanged(game, () => game.beginRound(socket(game)), 'NOT_IN_ROOM')
  rejectsUnchanged(
    game,
    () => game.changeInterval(bikes, 40, () => true),
    'CREATOR_REQUIRED',
  )
  for (const invalid of [9, 501, 25.5, '25', null, NaN, Infinity]) {
    rejectsUnchanged(
      game,
      () => game.changeInterval(creator, invalid, () => true),
      'INVALID_INTERVAL',
    )
  }
  rejectsUnchanged(
    game,
    () => game.changeInterval(creator, 40, () => false),
    'PERSISTENCE_FAILED',
  )
  assert.equal(game.changeInterval(creator, 10, () => true).ok, true)
  assert.equal(game.changeInterval(creator, 500, () => true).ok, true)
  game.disconnectPlayer('two')
  rejectsUnchanged(game, () => game.beginRound(creator), 'INSUFFICIENT_PLAYERS')
  game.reconnectPlayer('two')
  bikes.readyState = WebSocket.CLOSED
  assert.equal(game.eligiblePlayerCount, 0)
  rejectsUnchanged(game, () => game.beginRound(creator), 'INSUFFICIENT_PLAYERS')
  bikes.readyState = WebSocket.OPEN
  const { pending } = game.beginRound(creator)
  assert.equal(game.firstRoundStarted, false)
  rejectsUnchanged(game, () => game.beginRound(creator), 'ROUND_PENDING')
  rejectsUnchanged(
    game,
    () => game.changeInterval(creator, 40, () => true),
    'ROUND_PENDING',
  )
  assert.equal(
    game.addPlayer({ id: 'late', left: 70, right: 71 }).code,
    'REGISTRATION_CLOSED',
  )
  assert.deepEqual(
    game.launchRound(pending, () => {
      assert.equal(game.running, false)
      assert.equal(
        game.firstRoundStarted,
        true,
        'Persist the launch decision before physics',
      )
      return false
    }),
    { ok: false, code: 'PERSISTENCE_FAILED' },
  )
  assert.equal(game.firstRoundStarted, false)
  assert.equal(game.pendingStart, null)
  assert.equal(game.acceptingPlayers, true)
  assert.equal(game.stats.gamecount, 0)
  rejectsUnchanged(game, () => game.beginRound(spectator), 'CREATOR_REQUIRED')
  const success = game.beginRound(creator).pending
  assert.equal(game.launchRound(success, () => true).ok, true)
  assert.equal(game.running, true)
  assert.equal(game.firstRoundStarted, true)
  rejectsUnchanged(game, () => game.beginRound(spectator), 'ROUND_RUNNING')
  rejectsUnchanged(
    game,
    () => game.changeInterval(creator, 40, () => true),
    'ROUND_RUNNING',
  )
  game.stop()
  game.roomOwner.release(creator)
  creator.gameKey = null
  for (const requester of [spectator, bikes]) {
    const next = game.beginRound(requester).pending
    assert.ok(next, 'Any joined client may request a later round')
    // Later spectator departure alone does not invalidate a valid attempt.
    if (requester === spectator) {
      requester.gameKey = null
    }
    assert.equal(
      game.launchRound(next, () => {
        throw new Error('Marker already durable')
      }).ok,
      true,
    )
    game.stop()
  }
  assert.equal(
    game.stats.gamecount,
    0,
    'Requests and trusted stops do not fabricate results',
  )

  // Revalidate first authority and connected bike owners at the launch boundary.
  for (const change of ['owner', 'bike']) {
    const { game: other, creator: initial, bikes: participant } = room()
    const attempt = other.beginRound(initial).pending
    if (change === 'owner') {
      other.roomOwner.bind(socket(other))
    } else {
      participant.gameKey = 'elsewhere'
    }
    assert.equal(
      other.launchRound(attempt, () => true).code,
      change === 'owner' ? 'CREATOR_REQUIRED' : 'INSUFFICIENT_PLAYERS',
    )
    assert.equal(other.firstRoundStarted, false)
    assert.equal(other.pendingStart, null)
    assert.equal(other.acceptingPlayers, true)
  }
  const { game: stopped, creator: initial } = room()
  const retired = stopped.beginRound(initial).pending
  stopped.stop()
  assert.equal(stopped.launchRound(retired, () => true).ok, false)
  assert.equal(stopped.running, false)
  const destroyed = stopped.beginRound(initial).pending
  stopped.destroy()
  assert.equal(stopped.launchRound(destroyed, () => true).ok, false)
  assert.equal(stopped.firstRoundStarted, false)
  console.log(
    'Round authority domain: independent creator, eligibility, durable launch and rejection invariants passed',
  )
} finally {
  for (const game of games) {
    if (game.arena) {
      game.destroy()
    }
  }
}
