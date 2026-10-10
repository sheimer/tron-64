import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { state } from '../public/javascripts/state.js'
import { MSG_TYPE } from '../shared/protocol.js'

const originalDocument = globalThis.document
const originalWindow = globalThis.window
const originalFixture = globalThis.__registrationFixture
const originalSetTimeout = globalThis.setTimeout
const originalClearTimeout = globalThis.clearTimeout

class View {
  constructor(handlers = {}) {
    Object.assign(this, handlers)
    this.feedback = []
  }

  show() {}
  hide() {}
  updatePlayersTable() {}
  updateScores() {}
  updateState() {}
  updatePlayerPositions() {}
  setSpectatorMode() {}
  updateSpeed() {}
  showFeedback(message) {
    this.feedback.push(message)
  }
}

try {
  const connectionFeedback = { textContent: '', style: { display: 'none' } }
  globalThis.document = {
    getElementById: (id) =>
      id === 'connection-feedback' ? connectionFeedback : null,
  }
  globalThis.window = { addEventListener: () => {} }
  const listeners = new Map()
  const sends = []
  const handles = new Map()
  const directions = []
  const timers = new Map()
  let timerId = 0
  globalThis.setTimeout = (callback) => {
    timers.set(++timerId, callback)
    return timerId
  }
  globalThis.clearTimeout = (id) => timers.delete(id)
  const network = {
    generation: 1,
    on(type, callback) {
      listeners.set(type, callback)
    },
    emit(type, payload, message) {
      listeners.get(type)?.(payload, message)
    },
    addPlayer(player, requestId) {
      sends.push({ player, requestId })
      return true
    },
    bindPlayer(id, handle) {
      handles.set(id, handle)
      return true
    },
    changeDir({ id }) {
      directions.push(id)
      return handles.has(id)
    },
    joinGame() {
      handles.clear()
    },
    leaveGame() {
      handles.clear()
    },
    requestLobbyList() {},
  }
  globalThis.__registrationFixture = {
    state,
    settings: { coloredPlayers: true, addListener: () => {} },
    SPEED: { NORMAL: 25 },
    network,
    Renderer: class {
      setColors() {}
      clear() {}
      draw() {}
      resetGrid() {}
    },
    getThemeColors: () => ({
      bg: '#000',
      fg: '#fff',
      rose: '#f00',
      water: '#00f',
    }),
    onThemeChange: () => {},
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
  const mainPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../public/javascripts/main.js',
  )
  const mainSource = readFileSync(mainPath, 'utf8')
    .replace(/^import .*\n/gm, '')
    .replace(
      'export const app = new AppCoordinator()',
      'export { AppCoordinator }',
    )
  const bindings = Object.keys(globalThis.__registrationFixture).join(', ')
  const { AppCoordinator } = await import(
    `data:text/javascript,${encodeURIComponent(`const { ${bindings} } = globalThis.__registrationFixture;\n${mainSource}`)}`
  )
  const app = new AppCoordinator()
  assert.match(
    readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../views/index.pug',
      ),
      'utf8',
    ),
    /^ {2}#connection-feedback[^\n]*\n {2}button#btn-reload-connection[^\n]*\n {2}#layout$/m,
  )
  network.emit(
    MSG_TYPE.ERROR,
    'Game protocol changed. Reload this page to continue.',
    { code: 'PROTOCOL_MISMATCH' },
  )
  assert.equal(state.screen, 'welcome')
  assert.match(connectionFeedback.textContent, /reload/i)
  assert.notEqual(connectionFeedback.style.display, 'none')
  app.setScreen('lobby')
  assert.match(connectionFeedback.textContent, /reload/i)
  assert.notEqual(connectionFeedback.style.display, 'none')
  state.setCurrentGame('room-a', 'Room A')
  app.currentGameKey = 'room-a'
  app.configView.onAddPlayer({ name: 'Alice', left: 65, right: 68 })
  assert.equal(sends.length, 1)
  const { player, requestId } = sends[0]
  assert.equal(app.localPlayersConfig.size, 0)
  assert.equal(state.isLocalPlayer(player.id), false)
  app.onKeyDown({ repeat: false, keyCode: 65 })
  assert.deepEqual(directions, [])
  const retry = timers.get(timerId)
  timers.delete(timerId)
  retry()
  assert.equal(sends.length, 2)
  assert.deepEqual(sends[1], sends[0])

  network.emit(MSG_TYPE.GAME_INFO, {
    key: 'room-a',
    players: [{ ...player, connected: true }],
  })
  assert.equal(state.players[0].isLocal, false)
  network.emit(
    MSG_TYPE.PLAYER_REGISTERED,
    {
      key: 'wrong-room',
      id: player.id,
      reconnectToken: 'secret',
      inputHandle: 7,
    },
    { requestId },
  )
  network.emit(
    MSG_TYPE.PLAYER_REGISTERED,
    {
      key: 'room-a',
      id: 'another-player',
      reconnectToken: 'secret',
      inputHandle: 7,
    },
    { requestId },
  )
  assert.equal(state.isLocalPlayer(player.id), false)
  assert.equal(handles.size, 0)

  for (const inputHandle of [-1, 256, 1.5, '7']) {
    network.emit(
      MSG_TYPE.PLAYER_REGISTERED,
      { key: 'room-a', id: player.id, reconnectToken: 'secret', inputHandle },
      { requestId },
    )
    assert.equal(handles.size, 0)
    assert.equal(state.isLocalPlayer(player.id), false)
  }

  network.emit(
    MSG_TYPE.PLAYER_REGISTERED,
    { key: 'room-a', id: player.id, reconnectToken: 'secret', inputHandle: 7 },
    { requestId },
  )
  assert.equal(app.pendingRegistrations.size, 0)
  assert.equal(state.isLocalPlayer(player.id), true)
  assert.equal(state.players[0].isLocal, true)
  assert.equal(handles.get(player.id), 7)
  assert.equal(app.localPlayersConfig.get(player.id).left, 65)
  app.onKeyDown({ repeat: false, keyCode: 65 })
  assert.deepEqual(directions, [player.id])
  network.emit(
    MSG_TYPE.PLAYER_REGISTERED,
    { key: 'room-a', id: player.id, reconnectToken: 'secret', inputHandle: 9 },
    { requestId },
  )
  assert.equal(handles.get(player.id), 7)

  app.setScreen('game')
  network.emit(
    MSG_TYPE.ERROR,
    'Input handles exhausted. Open a fresh connection and register a new player.',
    { code: 'INPUT_HANDLE_EXHAUSTED' },
  )
  assert.match(connectionFeedback.textContent, /fresh connection/i)
  assert.notEqual(connectionFeedback.style.display, 'none')

  app.configView.onAddPlayer({ name: 'Bob', left: 66, right: 78 })
  const second = sends.at(-1)
  network.generation++
  network.emit(
    MSG_TYPE.PLAYER_REGISTERED,
    {
      key: 'room-a',
      id: second.player.id,
      reconnectToken: 'other',
      inputHandle: 8,
    },
    { requestId: second.requestId },
  )
  assert.equal(state.isLocalPlayer(second.player.id), false)
  app.clearPendingRegistrations()
  network.emit('close')
  assert.equal(state.screen, 'game')
  assert.match(connectionFeedback.textContent, /connection lost/i)
  assert.notEqual(connectionFeedback.style.display, 'none')
  network.emit('open')
  assert.match(connectionFeedback.textContent, /authenticating saved players/i)
  assert.notEqual(connectionFeedback.style.display, 'none')
  network.emit(MSG_TYPE.GAME_INFO, { key: 'room-a', players: [] })
  assert.match(
    connectionFeedback.textContent,
    /waiting for saved player authentication/i,
  )
  assert.notEqual(connectionFeedback.style.display, 'none')
  app.leaveCurrentGame()
  assert.equal(state.isLocalPlayer(player.id), false)
  assert.equal(handles.size, 0)
  assert.equal(connectionFeedback.style.display, 'none')
  console.log(
    'Client registration: public info and stale acknowledgements cannot grant controls',
  )
} finally {
  globalThis.document = originalDocument
  globalThis.window = originalWindow
  globalThis.__registrationFixture = originalFixture
  globalThis.setTimeout = originalSetTimeout
  globalThis.clearTimeout = originalClearTimeout
}
