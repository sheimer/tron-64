import './ui/dropdown.js'
import { state } from './state.js'
import { settings, SPEED } from './settings.js'
import { network } from './network.js'
import { Renderer } from './Renderer.js'
import { getThemeColors, onThemeChange } from './theme.js'
import { WelcomeView } from './ui/welcomeView.js'
import { SettingsView } from './ui/settingsView.js'
import { LobbyView } from './ui/lobbyView.js'
import { ConfigView } from './ui/configView.js'
import { GameView } from './ui/gameView.js'
import { MSG_TYPE } from '/shared/protocol.js'
import {
  PLAYER_COLOR_KEYS,
  GRID_SIZE,
  BLOCK_SIZE,
} from '/shared/constants.js'

const buildColorConfig = () => {
  const colors = getThemeColors()
  return {
    bgColor: colors.bg,
    bordercolor: colors.fg,
    explosioncolor: colors.rose,
    playercolors: PLAYER_COLOR_KEYS.map((name) => ({
      name,
      value: colors[name],
    })),
    playerbw: Array(PLAYER_COLOR_KEYS.length)
      .fill('fg')
      .map((name) => ({
        name,
        value: colors.fg,
      })),
  }
}

class AppCoordinator {
  constructor() {
    this.currentGameKey = null
    this.localPlayersConfig = new Map() // playerId -> { left, right }
    this.unsubscribers = []
    this.keyboardBound = false

    this.settingsView = new SettingsView()

    this.welcomeView = new WelcomeView({
      onEnterLobby: () => {
        this.setScreen('lobby')
      },
    })

    this.lobbyView = new LobbyView({
      onSelectGame: (gameId, name) => {
        state.setCurrentGame(gameId, name)
        this.joinGame(gameId)
      },
    })

    this.configView = new ConfigView({
      onAddPlayer: ({ name, left, right }) => {
        const id = Array.from(crypto.getRandomValues(new Uint8Array(4)))
          .map((num) => num.toString(16).padStart(2, '0'))
          .join('')

        this.localPlayersConfig.set(id, { left, right })
        state.addLocalPlayer(id, { left, right })

        const colors = buildColorConfig()
        const playerColor =
          colors.playercolors[state.players.length]?.name || 'fg'

        network.addPlayer({
          id,
          name,
          color: playerColor,
          left,
          right,
        })
      },
      onStartGame: () => {
        network.startGame()
      },
      onLeaveGame: () => {
        this.leaveCurrentGame()
      },
    })

    this.gameView = new GameView({
      onStartGame: () => {
        network.startGame()
      },
      onLeaveGame: () => {
        this.leaveCurrentGame()
      },
    })

    this.renderer = new Renderer({
      blocksize: BLOCK_SIZE,
      size: GRID_SIZE,
      bgColor: getThemeColors().bg,
      bordercolor: getThemeColors().fg,
      explosioncolor: getThemeColors().rose,
      playercolors: (settings.coloredPlayers
        ? buildColorConfig().playercolors
        : buildColorConfig().playerbw
      ).map((c) => c.value),
      id: 'arena',
    })

    this.initNetworkListeners()
    this.initThemeListeners()
    this.initKeyboardControls()
    this.initNavigationControls()

    state.subscribe('screen', (screen) => {
      this.updateScreenViews(screen)
    })

    this.setScreen('welcome')
  }

  initNavigationControls() {
    const infoBtn = document.getElementById('btn-info')
    if (infoBtn) {
      infoBtn.addEventListener('click', () => {
        if (this.currentGameKey) {
          this.leaveCurrentGame()
        }
        this.setScreen('welcome')
      })
    }

    const headerLobbyBtn = document.getElementById('btn-header-lobby')
    if (headerLobbyBtn) {
      headerLobbyBtn.addEventListener('click', () => {
        this.leaveCurrentGame()
      })
    }
  }

  setScreen(screen) {
    state.setScreen(screen)
  }

  updateScreenViews(screen) {
    const headerLobbyBtn = document.getElementById('btn-header-lobby')
    if (headerLobbyBtn) {
      headerLobbyBtn.style.display =
        screen === 'config' || screen === 'game' ? '' : 'none'
    }

    if (screen === 'welcome') {
      this.lobbyView.hide()
      this.configView.hide()
      this.gameView.hide()
      this.welcomeView.show()
    } else if (screen === 'lobby') {
      this.welcomeView.hide()
      this.configView.hide()
      this.gameView.hide()
      this.lobbyView.show()
    } else if (screen === 'config') {
      this.welcomeView.hide()
      this.lobbyView.hide()
      this.gameView.hide()
      this.configView.show(state.currentGame)
    } else if (screen === 'game') {
      this.welcomeView.hide()
      this.lobbyView.hide()
      this.configView.hide()
      this.gameView.show()
    }
  }

  initThemeListeners() {
    const updateColors = () => {
      const colors = buildColorConfig()
      const playerColors = (
        settings.coloredPlayers ? colors.playercolors : colors.playerbw
      ).map((c) => c.value)

      this.renderer.setColors({
        bgColor: colors.bgColor,
        bordercolor: colors.bordercolor,
        explosioncolor: colors.explosioncolor,
        playercolors: playerColors,
      })

      if (state.players.length) {
        this.configView.updatePlayersTable(state.players)
        this.gameView.updateScores(state.scores, state.players)
      }
    }

    onThemeChange(updateColors)
    settings.addListener('coloredPlayers', updateColors)
    settings.addListener('speed', (speed) => {
      const hasLocalPlayers = (state.players || []).some((p) => p.isLocal)
      if (this.currentGameKey && hasLocalPlayers) {
        network.setInterval(Math.round(1000 / speed))
      }
    })
  }

  initKeyboardControls() {
    this.onKeyDown = this.onKeyDown.bind(this)
    this.onButtonClick = this.onButtonClick.bind(this)

    window.addEventListener('keydown', this.onKeyDown)

    const leftBtn = document.getElementById('btn-left')
    const rightBtn = document.getElementById('btn-right')
    if (leftBtn) leftBtn.addEventListener('click', this.onButtonClick)
    if (rightBtn) rightBtn.addEventListener('click', this.onButtonClick)
  }

  onKeyDown(evt) {
    if (evt.repeat) return

    this.localPlayersConfig.forEach((cfg, playerId) => {
      if (typeof cfg.left === 'number') {
        if (evt.keyCode === cfg.left) {
          network.changeDir({ id: playerId, dir: 'left' })
        } else if (evt.keyCode === cfg.right) {
          network.changeDir({ id: playerId, dir: 'right' })
        }
      }
    })
  }

  onButtonClick(evt) {
    const btn = evt.target.closest('button')
    const isLeft = btn?.id?.includes('left')
    const isRight = btn?.id?.includes('right')

    this.localPlayersConfig.forEach((cfg, playerId) => {
      if (typeof cfg.left === 'string') {
        if (isLeft) {
          network.changeDir({ id: playerId, dir: 'left' })
        } else if (isRight) {
          network.changeDir({ id: playerId, dir: 'right' })
        }
      }
    })
  }

  initNetworkListeners() {
    network.on('open', () => {
      if (this.currentGameKey) {
        this.joinGame(this.currentGameKey)
      }
    })

    network.on('close', () => {
      if (this.currentGameKey) {
        this.setScreen('game')
        this.setMatchState('scoresWaiting')
      }
    })

    network.on(MSG_TYPE.GAME_INFO, (info) => {
      if (!info || !this.currentGameKey) return
      const players = (info.players || []).map((p) => {
        const isLocal = state.isLocalPlayer(p.id)
        if (isLocal) {
          const savedCfg = state.getLocalPlayerConfig(p.id)
          const left = savedCfg?.left ?? p.left
          const right = savedCfg?.right ?? p.right
          this.localPlayersConfig.set(p.id, { left, right })
        }
        return {
          ...p,
          isLocal,
        }
      })
      state.set('players', players)
      this.configView.updatePlayersTable(players)

      const hasLocalPlayers = players.some((p) => p.isLocal)
      this.settingsView.setSpectatorMode(!hasLocalPlayers && Boolean(this.currentGameKey))

      if (info.interval) {
        const targetFps = Math.round(1000 / info.interval)
        const closestSpeed = Object.values(SPEED).reduce((prev, curr) =>
          Math.abs(curr - targetFps) < Math.abs(prev - targetFps) ? curr : prev,
        )
        this.settingsView.updateSpeed(closestSpeed)
      }

      if (info.started) {
        if (info.scores) {
          state.set('scores', info.scores)
          this.gameView.updateScores(info.scores, players)
        }
        if (state.screen !== 'game') {
          this.setScreen('game')
          this.setMatchState(info.running ? 'scoresWaiting' : 'finished')
        }
      } else {
        if (state.screen !== 'config') {
          this.setScreen('config')
        }
        this.setMatchState('settingPlayers')
      }
    })

    network.on(MSG_TYPE.GAME_STATE, (matchState) => {
      if (!this.currentGameKey) return
      this.setMatchState(matchState)
    })

    network.on(MSG_TYPE.GAME_RESET, (positions) => {
      if (!this.currentGameKey) return
      state.set('positions', positions)
      this.renderer.clear()
      this.setScreen('game')
      this.setMatchState('start')
      this.gameView.updatePlayerPositions(state.players, positions)
      setTimeout(() => {
        this.renderer.resetGrid()
        network.send(MSG_TYPE.ARENA_READY)
      }, 50)
    })

    network.on(MSG_TYPE.GAME_DRAW, (changes) => {
      if (!this.currentGameKey) return
      this.renderer.draw(changes)
    })

    network.on(MSG_TYPE.GAME_FINISH, (scores) => {
      if (!this.currentGameKey) return
      state.set('scores', scores)
      this.gameView.updateScores(scores, state.players)
      this.renderer.clear()
      this.setMatchState('scores')
      setTimeout(() => {
        this.setMatchState('finished')
      }, 1000)
    })
  }

  setMatchState(matchState) {
    state.set('matchState', matchState)
    this.gameView.updateState(matchState)
  }

  joinGame(gameKey) {
    this.currentGameKey = gameKey
    network.joinGame(gameKey, state.getLocalPlayerIds(gameKey))
  }

  leaveCurrentGame() {
    if (this.currentGameKey) {
      network.leaveGame()
    }
    this.currentGameKey = null
    this.localPlayersConfig.clear()
    this.settingsView.setSpectatorMode(false)
    state.set('players', [])
    state.set('scores', { gamecount: 0, players: [], messages: [] })
    state.set('positions', {})
    this.configView.updatePlayersTable([])
    this.gameView.updateScores({ gamecount: 0, players: [], messages: [] }, [])
    this.setScreen('lobby')
    network.requestLobbyList()
  }
}

export const app = new AppCoordinator()
