import { settings } from '../settings.js'
import { PLAYER_COLOR_KEYS } from '/shared/constants.js'

const canHover =
  typeof window !== 'undefined' &&
  window.matchMedia('(hover: hover)').matches

const keycodes = {
  '66_78': { left: 66, right: 78 }, // b/n
  '89_88': { left: 89, right: 88 }, // y/x
  '75_76': { left: 75, right: 76 }, // k/l
  '81_87': { left: 81, right: 87 }, // q/w
  '40_39': { left: 40, right: 39 }, // <down>/<right>
  '98_99': { left: 98, right: 99 }, // <kpad 2>/<kpad 3>
  btn1_btn2: { left: 'btn-left', right: 'btn-right' }, // touch device
}

const keycodesText = {
  66: 'b',
  78: 'n',
  89: 'y',
  88: 'x',
  75: 'k',
  76: 'l',
  81: 'q',
  87: 'w',
  40: '<down>',
  39: '<right>',
  98: '<kpad 2>',
  99: '<kpad 3>',
  'btn-left': 'btn left',
  'btn-right': 'btn right',
}

export class ConfigView {
  constructor({ onAddPlayer, onStartGame, onLeaveGame }) {
    this.onAddPlayer = onAddPlayer
    this.onStartGame = onStartGame
    this.onLeaveGame = onLeaveGame

    this.container = document.getElementById('playersconfig')
    this.footer = document.getElementById('footer-playersconfig')
    this.gameIdSpan = document.getElementById('gameId')
    this.gameNameSpan = document.getElementById('gameName')
    this.bodyPlayersTable = document.getElementById('body-playerstable')

    this.formAddPlayer = document.getElementById('form-add-player')
    this.inputPlayerName = document.getElementById('input-add-player')
    this.selectKeycodes = document.getElementById('select-keycodes')
    this.msgNoKeycodes = document.getElementById('msg-no-keycodes')
    this.btnAddPlayer = document.getElementById('btn-add-player')
    this.btnInitGame = document.getElementById('btn-init-game')
    this.btnLeaveConfig = document.getElementById('btn-leave-config')

    this.initForm()
  }

  initForm() {
    if (this.selectKeycodes && this.msgNoKeycodes) {
      if (canHover) {
        this.selectKeycodes.required = true
        this.selectKeycodes.style.display = ''
        this.msgNoKeycodes.style.display = 'none'
      } else {
        this.selectKeycodes.required = false
        this.selectKeycodes.style.display = 'none'
        this.msgNoKeycodes.style.display = 'block'
      }
    }

    let playerName = ''
    let playerKeys = canHover ? '' : 'btn1_btn2'

    const checkAddButtonState = () => {
      if (this.btnAddPlayer) {
        this.btnAddPlayer.disabled = !(playerName.length && playerKeys.length)
      }
    }

    if (this.inputPlayerName) {
      this.inputPlayerName.onkeyup = (evt) => {
        playerName = evt.target.value.trim()
        checkAddButtonState()
      }
    }

    if (this.selectKeycodes) {
      this.selectKeycodes.onchange = (evt) => {
        playerKeys = evt.target.value
        checkAddButtonState()
      }
    }

    if (this.formAddPlayer) {
      this.formAddPlayer.onsubmit = () => {
        if (this.btnAddPlayer && !this.btnAddPlayer.disabled) {
          const config = keycodes[playerKeys]
          if (config) {
            this.onAddPlayer({
              name: playerName,
              left: config.left,
              right: config.right,
            })
            if (this.inputPlayerName) {
              this.inputPlayerName.value = ''
              playerName = ''
              if (!this.inputPlayerName.disabled) {
                this.inputPlayerName.focus()
              }
            }
            checkAddButtonState()
          }
        }
        return false
      }
    }

    if (this.btnInitGame) {
      this.btnInitGame.onclick = () => {
        this.onStartGame()
        return false
      }
    }

    if (this.btnLeaveConfig) {
      this.btnLeaveConfig.onclick = () => {
        if (typeof this.onLeaveGame === 'function') {
          this.onLeaveGame()
        }
        return false
      }
    }
  }

  updatePlayersTable(players) {
    if (!this.bodyPlayersTable) return

    while (this.bodyPlayersTable.firstChild) {
      this.bodyPlayersTable.removeChild(this.bodyPlayersTable.lastChild)
    }

    const colors = settings.coloredPlayers
      ? PLAYER_COLOR_KEYS
      : Array(PLAYER_COLOR_KEYS.length).fill('fg')

    for (let i = 0; i < players.length; i++) {
      const player = players[i]
      const isLocal = player.isLocal
      const isConnected = player.connected !== false
      const tr = document.createElement('tr')
      tr.className = isLocal ? `fg-${colors[i]}` : `fg-${colors[i]}-muted`
      if (!isConnected) {
        tr.style.opacity = '0.6'
      }

      // Name
      const tdName = document.createElement('td')
      const displayName = isConnected
        ? player.name
        : `${player.name} [disconnected]`
      tdName.appendChild(document.createTextNode(displayName))
      tr.appendChild(tdName)

      // Keys
      const tdKeys = document.createElement('td')
      if (isLocal) {
        const leftTxt = keycodesText[player.left] || player.left
        const rightTxt = keycodesText[player.right] || player.right
        tdKeys.appendChild(document.createTextNode(`${leftTxt}/${rightTxt}`))
      } else {
        tdKeys.appendChild(document.createTextNode('remote player'))
      }
      tr.appendChild(tdKeys)

      // Action / Placeholder
      const tdAction = document.createElement('td')
      tr.appendChild(tdAction)

      this.bodyPlayersTable.appendChild(tr)
    }

    const hasLocalPlayers = players.some((p) => p.isLocal)
    if (this.btnInitGame) {
      this.btnInitGame.disabled = !hasLocalPlayers || players.length < 2
    }

    if (players.length >= 6) {
      if (this.inputPlayerName) this.inputPlayerName.disabled = true
      if (this.selectKeycodes) this.selectKeycodes.disabled = true
      if (this.btnAddPlayer) this.btnAddPlayer.disabled = true
    } else {
      if (this.inputPlayerName) {
        this.inputPlayerName.disabled = false
        this.inputPlayerName.focus()
      }
      if (this.selectKeycodes) this.selectKeycodes.disabled = !canHover
    }
  }

  show(currentGame) {
    if (this.container) this.container.style.display = ''
    if (this.footer) this.footer.style.display = ''

    if (this.gameIdSpan && currentGame?.key) {
      this.gameIdSpan.textContent = currentGame.key
    }
    if (this.gameNameSpan && currentGame?.name) {
      this.gameNameSpan.textContent = currentGame.name
    }

    if (this.inputPlayerName && !this.inputPlayerName.disabled) {
      this.inputPlayerName.focus()
    }
  }

  hide() {
    if (this.container) this.container.style.display = 'none'
    if (this.footer) this.footer.style.display = 'none'
  }
}
