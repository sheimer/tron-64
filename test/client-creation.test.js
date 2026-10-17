import assert from 'node:assert/strict'
import { LobbySession } from '../public/javascripts/lobbySession.js'
import { LobbyView } from '../public/javascripts/ui/lobbyView.js'
import { GRID_SIZE } from '../shared/constants.js'
import { MSG_TYPE } from '../shared/protocol.js'
import { state } from '../public/javascripts/state.js'

const originalDocument = globalThis.document
const originalStorage = globalThis.sessionStorage
const originalSetTimeout = globalThis.setTimeout
const originalClearTimeout = globalThis.clearTimeout
try {
  const timers = new Map()
  let sequence = 0
  let now = 0
  globalThis.setTimeout = (callback, delay) => {
    timers.set(++sequence, { callback, at: now + delay })
    return sequence
  }
  globalThis.clearTimeout = (id) => timers.delete(id)
  const nextTimer = () => {
    const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0]
    timers.delete(id)
    now = timer.at
    timer.callback()
  }
  const advance = (duration) => {
    const target = now + duration
    while ([...timers.values()].some((timer) => timer.at <= target)) {
      nextTimer()
    }
    now = target
  }
  const saved = new Map()
  globalThis.sessionStorage = {
    getItem: (key) => saved.get(key),
    setItem: (key, value) => saved.set(key, value),
  }
  const lobbyError = { textContent: '', style: {} }
  globalThis.document = {
    getElementById: (id) => (id === 'lobby-error' ? lobbyError : null),
  }
  const listeners = new Map()
  const sends = []
  const network = {
    generation: 1,
    isConnected: () => true,
    requestLobbyList() {},
    createGame(payload, requestId) {
      sends.push({ payload, requestId })
    },
    on(type, callback) {
      listeners.set(type, callback)
      return () => listeners.delete(type)
    },
  }
  const selected = []
  const selectGame = (key, name) => selected.push({ key, name })
  const session = new LobbySession({
    state,
    network,
    settings: { speed: 40 },
    callbacks: {
      onSelectGame: selectGame,
      updateGamelistTable: (list) => lobby.updateGamelistTable(list),
      renderStatusRow: (message, extraClass) =>
        lobby.renderStatusRow(message, extraClass),
      showError: (message, persistent) => lobby.showError(message, persistent),
    },
  })
  const lobby = new LobbyView({
    onSelectGame: selectGame,
    onCreateGame: (name) => session.createGame(name),
    canRejoin: (key) => Boolean(state.getRoomOwnerClaim(key, true)),
    onShow: () => session.start(),
    onHide: () => session.stop(),
  })
  assert.equal(listeners.size, 0, 'Construction does not subscribe transport')
  lobby.show()
  assert.equal(state.listeners.get('connectedGames').size, 1)
  const payload = {
    name: 'Creator without bikes',
    size: GRID_SIZE,
    interval: 25,
    isPublic: true,
  }
  const created = {
    key: '12345678',
    ownerClientId: 'a'.repeat(32),
    roomOwnerToken: 'B'.repeat(43),
  }
  session.createGame(payload.name)
  assert.deepEqual(sends[0].payload, payload)
  const requestId = sends[0].requestId
  assert.match(requestId, /^[A-Za-z0-9_-]{1,64}$/)
  session.createGame('Duplicate form submission')
  assert.equal(sends.length, 1)
  const acknowledge = (result = created, id = requestId) =>
    listeners.get(MSG_TYPE.GAME_CREATED)(result, { requestId: id })
  acknowledge(created, 'unrelated')
  acknowledge({ ...created, roomOwnerToken: 'invalid' })
  assert.deepEqual(selected, [])
  assert.equal(state.getRoomOwnerClaim(created.key), undefined)
  nextTimer()
  assert.deepEqual(
    sends[1],
    sends[0],
    'Retry preserves the exact request and payload',
  )
  acknowledge()
  assert.deepEqual(selected, [{ key: created.key, name: payload.name }])
  assert.equal(timers.size, 0)
  assert.deepEqual(state.getReconnectEntries(created.key), [])
  assert.deepEqual(state.getRoomOwnerClaim(created.key), {
    ownerClientId: created.ownerClientId,
    roomOwnerToken: created.roomOwnerToken,
  })
  assert.equal(
    state.isRoomOwner(),
    false,
    'Saved proof alone grants no live permission',
  )
  const record = JSON.parse(saved.get('connectedGames'))[created.key]
  assert.deepEqual(record.localPlayers, {})
  // Normalization must preserve an independent owner even with no bike map.
  state.connectedGames[created.key] = {
    roomOwner: record.roomOwner,
    localPlayers: [],
  }
  state.addConnectedGame(created.key)
  assert.deepEqual(state.getRoomOwnerClaim(created.key), {
    ownerClientId: created.ownerClientId,
    roomOwnerToken: created.roomOwnerToken,
  })
  listeners.get(MSG_TYPE.LOBBY_LIST)([])
  assert.ok(
    state.getRoomOwnerClaim(created.key),
    'Public absence cannot erase private room credentials',
  )
  state.setCurrentGame(created.key, payload.name)
  state.connectionIsCurrent = ({ key, generation }) =>
    key === created.key && generation === network.generation
  state.acknowledgeRoomJoin(created.key, network.generation)
  state.acknowledgeRoomOwner(created.key, created.ownerClientId)
  assert.equal(state.isRoomOwner(), true)
  state.revokeRoomOwner(created.key)
  assert.equal(state.isRoomOwner(), false)
  assert.equal(state.getRoomOwnerClaim(created.key), undefined)
  assert.ok(
    state.getRoomOwnerClaim(created.key, true),
    'Explicit recovery retains revoked proof',
  )
  state.clearOwnership()

  session.createGame(payload.name)
  const expired = sends.at(-1).requestId
  nextTimer()
  nextTimer()
  nextTimer()
  assert.equal(sends.filter((send) => send.requestId === expired).length, 3)
  assert.equal(session.pendingCreation, null)
  assert.match(lobbyError.textContent, /acknowledgement was lost/i)
  acknowledge(created, expired)
  assert.equal(selected.length, 1)
  session.createGame(payload.name)
  const stale = sends.at(-1).requestId
  network.generation++
  acknowledge(created, stale)
  assert.equal(selected.length, 1)
  listeners.get('close')()
  assert.equal(timers.size, 0)
  session.createGame(payload.name)
  const hiddenCreation = sends.at(-1).requestId
  const hiddenAcknowledgement = listeners.get(MSG_TYPE.GAME_CREATED)
  const hiddenRetry = timers.get(session.pendingCreation.timer).callback
  lobby.hide()
  assert.equal(timers.size, 0)
  assert.equal(listeners.size, 0, 'Hiding releases transport subscriptions')
  assert.equal(state.listeners.get('connectedGames').size, 0)
  hiddenAcknowledgement(created, { requestId: hiddenCreation })
  const sendsBeforeHiddenRetry = sends.length
  hiddenRetry()
  assert.equal(sends.length, sendsBeforeHiddenRetry)
  assert.equal(selected.length, 1, 'Late hidden work cannot select a room')

  lobby.show()
  const error = (message) => listeners.get(MSG_TYPE.ERROR)(message)
  error('First error')
  const replacedCallback = timers.get(lobby.lobbyErrorTimer).callback
  advance(4000)
  error('Newer error')
  assert.equal(timers.size, 1, 'New feedback replaces the previous timer')
  replacedCallback()
  assert.equal(lobbyError.textContent, '[!] Newer error')
  assert.equal(lobbyError.style.display, 'block')
  advance(7999)
  assert.equal(
    lobbyError.style.display,
    'block',
    'Feedback lasts eight seconds',
  )
  advance(1)
  assert.equal(lobbyError.style.display, 'none')
  assert.equal(lobby.lobbyErrorTimer, null)
  assert.equal(timers.size, 0)

  error('Leaving the lobby')
  const hiddenCallback = timers.get(lobby.lobbyErrorTimer).callback
  lobby.hide()
  assert.equal(timers.size, 0, 'Leaving cancels feedback expiry')
  assert.equal(lobbyError.style.display, 'none')
  lobby.show()
  error('Returned to the lobby')
  hiddenCallback()
  assert.equal(lobbyError.style.display, 'block')
  const reinitializedCallback = timers.get(lobby.lobbyErrorTimer).callback
  lobby.show()
  assert.equal(
    state.listeners.get('connectedGames').size,
    1,
    'Showing again replaces the state subscription',
  )
  assert.equal(timers.size, 0, 'Reinitializing cancels feedback expiry')
  assert.equal(lobbyError.style.display, 'none')
  error('Current lobby feedback')
  reinitializedCallback()
  assert.equal(lobbyError.style.display, 'block')
  const transientCallback = timers.get(lobby.lobbyErrorTimer).callback
  session.createGame(payload.name)
  nextTimer()
  nextTimer()
  nextTimer()
  assert.equal(timers.size, 0, 'Lost-ack feedback cancels transient expiry')
  transientCallback()
  advance(8000)
  assert.match(lobbyError.textContent, /acknowledgement was lost/i)
  assert.equal(lobbyError.style.display, 'block')
  lobby.hide()
  assert.equal(timers.size, 0)
  console.log(
    'Client creation: correlated bounded retries, independent owner-only records and lobby feedback timer lifecycle passed',
  )
} finally {
  globalThis.document = originalDocument
  globalThis.sessionStorage = originalStorage
  globalThis.setTimeout = originalSetTimeout
  globalThis.clearTimeout = originalClearTimeout
}
