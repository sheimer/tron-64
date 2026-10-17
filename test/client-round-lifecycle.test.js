import { AppCoordinator } from '../public/javascripts/appCoordinator.js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { MSG_TYPE, PROTOCOL_VERSION } from '../shared/protocol.js'

const original = {
  window: globalThis.window,
  document: globalThis.document,
  WebSocket: globalThis.WebSocket,
  sessionStorage: globalThis.sessionStorage,
  localStorage: globalThis.localStorage,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
}
const timers = new Map()
const callbacks = new Map()
let nextId = 0
globalThis.setTimeout = (callback, delay) => {
  const id = ++nextId
  timers.set(id, { callback, delay })
  callbacks.set(id, callback)
  return id
}
globalThis.clearTimeout = (id) => timers.delete(id)
function pending(delay) {
  return [...timers].filter(([, timer]) => timer.delay === delay)
}
function flush(delay) {
  for (const [id, timer] of pending(delay)) {
    timers.delete(id)
    timer.callback()
  }
}
class FakeSocket {
  static OPEN = 1
  static instances = []
  constructor() {
    this.readyState = 0
    this.listeners = new Map()
    this.sent = []
    FakeSocket.instances.push(this)
  }
  addEventListener(type, listener) {
    this.listeners.set(type, listener)
  }
  dispatch(type, event = {}) {
    this.listeners.get(type)?.(event)
  }
  send(frame) {
    this.sent.push(frame)
  }
  close() {
    this.readyState = 3
    this.dispatch('close')
  }
  receive(type, payload, extra = {}) {
    this.dispatch('message', {
      data: JSON.stringify({
        type,
        payload,
        protocolVersion: PROTOCOL_VERSION,
        ...extra,
      }),
    })
  }
  messages(type) {
    return this.sent
      .filter((frame) => typeof frame === 'string')
      .map((frame) => JSON.parse(frame))
      .filter((frame) => frame.type === type)
  }
}
class View {
  constructor(handlers = {}) {
    Object.assign(this, handlers)
  }
  show() {}
  hide() {}
  updatePlayersTable() {}
  updatePermissions() {}
  updateScores() {}
  updateState() {}
  updatePlayerPositions(players, positions) {
    this.positions = structuredClone(positions)
  }
  setSpectatorMode() {}
  updateSpeed() {}
  updateRoomControls(inRoom, enabled) {
    this.setSpectatorMode(inRoom && !enabled)
  }
  showFeedback() {}
}
class Renderer {
  constructor() {
    this.clears = 0
    this.resets = 0
  }
  setColors() {}
  clear() {
    this.clears++
  }
  draw() {}
  resetGrid() {
    this.resets++
  }
}
let network
try {
  const storage = new Map()
  globalThis.sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  }
  globalThis.document = { getElementById: () => null }
  globalThis.window = {
    location: { protocol: 'http:', hostname: 'localhost', port: '3000' },
    addEventListener() {},
    matchMedia: () => ({ matches: true }),
  }
  globalThis.WebSocket = FakeSocket
  const protocolUrl = pathToFileURL(
    new URL('../shared/protocol.js', import.meta.url).pathname,
  ).href
  const networkSource = readFileSync(
    new URL('../public/javascripts/network.js', import.meta.url),
    'utf8',
  ).replace("from '/shared/protocol.js'", `from '${protocolUrl}'`)
  ;({ network } = await import(
    `data:text/javascript,${encodeURIComponent(networkSource)}`
  ))
  const { state } =
    await import('../public/javascripts/state.js?round-lifecycle')
  const dependencies = {
    state,
    network,
    settings: { coloredPlayers: true, addListener() {} },
    SPEED: { NORMAL: 25 },
    Renderer,
    getThemeColors: () => ({
      bg: '#000',
      fg: '#fff',
      rose: '#f00',
      water: '#00f',
    }),
    onThemeChange() {},
    WelcomeView: View,
    SettingsView: View,
    LobbyView: View,
    ConfigView: View,
    GameView: View,
    MSG_TYPE,
    PLAYER_COLOR_KEYS: ['water'],
    GRID_SIZE: 100,
    BLOCK_SIZE: 4,
  }
  const app = new AppCoordinator(dependencies)
  network.maxReconnectAttempts = 0
  let socket = FakeSocket.instances[0]
  const open = (transport) => {
    transport.readyState = FakeSocket.OPEN
    transport.dispatch('open')
    transport.receive(MSG_TYPE.LOBBY_LIST, [])
  }
  open(socket)
  const info = (
    key,
    round = { stage: 'configuration', startId: null },
    firstRoundStarted = false,
  ) => ({
    key,
    name: key,
    players: [{ id: 'one' }, { id: 'two' }],
    eligiblePlayerCount: 2,
    interval: 25,
    firstRoundStarted,
    started: round.stage !== 'configuration',
    running: round.stage === 'running',
    scores: { gamecount: firstRoundStarted ? 1 : 0, players: [], messages: [] },
    round,
  })
  function join(
    key,
    { owner = false, bikes = false, round, played = false } = {},
  ) {
    state.setCurrentGame(key, key)
    if (owner) {
      state.saveRoomOwner(key, {
        ownerClientId: 'a'.repeat(32),
        roomOwnerToken: 'A'.repeat(43),
      })
    }
    if (bikes) {
      state.addLocalPlayer('one', { left: 65, right: 68 }, 'B'.repeat(43))
    }
    app.joinGame(key)
    const request = socket.messages(MSG_TYPE.JOIN_GAME).at(-1)
    socket.receive(
      MSG_TYPE.JOIN_RESULT,
      {
        key,
        accepted: bikes ? [{ id: 'one', inputHandle: 0 }] : [],
        rejected: [],
        roomOwner: owner
          ? { accepted: true, ownerClientId: 'a'.repeat(32) }
          : null,
      },
      { requestId: request.requestId },
    )
    socket.receive(MSG_TYPE.GAME_INFO, info(key, round, played))
  }
  const reset = (id, key = app.roomSession.currentGameKey) =>
    socket.receive(MSG_TYPE.GAME_RESET, {
      key,
      startId: id,
      positions: { one: 1, two: 2 },
    })
  const stage = (id, value, key = app.roomSession.currentGameKey, reason) =>
    socket.receive(MSG_TYPE.GAME_STATE, {
      key,
      startId: id,
      stage: value,
      ...(reason ? { reason } : {}),
    })
  const finish = (id, key = app.roomSession.currentGameKey) =>
    socket.receive(MSG_TYPE.GAME_FINISH, {
      key,
      startId: id,
      scores: { gamecount: 2, players: [], messages: [] },
    })
  const observed = () =>
    JSON.stringify({
      room: app.roomSession.currentGameKey,
      screen: state.screen,
      match: state.matchState,
      positions: state.positions,
      scores: state.scores,
      round: state.roundInfo,
      clears: app.renderer.clears,
      resets: app.renderer.resets,
    })

  join('room-a', { owner: true, bikes: true })
  reset('attempt-a')
  assert.equal(state.screen, 'game')
  assert.equal(state.matchState, 'start')
  const resetCallback = callbacks.get(pending(50).at(-1)[0])
  const pristine = observed()
  reset('foreign', 'room-b')
  stage('foreign', 'running', 'room-b')
  finish('foreign', 'room-b')
  stage('retired', 'configuration', 'room-a', 'STALE_CANCEL')
  finish('retired')
  assert.equal(
    observed(),
    pristine,
    'Wrong room/attempt events cannot mutate the active round',
  )
  flush(50)
  assert.equal(app.renderer.resets, 1)
  assert.deepEqual(socket.messages(MSG_TYPE.ARENA_READY).at(-1).payload, {
    startId: 'attempt-a',
  })

  stage('attempt-a', 'countdown')
  stage('attempt-a', 'configuration', 'room-a', 'ROSTER_CHANGED')
  assert.equal(
    state.screen,
    'config',
    'First cancellation routes an already visible game screen',
  )
  assert.equal(state.matchState, 'settingPlayers')
  assert.equal(state.roundInfo.firstRoundStarted, false)
  assert.equal(
    state.canStartRound(),
    true,
    'Creator retains first-start permission',
  )
  const cancelled = observed()
  resetCallback()
  assert.equal(
    observed(),
    cancelled,
    'Cancelled reset cannot clear the idle arena',
  )
  assert.equal(socket.messages(MSG_TYPE.ARENA_READY).length, 1)
  reset('attempt-b')
  const replacement = observed()
  stage('attempt-a', 'configuration', 'room-a', 'LATE_CANCEL')
  stage('attempt-a', 'running')
  finish('attempt-a')
  resetCallback()
  assert.equal(
    observed(),
    replacement,
    'A retired attempt cannot cancel or finish its replacement',
  )
  flush(50)
  stage('attempt-b', 'running')
  finish('attempt-b')
  assert.equal(state.matchState, 'scores')
  const reveal = callbacks.get(pending(1000).at(-1)[0])
  reset('attempt-c')
  const afterRetry = observed()
  reveal()
  assert.equal(
    observed(),
    afterRetry,
    'Old score reveal cannot finish a new attempt',
  )

  // Pending admission supplies positions without a historic GAME_RESET. An
  // authenticated spectator never contributes readiness, but can start later.
  join('spectator-room', {
    round: {
      stage: 'countdown',
      startId: 'snapshot-attempt',
      positions: { one: 3, two: 4 },
    },
    played: true,
  })
  assert.equal(state.screen, 'game')
  assert.equal(state.matchState, 'start')
  assert.deepEqual(state.positions, { one: 3, two: 4 })
  assert.deepEqual(app.gameView.positions, { one: 3, two: 4 })
  assert.equal(state.ownedPlayerIds.size, 0)
  assert.equal(state.canStartRound(), false)
  const spectatorReady = socket.messages(MSG_TYPE.ARENA_READY).length
  flush(50)
  assert.equal(socket.messages(MSG_TYPE.ARENA_READY).length, spectatorReady)
  stage('snapshot-attempt', 'finished', 'spectator-room', 'ROSTER_CHANGED')
  assert.equal(state.screen, 'game')
  assert.equal(state.matchState, 'finished')
  assert.equal(state.scores.gamecount, 1)
  assert.equal(
    state.canStartRound(),
    true,
    'Idle later start remains available to spectators',
  )
  app.gameView.onStartGame()
  assert.equal(socket.messages(MSG_TYPE.START_GAME).length, 1)

  for (const operation of ['leave', 'switch', 'close', 'generation']) {
    join(`guard-${operation}`, { bikes: true, played: true })
    reset(`reset-${operation}`)
    const delayedReset = callbacks.get(pending(50).at(-1)[0])
    stage(`reset-${operation}`, 'running')
    finish(`reset-${operation}`)
    const delayedReveal = callbacks.get(pending(1000).at(-1)[0])
    if (operation === 'leave') {
      app.leaveCurrentGame()
    } else if (operation === 'switch') {
      join('replacement-room', { bikes: true })
    } else if (operation === 'close') {
      socket.close()
    } else {
      network.generation++
    }
    const after = observed()
    const ready = socket.messages(MSG_TYPE.ARENA_READY).length
    delayedReset()
    delayedReveal()
    assert.equal(
      observed(),
      after,
      `${operation} invalidates both deferred callbacks`,
    )
    assert.equal(socket.messages(MSG_TYPE.ARENA_READY).length, ready)
    if (operation === 'close') {
      const old = socket
      network.connect()
      socket = FakeSocket.instances.at(-1)
      open(socket)
      join('new-generation', { bikes: true })
      reset('new-generation-round')
      const current = observed()
      old.receive(MSG_TYPE.GAME_RESET, {
        key: app.roomSession.currentGameKey,
        startId: 'old-socket',
        positions: {},
      })
      old.receive(MSG_TYPE.GAME_STATE, {
        key: app.roomSession.currentGameKey,
        startId: 'new-generation-round',
        stage: 'configuration',
        reason: 'OLD_SOCKET',
      })
      old.receive(MSG_TYPE.GAME_FINISH, {
        key: app.roomSession.currentGameKey,
        startId: 'new-generation-round',
        scores: {},
      })
      assert.equal(
        observed(),
        current,
        'Events from a previous socket generation are ignored',
      )
    }
  }
  // Use the actual view to catch visibility side effects of repeated screen
  // routing while the score-reveal timer deliberately preserves matchState.
  globalThis.localStorage = { getItem: () => null }
  let gameViewSource = readFileSync(
    new URL('../public/javascripts/ui/gameView.js', import.meta.url),
    'utf8',
  )
  for (const [specifier, relative] of [
    ['../settings.js', '../public/javascripts/settings.js'],
    ['../state.js', '../public/javascripts/state.js?round-lifecycle'],
    ['/shared/constants.js', '../shared/constants.js'],
    ['/shared/utils.js', '../shared/utils.js'],
  ]) {
    gameViewSource = gameViewSource.replace(
      `from '${specifier}'`,
      `from '${new URL(relative, import.meta.url).href}'`,
    )
  }
  const { GameView } = await import(
    `data:text/javascript,${encodeURIComponent(gameViewSource)}`
  )
  const elements = new Map(
    ['arena', 'scores', 'scores-waiting', 'playernames'].map((id) => [
      id,
      { style: {}, classList: { add() {}, remove() {} } },
    ]),
  )
  globalThis.document = { getElementById: (id) => elements.get(id) ?? null }
  app.gameView = new GameView({ onStartGame() {}, onLeaveGame() {} })
  app.roundLifecycle.gameView = app.gameView
  join('score-visibility', { bikes: true, played: true })
  reset('visible-round')
  assert.equal(elements.get('arena').style.display, 'block')
  flush(50)
  stage('visible-round', 'running')
  finish('visible-round')
  const revealTimer = app.roundLifecycle.scoreTimer
  for (let i = 0; i < 2; i++) {
    socket.receive(
      MSG_TYPE.GAME_INFO,
      info(
        'score-visibility',
        { stage: 'finished', startId: 'visible-round' },
        true,
      ),
    )
    assert.equal(state.matchState, 'scores')
    assert.equal(app.roundLifecycle.scoreTimer, revealTimer)
    assert.equal(
      elements.get('arena').style.display,
      'none',
      'A repeated finished snapshot must not reopen the arena during score reveal',
    )
    assert.equal(elements.get('scores').style.display, 'block')
  }
  flush(1000)
  assert.equal(state.matchState, 'finished')
  app.gameView.hide()
  app.gameView.show()
  assert.equal(elements.get('arena').style.display, 'none')
  assert.equal(elements.get('scores').style.display, 'block')
  reset('next-visible-round')
  assert.equal(elements.get('arena').style.display, 'block')
  assert.equal(elements.get('scores').style.display, 'none')
  flush(50)
  app.leaveCurrentGame()
  network.stopPing()
  console.log(
    'Client round lifecycle: actual coordinator scoped events, pending snapshots, cancellation routing and stale callback guards passed',
  )
} finally {
  network?.stopPing()
  globalThis.window = original.window
  globalThis.document = original.document
  globalThis.WebSocket = original.WebSocket
  globalThis.sessionStorage = original.sessionStorage
  globalThis.localStorage = original.localStorage
  globalThis.setTimeout = original.setTimeout
  globalThis.clearTimeout = original.clearTimeout
}
