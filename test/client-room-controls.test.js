import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { renderFile } from 'pug'
import { MSG_TYPE, PROTOCOL_VERSION } from '../shared/protocol.js'
import {
  PLAYER_COLOR_KEYS,
  GRID_SIZE,
  BLOCK_SIZE,
} from '../shared/constants.js'
import { ordinalSuffixOf, sortScoreboardPlayers } from '../shared/utils.js'

// Exercise actual coordinator, state, network, settings and all permission views.
// Only transport/DOM and unrelated welcome/canvas/theme mechanics are stubbed.
const original = Object.fromEntries(
  [
    'window',
    'document',
    'WebSocket',
    'sessionStorage',
    'localStorage',
    '__roomControlFixture',
  ].map((key) => [key, globalThis[key]]),
)
const html = renderFile(
  new URL('../views/index.pug', import.meta.url).pathname,
  { title: 'Test' },
)
for (const id of [
  'room-authority',
  'room-owner-status',
  'config-start-feedback',
  'game-start-feedback',
  'room-control-feedback',
  'speed-feedback',
  'registration-permission-feedback',
  'game-speed-custom',
]) {
  assert.match(html, new RegExp(`id="${id}"`), `Permanent Pug element ${id}`)
}
assert.match(html, /id="room-authority"[^>]*role="status"/)
class Element {
  constructor(id = '') {
    this.id = id
    this.children = []
    this.style = {}
    this.value = ''
    this.disabled = false
    this._text = ''
    this.listeners = new Map()
    this.classList = { add() {}, remove() {} }
  }
  set textContent(value) {
    this._text = String(value)
    this.children = []
  }
  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join('')
  }
  set innerHTML(value) {
    void value
    this._text = ''
    this.children = []
  }
  appendChild(child) {
    this.children.push(child)
    return child
  }
  get firstChild() {
    return this.children[0]
  }
  get lastChild() {
    return this.children.at(-1)
  }
  removeChild(child) {
    this.children.splice(this.children.indexOf(child), 1)
  }
  addEventListener(type, callback) {
    this.listeners.set(type, callback)
  }
  focus() {}
}
class Socket {
  static OPEN = 1
  static instances = []
  constructor() {
    this.readyState = 0
    this.listeners = new Map()
    this.sent = []
    Socket.instances.push(this)
  }
  addEventListener(type, listener) {
    this.listeners.set(type, listener)
  }
  dispatch(type, value = {}) {
    this.listeners.get(type)?.(value)
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
class WelcomeView {
  show() {}
  hide() {}
}
class Renderer {
  setColors() {}
  clear() {}
  draw() {}
  resetGrid() {}
}
const room = '11223344'
const owner = { ownerClientId: 'a'.repeat(32), roomOwnerToken: 'A'.repeat(43) }
let network
let app
try {
  const elements = new Map(
    [...html.matchAll(/id="([^"]+)"/g)].map((match) => [
      match[1],
      new Element(match[1]),
    ]),
  )
  const checkbox = new Map()
  globalThis.document = {
    getElementById: (id) => elements.get(id) ?? null,
    querySelector: (selector) => {
      if (!checkbox.has(selector)) checkbox.set(selector, new Element())
      return checkbox.get(selector)
    },
    createElement: () => new Element(),
    createTextNode: (text) => ({ textContent: String(text) }),
  }
  const windowListeners = new Map()
  globalThis.window = {
    location: {
      protocol: 'http:',
      hostname: 'localhost',
      port: '3000',
      search: '',
      reload() {},
    },
    matchMedia: () => ({ matches: true }),
    addEventListener: (type, listener) => windowListeners.set(type, listener),
  }
  const saved = new Map([
    [
      'connectedGames',
      JSON.stringify({ [room]: { roomOwner: owner, localPlayers: {} } }),
    ],
  ])
  const prefs = new Map([['speed', '40']])
  globalThis.sessionStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  }
  globalThis.localStorage = {
    getItem: (key) => prefs.get(key) ?? null,
    setItem: (key, value) => prefs.set(key, value),
  }
  globalThis.WebSocket = Socket
  const protocolUrl = pathToFileURL(
    new URL('../shared/protocol.js', import.meta.url).pathname,
  ).href
  const source = (relative) =>
    readFileSync(new URL(relative, import.meta.url), 'utf8')
  const networkSource = source('../public/javascripts/network.js').replace(
    "from '/shared/protocol.js'",
    `from '${protocolUrl}'`,
  )
  ;({ network } = await import(
    `data:text/javascript,${encodeURIComponent(networkSource)}`
  ))
  network.maxReconnectAttempts = 0
  const { state } = await import('../public/javascripts/state.js?room-controls')
  const settingsModule =
    await import('../public/javascripts/settings.js?room-controls')
  const { settings, SPEED } = settingsModule
  const bindings = {
    state,
    appState: state,
    network,
    ...settingsModule,
    PLAYER_COLOR_KEYS,
    GRID_SIZE,
    BLOCK_SIZE,
    MSG_TYPE,
    ordinalSuffixOf,
    sortScoreboardPlayers,
    Renderer,
    WelcomeView,
    getThemeColors: () => ({ bg: '#000', fg: '#fff', rose: '#f00' }),
    onThemeChange() {},
  }
  globalThis.__roomControlFixture = bindings
  async function actualModule(relative) {
    const body = source(relative)
      .replace(/^import .*\n/gm, '')
      .replace(
        'export const app = new AppCoordinator()',
        'export { AppCoordinator }',
      )
    return import(
      `data:text/javascript,${encodeURIComponent(`const { ${Object.keys(bindings).join(', ')} } = globalThis.__roomControlFixture;\n${body}`)}`
    )
  }
  for (const name of ['SettingsView', 'ConfigView', 'GameView', 'LobbyView']) {
    const file = name[0].toLowerCase() + name.slice(1)
    bindings[name] = (
      await actualModule(`../public/javascripts/ui/${file}.js`)
    )[name]
  }
  const { AppCoordinator } = await actualModule('../public/javascripts/main.js')
  app = new AppCoordinator()
  const socket = Socket.instances.at(-1)
  const el = (id) => elements.get(id)
  const info = (extra = {}) => ({
    key: room,
    name: 'Room',
    players: [
      { id: 'one', name: 'One', connected: true },
      { id: 'two', name: 'Two', connected: true },
    ],
    eligiblePlayerCount: 2,
    ownerStatus: 'present',
    firstRoundStarted: false,
    running: false,
    acceptingPlayers: true,
    interval: 37,
    scores: { gamecount: 0, players: [], messages: [] },
    round: { stage: 'configuration', startId: null },
    ...extra,
  })
  const receiveInfo = (extra) => socket.receive(MSG_TYPE.GAME_INFO, info(extra))
  const currentRequest = () => socket.messages(MSG_TYPE.JOIN_GAME).at(-1)
  const join = () => {
    state.setCurrentGame(room, 'Room')
    app.joinGame(room)
    return currentRequest()
  }
  const acknowledge = (
    claim = { accepted: true, ownerClientId: owner.ownerClientId },
    accepted = [],
    rejected = [],
  ) => {
    const request = currentRequest()
    socket.receive(
      MSG_TYPE.JOIN_RESULT,
      { key: room, accepted, rejected, roomOwner: claim },
      { requestId: request.requestId },
    )
  }
  const controls = (start, speed) => {
    assert.equal(el('btn-init-game').disabled, !start)
    assert.equal(el('btn-start-game').disabled, !start)
    assert.equal(el('game-speed').disabled, !speed)
  }
  socket.readyState = Socket.OPEN
  socket.dispatch('open')
  socket.receive(MSG_TYPE.LOBBY_LIST, [])
  app.setScreen('lobby')
  const bytes = saved.get('connectedGames')
  const initialJoinCount = socket.messages(MSG_TYPE.JOIN_GAME).length
  socket.receive(MSG_TYPE.LOBBY_LIST, [])
  const table = el('body-gamelisttable')
  assert.equal(table.children.length, 1)
  assert.match(
    table.textContent,
    /Saved room 11223344.*saved; rejoin to check.*rejoin/,
  )
  assert.equal(saved.get('connectedGames'), bytes)
  assert.equal(
    socket.messages(MSG_TYPE.JOIN_GAME).length,
    initialJoinCount,
    'Saved private room is never probed from public omission',
  )
  table.children[0].children[4].children[0].onclick()
  assert.deepEqual(currentRequest().payload.reconnect, [])
  assert.deepEqual(currentRequest().payload.roomOwner, owner)
  receiveInfo()
  controls(false, false)
  assert.equal(state.isRoomOwner(), false)
  assert.match(el('room-owner-status').textContent, /authentication/i)
  acknowledge()
  controls(true, true)
  assert.equal(
    state.ownedPlayerIds.size,
    0,
    'Creator role does not require a local bike',
  )
  assert.equal(network.inputHandles.size, 0)
  assert.match(el('room-owner-status').textContent, /you created/i)
  assert.match(el('config-start-feedback').textContent, /without a bike/i)
  assert.match(el('config-start-feedback').textContent, /two on one keyboard/i)

  // Every authoritative stage/roster transition refreshes all actual controls.
  receiveInfo({ eligiblePlayerCount: 1 })
  controls(false, true)
  assert.match(el('game-start-feedback').textContent, /1 eligible/i)
  for (const extra of [
    { eligiblePlayerCount: 7 },
    {
      players: Array.from({ length: 7 }, (_, index) => ({
        id: `p${index}`,
        connected: index < 2,
      })),
      eligiblePlayerCount: 2,
    },
  ]) {
    receiveInfo(extra)
    controls(false, true)
  }
  assert.match(
    el('config-start-feedback').textContent,
    /more than six registered/i,
  )
  receiveInfo()
  controls(true, true)
  for (const stage of [
    'preparation',
    'countdown',
    'running',
    'destroyed',
    undefined,
  ]) {
    receiveInfo({
      running: stage === 'running',
      round: { stage, startId: 'attempt' },
    })
    controls(false, false)
  }
  receiveInfo()
  controls(true, true)
  // Exact custom values throughout the server's interval domain, without echoes.
  const preference = prefs.get('speed')
  for (const interval of [10, 11, 20, 25, 37, 40, 499, 500]) {
    receiveInfo({ interval })
    const preset = Object.entries(SPEED).find(
      ([, fps]) => Math.round(1000 / fps) === interval,
    )?.[0]
    assert.equal(el('game-speed').value, preset ?? 'CUSTOM')
    if (!preset) {
      assert.equal(el('game-speed-custom').hidden, false)
      assert.match(
        el('game-speed-custom').textContent,
        new RegExp(`${interval} ms`),
      )
    }
    assert.match(el('speed-feedback').textContent, new RegExp(`${interval} ms`))
  }
  assert.equal(socket.messages(MSG_TYPE.SET_INTERVAL).length, 0)
  assert.equal(prefs.get('speed'), preference)
  receiveInfo({ interval: 37 })
  el('game-speed').value = 'FAST'
  el('game-speed').onchange({ target: el('game-speed') })
  assert.equal(socket.messages(MSG_TYPE.SET_INTERVAL).length, 1)
  assert.equal(socket.messages(MSG_TYPE.SET_INTERVAL)[0].payload, 20)
  assert.equal(
    el('game-speed').value,
    'CUSTOM',
    'Selection waits for acknowledged authority',
  )
  assert.equal(prefs.get('speed'), preference)
  socket.receive(
    MSG_TYPE.ERROR,
    '<img src=x onerror=bad()> speed save failed',
    { code: 'PERSISTENCE_FAILED' },
  )
  assert.equal(el('game-speed').value, 'CUSTOM')
  assert.equal(
    el('room-control-feedback').textContent,
    '<img src=x onerror=bad()> speed save failed',
  )
  assert.equal(
    el('room-control-feedback').children.length,
    0,
    'Errors use safe text content',
  )
  receiveInfo({ interval: 20 })
  assert.equal(el('game-speed').value, 'FAST')
  assert.equal(socket.messages(MSG_TYPE.SET_INTERVAL).length, 1)
  settings.set('speed', 25)
  assert.equal(
    socket.messages(MSG_TYPE.SET_INTERVAL).length,
    1,
    'Personal settings listener sends no room mutation',
  )
  assert.equal(el('game-speed').value, 'FAST')

  // Revocation removes creator permission yet later-start permission survives.
  socket.receive(MSG_TYPE.ROOM_OWNER_REVOKED, {
    key: room,
    ownerClientId: owner.ownerClientId,
  })
  controls(false, false)
  assert.match(el('config-start-feedback').textContent, /only.*creator.*first/i)
  const beforeForbiddenStart = socket.messages(MSG_TYPE.START_GAME).length
  const beforeForbiddenSpeed = socket.messages(MSG_TYPE.SET_INTERVAL).length
  el('btn-init-game').onclick()
  el('game-speed').value = 'SLOW'
  el('game-speed').onchange({ target: el('game-speed') })
  assert.equal(
    socket.messages(MSG_TYPE.START_GAME).length,
    beforeForbiddenStart,
  )
  assert.equal(
    socket.messages(MSG_TYPE.SET_INTERVAL).length,
    beforeForbiddenSpeed,
  )
  assert.equal(el('game-speed').value, 'FAST')

  receiveInfo({
    firstRoundStarted: true,
    ownerStatus: 'away',
    acceptingPlayers: false,
    round: { stage: 'finished', startId: null },
  })
  controls(true, false)
  assert.match(
    el('game-start-feedback').textContent,
    /any joined client.*spectators/i,
  )
  assert.match(el('room-owner-status').textContent, /creator away/i)
  assert.match(
    el('registration-permission-feedback').textContent,
    /registration is closed/i,
  )
  const sentStarts = socket.messages(MSG_TYPE.START_GAME).length
  el('btn-start-game').onclick()
  assert.equal(socket.messages(MSG_TYPE.START_GAME).length, sentStarts + 1)
  receiveInfo({
    firstRoundStarted: true,
    ownerStatus: 'unrecoverable',
    round: { stage: 'finished', startId: null },
  })
  controls(true, false)
  assert.match(el('room-owner-status').textContent, /unrecoverable/i)
  network.protocolReady = false
  app.refreshRoomControls()
  controls(false, false)
  network.protocolReady = true
  network.generation++
  app.refreshRoomControls()
  controls(false, false)
  join()
  receiveInfo({
    firstRoundStarted: true,
    round: { stage: 'finished', startId: null },
  })
  controls(false, false)
  acknowledge()
  controls(true, true)
  socket.receive(MSG_TYPE.GAME_INFO, info(), {
    protocolVersion: PROTOCOL_VERSION + 1,
  })
  controls(false, false)
  assert.equal(state.isRoomOwner(), false)
  assert.equal(el('btn-reload-connection').style.display, '')
  assert.match(el('connection-feedback').textContent, /reload/i)
  join()
  acknowledge()

  // Actual config form + private registration ACK retains both keyboard bikes.
  receiveInfo()
  for (const [id, name, keys, left, right, handle] of [
    ['one', 'One', '66_78', 66, 78, 17],
    ['two', 'Two', '89_88', 89, 88, 23],
  ]) {
    el('input-add-player').oninput({ target: { value: name } })
    el('select-keycodes').onchange({ target: { value: keys } })
    el('form-add-player').onsubmit()
    const registration = socket.messages(MSG_TYPE.ADD_PLAYER).at(-1)
    // Coordinator generates the registration IDs; the public fixture follows it.
    socket.receive(
      MSG_TYPE.PLAYER_REGISTERED,
      {
        key: room,
        id: registration.payload.id,
        reconnectToken: (id === 'one' ? 'B' : 'C').repeat(43),
        inputHandle: handle,
      },
      { requestId: registration.requestId },
    )
    assert.deepEqual(app.localPlayersConfig.get(registration.payload.id), {
      left,
      right,
    })
  }
  const ids = [...state.ownedPlayerIds]
  assert.equal(ids.length, 2)
  windowListeners.get('keydown')({ keyCode: 66, repeat: false })
  windowListeners.get('keydown')({ keyCode: 88, repeat: false })
  assert.deepEqual(
    socket.sent
      .filter((frame) => frame instanceof Uint8Array)
      .map((frame) => [...frame]),
    [
      [2, 17, 0],
      [2, 23, 1],
    ],
  )
  socket.receive(MSG_TYPE.ROOM_OWNER_REVOKED, {
    key: room,
    ownerClientId: owner.ownerClientId,
  })
  assert.equal(state.isRoomOwner(), false)
  assert.equal(
    network.inputHandles.size,
    2,
    'Creator revocation preserves bike authority',
  )
  socket.receive(MSG_TYPE.OWNERSHIP_REVOKED, { key: room, ids })
  assert.equal(network.inputHandles.size, 0)
  assert.equal(app.localPlayersConfig.size, 0)
  const beforeKeys = socket.sent.length
  windowListeners.get('keydown')({ keyCode: 66, repeat: false })
  assert.equal(socket.sent.length, beforeKeys)
  socket.close()
  controls(false, false)
  assert.equal(state.isRoomOwner(), false)
  app.leaveCurrentGame()
  assert.equal(el('room-authority').style.display, 'none')
  assert.equal(
    el('game-speed').value,
    'SLOW',
    'Leaving restores the personal preference',
  )
  assert.equal(socket.messages(MSG_TYPE.SET_INTERVAL).length, 1)

  // Proof omission preserves saved rows; only explicit correlated missing does
  // remove the visible row. Ordinary record retirement refreshes it immediately.
  state.saveRoomOwner(room, owner)
  socket.readyState = Socket.OPEN
  network.protocolReady = true
  socket.receive(MSG_TYPE.LOBBY_LIST, [])
  assert.match(table.textContent, /Saved room 11223344/)
  state.removeConnectedGames([room])
  assert.doesNotMatch(table.textContent, /11223344/)
  state.saveRoomOwner(room, owner)
  join()
  const request = currentRequest()
  socket.receive(MSG_TYPE.ERROR, 'Missing room', {
    code: 'GAME_NOT_FOUND',
    requestId: 'wrong',
  })
  assert.ok(state.connectedGames[room])
  socket.receive(MSG_TYPE.ERROR, 'Missing room', {
    code: 'GAME_NOT_FOUND',
    requestId: request.requestId,
  })
  assert.equal(state.connectedGames[room], undefined)
  assert.doesNotMatch(table.textContent, /11223344/)
  console.log(
    'Client room controls: actual coordinator/network/state/settings/views, independent owner proof, complete stage/roster/socket gates, accurate custom intervals, no echoes, safe rejection rollback, saved private rows and shared keyboard bindings passed',
  )
} finally {
  app?.clearRoundCallbacks()
  app?.clearPendingRegistrations()
  if (network) {
    network.windowClosing = true
    network.stopPing()
    network.socket?.close()
  }
  for (const [key, value] of Object.entries(original)) globalThis[key] = value
}
