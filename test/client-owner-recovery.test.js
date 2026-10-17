import { AppCoordinator } from '../public/javascripts/appCoordinator.js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { MSG_TYPE, PROTOCOL_VERSION } from '../shared/protocol.js'
import { ordinalSuffixOf, sortScoreboardPlayers } from '../shared/utils.js'
import { LOBBY_CHECK_BATCH_SIZE } from '../shared/constants.js'

const original = {
  window: globalThis.window,
  document: globalThis.document,
  WebSocket: globalThis.WebSocket,
  sessionStorage: globalThis.sessionStorage,
  fixture: globalThis.__ownerRecoveryFixture,
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
  addEventListener(type, callback) {
    this.listeners.set(type, callback)
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
class Element {
  constructor() {
    this.children = []
    this.style = {}
    this.textContent = ''
  }
  set innerHTML(value) {
    this.children = []
  }
  appendChild(child) {
    this.children.push(child)
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
  updatePlayerPositions() {}
  updateSpeed() {}
  updateRoomControls(inRoom, enabled) {
    this.setSpectatorMode(inRoom && !enabled)
  }
  setSpectatorMode(value) {
    this.spectator = value
  }
  showFeedback(message) {
    this.feedback = message
  }
}
class Renderer {
  setColors() {}
  clear() {}
  draw() {}
  resetGrid() {}
}
const room = '11223344'
const ownerCredential = {
  ownerClientId: 'a'.repeat(32),
  roomOwnerToken: 'A'.repeat(43),
}
const acceptedOwner = {
  accepted: true,
  ownerClientId: ownerCredential.ownerClientId,
}
const networks = []
let serial = 0
async function fixture({ search = '', saved = {} } = {}) {
  const tag = ++serial
  const savedBytes = new Map([['connectedGames', JSON.stringify(saved)]])
  globalThis.sessionStorage = {
    getItem: (key) => savedBytes.get(key) ?? null,
    setItem: (key, value) => savedBytes.set(key, value),
  }
  const elements = new Map([
    ['body-gamelisttable', new Element()],
    ['connection-feedback', new Element()],
    ['gamecount', new Element()],
    ['round-results-label', new Element()],
    ['body-scoretable', new Element()],
  ])
  globalThis.document = {
    getElementById: (id) => elements.get(id) ?? null,
    createElement: () => new Element(),
    createTextNode: (text) => ({ text }),
  }
  globalThis.window = {
    location: {
      protocol: 'http:',
      hostname: 'localhost',
      port: '3000',
      search,
    },
    addEventListener() {},
    matchMedia: () => ({ matches: false }),
  }
  globalThis.WebSocket = FakeSocket
  const protocolUrl = pathToFileURL(
    new URL('../shared/protocol.js', import.meta.url).pathname,
  ).href
  const networkSource = readFileSync(
    new URL('../public/javascripts/network.js', import.meta.url),
    'utf8',
  ).replace("from '/shared/protocol.js'", `from '${protocolUrl}'`)
  const { network } = await import(
    `data:text/javascript,${encodeURIComponent(`${networkSource}\n// recovery fixture ${tag}`)}`
  )
  networks.push(network)
  network.maxReconnectAttempts = 0
  const { state } = await import(
    `../public/javascripts/state.js?owner-recovery=${tag}`
  )
  const bindings = {
    state,
    network,
    settings: { coloredPlayers: true, speed: 40, addListener() {} },
    SPEED: { NORMAL: 40 },
    Renderer,
    getThemeColors: () => ({ bg: '#000', fg: '#fff', rose: '#f00' }),
    onThemeChange() {},
    WelcomeView: View,
    SettingsView: View,
    ConfigView: View,
    GameView: View,
    ordinalSuffixOf,
    sortScoreboardPlayers,
    MSG_TYPE,
    PLAYER_COLOR_KEYS: ['water'],
    GRID_SIZE: 100,
    LOBBY_CHECK_BATCH_SIZE,
    BLOCK_SIZE: 4,
  }
  globalThis.__ownerRecoveryFixture = bindings
  const lobbySource = readFileSync(
    new URL('../public/javascripts/ui/lobbyView.js', import.meta.url),
    'utf8',
  ).replace(/^import .*\n/gm, '')
  const { LobbyView } = await import(
    `data:text/javascript,${encodeURIComponent(`const { state, network, settings, MSG_TYPE, GRID_SIZE, LOBBY_CHECK_BATCH_SIZE } = globalThis.__ownerRecoveryFixture;\n${lobbySource}\n// fixture ${tag}`)}`
  )
  bindings.LobbyView = LobbyView
  const gameSource = readFileSync(
    new URL('../public/javascripts/ui/gameView.js', import.meta.url),
    'utf8',
  ).replace(/^import .*\n/gm, '')
  const { GameView } = await import(
    `data:text/javascript,${encodeURIComponent(`const { settings, state: appState, PLAYER_COLOR_KEYS, ordinalSuffixOf, sortScoreboardPlayers } = globalThis.__ownerRecoveryFixture;\n${gameSource}\n// fixture ${tag}`)}`
  )
  bindings.GameView = GameView
  const app = new AppCoordinator(bindings)
  let socket = FakeSocket.instances.at(-1)
  const open = (ws) => {
    ws.readyState = FakeSocket.OPEN
    ws.dispatch('open')
    ws.receive(MSG_TYPE.LOBBY_LIST, [])
  }
  const currentRequest = () => socket.messages(MSG_TYPE.JOIN_GAME).at(-1)
  const join = (key = room, explicit = true) => {
    state.setCurrentGame(key, key)
    app.joinGame(key, explicit)
    return currentRequest()
  }
  const result = (
    request = currentRequest(),
    owner = acceptedOwner,
    extra = {},
    accepted = [],
  ) =>
    socket.receive(
      MSG_TYPE.JOIN_RESULT,
      { key: request.payload.key, accepted, rejected: [], roomOwner: owner },
      { requestId: request.requestId, ...extra },
    )
  const error = (code, request = currentRequest(), extra = {}) =>
    socket.receive(MSG_TYPE.ERROR, code, {
      code,
      requestId: request.requestId,
      ...extra,
    })
  const reconnect = () => {
    socket.close()
    network.connect()
    socket = FakeSocket.instances.at(-1)
    open(socket)
    return socket
  }
  return {
    app,
    state,
    network,
    savedBytes,
    elements,
    open: () => open(socket),
    join,
    result,
    error,
    reconnect,
    currentRequest,
    socket: () => socket,
  }
}
const info = (key, played = false, eligible = 2) => ({
  key,
  name: key,
  players: [
    { id: 'one', connected: true },
    { id: 'two', connected: true },
  ],
  firstRoundStarted: played,
  eligiblePlayerCount: eligible,
  ownerStatus: 'away',
  started: played,
  running: false,
  interval: 40,
  scores: { gamecount: 0, players: [], messages: [] },
  round: { stage: played ? 'finished' : 'configuration', startId: null },
})
try {
  const f = await fixture({
    saved: {
      [room]: { roomOwner: ownerCredential, localPlayers: [] },
      55667788: { roomOwner: ownerCredential, localPlayers: {} },
    },
  })
  f.open()
  f.state.addConnectedGame(room)
  f.app.setScreen('lobby')
  const privateBytes = f.savedBytes.get('connectedGames')
  f.socket().receive(MSG_TYPE.LOBBY_LIST, [])
  assert.equal(
    f.savedBytes.get('connectedGames'),
    privateBytes,
    'Absent public/private rooms retain independent saved proof',
  )
  const request = f.join()
  assert.deepEqual(request.payload.reconnect, [])
  assert.deepEqual(request.payload.roomOwner, ownerCredential)
  assert.equal(f.state.isRoomOwner(), false, 'Saved proof is not permission')
  f.result(request, acceptedOwner, { requestId: 'foreign' })
  f.socket().receive(
    MSG_TYPE.JOIN_RESULT,
    { key: '55667788', accepted: [], rejected: [], roomOwner: acceptedOwner },
    { requestId: request.requestId },
  )
  assert.equal(f.state.isRoomOwner(), false)
  f.socket().receive(
    MSG_TYPE.JOIN_RESULT,
    { key: room, accepted: [], rejected: [], roomOwner: acceptedOwner },
    { requestId: request.requestId, protocolVersion: undefined },
  )
  assert.equal(
    f.state.isRoomOwner(),
    false,
    'Private result must carry the current protocol',
  )
  assert.equal(
    f.app.roomSession.pendingJoin,
    null,
    'Mismatch retires the private request',
  )
  f.result(f.join())
  assert.equal(f.state.isRoomOwner(), true)
  assert.equal(f.network.inputHandles.size, 0)
  f.socket().receive(MSG_TYPE.GAME_INFO, info(room))
  assert.equal(f.state.canStartRound(), true)
  assert.equal(f.app.settingsView.spectator, false)
  f.socket().receive(MSG_TYPE.ROOM_OWNER_REVOKED, {
    key: '55667788',
    ownerClientId: ownerCredential.ownerClientId,
  })
  f.socket().receive(MSG_TYPE.ROOM_OWNER_REVOKED, {
    key: room,
    ownerClientId: 'b'.repeat(32),
  })
  assert.equal(f.state.isRoomOwner(), true)
  f.socket().receive(MSG_TYPE.ROOM_OWNER_REVOKED, {
    key: room,
    ownerClientId: ownerCredential.ownerClientId,
  })
  assert.equal(f.state.isRoomOwner(), false)
  assert.equal(f.state.canStartRound(), false)
  assert.equal(f.app.settingsView.spectator, true)
  assert.equal(f.state.getRoomOwnerClaim(room), undefined)
  assert.deepEqual(f.state.getRoomOwnerClaim(room, true), ownerCredential)
  const oldSocket = f.socket()
  f.reconnect()
  assert.equal(
    f.currentRequest().payload.roomOwner,
    undefined,
    'Revoked owner cannot automatically reclaim',
  )
  assert.equal(f.state.isRoomOwner(), false)
  oldSocket.receive(
    MSG_TYPE.JOIN_RESULT,
    { key: room, accepted: [], rejected: [], roomOwner: acceptedOwner },
    { requestId: request.requestId },
  )
  oldSocket.receive(MSG_TYPE.ROOM_OWNER_REVOKED, {
    key: room,
    ownerClientId: ownerCredential.ownerClientId,
  })
  assert.equal(
    f.state.isRoomOwner(),
    false,
    'Superseded transport cannot restore controls',
  )
  const explicit = f.join()
  assert.deepEqual(explicit.payload.roomOwner, ownerCredential)
  f.result(explicit)
  assert.equal(f.state.isRoomOwner(), true)
  // Even a current transport cannot acknowledge an earlier socket generation.
  const staleGeneration = f.join()
  f.network.generation++
  f.result(staleGeneration)
  assert.equal(f.state.isRoomOwner(), false)
  assert.ok(f.state.getRoomOwnerClaim(room, true))

  // Owner responses authenticate independently from acknowledged bike handles.
  f.state.addLocalPlayer('one', { left: 65, right: 68 }, 'B'.repeat(43))
  for (const owner of [
    undefined,
    null,
    {},
    { accepted: 1, ownerClientId: ownerCredential.ownerClientId },
    { accepted: true, ownerClientId: 'b'.repeat(32) },
    { accepted: false, code: 'INVALID_OWNER_CREDENTIAL' },
  ]) {
    const pending = f.join()
    f.socket().receive(
      MSG_TYPE.JOIN_RESULT,
      {
        key: room,
        accepted: [{ id: 'one', inputHandle: 17 }],
        rejected: [],
        ...(owner === undefined ? {} : { roomOwner: owner }),
      },
      { requestId: pending.requestId },
    )
    assert.equal(f.state.isRoomOwner(), false)
    const legitimateRejection = owner?.accepted === false
    assert.equal(f.state.isLocalPlayer('one'), legitimateRejection)
    assert.equal(f.network.inputHandles.has('one'), legitimateRejection)
    assert.equal(f.app.roomSession.pendingJoin === null, legitimateRejection)
    assert.deepEqual(f.state.getRoomOwnerClaim(room, true), ownerCredential)
  }
  for (const [accepted, rejected] of [
    [[null], []],
    [[{}], []],
    [[{ id: 'one', inputHandle: -1 }], []],
    [[{ id: 'one', inputHandle: 256 }], []],
    [[{ id: 'one', inputHandle: '1' }], []],
    [
      [
        { id: 'one', inputHandle: 1 },
        { id: 'one', inputHandle: 2 },
      ],
      [],
    ],
    [[{ id: 'foreign', inputHandle: 1 }], []],
    [[], []],
    [[], [null]],
    [[], [{ id: 'one', code: 'MADE_UP' }]],
    [
      [{ id: 'one', inputHandle: 1 }],
      [{ id: 'one', code: 'INVALID_CREDENTIAL' }],
    ],
  ]) {
    const pending = f.join()
    const before = f.savedBytes.get('connectedGames')
    f.socket().receive(
      MSG_TYPE.JOIN_RESULT,
      {
        key: room,
        accepted,
        rejected,
        roomOwner: acceptedOwner,
      },
      { requestId: pending.requestId },
    )
    assert.equal(f.state.isRoomOwner(), false)
    assert.equal(f.state.isLocalPlayer('one'), false)
    assert.equal(f.network.inputHandles.size, 0)
    assert.equal(f.savedBytes.get('connectedGames'), before)
    assert.equal(f.app.roomSession.pendingJoin.requestId, pending.requestId)
  }
  const ownerGood = f.join()
  f.socket().receive(
    MSG_TYPE.JOIN_RESULT,
    {
      key: room,
      accepted: [],
      rejected: [{ id: 'one', code: 'INVALID_CREDENTIAL' }],
      roomOwner: acceptedOwner,
    },
    { requestId: ownerGood.requestId },
  )
  assert.equal(f.state.isRoomOwner(), true)
  assert.equal(f.state.isLocalPlayer('one'), false)

  // Only the explicit pending request in the current room/generation can erase
  // a record. Capacity, rejected proof, transport loss and unsolicited errors
  // retain the exact stored credential bytes.
  for (const code of [
    'INVALID_OWNER_CREDENTIAL',
    'ROOM_FULL',
    'INPUT_HANDLE_EXHAUSTED',
    'PERSISTENCE_FAILED',
    'INVALID_MESSAGE',
  ]) {
    f.join()
    const before = f.savedBytes.get('connectedGames')
    f.error(code)
    assert.equal(f.savedBytes.get('connectedGames'), before)
  }
  let pending = f.join()
  let before = f.savedBytes.get('connectedGames')
  f.error('GAME_NOT_FOUND', pending, { requestId: 'unrelated' })
  assert.equal(f.savedBytes.get('connectedGames'), before)
  f.network.generation++
  f.error('GAME_NOT_FOUND', pending)
  assert.equal(f.savedBytes.get('connectedGames'), before)
  pending = f.join()
  f.app.roomSession.currentGameKey = '55667788'
  f.error('GAME_NOT_FOUND', pending)
  assert.equal(f.savedBytes.get('connectedGames'), before)
  pending = f.join(room, false)
  f.error('GAME_NOT_FOUND', pending)
  assert.equal(
    f.savedBytes.get('connectedGames'),
    before,
    'Automatic reconnect failure retains recovery proof',
  )
  f.join()
  before = f.savedBytes.get('connectedGames')
  f.socket().close()
  assert.equal(f.savedBytes.get('connectedGames'), before)
  assert.equal(f.state.isRoomOwner(), false)
  f.reconnect()
  pending = f.join()
  f.error('GAME_NOT_FOUND', pending)
  assert.equal(f.state.connectedGames[room], undefined)
  assert.ok(f.state.connectedGames['55667788'])
  assert.equal(f.app.roomSession.currentGameKey, null)
  assert.equal(
    f.state.screen,
    'lobby',
    'Missing-room recovery leaves usable navigation',
  )

  // Actual lobby rendering offers ordinary admission to a closed room; saved
  // owner-only and revoked records retain explicit recovery labels.
  f.state.connectedGames = {}
  const closed = [
    { key: room, name: 'Closed', numPlayers: 6, acceptingPlayers: false },
  ]
  f.app.lobbyView.updateGamelistTable(closed)
  let button =
    f.elements.get('body-gamelisttable').children[0].children[4].children[0]
  assert.equal(button.disabled, false)
  assert.equal(button.children[0].text.trim(), 'join')
  button.onclick()
  assert.deepEqual(f.currentRequest().payload.reconnect, [])
  assert.equal(f.currentRequest().payload.roomOwner, undefined)
  f.result(f.currentRequest(), null)
  f.socket().receive(MSG_TYPE.GAME_INFO, info(room))
  assert.equal(
    f.state.canStartRound(),
    false,
    'Absent owner blocks only first start',
  )
  f.socket().receive(MSG_TYPE.GAME_INFO, info(room, true))
  assert.equal(
    f.state.canStartRound(),
    true,
    'A joined spectator may request a later eligible round',
  )
  assert.equal(
    f.app.settingsView.spectator,
    true,
    'Later-start permission does not grant speed control',
  )
  assert.equal(
    f.elements.get('gamecount').children[0].text,
    'No completed rounds',
  )
  assert.equal(f.elements.get('round-results-label').textContent, '')
  f.app.gameView.updateScores({ gamecount: 2, players: [], messages: [] })
  assert.equal(f.elements.get('gamecount').children[0].text, '2nd')
  assert.equal(
    f.elements.get('round-results-label').textContent,
    " game's results...",
  )
  assert.equal(f.state.scores.gamecount, 0)
  assert.deepEqual(f.state.scores.messages, [])
  assert.match(
    f.elements.get('connection-feedback').textContent,
    /no round completed/i,
  )
  f.socket().receive(MSG_TYPE.GAME_INFO, info(room, true, 1))
  assert.equal(f.state.canStartRound(), false)
  f.state.saveRoomOwner(room, ownerCredential)
  f.state.revokeRoomOwner(room)
  f.app.lobbyView.updateGamelistTable(closed)
  button =
    f.elements.get('body-gamelisttable').children[0].children[4].children[0]
  assert.equal(button.disabled, false)
  assert.equal(button.children[0].text.trim(), 'rejoin')
  button.onclick()
  assert.deepEqual(f.currentRequest().payload.roomOwner, ownerCredential)

  for (const search of [`?room=${room}`, `?room=${room}&other=value`]) {
    const direct = await fixture({ search })
    assert.equal(direct.socket().messages(MSG_TYPE.JOIN_GAME).length, 0)
    direct.open()
    assert.equal(direct.socket().messages(MSG_TYPE.JOIN_GAME).length, 1)
    assert.equal(direct.currentRequest().payload.key, room)
    assert.deepEqual(direct.currentRequest().payload.reconnect, [])
    assert.equal(direct.currentRequest().payload.roomOwner, undefined)
    direct.result(direct.currentRequest(), null)
    direct.socket().receive(MSG_TYPE.GAME_INFO, info(room, true))
    assert.equal(direct.state.screen, 'game')
    assert.equal(direct.state.canStartRound(), true)
    direct.socket().receive(MSG_TYPE.LOBBY_LIST, [])
    assert.equal(
      direct.socket().messages(MSG_TYPE.JOIN_GAME).length,
      1,
      'Direct entry cannot probe repeatedly',
    )
  }
  const directOwner = await fixture({
    search: `?room=${room}`,
    saved: { [room]: { roomOwner: { ...ownerCredential, revoked: true } } },
  })
  directOwner.open()
  assert.deepEqual(
    directOwner.currentRequest().payload.roomOwner,
    ownerCredential,
  )
  assert.deepEqual(directOwner.currentRequest().payload.reconnect, [])
  directOwner.result()
  assert.equal(directOwner.state.isRoomOwner(), true)
  const missing = await fixture({
    search: `?room=${room}`,
    saved: { [room]: { roomOwner: ownerCredential } },
  })
  missing.open()
  missing.error('GAME_NOT_FOUND')
  assert.equal(missing.state.connectedGames[room], undefined)
  assert.equal(missing.state.screen, 'lobby')
  assert.equal(missing.app.roomSession.currentGameKey, null)
  for (const search of [
    '?room=',
    '?room=xyz',
    '?room=112233445',
    '?room=%3Cscript%3E',
    '?room=ABCDEF12',
  ]) {
    const invalid = await fixture({ search })
    invalid.open()
    assert.equal(invalid.socket().messages(MSG_TYPE.JOIN_GAME).length, 0)
    assert.equal(invalid.state.screen, 'welcome')
  }
  console.log(
    'Client owner recovery: actual coordinator/network/state/lobby correlation, independent role results, saved proof retention, revocation and direct spectator entry passed',
  )
} finally {
  for (const network of networks) {
    network.windowClosing = true
    network.stopPing()
    network.socket?.close()
  }
  globalThis.window = original.window
  globalThis.document = original.document
  globalThis.WebSocket = original.WebSocket
  globalThis.sessionStorage = original.sessionStorage
  globalThis.__ownerRecoveryFixture = original.fixture
}
