export class LobbyView {
  constructor({ onSelectGame, onCreateGame, canRejoin, onShow, onHide }) {
    this.onSelectGame = onSelectGame
    this.onCreateGame = onCreateGame
    this.canRejoin = canRejoin
    this.onShow = onShow
    this.onHide = onHide
    this.lobbyErrorTimer = null

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
            this.onCreateGame(gameName)
          }
          return false
        }
      }
    }
  }

  clearLobbyError() {
    clearTimeout(this.lobbyErrorTimer)
    this.lobbyErrorTimer = null
    if (this.lobbyError) {
      this.lobbyError.style.display = 'none'
    }
  }

  showError(message, persistent = false) {
    this.clearLobbyError()
    if (!this.lobbyError) {
      return
    }
    this.lobbyError.textContent = message
    this.lobbyError.style.display = 'block'
    if (persistent) {
      return
    }
    const timer = setTimeout(() => {
      if (this.lobbyErrorTimer !== timer) {
        return
      }
      this.lobbyErrorTimer = null
      this.lobbyError.style.display = 'none'
    }, 8000)
    this.lobbyErrorTimer = timer
  }

  renderStatusRow(message, extraClass = 'fg-fg-muted') {
    if (!this.bodyGamelistTable) {
      return
    }

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
    if (!this.bodyGamelistTable) {
      return
    }

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
      const canRejoin = this.canRejoin(item.key)
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
    if (this.container) {
      this.container.style.display = ''
    }
    if (this.footer) {
      this.footer.style.display = ''
    }
    this.onShow()
  }

  hide() {
    this.onHide()
    this.clearLobbyError()
    if (this.container) {
      this.container.style.display = 'none'
    }
    if (this.footer) {
      this.footer.style.display = 'none'
    }
  }
}
