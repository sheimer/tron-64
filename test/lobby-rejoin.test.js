import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LOBBY_CHECK_BATCH_SIZE } from '../shared/constants.js'

class Element {
  constructor() {
    this.children = []
    this.style = {}
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

const originalDocument = globalThis.document
const originalFixture = globalThis.__lobbyReviewState
try {
  globalThis.document = {
    getElementById: () => null,
    createElement: () => new Element(),
    createTextNode: (text) => ({ text }),
  }
  const { state } = await import('../public/javascripts/state.js')
  const queries = []
  const network = {
    generation: 1,
    protocolReady: true,
    isConnected: () => true,
    requestLobbyList: (rooms, requestId) => queries.push({ rooms, requestId }),
  }
  globalThis.__lobbyReviewState = { state, network, LOBBY_CHECK_BATCH_SIZE }
  const source = readFileSync(
    new URL('../public/javascripts/ui/lobbyView.js', import.meta.url),
    'utf8',
  ).replace(/^import .*\n/gm, '')
  const { LobbyView } = await import(
    `data:text/javascript,${encodeURIComponent(`const { state, network, LOBBY_CHECK_BATCH_SIZE } = globalThis.__lobbyReviewState;\n${source}`)}`
  )
  const lobby = Object.create(LobbyView.prototype)
  lobby.bodyGamelistTable = new Element()
  let selected
  lobby.onSelectGame = (key) => {
    selected = key
  }
  const button = (acceptingPlayers) => {
    lobby.updateGamelistTable([
      { key: 'room', name: 'Room', numPlayers: 6, acceptingPlayers },
    ])
    return lobby.bodyGamelistTable.children[0].children[4].children[0]
  }
  state.setCurrentGame('room', 'Room')
  assert.equal(button(true).disabled, false)
  assert.equal(button(false).disabled, false)
  assert.equal(button(false).children[0].text.trim(), 'join')
  state.addLocalPlayer('player', { left: 65, right: 68 }, 'A'.repeat(43))
  state.clearOwnership()
  assert.equal(button(false).disabled, false)
  assert.equal(button(false).children[0].text.trim(), 'rejoin')
  button(false).onclick()
  assert.equal(selected, 'room')
  assert.equal(state.isLocalPlayer('player'), false)
  state.revokeOwnership(['player'], 'room')
  assert.equal(
    button(false).disabled,
    false,
    'Explicit reclaim includes revoked credentials',
  )
  state.connectedGames.room.localPlayers.player.reconnectToken = 'invalid'
  assert.equal(button(false).disabled, false)
  state.connectedGames.room.localPlayers.player = { left: 65, right: 68 }
  assert.equal(
    button(false).disabled,
    false,
    'Legacy IDs still permit spectator admission without enabling recovery',
  )
  state.saveRoomOwner('room', {
    ownerClientId: 'a'.repeat(32),
    roomOwnerToken: 'B'.repeat(43),
  })
  assert.equal(
    button(false).disabled,
    false,
    'Owner-only recovery requires no bikes',
  )
  assert.equal(button(false).children[0].text.trim(), 'rejoin')
  assert.equal(
    state.isRoomOwner(),
    false,
    'Saved owner proof grants no live permission',
  )

  const discovery = new LobbyView({ onSelectGame() {} })
  discovery.bodyGamelistTable = new Element()
  state.connectedGames = {}
  const keys = Array.from({ length: LOBBY_CHECK_BATCH_SIZE + 1 }, (_, index) =>
    index.toString(16).padStart(8, '0'),
  )
  for (const key of keys) {
    state.saveRoomOwner(key, {
      ownerClientId: 'a'.repeat(32),
      roomOwnerToken: 'B'.repeat(43),
    })
  }
  state.revokeRoomOwner(keys[0])
  discovery.requestLobbyList()
  assert.deepEqual(
    queries.map((query) => query.rooms.length),
    [50, 1],
  )
  assert.ok(
    queries[0].rooms[0].roomOwner,
    'Discovery can check revoked proof without reclaiming it',
  )
  discovery.requestLobbyList()
  assert.equal(queries.length, 2, 'Unchanged proof is not repeatedly sent')
  discovery.receiveLobbyList([], { missingKeys: [keys[0]] })
  assert.ok(
    state.connectedGames[keys[0]],
    'An initial greeting cannot delete proof',
  )
  discovery.receiveLobbyList([], { requestId: 'stale', missingKeys: [keys[0]] })
  assert.ok(state.connectedGames[keys[0]])
  const changed = keys[1]
  state.saveRoomOwner(changed, {
    ownerClientId: 'c'.repeat(32),
    roomOwnerToken: 'D'.repeat(43),
  })
  discovery.receiveLobbyList([], {
    requestId: queries[0].requestId,
    missingKeys: [keys[0], changed, keys.at(-1)],
  })
  assert.equal(
    state.connectedGames[keys[0]],
    undefined,
    'Confirmed expired proof is removed automatically',
  )
  assert.ok(
    state.connectedGames[changed],
    'A stale check cannot delete replaced proof',
  )
  assert.ok(
    state.connectedGames[keys.at(-1)],
    'Only checked keys may be removed',
  )
  network.generation++
  discovery.receiveLobbyList([], {
    requestId: queries[1].requestId,
    missingKeys: [keys.at(-1)],
  })
  assert.ok(
    state.connectedGames[keys.at(-1)],
    'Old socket responses cannot remove saved proof',
  )
  discovery.requestLobbyList()
  const current = queries.at(-1)
  const live = keys[2]
  discovery.receiveLobbyList(
    [
      {
        key: live,
        name: 'Live private room',
        numPlayers: 2,
        isPublic: false,
        acceptingPlayers: false,
      },
    ],
    { requestId: current.requestId, missingKeys: [] },
  )
  const row = discovery.bodyGamelistTable.children[0]
  assert.equal(row.children[1].children[0].text, 'Live private room')
  assert.equal(row.children[2].children[0].text, 2)
  assert.equal(row.children[3].children[0].text, 'private; registration closed')
  assert.equal(row.children[4].children[0].children[0].text.trim(), 'rejoin')
  discovery.receiveLobbyList([], { missingKeys: [live] })
  assert.equal(
    state.connectedGames[live],
    undefined,
    'A personalized deletion broadcast retires checked proof',
  )
  assert.equal(state.isRoomOwner(), false)
  assert.equal(state.ownedPlayerIds.size, 0, 'Discovery grants no bike control')
  console.log(
    'Lobby rejoin: credentials enable explicit recovery without granting ownership',
  )
} finally {
  globalThis.document = originalDocument
  globalThis.__lobbyReviewState = originalFixture
}
