import { settings } from '../settings.js'
import { state as appState } from '../state.js'
import { PLAYER_COLOR_KEYS } from '/shared/constants.js'
import { ordinalSuffixOf } from '/shared/utils.js'

const canHover =
  typeof window !== 'undefined' &&
  window.matchMedia('(hover: hover)').matches

export class GameView {
  constructor({ onStartGame, onLeaveGame }) {
    this.onStartGame = onStartGame
    this.onLeaveGame = onLeaveGame

    this.arenaCanvas = document.getElementById('arena')
    this.playernames = document.getElementById('playernames')
    this.scores = document.getElementById('scores')
    this.scoresWaiting = document.getElementById('scores-waiting')
    this.footer = document.getElementById('footer-game')
    this.startBtn = document.getElementById('btn-start-game')
    this.leaveBtn = document.getElementById('btn-leave-game')
    this.leftBtn = document.getElementById('btn-left')
    this.rightBtn = document.getElementById('btn-right')

    this.gameCounter = document.getElementById('gamecount')
    this.gameMessages = document.getElementById('messages')
    this.bodyScoreTable = document.getElementById('body-scoretable')

    this.playerPositions = [
      document.getElementById('playerpos0'),
      document.getElementById('playerpos1'),
      document.getElementById('playerpos2'),
      document.getElementById('playerpos3'),
      document.getElementById('playerpos4'),
      document.getElementById('playerpos5'),
    ]

    this.initHandlers()
  }

  initHandlers() {
    if (this.startBtn) {
      this.startBtn.onclick = () => {
        this.onStartGame()
        return false
      }
    }

    if (this.leaveBtn) {
      this.leaveBtn.onclick = () => {
        if (typeof this.onLeaveGame === 'function') {
          this.onLeaveGame()
        }
        return false
      }
    }
  }

  updateState(state) {
    // Arena visibility
    if (this.arenaCanvas) {
      if (
        state === 'scores' ||
        state === 'scoresWaiting' ||
        state === 'finished'
      ) {
        this.arenaCanvas.style.display = 'none'
      } else if (state === 'running') {
        this.arenaCanvas.style.display = 'block'
      }
    }

    // Scoreboard visibility
    if (this.scores) {
      if (
        state === 'scores' ||
        state === 'scoresWaiting' ||
        state === 'finished'
      ) {
        this.scores.style.display = 'block'
      } else {
        this.scores.style.display = 'none'
      }
    }

    // Waiting overlay
    if (this.scoresWaiting) {
      this.scoresWaiting.style.display =
        state === 'scoresWaiting' ? 'block' : 'none'
    }

    // Player positions animation
    if (this.playernames) {
      if (state === 'running') {
        this.playernames.classList.add('active')
        setTimeout(() => {
          if (this.playernames) {
            this.playernames.classList.remove('active')
          }
        }, 2500)
      } else {
        this.playernames.classList.remove('active')
      }
    }

    // Start button readiness
    if (this.startBtn) {
      const hasLocalPlayers = (appState.players || []).some((p) => p.isLocal)
      const isReady =
        (state === 'ready' || state === 'finished') && hasLocalPlayers
      const setFocus = isReady && this.startBtn.disabled
      this.startBtn.disabled = !isReady
      if (setFocus) {
        this.startBtn.focus()
      }
    }

    // Touch control buttons
    if (this.leftBtn && this.rightBtn) {
      if (!canHover && (state === 'start' || state === 'running')) {
        this.leftBtn.style.display = ''
        this.rightBtn.style.display = ''
      } else {
        this.leftBtn.style.display = 'none'
        this.rightBtn.style.display = 'none'
      }
    }

    // Reset log
    if (state === 'start') {
      const logEl = document.getElementById('log')
      if (logEl) logEl.innerHTML = ''
    }
  }

  updatePlayerPositions(players, positions) {
    const posNames = {}
    const posOffline = {}
    players.forEach((player) => {
      if (typeof positions[player.id] !== 'undefined') {
        const isOffline = player.connected === false
        posNames[positions[player.id]] = isOffline
          ? `${player.name} [disconnected]`
          : player.name
        posOffline[positions[player.id]] = isOffline
      }
    })

    this.playerPositions.forEach((posEl, index) => {
      if (posEl) {
        posEl.innerHTML = ''
        const name = posNames[index] || ''
        posEl.appendChild(document.createTextNode(name))
        posEl.style.opacity = posOffline[index] ? '0.5' : ''
      }
    })
  }

  updateScores(scores, players = []) {
    if (!this.bodyScoreTable) return

    const colors = settings.coloredPlayers
      ? PLAYER_COLOR_KEYS
      : Array(PLAYER_COLOR_KEYS.length).fill('fg')

    const playersById = players.reduce((acc, player, index) => {
      acc[player.id] = { ...player, renderColor: colors[index] || 'fg' }
      return acc
    }, {})

    if (this.gameCounter) {
      this.gameCounter.innerHTML = ''
      this.gameCounter.appendChild(
        document.createTextNode(ordinalSuffixOf(scores.gamecount)),
      )
    }

    if (this.gameMessages) {
      this.gameMessages.innerHTML = ''
      scores.messages.forEach((message) => {
        const div = document.createElement('div')
        if (message.playerPre && playersById[message.playerPre]) {
          const p = playersById[message.playerPre]
          const span = document.createElement('span')
          span.className = `fg-${p.renderColor}${p.isLocal ? '' : '-muted'}`
          span.appendChild(document.createTextNode(p.name))
          div.appendChild(span)
          div.appendChild(document.createTextNode(' '))
        }
        div.appendChild(document.createTextNode(message.text))
        if (message.playerPost && playersById[message.playerPost]) {
          const p = playersById[message.playerPost]
          div.appendChild(document.createTextNode(' '))
          const span = document.createElement('span')
          span.className = `fg-${p.renderColor}${p.isLocal ? '' : '-muted'}`
          span.appendChild(document.createTextNode(p.name))
          div.appendChild(span)
        }
        this.gameMessages.appendChild(div)
      })
    }

    while (this.bodyScoreTable.firstChild) {
      this.bodyScoreTable.removeChild(this.bodyScoreTable.lastChild)
    }

    const addScoreColumn = (tr, content) => {
      const td = document.createElement('td')
      td.style.textAlign = 'right'
      td.appendChild(document.createTextNode(content))
      tr.appendChild(td)
    }

    const playerList =
      Array.isArray(scores?.players) && scores.players.length > 0
        ? scores.players
        : players.map((p) => ({
            id: p.id,
            name: p.name,
            lastScore: 0,
            kills: 0,
            killed: 0,
            escaped: 0,
            total: 0,
            connected: p.connected,
          }))

    for (let i = 0; i < playerList.length; i++) {
      const player = playerList[i]
      const playerInfo = playersById[player.id]
      const playerColor = playerInfo?.renderColor ?? 'fg'
      const isConnected = playerInfo
        ? playerInfo.connected !== false
        : player.connected !== false

      const isLocal = playerInfo ? Boolean(playerInfo.isLocal) : false
      const tr = document.createElement('tr')
      tr.className = isLocal
        ? `fg-${playerColor}`
        : `fg-${playerColor}-muted`
      if (!isConnected) {
        tr.style.opacity = '0.6'
      }

      const td = document.createElement('td')
      const displayName = isConnected
        ? player.name
        : `${player.name} [disconnected]`
      td.appendChild(document.createTextNode(displayName))
      tr.appendChild(td)

      addScoreColumn(tr, player.lastScore ?? 0)
      addScoreColumn(tr, player.kills ?? 0)
      addScoreColumn(tr, player.killed ?? 0)
      addScoreColumn(tr, player.escaped ?? 0)
      addScoreColumn(tr, player.total ?? 0)

      this.bodyScoreTable.appendChild(tr)
    }
  }

  show() {
    if (this.arenaCanvas) this.arenaCanvas.style.display = ''
    if (this.playernames) this.playernames.style.display = ''
    if (this.footer) this.footer.style.display = ''
    if (this.startBtn) this.startBtn.style.display = ''
  }

  hide() {
    if (this.arenaCanvas) this.arenaCanvas.style.display = 'none'
    if (this.playernames) this.playernames.style.display = 'none'
    if (this.scores) this.scores.style.display = 'none'
    if (this.scoresWaiting) this.scoresWaiting.style.display = 'none'
    if (this.footer) this.footer.style.display = 'none'
  }
}
