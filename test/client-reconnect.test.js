import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import {
  BINARY_OPCODE,
  MSG_TYPE,
  PROTOCOL_VERSION,
} from '../shared/protocol.js'

const directory = path.dirname(fileURLToPath(import.meta.url))
const originalWindow = globalThis.window
const originalDocument = globalThis.document
const originalSocket = globalThis.WebSocket
const originalStorage = globalThis.sessionStorage
const originalFixture = globalThis.__reconnectFixture

class FakeSocket {
  static OPEN = 1
  static instances = []

  constructor() {
    this.readyState = 0
    this.sent = []
    this.listeners = new Map()
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
    if (this.readyState === 3) return
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

  joins() {
    return this.sent
      .filter((frame) => typeof frame === 'string')
      .map((frame) => JSON.parse(frame))
      .filter((message) => message.type === MSG_TYPE.JOIN_GAME)
  }
}

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
  const feedback = { textContent: '', style: { display: 'none' } }
  const freshButton = {
    style: { display: 'none' },
    addEventListener(type, callback) {
      if (type === 'click') this.click = callback
    },
  }
  const storage = new Map()
  globalThis.sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  }
  globalThis.document = {
    getElementById: (id) =>
      id === 'connection-feedback'
        ? feedback
        : id === 'btn-fresh-connection'
          ? freshButton
          : null,
  }
  globalThis.window = {
    location: { protocol: 'http:', hostname: 'localhost', port: '3000' },
    addEventListener: () => {},
  }
  globalThis.WebSocket = FakeSocket

  const protocolUrl = pathToFileURL(
    path.resolve(directory, '../shared/protocol.js'),
  ).href
  const networkSource = readFileSync(
    path.resolve(directory, '../public/javascripts/network.js'),
    'utf8',
  ).replace("from '/shared/protocol.js'", `from '${protocolUrl}'`)
  const { network } = await import(
    `data:text/javascript,${encodeURIComponent(networkSource)}`
  )
  const { state } =
    await import('../public/javascripts/state.js?client-reconnect')
  globalThis.__reconnectFixture = {
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
  const mainSource = readFileSync(
    path.resolve(directory, '../public/javascripts/main.js'),
    'utf8',
  )
    .replace(/^import .*\n/gm, '')
    .replace(
      'export const app = new AppCoordinator()',
      'export { AppCoordinator }',
    )
  const bindings = Object.keys(globalThis.__reconnectFixture).join(', ')
  const { AppCoordinator } = await import(
    `data:text/javascript,${encodeURIComponent(`const { ${bindings} } = globalThis.__reconnectFixture;\n${mainSource}`)}`
  )
  const app = new AppCoordinator()
  const first = FakeSocket.instances[0]
  first.readyState = FakeSocket.OPEN
  first.dispatch('open')
  first.receive(MSG_TYPE.LOBBY_LIST, [])
  state.setCurrentGame('room-r', 'Room R')
  state.addLocalPlayer('first', { left: 65, right: 68 }, 'A'.repeat(43))
  state.addLocalPlayer('second', { left: 66, right: 69 }, 'B'.repeat(43))
  state.clearOwnership()
  app.joinGame('room-r')
  const initial = first.joins().at(-1)
  assert.deepEqual(
    initial.payload.reconnect.map((entry) => entry.id),
    ['first', 'second'],
  )
  assert.equal(network.changeDir({ id: 'first', dir: 'left' }), false)
  first.receive(MSG_TYPE.GAME_INFO, {
    key: 'room-r',
    players: [{ id: 'first' }, { id: 'second' }],
  })
  assert.equal(state.players[0].isLocal, false)

  const ack = (socket, requestId, key, accepted, rejected = []) =>
    socket.receive(
      MSG_TYPE.JOIN_RESULT,
      { key, accepted, rejected },
      { requestId },
    )
  ack(first, 'unrelated', 'room-r', [{ id: 'first', inputHandle: 5 }])
  ack(first, initial.requestId, 'other-room', [{ id: 'first', inputHandle: 5 }])
  ack(first, initial.requestId, 'room-r', [
    { id: 'first', inputHandle: 5 },
    { id: 'second', inputHandle: 5 },
  ])
  assert.equal(state.isLocalPlayer('first'), false)
  assert.equal(network.changeDir({ id: 'first', dir: 'left' }), false)
  ack(
    first,
    initial.requestId,
    'room-r',
    [{ id: 'first', inputHandle: 5 }],
    [{ id: 'second', code: 'INVALID_CREDENTIAL' }],
  )
  assert.equal(state.isLocalPlayer('first'), true)
  assert.equal(state.isLocalPlayer('second'), false)
  assert.match(feedback.textContent, /1 saved player.*could not be restored/i)
  assert.equal(network.changeDir({ id: 'first', dir: 'left' }), true)
  assert.deepEqual(Array.from(first.sent.at(-1)), [
    BINARY_OPCODE.CHANGE_DIR,
    5,
    0,
  ])

  first.receive(MSG_TYPE.OWNERSHIP_REVOKED, { key: 'room-r', ids: ['first'] })
  assert.equal(state.isLocalPlayer('first'), false)
  assert.equal(network.changeDir({ id: 'first', dir: 'left' }), false)
  assert.equal(state.connectedGames['room-r'].localPlayers.first.revoked, true)
  // A new transport does not automatically reclaim an intentionally revoked player.
  network.maxReconnectAttempts = 0
  first.close()
  network.connect()
  const second = FakeSocket.instances[1]
  second.readyState = FakeSocket.OPEN
  second.dispatch('open')
  second.receive(MSG_TYPE.LOBBY_LIST, [])
  assert.deepEqual(
    second
      .joins()
      .at(-1)
      .payload.reconnect.map((entry) => entry.id),
    ['second'],
  )
  first.receive(
    MSG_TYPE.JOIN_RESULT,
    {
      key: 'room-r',
      accepted: [{ id: 'first', inputHandle: 5 }],
      rejected: [],
    },
    { requestId: initial.requestId },
  )
  assert.equal(state.isLocalPlayer('first'), false)
  assert.equal(network.changeDir({ id: 'first', dir: 'left' }), false)
  const autoJoin = second.joins().at(-1)
  ack(second, autoJoin.requestId, 'room-r', [{ id: 'second', inputHandle: 0 }])
  assert.equal(network.changeDir({ id: 'second', dir: 'left' }), true)

  app.joinGame('room-r')
  const explicit = second.joins().at(-1)
  assert.deepEqual(
    explicit.payload.reconnect.map((entry) => entry.id),
    ['first', 'second'],
  )
  assert.equal(network.changeDir({ id: 'first', dir: 'left' }), false)
  ack(second, explicit.requestId, 'room-r', [
    { id: 'first', inputHandle: 1 },
    { id: 'second', inputHandle: 0 },
  ])
  assert.equal(state.isLocalPlayer('first'), true)
  assert.equal(network.changeDir({ id: 'first', dir: 'left' }), true)

  network.emit(
    MSG_TYPE.ERROR,
    'Open a fresh connection to recover input handles.',
    {
      code: 'INPUT_HANDLE_EXHAUSTED',
    },
  )
  assert.notEqual(freshButton.style.display, 'none')
  freshButton.click()
  const third = FakeSocket.instances[2]
  assert.equal(second.readyState, FakeSocket.OPEN)
  assert.equal(network.previousSocket, second)
  assert.equal(network.inputHandles.size, 0)
  assert.equal(state.isLocalPlayer('first'), false)
  assert.equal(network.changeDir({ id: 'first', dir: 'left' }), false)
  freshButton.click()
  assert.equal(FakeSocket.instances.length, 3)
  third.readyState = FakeSocket.OPEN
  third.dispatch('open')
  assert.equal(network.changeDir({ id: 'first', dir: 'left' }), false)
  third.receive(MSG_TYPE.LOBBY_LIST, [])
  const freshJoin = third.joins().at(-1)
  assert.equal(freshJoin.payload.requireAll, true)
  assert.deepEqual(
    freshJoin.payload.reconnect.map((entry) => entry.id),
    ['first', 'second'],
  )
  assert.equal(network.changeDir({ id: 'first', dir: 'left' }), false)
  ack(third, 'old-request', 'room-r', [{ id: 'first', inputHandle: 0 }])
  assert.equal(second.readyState, FakeSocket.OPEN)
  assert.equal(network.changeDir({ id: 'first', dir: 'left' }), false)
  ack(third, freshJoin.requestId, 'room-r', [
    { id: 'first', inputHandle: 0 },
    { id: 'second', inputHandle: 1 },
  ])
  assert.equal(second.readyState, 3)
  assert.equal(network.previousSocket, null)
  assert.equal(network.changeDir({ id: 'first', dir: 'left' }), true)
  assert.deepEqual(Array.from(third.sent.at(-1)), [
    BINARY_OPCODE.CHANGE_DIR,
    0,
    0,
  ])

  // A rejected replacement never releases the still-live original socket.
  network.emit(
    MSG_TYPE.ERROR,
    'Open a fresh connection to recover input handles.',
    { code: 'INPUT_HANDLE_EXHAUSTED' },
  )
  freshButton.click()
  const fourth = FakeSocket.instances[3]
  assert.equal(third.readyState, FakeSocket.OPEN)
  fourth.readyState = FakeSocket.OPEN
  fourth.dispatch('open')
  fourth.receive(MSG_TYPE.LOBBY_LIST, [])
  const deniedJoin = fourth.joins().at(-1)
  fourth.receive(MSG_TYPE.ERROR, 'The target room is full.', {
    code: 'ROOM_FULL',
    requestId: deniedJoin.requestId,
  })
  assert.equal(network.socket, third)
  assert.equal(network.previousSocket, null)
  assert.equal(fourth.readyState, 3)
  assert.equal(third.readyState, FakeSocket.OPEN)
  assert.equal(state.isLocalPlayer('first'), true)
  assert.equal(state.isLocalPlayer('second'), true)
  assert.equal(network.changeDir({ id: 'first', dir: 'left' }), true)
  assert.deepEqual(Array.from(third.sent.at(-1)), [
    BINARY_OPCODE.CHANGE_DIR,
    0,
    0,
  ])
  assert.equal(FakeSocket.instances.length, 4)

  // A partial fresh claim is rejected as a batch, leaving both old routes live.
  network.emit(
    MSG_TYPE.ERROR,
    'Open a fresh connection to recover input handles.',
    { code: 'INPUT_HANDLE_EXHAUSTED' },
  )
  freshButton.click()
  const fifth = FakeSocket.instances[4]
  fifth.readyState = FakeSocket.OPEN
  fifth.dispatch('open')
  fifth.receive(MSG_TYPE.LOBBY_LIST, [])
  const partialJoin = fifth.joins().at(-1)
  assert.equal(partialJoin.payload.requireAll, true)
  fifth.receive(MSG_TYPE.ERROR, 'One saved credential was rejected.', {
    code: 'RECONNECT_INCOMPLETE',
    requestId: partialJoin.requestId,
  })
  assert.equal(network.socket, third)
  assert.equal(fifth.readyState, 3)
  assert.equal(network.previousSocket, null)
  assert.equal(third.readyState, FakeSocket.OPEN)
  assert.equal(state.isLocalPlayer('first'), true)
  assert.equal(state.isLocalPlayer('second'), true)
  assert.equal(network.changeDir({ id: 'first', dir: 'left' }), true)
  assert.deepEqual(Array.from(third.sent.at(-1)), [
    BINARY_OPCODE.CHANGE_DIR,
    0,
    0,
  ])
  assert.equal(network.changeDir({ id: 'second', dir: 'left' }), true)
  assert.deepEqual(Array.from(third.sent.at(-1)), [
    BINARY_OPCODE.CHANGE_DIR,
    1,
    0,
  ])

  // A revocation delivered to the previous socket during recovery must not
  // be restored when the replacement fails.
  network.emit(
    MSG_TYPE.ERROR,
    'Open a fresh connection to recover input handles.',
    { code: 'INPUT_HANDLE_EXHAUSTED' },
  )
  freshButton.click()
  const sixth = FakeSocket.instances[5]
  sixth.readyState = FakeSocket.OPEN
  sixth.dispatch('open')
  sixth.receive(MSG_TYPE.LOBBY_LIST, [])
  const revokedJoin = sixth.joins().at(-1)
  third.receive(MSG_TYPE.OWNERSHIP_REVOKED, {
    key: 'room-r',
    ids: ['first'],
  })
  sixth.receive(MSG_TYPE.ERROR, 'The room is full.', {
    code: 'ROOM_FULL',
    requestId: revokedJoin.requestId,
  })
  assert.equal(network.socket, third)
  assert.equal(state.isLocalPlayer('first'), false)
  assert.equal(state.isLocalPlayer('second'), true)
  assert.equal(network.changeDir({ id: 'first', dir: 'left' }), false)
  assert.equal(network.changeDir({ id: 'second', dir: 'left' }), true)

  // Once the old transport dies, a failed replacement cannot recover it.
  network.emit(
    MSG_TYPE.ERROR,
    'Open a fresh connection to recover input handles.',
    { code: 'INPUT_HANDLE_EXHAUSTED' },
  )
  freshButton.click()
  const seventh = FakeSocket.instances[6]
  seventh.readyState = FakeSocket.OPEN
  seventh.dispatch('open')
  seventh.receive(MSG_TYPE.LOBBY_LIST, [])
  const closedOldJoin = seventh.joins().at(-1)
  third.close()
  seventh.receive(MSG_TYPE.ERROR, 'The room is full.', {
    code: 'ROOM_FULL',
    requestId: closedOldJoin.requestId,
  })
  assert.equal(network.changeDir({ id: 'second', dir: 'left' }), false)
  assert.equal(state.isLocalPlayer('second'), false)

  network.stopPing()
  console.log(
    'Client reconnect: correlated ACK, revocation, and explicit fresh recovery passed',
  )
} finally {
  globalThis.window = originalWindow
  globalThis.document = originalDocument
  globalThis.WebSocket = originalSocket
  globalThis.sessionStorage = originalStorage
  globalThis.__reconnectFixture = originalFixture
}
