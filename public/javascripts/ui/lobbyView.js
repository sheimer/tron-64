import { network } from '../network.js'
import { state } from '../state.js'
import { settings } from '../settings.js'
import { MSG_TYPE } from '/shared/protocol.js'
import { GRID_SIZE, LOBBY_CHECK_BATCH_SIZE } from '/shared/constants.js'

export class LobbyView {
  constructor({ onSelectGame }) {
    this.onSelectGame = onSelectGame
    this.unsubscribers = []
    this.pendingCreation = null
    this.lobbyErrorTimer = null
    this.pendingLobbyChecks = new Map()
    this.verifiedLobbyRecords = new Map()
    this.lobbyClaimsSignature = null

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
        this.clearLobbyError()
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

  clearLobbyError() {
    clearTimeout(this.lobbyErrorTimer)
    this.lobbyErrorTimer = null
    if (this.lobbyError) this.lobbyError.style.display = 'none'
  }

  requestLobbyList() {
    if (!network.isConnected() || !network.protocolReady) return
    const records = Object.entries(state.connectedGames).filter(([key]) =>
      /^[a-f0-9]{8}$/.test(key),
    )
    const signature = JSON.stringify([network.generation, records])
    if (signature === this.lobbyClaimsSignature) return
    this.lobbyClaimsSignature = signature
    this.pendingLobbyChecks.clear()
    for (const key of this.verifiedLobbyRecords.keys()) {
      if (!state.connectedGames[key]) this.verifiedLobbyRecords.delete(key)
    }
    for (
      let offset = 0;
      offset < Math.max(1, records.length);
      offset += LOBBY_CHECK_BATCH_SIZE
    ) {
      const batch = records.slice(offset, offset + LOBBY_CHECK_BATCH_SIZE)
      const requestId = Array.from(crypto.getRandomValues(new Uint8Array(12)))
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('')
      const snapshots = new Map(
        batch.map(([key, record]) => [key, JSON.stringify(record)]),
      )
      this.pendingLobbyChecks.set(requestId, {
        generation: network.generation,
        snapshots,
      })
      network.requestLobbyList(
        batch.map(([key]) => ({
          key,
          roomOwner: state.getRoomOwnerClaim(key, true),
          reconnect: state.getReconnectEntries(key, true),
        })),
        requestId,
      )
    }
  }

  receiveLobbyList(list, msg) {
    if (!Array.isArray(list)) return
    if (msg?.requestId !== undefined) {
      const pending = this.pendingLobbyChecks.get(msg.requestId)
      if (!pending || pending.generation !== network.generation) return
      this.pendingLobbyChecks.delete(msg.requestId)
      for (const [key, record] of pending.snapshots) {
        if (JSON.stringify(state.connectedGames[key]) === record)
          this.verifiedLobbyRecords.set(key, record)
      }
    }
    // Only an explicit server absence for an unchanged checked record retires
    // credentials. A public-only greeting or a rejected proof cannot do so.
    const missing = Array.isArray(msg?.missingKeys)
      ? msg.missingKeys.filter(
          (key) =>
            this.verifiedLobbyRecords.has(key) &&
            this.verifiedLobbyRecords.get(key) ===
              JSON.stringify(state.connectedGames[key]),
        )
      : []
    state.set('gamesList', list)
    if (missing.length) {
      for (const key of missing) this.verifiedLobbyRecords.delete(key)
      state.removeConnectedGames(missing)
    }
    this.updateGamelistTable(list)
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

    const rooms = Array.isArray(list) ? list : []
    if (rooms.length === 0) {
      this.renderStatusRow(
        'No active games found. Create one above to get started!',
      )
      return
    }

    while (this.bodyGamelistTable.firstChild) {
      this.bodyGamelistTable.removeChild(this.bodyGamelistTable.lastChild)
    }

    for (let i = 0; i < rooms.length; i++) {
      const item = rooms[i]
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
        document.createTextNode(
          `${item.isPublic === false ? 'private; ' : ''}${
            item.acceptingPlayers ? 'registration open' : 'registration closed'
          }`,
        ),
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
    this.clearLobbyError()
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
      state.subscribe('connectedGames', () => {
        this.updateGamelistTable(state.gamesList)
        this.requestLobbyList()
      }),
    )

    this.unsubscribers.push(
      network.on('close', () => {
        this.clearPendingCreation()
        this.pendingLobbyChecks.clear()
        this.verifiedLobbyRecords.clear()
        this.lobbyClaimsSignature = null
        this.renderStatusRow(
          'Connection lost. Reconnecting to server...',
          'fg-rose-muted',
        )
      }),
    )

    this.unsubscribers.push(
      network.on('open', () => {
        this.renderStatusRow('Fetching active games...')
        this.requestLobbyList()
      }),
    )

    this.unsubscribers.push(
      network.on(MSG_TYPE.LOBBY_LIST, (list, msg) =>
        this.receiveLobbyList(list, msg),
      ),
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
        this.clearLobbyError()
        if (this.lobbyError) {
          this.lobbyError.textContent = `[!] ${errorMessage}`
          this.lobbyError.style.display = 'block'
          const timer = setTimeout(() => {
            if (this.lobbyErrorTimer !== timer) return
            this.lobbyErrorTimer = null
            if (this.lobbyError) {
              this.lobbyError.style.display = 'none'
            }
          }, 8000)
          this.lobbyErrorTimer = timer
        }
      }),
    )

    this.lobbyClaimsSignature = null
    this.requestLobbyList()
  }

  hide() {
    this.clearPendingCreation()
    this.clearLobbyError()
    this.pendingLobbyChecks.clear()
    this.verifiedLobbyRecords.clear()
    this.lobbyClaimsSignature = null
    if (this.container) this.container.style.display = 'none'
    if (this.footer) this.footer.style.display = 'none'

    this.unsubscribers.forEach((unsub) => unsub())
    this.unsubscribers = []
  }
}
