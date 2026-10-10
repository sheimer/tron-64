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
const networkPath = path.resolve(directory, '../public/javascripts/network.js')
const protocolUrl = pathToFileURL(
  path.resolve(directory, '../shared/protocol.js'),
).href
const source = readFileSync(networkPath, 'utf8').replace(
  "from '/shared/protocol.js'",
  `from '${protocolUrl}'`,
)

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

  send(data) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
    this.dispatch('close')
  }

  receive(value) {
    this.dispatch('message', { data: JSON.stringify(value) })
  }
}

const originalWindow = globalThis.window
const originalDocument = globalThis.document
const originalWebSocket = globalThis.WebSocket
const originalSessionStorage = globalThis.sessionStorage

try {
  globalThis.window = {
    location: { protocol: 'http:', hostname: 'localhost', port: '3000' },
    addEventListener: () => {},
  }
  globalThis.document = { getElementById: () => null }
  globalThis.WebSocket = FakeSocket
  const { network } = await import(
    `data:text/javascript,${encodeURIComponent(source)}`
  )
  const errors = []
  network.on(MSG_TYPE.ERROR, (message) => errors.push(message))
  const first = FakeSocket.instances[0]
  first.readyState = FakeSocket.OPEN
  first.dispatch('open')
  assert.equal(network.changeDir({ id: 'a1b2c3d4', dir: 'left' }), false)
  assert.equal(network.addPlayer({ id: 'a1b2c3d4' }, 'pending'), false)

  first.receive({
    type: MSG_TYPE.LOBBY_LIST,
    protocolVersion: PROTOCOL_VERSION,
  })
  assert.equal(network.addPlayer({ id: 'a1b2c3d4' }, 'pending'), true)
  assert.equal(network.changeDir({ id: 'a1b2c3d4', dir: 'left' }), false)
  assert.equal(network.bindPlayer('a1b2c3d4', 247), true)
  assert.equal(network.bindPlayer('00000123', 248), true)
  assert.equal(network.changeDir({ id: 'a1b2c3d4', dir: 'left' }), true)
  assert.equal(network.changeDir({ id: '00000123', dir: 'right' }), true)
  assert.deepEqual(
    first.sent
      .filter((frame) => frame instanceof Uint8Array)
      .map((frame) => Array.from(frame)),
    [
      [BINARY_OPCODE.CHANGE_DIR, 247, 0],
      [BINARY_OPCODE.CHANGE_DIR, 248, 1],
    ],
  )
  network.leaveGame()
  assert.equal(network.changeDir({ id: 'a1b2c3d4', dir: 'left' }), false)
  network.bindPlayer('a1b2c3d4', 249)
  network.windowClosing = true
  first.close()
  assert.equal(network.changeDir({ id: 'a1b2c3d4', dir: 'left' }), false)
  network.connect()
  const second = FakeSocket.instances[1]
  second.readyState = FakeSocket.OPEN
  first.receive({
    type: MSG_TYPE.PLAYER_REGISTERED,
    protocolVersion: PROTOCOL_VERSION,
    payload: { id: 'a1b2c3d4', inputHandle: 249 },
  })
  assert.equal(network.inputHandles.size, 0)
  assert.equal(network.changeDir({ id: 'a1b2c3d4', dir: 'left' }), false)
  second.receive({
    type: MSG_TYPE.LOBBY_LIST,
    protocolVersion: PROTOCOL_VERSION - 1,
  })
  assert.equal(second.readyState, 3)
  assert.equal(network.protocolReady, false)
  assert.match(errors.at(-1), /reload/i)
  network.stopPing()

  const statePath = pathToFileURL(
    path.resolve(directory, '../public/javascripts/state.js'),
  ).href
  for (const value of ['{', '[]', '{"r":{"localPlayers":null}}']) {
    globalThis.sessionStorage = {
      getItem: () => value,
      setItem: () => {
        throw new Error('Storage blocked')
      },
    }
    const { state } = await import(
      `${statePath}?invalid=${encodeURIComponent(value)}`
    )
    state.setCurrentGame('r', 'Room')
    assert.deepEqual(state.getLocalPlayerIds('r'), [])
    assert.equal(state.isLocalPlayer('public-id'), false)
    state.addLocalPlayer('public-id', { left: 65, right: 68 }, 'secret')
    assert.equal(state.isLocalPlayer('public-id'), true)
    assert.deepEqual(state.getLocalPlayerConfig('public-id'), {
      left: 65,
      right: 68,
    })
    state.clearOwnership()
    assert.equal(state.isLocalPlayer('public-id'), false)
  }
  globalThis.sessionStorage = {
    getItem: () => '{"r":{"localPlayers":{"legacy":{"left":65}}}}',
    setItem: () => {},
  }
  const { state: legacy } = await import(`${statePath}?legacy`)
  legacy.setCurrentGame('r', 'Room')
  assert.equal(legacy.getLocalPlayerConfig('legacy'), null)
  assert.equal(legacy.isLocalPlayer('legacy'), false)

  console.log(
    'Client ownership: binary handles, protocol gate, socket loss, and storage faults passed',
  )
} finally {
  globalThis.window = originalWindow
  globalThis.document = originalDocument
  globalThis.WebSocket = originalWebSocket
  globalThis.sessionStorage = originalSessionStorage
}
