import { network } from '../network.js'
import { state } from '../state.js'
import { settings } from '../settings.js'
import { MSG_TYPE } from '/shared/protocol.js'
import { GRID_SIZE } from '/shared/constants.js'

export class LobbyView {
  constructor({ onSelectGame }) {
    this.onSelectGame = onSelectGame
    this.unsubscribers = []

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
      this.inputGameName.onkeyup = (evt) => {
        gameName = evt.target.value.trim()
        this.btnCreateGame.disabled = !gameName.length
      }

      if (this.formCreateGame) {
        this.formCreateGame.onsubmit = () => {
          if (!this.btnCreateGame.disabled) {
            network.createGame({
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
      joinButton.appendChild(document.createTextNode(' join '))

      joinButton.onclick = () => {
        this.onSelectGame(item.key, item.name)
      }

      const isReconnectable =
        state.connectedGames[item.key] &&
        Object.keys(state.connectedGames[item.key].localPlayers || {}).length > 0

      joinButton.disabled = !item.acceptingPlayers && !isReconnectable

      tdAction.appendChild(joinButton)
      tr.appendChild(tdAction)

      this.bodyGamelistTable.appendChild(tr)
    }
  }

  show() {
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
        // Clean up stale connected games from sessionStorage
        const localGameKeys = Object.keys(state.connectedGames)
        const staleKeys = localGameKeys.filter(
          (key) => !list.some((serverGame) => serverGame.key === key),
        )
        if (staleKeys.length) {
          state.removeConnectedGames(staleKeys)
        }
        state.set('gamesList', list)
        this.updateGamelistTable(list)
      }),
    )

    this.unsubscribers.push(
      network.on(MSG_TYPE.GAME_CREATED, (gameId) => {
        const gameName = this.inputGameName
          ? this.inputGameName.value.trim()
          : ''
        this.onSelectGame(gameId, gameName)
      }),
    )

    this.unsubscribers.push(
      network.on(MSG_TYPE.ERROR, (errorMessage) => {
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
    if (this.container) this.container.style.display = 'none'
    if (this.footer) this.footer.style.display = 'none'

    this.unsubscribers.forEach((unsub) => unsub())
    this.unsubscribers = []
  }
}
