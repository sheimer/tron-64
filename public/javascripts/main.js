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
import { PLAYER_COLOR_KEYS, GRID_SIZE, BLOCK_SIZE } from '/shared/constants.js'

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
    this.pendingRegistrations = new Map()
    this.pendingJoin = null
    this.freshRecovery = null
    this.recoveryNotice = false
    this.connectionFeedback = document.getElementById('connection-feedback')
    this.freshConnectionButton = document.getElementById('btn-fresh-connection')
    this.freshConnectionButton?.addEventListener('click', () => {
      const entries = state.getReconnectEntries(this.currentGameKey, true)
      const ownedIds = new Set(state.ownedPlayerIds)
      if (
        [...ownedIds].some((id) => !entries.some((entry) => entry.id === id))
      ) {
        this.showConnectionFeedback(
          'Every controlled player needs a saved credential before opening a fresh connection.',
        )
        return
      }
      if (network.openFreshConnection()) {
        this.freshRecovery = {
          key: this.currentGameKey,
          configs: new Map(this.localPlayersConfig),
          ids: ownedIds,
        }
        this.clearPendingRegistrations()
        this.pendingJoin = null
        this.localPlayersConfig.clear()
        state.clearOwnership()
        this.showConnectionFeedback(
          'Opening a fresh connection to restore saved players.',
        )
      }
    })
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

        const colors = buildColorConfig()
        const playerColor =
          colors.playercolors[state.players.length]?.name || 'fg'

        const player = {
          id,
          name,
          color: playerColor,
          left,
          right,
        }
        const requestId = Array.from(crypto.getRandomValues(new Uint8Array(12)))
          .map((num) => num.toString(16).padStart(2, '0'))
          .join('')
        const pending = {
          player,
          key: this.currentGameKey,
          generation: network.generation,
          attempts: 0,
          timer: null,
        }
        this.pendingRegistrations.set(requestId, pending)
        const retry = () => {
          if (
            this.pendingRegistrations.get(requestId) !== pending ||
            pending.generation !== network.generation ||
            pending.key !== this.currentGameKey
          )
            return
          if (pending.attempts >= 3) {
            this.pendingRegistrations.delete(requestId)
            this.configView.showFeedback(
              'Registration acknowledgement was lost. Try a new player in this room if available, or create a new room.',
            )
            return
          }
          pending.attempts++
          network.addPlayer(player, requestId)
          pending.timer = setTimeout(retry, 2000)
        }
        retry()
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
        this.joinGame(this.currentGameKey, false)
        if (this.recoveryNotice) {
          this.showConnectionFeedback(
            'Connection restored. Authenticating saved players.',
          )
        }
      }
    })

    network.on('close', () => {
      this.freshRecovery = null
      if (this.currentGameKey) this.recoveryNotice = true
      this.clearPendingRegistrations()
      this.pendingJoin = null
      this.localPlayersConfig.clear()
      state.clearOwnership()
      if (this.currentGameKey) {
        this.showConnectionFeedback(
          'Connection lost. Reconnecting and authenticating saved players.',
        )
        this.setScreen('game')
        this.setMatchState('scoresWaiting')
      }
    })

    network.on('previous-close', () => {
      this.freshRecovery = null
      this.localPlayersConfig.clear()
      state.clearOwnership()
      state.set(
        'players',
        state.players.map((p) => ({ ...p, isLocal: false })),
      )
      this.configView.updatePlayersTable(state.players)
      this.showConnectionFeedback(
        'The original connection closed during recovery. Waiting for authentication on the new connection.',
      )
    })

    network.on('fresh-recovery-failed', (message) => {
      this.restoreFreshRecovery(message)
    })

    network.on(MSG_TYPE.PLAYER_REGISTERED, (binding, msg) => {
      const pending = this.pendingRegistrations.get(msg.requestId)
      if (
        !pending ||
        pending.generation !== network.generation ||
        pending.key !== this.currentGameKey ||
        pending.key !== binding?.key ||
        pending.player.id !== binding.id ||
        typeof binding.reconnectToken !== 'string' ||
        !network.bindPlayer(binding.id, binding.inputHandle)
      )
        return
      clearTimeout(pending.timer)
      this.pendingRegistrations.delete(msg.requestId)
      this.localPlayersConfig.set(binding.id, {
        left: pending.player.left,
        right: pending.player.right,
      })
      state.addLocalPlayer(
        binding.id,
        { left: pending.player.left, right: pending.player.right },
        binding.reconnectToken,
      )
      this.configView.showFeedback(`${pending.player.name} registered.`)
      this.recoveryNotice = false
      this.showConnectionFeedback('')
      // GAME_INFO can arrive before the private acknowledgement.
      state.set(
        'players',
        state.players.map((p) =>
          p.id === binding.id ? { ...p, isLocal: true } : p,
        ),
      )
      this.configView.updatePlayersTable(state.players)
      this.settingsView.setSpectatorMode(false)
    })

    network.on(MSG_TYPE.JOIN_RESULT, (result, msg) => {
      const pending = this.pendingJoin
      if (
        !pending ||
        msg.requestId !== pending.requestId ||
        pending.generation !== network.generation ||
        pending.key !== this.currentGameKey ||
        result?.key !== pending.key ||
        !Array.isArray(result.accepted) ||
        !Array.isArray(result.rejected)
      )
        return
      const accepted = result.accepted
      const handles = new Set(accepted.map((binding) => binding.inputHandle))
      if (
        handles.size !== accepted.length ||
        accepted.some(
          (binding) =>
            !pending.ids.has(binding.id) ||
            !Number.isInteger(binding.inputHandle) ||
            binding.inputHandle < 0 ||
            binding.inputHandle > 255,
        )
      )
        return
      this.pendingJoin = null
      for (const binding of accepted) {
        const config = state.acknowledgeReconnect(binding.id, pending.key)
        if (!config || !network.bindPlayer(binding.id, binding.inputHandle))
          continue
        this.localPlayersConfig.set(binding.id, config)
      }
      const rejected = result.rejected.length
      if (rejected) {
        this.showConnectionFeedback(
          `${rejected} saved player${rejected === 1 ? '' : 's'} could not be restored. Check the saved credentials or join a new room.`,
        )
      } else if (pending.missing) {
        this.showConnectionFeedback(
          `${pending.missing} saved player${pending.missing === 1 ? '' : 's'} had no usable credential.`,
        )
      } else this.showConnectionFeedback('')
      this.recoveryNotice = false
      state.set(
        'players',
        state.players.map((p) => ({
          ...p,
          isLocal: state.isLocalPlayer(p.id),
        })),
      )
      this.configView.updatePlayersTable(state.players)
      this.settingsView.setSpectatorMode(!state.players.some((p) => p.isLocal))
      this.freshRecovery = null
      network.completeFreshConnection?.()
    })

    network.on(MSG_TYPE.OWNERSHIP_REVOKED, (notice) => {
      if (notice?.key !== this.currentGameKey || !Array.isArray(notice.ids))
        return
      state.revokeOwnership(notice.ids, notice.key)
      network.revokePlayers(notice.ids)
      for (const id of notice.ids) this.localPlayersConfig.delete(id)
      for (const id of notice.ids) {
        this.freshRecovery?.ids.delete(id)
        this.freshRecovery?.configs.delete(id)
      }
      state.set(
        'players',
        state.players.map((p) => ({
          ...p,
          isLocal: state.isLocalPlayer(p.id),
        })),
      )
      this.configView.updatePlayersTable(state.players)
      this.settingsView.setSpectatorMode(!state.players.some((p) => p.isLocal))
      this.showConnectionFeedback(
        'Player control moved to another connection. Select the room again to reclaim it explicitly.',
      )
    })

    network.on(MSG_TYPE.ERROR, (message, msg) => {
      const pending = this.pendingRegistrations.get(msg?.requestId)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingRegistrations.delete(msg.requestId)
      }
      if (this.pendingJoin && msg?.requestId === this.pendingJoin.requestId)
        this.pendingJoin = null
      if (network.previousSocket && network.abortFreshConnection?.()) {
        this.restoreFreshRecovery(
          `${message} Existing player controls remain active.`,
        )
        return
      }
      if (this.currentGameKey) this.configView.showFeedback(message)
      if (msg?.code === 'INPUT_HANDLE_EXHAUSTED' && this.currentGameKey) {
        this.showConnectionFeedback(message, true)
        return
      }
      if (
        msg?.code === 'PROTOCOL_MISMATCH' ||
        (this.currentGameKey && state.screen === 'game')
      ) {
        this.showConnectionFeedback(message)
      }
    })

    network.on(MSG_TYPE.GAME_INFO, (info) => {
      if (!info || !this.currentGameKey || info.key !== this.currentGameKey)
        return
      if (this.recoveryNotice) {
        this.showConnectionFeedback(
          'Connected. Waiting for saved player authentication.',
        )
      }
      const players = (info.players || []).map((p) => {
        const isLocal = state.isLocalPlayer(p.id)
        if (isLocal) {
          const savedCfg = state.getLocalPlayerConfig(p.id)
          this.localPlayersConfig.set(p.id, {
            left: savedCfg?.left ?? p.left,
            right: savedCfg?.right ?? p.right,
          })
        }
        return {
          ...p,
          isLocal,
        }
      })
      state.set('players', players)
      this.configView.updatePlayersTable(players)

      const hasLocalPlayers = players.some((p) => p.isLocal)
      this.settingsView.setSpectatorMode(
        !hasLocalPlayers && Boolean(this.currentGameKey),
      )

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

  joinGame(gameKey, explicit = true) {
    this.clearPendingRegistrations()
    this.localPlayersConfig.clear()
    state.clearOwnership()
    this.currentGameKey = gameKey
    const reconnect = state.getReconnectEntries(gameKey, explicit)
    const requestId = Array.from(crypto.getRandomValues(new Uint8Array(12)))
      .map((num) => num.toString(16).padStart(2, '0'))
      .join('')
    this.pendingJoin = {
      key: gameKey,
      generation: network.generation,
      requestId,
      ids: new Set(reconnect.map((entry) => entry.id)),
      missing: state.getLocalPlayerIds(gameKey).length - reconnect.length,
    }
    network.joinGame(gameKey, reconnect, requestId)
    if (this.pendingJoin.missing) {
      this.configView.showFeedback(
        'Some saved players have missing or unusable credentials. They cannot be restored automatically.',
      )
    }
  }

  clearPendingRegistrations() {
    for (const pending of this.pendingRegistrations.values())
      clearTimeout(pending.timer)
    this.pendingRegistrations.clear()
  }

  restoreFreshRecovery(message) {
    const recovery = this.freshRecovery
    this.freshRecovery = null
    this.pendingJoin = null
    if (recovery && recovery.key === this.currentGameKey) {
      this.localPlayersConfig = recovery.configs
      state.ownedPlayerIds = recovery.ids
      state.set(
        'players',
        state.players.map((p) => ({
          ...p,
          isLocal: state.isLocalPlayer(p.id),
        })),
      )
      this.configView.updatePlayersTable(state.players)
      this.settingsView.setSpectatorMode(!state.players.some((p) => p.isLocal))
    }
    this.showConnectionFeedback(message, true)
  }

  showConnectionFeedback(message, freshConnection = false) {
    if (this.freshConnectionButton)
      this.freshConnectionButton.style.display = freshConnection ? '' : 'none'
    if (!this.connectionFeedback) return
    this.connectionFeedback.textContent = message
    this.connectionFeedback.style.display = message ? '' : 'none'
  }

  leaveCurrentGame() {
    if (this.currentGameKey) {
      network.leaveGame()
    }
    this.currentGameKey = null
    this.recoveryNotice = false
    this.showConnectionFeedback('')
    this.clearPendingRegistrations()
    this.pendingJoin = null
    this.localPlayersConfig.clear()
    state.clearOwnership()
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
