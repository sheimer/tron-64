import { network } from '../network.js'
import { state } from '../state.js'
import { settings } from '../settings.js'
import { MSG_TYPE } from '/shared/protocol.js'
import { GRID_SIZE } from '/shared/constants.js'

export class LobbyView {
  constructor({ onSelectGame }) {
    this.onSelectGame = onSelectGame
    this.unsubscribers = []
    this.pendingCreation = null

    this.container = document.getElementById('lobby')
    this.footer = document.getElementById('footer-lobby')
    this.bodyGamelistTable = document.getElementById('body-gamelisttable')
    this.formCreateGame = document.getElementById('form-create-game')
    this.inputGameName = document.getElementById('input-create-game')
    this.btnCreateGame = document.getElementById('btn-create-game')
    this.lobbyError = document.getElementById('lobby-error')

    this.initCreateForm()
  }

  initCreateForm() {
    let gameName = ''

    if (this.inputGameName && this.btnCreateGame) {
      this.inputGameName.oninput = (evt) => {
        gameName = evt.target.value.trim()
        this.btnCreateGame.disabled = !gameName.length
      }

      if (this.formCreateGame) {
        this.formCreateGame.onsubmit = () => {
          if (!this.btnCreateGame.disabled) {
            this.createGame({
              name: gameName,
              size: GRID_SIZE,
              interval: Math.round(1000 / settings.speed),
              isPublic: true,
            })
          }
          return false
        }
      }
    }
  }

  createGame(payload) {
    if (this.pendingCreation) return
    const requestId = Array.from(crypto.getRandomValues(new Uint8Array(12)))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
    const pending = {
      requestId,
      generation: network.generation,
      payload,
      attempts: 0,
      timer: null,
    }
    this.pendingCreation = pending
    const retry = () => {
      if (
        this.pendingCreation !== pending ||
        pending.generation !== network.generation
      )
        return
      if (pending.attempts >= 3) {
        this.clearPendingCreation()
        if (this.lobbyError) {
          this.lobbyError.textContent =
            'Room creation acknowledgement was lost. Try again or reload before creating another room.'
          this.lobbyError.style.display = 'block'
        }
        return
      }
      pending.attempts++
      network.createGame(payload, requestId)
      pending.timer = setTimeout(retry, 2000)
    }
    retry()
  }

  clearPendingCreation() {
    clearTimeout(this.pendingCreation?.timer)
    this.pendingCreation = null
  }

  renderStatusRow(message, extraClass = 'fg-fg-muted') {
    if (!this.bodyGamelistTable) return

    while (this.bodyGamelistTable.firstChild) {
      this.bodyGamelistTable.removeChild(this.bodyGamelistTable.lastChild)
    }

    const tr = document.createElement('tr')
    const td = document.createElement('td')
    td.colSpan = 5
    td.className = extraClass
    td.style.textAlign = 'center'
    td.style.padding = '1.5rem 0'
    td.appendChild(document.createTextNode(message))
    tr.appendChild(td)
    this.bodyGamelistTable.appendChild(tr)
  }

  updateGamelistTable(list) {
    if (!this.bodyGamelistTable) return

    if (!Array.isArray(list) || list.length === 0) {
      this.renderStatusRow(
        'No active games found. Create one above to get started!',
      )
      return
    }

    while (this.bodyGamelistTable.firstChild) {
      this.bodyGamelistTable.removeChild(this.bodyGamelistTable.lastChild)
    }

    for (let i = 0; i < list.length; i++) {
      const item = list[i]
      const tr = document.createElement('tr')

      // Key
      const tdKey = document.createElement('td')
      tdKey.appendChild(document.createTextNode(item.key))
      tr.appendChild(tdKey)

      // Name
      const tdName = document.createElement('td')
      tdName.appendChild(document.createTextNode(item.name))
      tr.appendChild(tdName)

      // Number of Players
      const tdPlayers = document.createElement('td')
      tdPlayers.appendChild(document.createTextNode(item.numPlayers))
      tr.appendChild(tdPlayers)

      // Status
      const tdStatus = document.createElement('td')
      tdStatus.appendChild(
        document.createTextNode(item.acceptingPlayers ? 'waiting' : 'running'),
      )
      tr.appendChild(tdStatus)

      // Action / Join button
      const tdAction = document.createElement('td')
      const joinButton = document.createElement('button')
      const canRejoin =
        state.getReconnectEntries(item.key, true).length > 0 ||
        Boolean(state.getRoomOwnerClaim(item.key, true))
      joinButton.appendChild(
        document.createTextNode(canRejoin ? ' rejoin ' : ' join '),
      )

      joinButton.onclick = () => {
        this.onSelectGame(item.key, item.name)
      }

      // Room admission remains available to spectators after bike registration
      // closes. The server owns membership/capacity checks for every join.
      joinButton.disabled = false

      tdAction.appendChild(joinButton)
      tr.appendChild(tdAction)

      this.bodyGamelistTable.appendChild(tr)
    }
  }

  show() {
    this.unsubscribers.forEach((unsub) => unsub())
    this.unsubscribers = []

    if (this.container) this.container.style.display = ''
    if (this.footer) this.footer.style.display = ''

    if (!state.gamesList || state.gamesList.length === 0) {
      if (network.isConnected()) {
        this.renderStatusRow('Fetching active games...')
      } else {
        this.renderStatusRow('Connecting to server & fetching games...')
      }
    } else {
      this.updateGamelistTable(state.gamesList)
    }

    this.unsubscribers.push(
      network.on('close', () => {
        this.clearPendingCreation()
        this.renderStatusRow(
          'Connection lost. Reconnecting to server...',
          'fg-rose-muted',
        )
      }),
    )

    this.unsubscribers.push(
      network.on('open', () => {
        this.renderStatusRow('Fetching active games...')
        network.requestLobbyList()
      }),
    )

    this.unsubscribers.push(
      network.on(MSG_TYPE.LOBBY_LIST, (list) => {
        if (!Array.isArray(list)) return
        // A public-only listing cannot establish that a saved private room is gone.
        state.set('gamesList', list)
        this.updateGamelistTable(list)
      }),
    )

    this.unsubscribers.push(
      network.on(MSG_TYPE.GAME_CREATED, (created, msg) => {
        const pending = this.pendingCreation
        if (
          !pending ||
          msg?.requestId !== pending.requestId ||
          pending.generation !== network.generation ||
          !/^[a-f0-9]{8}$/.test(created?.key) ||
          !/^[a-f0-9]{32}$/.test(created.ownerClientId) ||
          !/^[A-Za-z0-9_-]{43}$/.test(created.roomOwnerToken)
        )
          return
        this.clearPendingCreation()
        state.saveRoomOwner(created.key, {
          ownerClientId: created.ownerClientId,
          roomOwnerToken: created.roomOwnerToken,
        })
        this.onSelectGame(created.key, pending.payload.name)
      }),
    )

    this.unsubscribers.push(
      network.on(MSG_TYPE.ERROR, (errorMessage, msg) => {
        if (msg?.requestId === this.pendingCreation?.requestId)
          this.clearPendingCreation()
        if (this.lobbyError) {
          this.lobbyError.textContent = `[!] ${errorMessage}`
          this.lobbyError.style.display = 'block'
          setTimeout(() => {
            if (this.lobbyError) {
              this.lobbyError.style.display = 'none'
            }
          }, 8000)
        }
      }),
    )

    network.requestLobbyList()
  }

  hide() {
    this.clearPendingCreation()
    if (this.container) this.container.style.display = 'none'
    if (this.footer) this.footer.style.display = 'none'

    this.unsubscribers.forEach((unsub) => unsub())
    this.unsubscribers = []
  }
}
