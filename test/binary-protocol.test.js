import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import {
  BINARY_OPCODE,
  MSG_TYPE,
  PROTOCOL_VERSION,
} from '../shared/protocol.js'
import { CELL_TYPE } from '../shared/constants.js'

const directory = path.dirname(fileURLToPath(import.meta.url))
const original = {
  window: globalThis.window,
  document: globalThis.document,
  WebSocket: globalThis.WebSocket,
  getComputedStyle: globalThis.getComputedStyle,
}

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

  send(data) {
    this.sent.push(data)
  }

  close() {
    if (this.readyState === 3) return
    this.readyState = 3
    this.dispatch('close')
  }

  receiveText(value) {
    this.dispatch('message', { data: JSON.stringify(value) })
  }

  receiveBytes(bytes) {
    this.dispatch('message', { data: Uint8Array.from(bytes).buffer })
  }

  movement() {
    return this.sent
      .filter((frame) => frame instanceof Uint8Array)
      .map((frame) => Array.from(frame))
  }
}

const versioned = (type, payload, extra = {}) => ({
  type,
  payload,
  protocolVersion: PROTOCOL_VERSION,
  ...extra,
})

const drawFrame = (cells) => {
  const bytes = new Uint8Array(1 + cells.length * 5)
  const view = new DataView(bytes.buffer)
  view.setUint8(0, BINARY_OPCODE.DRAW)
  cells.forEach(([x, y, value], index) => {
    const offset = 1 + index * 5
    view.setUint16(offset, x)
    view.setUint16(offset + 2, y)
    view.setInt8(offset + 4, value)
  })
  return bytes
}

try {
  const paints = []
  const resizeListeners = new Map()
  const context = {
    fillStyle: '',
    fillRect(...rect) {
      paints.push({ color: this.fillStyle, rect })
    },
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
  }
  globalThis.document = {
    body: {},
    getElementById: (id) => (id === 'arena' ? canvas : null),
  }
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '1' })
  globalThis.window = {
    location: { protocol: 'http:', hostname: 'localhost', port: '3000' },
    devicePixelRatio: 1,
    addEventListener: (type, callback) => resizeListeners.set(type, callback),
    removeEventListener: (type) => resizeListeners.delete(type),
    matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }),
  }
  globalThis.WebSocket = FakeSocket

  const constantsUrl = pathToFileURL(
    path.resolve(directory, '../shared/constants.js'),
  ).href
  const protocolUrl = pathToFileURL(
    path.resolve(directory, '../shared/protocol.js'),
  ).href
  const rendererSource = readFileSync(
    path.resolve(directory, '../public/javascripts/Renderer.js'),
    'utf8',
  )
    .replace("from '/shared/constants.js'", `from '${constantsUrl}'`)
    .replace("from '/shared/protocol.js'", `from '${protocolUrl}'`)
  const { Renderer } = await import(
    `data:text/javascript,${encodeURIComponent(rendererSource)}`
  )
  const renderer = new Renderer({
    id: 'arena',
    size: { x: 4, y: 4 },
    blocksize: 2,
    bgColor: 'background',
    bordercolor: 'border',
    explosioncolor: 'explosion',
    playercolors: ['first-color', 'second-color'],
  })
  const networkSource = readFileSync(
    path.resolve(directory, '../public/javascripts/network.js'),
    'utf8',
  ).replace("from '/shared/protocol.js'", `from '${protocolUrl}'`)
  const { network } = await import(
    `data:text/javascript,${encodeURIComponent(networkSource)}`
  )
  const first = FakeSocket.instances[0]
  first.readyState = FakeSocket.OPEN
  first.dispatch('open')
  first.receiveText(versioned(MSG_TYPE.LOBBY_LIST, []))

  let drawEvents = 0
  let gameInfoEvents = 0
  network.on(MSG_TYPE.GAME_DRAW, (changes) => {
    drawEvents++
    assert.ok(changes instanceof DataView)
    renderer.draw(changes)
  })
  network.on(MSG_TYPE.GAME_INFO, () => gameInfoEvents++)

  const initialPaints = paints.length
  const jsonCell = [[1, 1, 0]]
  for (const message of [
    versioned(MSG_TYPE.GAME_DRAW, jsonCell),
    {
      action: MSG_TYPE.GAME_DRAW,
      payload: jsonCell,
      protocolVersion: PROTOCOL_VERSION,
    },
    versioned(MSG_TYPE.GAME_DRAW, jsonCell, { action: MSG_TYPE.GAME_INFO }),
    versioned(MSG_TYPE.GAME_INFO, jsonCell, { action: MSG_TYPE.GAME_DRAW }),
  ]) {
    first.receiveText(message)
  }
  assert.equal(drawEvents, 0)
  assert.equal(gameInfoEvents, 1)
  assert.equal(renderer.fields[1][1], CELL_TYPE.EMPTY)
  assert.equal(paints.length, initialPaints)
  first.receiveText(versioned(MSG_TYPE.GAME_INFO, { key: 'room-r' }))
  assert.equal(gameInfoEvents, 2, 'JSON control messages remain available')

  const valid = drawFrame([
    [1, 1, 0],
    [2, 1, CELL_TYPE.EXPLOSION],
  ])
  first.receiveBytes(valid)
  assert.equal(drawEvents, 1)
  assert.equal(renderer.fields[1][1], 0)
  assert.equal(renderer.fields[2][1], CELL_TYPE.EXPLOSION)
  assert.deepEqual(paints.at(-1), {
    color: 'explosion',
    rect: [4, 2, 2, 2],
  })

  for (const invalid of [
    [],
    [BINARY_OPCODE.DRAW],
    [99, ...valid.slice(1)],
    [BINARY_OPCODE.DRAW, 0],
    [BINARY_OPCODE.DRAW, 0, 1, 0, 2],
    [...drawFrame([[3, 2, 1]]), 255],
  ]) {
    const eventsBefore = drawEvents
    const paintsBefore = paints.length
    first.receiveBytes(invalid)
    assert.equal(
      drawEvents,
      eventsBefore + (invalid[0] === BINARY_OPCODE.DRAW ? 1 : 0),
      'network routes DRAW packets; the renderer owns structural validation',
    )
    assert.equal(
      paints.length,
      paintsBefore,
      'malformed frame must not paint a prefix',
    )
    assert.equal(renderer.fields[3][2], CELL_TYPE.EMPTY)
  }
  for (const invalidRecords of [
    [
      [3, 2, 1],
      [99, 2, 0],
    ],
    [
      [3, 2, 1],
      [2, 3, 127],
    ],
  ]) {
    const before = paints.length
    first.receiveBytes(drawFrame(invalidRecords))
    assert.equal(
      paints.length,
      before,
      'invalid later record cannot paint valid prefix',
    )
    assert.equal(renderer.fields[3][2], CELL_TYPE.EMPTY)
  }
  // Direct callers cannot bypass the decoder or restore legacy array input.
  const beforeDirect = paints.length
  renderer.draw([[3, 2, 1]])
  renderer.draw(
    new DataView(
      Uint8Array.from([BINARY_OPCODE.DRAW, 0, 3, 0, 2, 1, 255]).buffer,
    ),
  )
  renderer.draw(new DataView(Uint8Array.from([99, 0, 3, 0, 2, 1]).buffer))
  assert.equal(renderer.fields[3][2], CELL_TYPE.EMPTY)
  assert.equal(paints.length, beforeDirect)

  renderer.setColors({ playercolors: ['new-first', 'new-second'] })
  assert.equal(renderer.fields[1][1], 0)
  assert.ok(
    paints.some((paint) => paint.color === 'new-first' && paint.rect[0] === 2),
  )
  const beforeResize = paints.length
  resizeListeners.get('resize')()
  assert.ok(paints.length > beforeResize)
  assert.equal(renderer.fields[2][1], CELL_TYPE.EXPLOSION)
  renderer.clear()
  renderer.resetGrid()
  assert.equal(renderer.fields[1][1], CELL_TYPE.EMPTY)
  assert.equal(renderer.fields[0][0], CELL_TYPE.BORDER)
  first.receiveBytes(drawFrame([[1, 2, 1]]))
  assert.equal(renderer.fields[1][2], 1)

  // Canonical string IDs use acknowledged byte handles; all steering is binary.
  assert.equal(network.changeDir({ id: 'a1b2c3d4', dir: 'left' }), false)
  assert.equal(network.bindPlayer('a1b2c3d4', 245), true)
  assert.equal(network.bindPlayer('00000123', 246), true)
  assert.equal(network.changeDir({ id: 'a1b2c3d4', dir: 'left' }), true)
  assert.equal(network.changeDir({ id: '00000123', dir: 'right' }), true)
  assert.equal(network.changeDir({ id: 'unknown', dir: 'left' }), false)
  assert.deepEqual(first.movement(), [
    [BINARY_OPCODE.CHANGE_DIR, 245, 0],
    [BINARY_OPCODE.CHANGE_DIR, 246, 1],
  ])
  assert.equal(
    first.sent
      .filter((frame) => typeof frame === 'string')
      .some((frame) => /CHANGE_DIR|changeDir/.test(frame)),
    false,
  )
  network.revokePlayers(['a1b2c3d4'])
  assert.equal(network.changeDir({ id: 'a1b2c3d4', dir: 'left' }), false)
  network.joinGame('other-room', [], 'switch')
  assert.equal(network.changeDir({ id: '00000123', dir: 'left' }), false)

  network.bindPlayer('00000123', 247)
  network.windowClosing = true
  first.close()
  network.connect()
  const second = FakeSocket.instances[1]
  second.readyState = FakeSocket.OPEN
  second.dispatch('open')
  assert.equal(network.changeDir({ id: '00000123', dir: 'left' }), false)
  second.receiveText(versioned(MSG_TYPE.LOBBY_LIST, []))
  assert.equal(network.changeDir({ id: '00000123', dir: 'left' }), false)
  first.receiveText(
    versioned(MSG_TYPE.JOIN_RESULT, {
      key: 'other-room',
      accepted: [{ id: '00000123', inputHandle: 247 }],
      rejected: [],
    }),
  )
  assert.equal(network.changeDir({ id: '00000123', dir: 'left' }), false)
  network.bindPlayer('00000123', 0) // Coordinator binds only after current JOIN_RESULT.
  assert.equal(first.readyState, 3)
  assert.equal(network.changeDir({ id: '00000123', dir: 'left' }), true)
  assert.deepEqual(second.movement(), [[BINARY_OPCODE.CHANGE_DIR, 0, 0]])
  second.receiveBytes(drawFrame([[2, 2, 0]]))
  assert.equal(
    renderer.fields[2][2],
    0,
    'spectator/rejoin path still accepts binary state',
  )

  renderer.destroy()
  network.stopPing()
  console.log(
    'Binary protocol: drawing validation, redraws, and byte-handle steering passed',
  )
} finally {
  globalThis.window = original.window
  globalThis.document = original.document
  globalThis.WebSocket = original.WebSocket
  globalThis.getComputedStyle = original.getComputedStyle
}
