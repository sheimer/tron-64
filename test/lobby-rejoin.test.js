import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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
    createElement: () => new Element(),
    createTextNode: (text) => ({ text }),
  }
  const { state } = await import('../public/javascripts/state.js')
  globalThis.__lobbyReviewState = state
  const source = readFileSync(
    new URL('../public/javascripts/ui/lobbyView.js', import.meta.url),
    'utf8',
  ).replace(/^import .*\n/gm, '')
  const { LobbyView } = await import(
    `data:text/javascript,${encodeURIComponent(`const state = globalThis.__lobbyReviewState;\n${source}`)}`
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
  assert.equal(button(false).disabled, true)
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
  assert.equal(button(false).disabled, true)
  state.connectedGames.room.localPlayers.player = { left: 65, right: 68 }
  assert.equal(
    button(false).disabled,
    true,
    'Legacy IDs alone cannot enable recovery',
  )
  console.log(
    'Lobby rejoin: credentials enable explicit recovery without granting ownership',
  )
} finally {
  globalThis.document = originalDocument
  globalThis.__lobbyReviewState = originalFixture
}
