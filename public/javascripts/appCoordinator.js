import { RoomSession } from './roomSession.js'
import { RoundLifecycle } from './roundLifecycle.js'
import {
  PLAYER_COLOR_KEYS,
  GRID_SIZE,
  BLOCK_SIZE,
} from '../../shared/constants.js'

// Wires views, transport and domain controllers without starting a browser app
// on import. main.js supplies the browser dependencies and creates the singleton.
export class AppCoordinator {
  constructor({
    state,
    settings,
    network,
    Renderer,
    getThemeColors,
    onThemeChange,
    WelcomeView,
    SettingsView,
    LobbyView,
    ConfigView,
    GameView,
  }) {
    this.state = state
    this.settings = settings
    this.network = network
    this.getThemeColors = getThemeColors
    this.onThemeChange = onThemeChange
    const entryKey = new URLSearchParams(window.location.search ?? '').get(
      'room',
    )
    const directRoomKey = /^[a-f0-9]{8}$/.test(entryKey) ? entryKey : null
    this.pendingInterval = null
    this.ownerStatus = document.getElementById('room-owner-status')
    this.authorityContainer = document.getElementById('room-authority')
    this.controlFeedback = document.getElementById('room-control-feedback')
    this.connectionFeedback = document.getElementById('connection-feedback')
    this.reloadButton = document.getElementById('btn-reload-connection')
    this.reloadButton?.addEventListener('click', () => window.location.reload())

    this.roomSession = new RoomSession({
      state,
      network,
      directRoomKey,
      callbacks: {
        clearRoundCallbacks: (retireAttempt) => {
          this.roundLifecycle.clearRoundCallbacks()
          if (retireAttempt) this.roundLifecycle.currentStartId = null
        },
        clearPendingInterval: () => {
          this.pendingInterval = null
        },
        showControlFeedback: (message) => this.showControlFeedback(message),
        refreshRoomControls: () => this.refreshRoomControls(),
        showConnectionFeedback: (message, offerReload) =>
          this.showConnectionFeedback(message, offerReload),
        showRegistrationFeedback: (message) =>
          this.configView.showFeedback(message),
        updatePlayersTable: (players) =>
          this.configView.updatePlayersTable(players),
        updateScores: (scores, players) =>
          this.gameView.updateScores(scores, players),
        handleRoomInfo: (info) => this.handleRoomInfo(info),
        setScreen: (screen) => this.setScreen(screen),
        setMatchState: (matchState) => this.setMatchState(matchState),
        leaveCurrentGame: () => this.leaveCurrentGame(),
      },
    })
    state.connectionIsCurrent = ({ key, generation }) =>
      key === this.roomSession.currentGameKey &&
      generation === network.generation &&
      network.isConnected() &&
      network.protocolReady

    this.settingsView = new SettingsView({
      onChangeRoomInterval: (interval) => this.changeRoomInterval(interval),
    })
    this.welcomeView = new WelcomeView({
      onEnterLobby: () => this.setScreen('lobby'),
    })
    this.lobbyView = new LobbyView({
      onSelectGame: (key, name) => {
        state.setCurrentGame(key, name)
        this.joinGame(key)
      },
    })
    this.configView = new ConfigView({
      onAddPlayer: (player) =>
        this.roomSession.addPlayer({
          ...player,
          color: PLAYER_COLOR_KEYS[state.players.length] || 'fg',
        }),
      onStartGame: () => this.startRound(),
      onLeaveGame: () => this.leaveCurrentGame(),
    })
    this.gameView = new GameView({
      onStartGame: () => this.startRound(),
      onLeaveGame: () => this.leaveCurrentGame(),
    })
    const colors = this.buildColorConfig()
    this.renderer = new Renderer({
      blocksize: BLOCK_SIZE,
      size: GRID_SIZE,
      bgColor: colors.bgColor,
      bordercolor: colors.bordercolor,
      explosioncolor: colors.explosioncolor,
      playercolors: (settings.coloredPlayers
        ? colors.playercolors
        : colors.playerbw
      ).map((color) => color.value),
      id: 'arena',
    })
    this.roundLifecycle = new RoundLifecycle({
      state,
      network,
      renderer: this.renderer,
      gameView: this.gameView,
      getRoomKey: () => this.roomSession.currentGameKey,
      setScreen: (screen) => this.setScreen(screen),
      refreshRoomControls: () => this.refreshRoomControls(),
      showConnectionFeedback: (message) => this.showConnectionFeedback(message),
      showControlFeedback: (message) => this.showControlFeedback(message),
    })
    this.roomSession.initNetworkListeners()
    this.roundLifecycle.initNetworkListeners()
    this.initThemeListeners()
    this.initKeyboardControls()
    this.initNavigationControls()
    state.subscribe('screen', (screen) => this.updateScreenViews(screen))
    this.setScreen('welcome')
    this.refreshRoomControls()
  }

  buildColorConfig() {
    const colors = this.getThemeColors()
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

  initNavigationControls() {
    const infoBtn = document.getElementById('btn-info')
    if (infoBtn) {
      infoBtn.addEventListener('click', () => {
        if (this.roomSession.currentGameKey) {
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
    this.state.setScreen(screen)
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
      this.configView.show(this.state.currentGame)
    } else if (screen === 'game') {
      this.welcomeView.hide()
      this.lobbyView.hide()
      this.configView.hide()
      this.gameView.show()
    }
  }

  initThemeListeners() {
    const updateColors = () => {
      const colors = this.buildColorConfig()
      const playerColors = (
        this.settings.coloredPlayers ? colors.playercolors : colors.playerbw
      ).map((c) => c.value)

      this.renderer.setColors({
        bgColor: colors.bgColor,
        bordercolor: colors.bordercolor,
        explosioncolor: colors.explosioncolor,
        playercolors: playerColors,
      })

      if (this.state.players.length) {
        this.configView.updatePlayersTable(this.state.players)
        this.gameView.updateScores(this.state.scores, this.state.players)
      }
    }

    this.onThemeChange(updateColors)
    this.settings.addListener('coloredPlayers', updateColors)
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

    this.roomSession.localPlayersConfig.forEach((cfg, playerId) => {
      if (typeof cfg.left === 'number') {
        if (evt.keyCode === cfg.left) {
          this.network.changeDir({ id: playerId, dir: 'left' })
        } else if (evt.keyCode === cfg.right) {
          this.network.changeDir({ id: playerId, dir: 'right' })
        }
      }
    })
  }

  onButtonClick(evt) {
    const btn = evt.target.closest('button')
    const isLeft = btn?.id?.includes('left')
    const isRight = btn?.id?.includes('right')

    this.roomSession.localPlayersConfig.forEach((cfg, playerId) => {
      if (typeof cfg.left === 'string') {
        if (isLeft) {
          this.network.changeDir({ id: playerId, dir: 'left' })
        } else if (isRight) {
          this.network.changeDir({ id: playerId, dir: 'right' })
        }
      }
    })
  }

  refreshRoomControls() {
    const inRoom = Boolean(this.roomSession.currentGameKey)
    if (this.authorityContainer)
      this.authorityContainer.style.display = inRoom ? '' : 'none'
    if (this.ownerStatus)
      this.ownerStatus.textContent = this.state.ownerStatusText()
    this.configView.updatePermissions()
    this.gameView.updatePermissions()
    this.settingsView.updateRoomControls(
      inRoom,
      this.state.canChangeInterval(),
      this.state.speedReason(),
      this.state.roundInfo?.interval,
    )
  }

  showControlFeedback(message) {
    if (this.controlFeedback) this.controlFeedback.textContent = message
  }

  startRound() {
    if (!this.state.canStartRound()) {
      this.showControlFeedback(this.state.startRoundReason())
      this.refreshRoomControls()
      return
    }
    this.showControlFeedback('Requesting round start.')
    this.network.startGame()
  }

  changeRoomInterval(interval) {
    if (!this.state.canChangeInterval()) {
      this.showControlFeedback(this.state.speedReason())
      this.refreshRoomControls()
      return
    }
    this.pendingInterval = { interval }
    this.showControlFeedback('Requesting room speed change.')
    this.network.setInterval(interval)
    // Keep the acknowledged value until the authoritative snapshot arrives.
    this.refreshRoomControls()
  }

  showConnectionFeedback(message, offerReload = false) {
    if (this.reloadButton)
      this.reloadButton.style.display = offerReload ? '' : 'none'
    if (!this.connectionFeedback) return
    this.connectionFeedback.textContent = message
    this.connectionFeedback.style.display = message ? '' : 'none'
  }

  handleRoomInfo(info) {
    const { state } = this
    if (this.pendingInterval?.interval === info.interval) {
      this.pendingInterval = null
      this.showControlFeedback('Room speed updated.')
    }
    this.refreshRoomControls()
    if (info.scores) {
      state.set('scores', info.scores)
      this.gameView.updateScores(info.scores, state.players)
    }
    this.roundLifecycle.applySnapshot(info)
  }

  joinGame(key, explicit = true) {
    this.roomSession.joinGame(key, explicit)
  }

  leaveCurrentGame() {
    this.roomSession.leaveCurrentGame()
  }

  setMatchState(matchState) {
    this.roundLifecycle.setMatchState(matchState)
  }
}
