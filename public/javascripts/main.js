import './ui/dropdown.js'
import { state } from './state.js'
import { settings } from './settings.js'
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
    const entryKey = new URLSearchParams(window.location.search ?? '').get(
      'room',
    )
    this.directRoomKey = /^[a-f0-9]{8}$/.test(entryKey) ? entryKey : null
    this.currentGameKey = null
    this.currentStartId = null
    this.roundStage = 'configuration'
    this.roundGeneration = 0
    this.resetTimer = null
    this.scoreTimer = null
    this.localPlayersConfig = new Map() // playerId -> { left, right }
    this.pendingRegistrations = new Map()
    this.pendingJoin = null
    this.recoveryNotice = false
    this.ownerStatus = document.getElementById('room-owner-status')
    this.authorityContainer = document.getElementById('room-authority')
    this.controlFeedback = document.getElementById('room-control-feedback')
    this.pendingInterval = null
    state.connectionIsCurrent = ({ key, generation }) =>
      key === this.currentGameKey &&
      generation === network.generation &&
      network.isConnected() &&
      network.protocolReady
    this.connectionFeedback = document.getElementById('connection-feedback')
    this.reloadButton = document.getElementById('btn-reload-connection')
    this.reloadButton?.addEventListener('click', () => {
      window.location.reload()
    })
    this.unsubscribers = []
    this.keyboardBound = false

    this.settingsView = new SettingsView({
      onChangeRoomInterval: (interval) => this.changeRoomInterval(interval),
    })

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
        this.startRound()
      },
      onLeaveGame: () => {
        this.leaveCurrentGame()
      },
    })

    this.gameView = new GameView({
      onStartGame: () => {
        this.startRound()
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
    this.refreshRoomControls()
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
      if (this.directRoomKey) {
        const key = this.directRoomKey
        this.directRoomKey = null
        state.setCurrentGame(key, key)
        this.setScreen('lobby')
        this.joinGame(key)
        return
      }
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
      this.clearRoundCallbacks()
      if (this.currentGameKey) this.recoveryNotice = true
      this.clearPendingRegistrations()
      this.pendingJoin = null
      this.localPlayersConfig.clear()
      state.clearOwnership()
      this.pendingInterval = null
      this.refreshRoomControls()
      if (this.currentGameKey) {
        this.showConnectionFeedback(
          'Connection lost. Reconnecting and authenticating saved players.',
        )
        this.setScreen('game')
        this.setMatchState('scoresWaiting')
      }
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
        !Number.isInteger(binding.inputHandle) ||
        binding.inputHandle < 0 ||
        binding.inputHandle > 255
      )
        return
      network.bindPlayer(binding.id, binding.inputHandle)
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
      this.refreshRoomControls()
    })

    network.on(MSG_TYPE.JOIN_RESULT, (result, msg) => {
      const pending = this.pendingJoin
      if (
        !pending ||
        msg?.requestId !== pending.requestId ||
        pending.generation !== network.generation ||
        pending.key !== this.currentGameKey ||
        result?.key !== pending.key ||
        !Array.isArray(result.accepted) ||
        !Array.isArray(result.rejected)
      )
        return
      const accepted = result.accepted
      const rejectedBindings = result.rejected
      const validRecord = (binding) =>
        binding !== null &&
        typeof binding === 'object' &&
        !Array.isArray(binding) &&
        typeof binding.id === 'string' &&
        pending.ids.has(binding.id)
      // Validate the complete private reply before consuming the request or
      // restoring either independent role. Credential rejection is a valid
      // outcome; a malformed or partial response grants no live controls.
      if (
        accepted.some(
          (binding) =>
            !validRecord(binding) ||
            !Number.isInteger(binding.inputHandle) ||
            binding.inputHandle < 0 ||
            binding.inputHandle > 255,
        ) ||
        rejectedBindings.some(
          (binding) =>
            !validRecord(binding) || binding.code !== 'INVALID_CREDENTIAL',
        )
      )
        return
      const handles = new Set(accepted.map((binding) => binding.inputHandle))
      const allBindings = [...accepted, ...rejectedBindings]
      const ids = new Set(allBindings.map((binding) => binding.id))
      const owner = result.roomOwner
      const validOwner = pending.roomOwner
        ? owner !== null &&
          typeof owner === 'object' &&
          !Array.isArray(owner) &&
          ((owner.accepted === true &&
            owner.ownerClientId === pending.roomOwner.ownerClientId) ||
            (owner.accepted === false &&
              owner.code === 'INVALID_OWNER_CREDENTIAL'))
        : owner === null
      if (
        !validOwner ||
        ids.size !== allBindings.length ||
        ids.size !== pending.ids.size ||
        handles.size !== accepted.length ||
        accepted.length > 6
      )
        return
      this.pendingJoin = null
      state.acknowledgeRoomJoin(pending.key, pending.generation)
      if (
        pending.roomOwner &&
        result.roomOwner?.accepted === true &&
        result.roomOwner.ownerClientId === pending.roomOwner.ownerClientId
      )
        state.acknowledgeRoomOwner(pending.key, result.roomOwner.ownerClientId)
      for (const binding of accepted) {
        const config = state.acknowledgeReconnect(binding.id, pending.key)
        if (!config) continue
        network.bindPlayer(binding.id, binding.inputHandle)
        this.localPlayersConfig.set(binding.id, config)
      }
      const rejected = result.rejected.length
      if (pending.roomOwner && !state.isRoomOwner()) {
        this.showConnectionFeedback(
          'Room creator credential could not be authenticated. Saved credentials were kept; rejoin explicitly to try again.',
        )
      } else if (rejected) {
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
      this.refreshRoomControls()
    })

    network.on(MSG_TYPE.ROOM_OWNER_REVOKED, (notice) => {
      if (
        notice?.key !== this.currentGameKey ||
        notice.ownerClientId !== state.roomOwnerClientId
      )
        return
      state.revokeRoomOwner(notice.key)
      this.configView.updatePlayersTable(state.players)
      this.refreshRoomControls()
      this.showConnectionFeedback(
        'Room creator controls moved to another connection. Rejoin explicitly to recover them.',
      )
    })

    network.on(MSG_TYPE.OWNERSHIP_REVOKED, (notice) => {
      if (notice?.key !== this.currentGameKey || !Array.isArray(notice.ids))
        return
      state.revokeOwnership(notice.ids, notice.key)
      network.revokePlayers(notice.ids)
      for (const id of notice.ids) this.localPlayersConfig.delete(id)
      state.set(
        'players',
        state.players.map((p) => ({
          ...p,
          isLocal: state.isLocalPlayer(p.id),
        })),
      )
      this.configView.updatePlayersTable(state.players)
      this.refreshRoomControls()
      this.showConnectionFeedback(
        'Player control moved to another connection. Select the room again to reclaim it explicitly.',
      )
    })

    network.on(MSG_TYPE.ERROR, (message, msg) => {
      if (msg?.code === 'PROTOCOL_MISMATCH') {
        this.clearRoundCallbacks()
        this.clearPendingRegistrations()
        this.pendingJoin = null
        this.pendingInterval = null
        this.localPlayersConfig.clear()
        state.clearOwnership()
        this.showControlFeedback(message)
        this.refreshRoomControls()
        this.showConnectionFeedback(message, true)
        return
      }
      const pending = this.pendingRegistrations.get(msg?.requestId)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingRegistrations.delete(msg.requestId)
      }
      const join = this.pendingJoin
      if (
        join &&
        msg?.requestId === join.requestId &&
        join.key === this.currentGameKey &&
        join.generation === network.generation
      ) {
        this.pendingJoin = null
        if (msg.code === 'GAME_NOT_FOUND' && join.explicit) {
          state.removeConnectedGames([join.key])
          this.leaveCurrentGame()
          this.showConnectionFeedback(message)
          return
        }
      }
      if (this.currentGameKey) {
        this.configView.showFeedback(message)
        this.pendingInterval = null
        this.showControlFeedback(message)
        this.refreshRoomControls()
      }
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
      state.roundInfo = info
      state.set('players', players)
      this.configView.updatePlayersTable(players)

      if (this.pendingInterval?.interval === info.interval) {
        this.pendingInterval = null
        this.showControlFeedback('Room speed updated.')
      }
      this.refreshRoomControls()

      if (info.scores) {
        state.set('scores', info.scores)
        this.gameView.updateScores(info.scores, players)
      }
      const round = info.round
      if (!round) return
      if (['preparation', 'countdown'].includes(round.stage)) {
        this.prepareRound({ key: info.key, ...round })
        this.roundStage = round.stage
        this.setMatchState('start')
      } else if (round.stage === 'configuration') {
        this.clearRoundCallbacks()
        this.currentStartId = null
        this.roundStage = round.stage
        this.setScreen('config')
        this.setMatchState('settingPlayers')
      } else if (round.stage === 'finished') {
        const revealing =
          this.currentStartId === round.startId && this.scoreTimer !== null
        if (this.currentStartId !== round.startId) this.clearRoundCallbacks()
        this.currentStartId = round.startId
        this.roundStage = round.stage
        this.setScreen('game')
        if (!revealing) this.setMatchState('finished')
        if (info.firstRoundStarted && info.scores?.gamecount === 0)
          this.showConnectionFeedback(
            'The first round launch was saved, but no round completed. Registration is closed. Reconnect saved bikes to start the next round.',
          )
      } else if (round.stage === 'running') {
        const prepared =
          this.currentStartId === round.startId &&
          state.matchState !== 'scoresWaiting'
        if (!prepared) this.clearRoundCallbacks()
        this.currentStartId = round.startId
        this.roundStage = round.stage
        this.setScreen('game')
        this.setMatchState(prepared ? 'running' : 'scoresWaiting')
      }
    })

    network.on(MSG_TYPE.GAME_STATE, (transition) => {
      if (!transition || transition.key !== this.currentGameKey) return
      if (transition.startId !== this.currentStartId) return
      if (transition.reason) {
        this.clearRoundCallbacks()
        this.currentStartId = null
        this.roundStage = transition.stage
        if (state.roundInfo)
          state.roundInfo = {
            ...state.roundInfo,
            running: false,
            round: { stage: transition.stage, startId: null },
          }
        this.renderer.clear()
        state.set('positions', {})
        this.setScreen(transition.stage === 'configuration' ? 'config' : 'game')
        this.setMatchState(
          transition.stage === 'configuration' ? 'settingPlayers' : 'finished',
        )
        const reasons = {
          PARTICIPANTS_CHANGED: 'bike connections or controls changed',
          CREATOR_CHANGED: 'the creator connection changed',
          PERSISTENCE_FAILED: 'the launch could not be saved',
          ROOM_REMOVED: 'the room was removed',
          ROOM_RESET: 'the room was reset',
          ROOM_STOPPED: 'the round was stopped',
          CANCELLED: 'the round was stopped',
        }
        const reason = reasons[transition.reason] ?? 'the room state changed'
        const cancellation = `Round cancelled because ${reason}. Start again when ready.`
        this.showConnectionFeedback(cancellation)
        this.showControlFeedback(cancellation)
        this.refreshRoomControls()
        return
      }
      this.roundStage = transition.stage
      if (state.roundInfo)
        state.roundInfo = {
          ...state.roundInfo,
          running: transition.stage === 'running',
          round: { ...state.roundInfo.round, stage: transition.stage },
        }
      if (transition.stage === 'running') this.setMatchState('running')
      else if (['preparation', 'countdown'].includes(transition.stage))
        this.setMatchState('start')
    })

    network.on(MSG_TYPE.GAME_RESET, (reset) => {
      this.prepareRound(reset)
    })

    network.on(MSG_TYPE.GAME_DRAW, (changes) => {
      if (!this.currentGameKey) return
      this.renderer.draw(changes)
    })

    network.on(MSG_TYPE.GAME_FINISH, (result) => {
      if (
        !result ||
        result.key !== this.currentGameKey ||
        typeof result.startId !== 'string' ||
        result.startId !== this.currentStartId
      )
        return
      this.clearRoundCallbacks()
      this.roundStage = 'finished'
      if (state.roundInfo)
        state.roundInfo = {
          ...state.roundInfo,
          running: false,
          round: { stage: 'finished', startId: result.startId },
        }
      state.set('scores', result.scores)
      this.gameView.updateScores(result.scores, state.players)
      this.renderer.clear()
      this.setMatchState('scores')
      const guard = this.roundCallbackGuard()
      this.scoreTimer = setTimeout(() => {
        if (!guard()) return
        this.scoreTimer = null
        this.setMatchState('finished')
      }, 1000)
    })
  }

  clearRoundCallbacks() {
    clearTimeout(this.resetTimer)
    clearTimeout(this.scoreTimer)
    this.resetTimer = null
    this.scoreTimer = null
    this.roundGeneration++
  }

  roundCallbackGuard() {
    const key = this.currentGameKey
    const startId = this.currentStartId
    const socketGeneration = network.generation
    const roundGeneration = this.roundGeneration
    return () =>
      key === this.currentGameKey &&
      startId === this.currentStartId &&
      socketGeneration === network.generation &&
      roundGeneration === this.roundGeneration
  }

  prepareRound(round) {
    if (
      !round ||
      round.key !== this.currentGameKey ||
      typeof round.startId !== 'string' ||
      !round.positions ||
      typeof round.positions !== 'object'
    )
      return
    if (this.currentStartId === round.startId) return
    this.clearRoundCallbacks()
    this.currentStartId = round.startId
    this.roundStage = round.stage ?? 'preparation'
    if (state.roundInfo)
      state.roundInfo = {
        ...state.roundInfo,
        running: false,
        round: { ...round, stage: this.roundStage },
      }
    this.showConnectionFeedback('')
    state.set('positions', round.positions)
    this.renderer.clear()
    this.setScreen('game')
    this.setMatchState('start')
    this.gameView.updatePlayerPositions(state.players, round.positions)
    const guard = this.roundCallbackGuard()
    this.resetTimer = setTimeout(() => {
      if (!guard() || !['preparation', 'countdown'].includes(this.roundStage))
        return
      this.resetTimer = null
      this.renderer.resetGrid()
      if (
        state.players.some(
          (player) =>
            player.connected !== false && state.isLocalPlayer(player.id),
        )
      )
        network.arenaReady(round.startId)
    }, 50)
  }

  setMatchState(matchState) {
    state.set('matchState', matchState)
    this.gameView.updateState(matchState)
    this.refreshRoomControls()
  }

  joinGame(gameKey, explicit = true) {
    this.clearRoundCallbacks()
    this.currentStartId = null
    this.clearPendingRegistrations()
    this.localPlayersConfig.clear()
    state.clearOwnership()
    this.currentGameKey = gameKey
    this.pendingInterval = null
    this.showControlFeedback('')
    this.refreshRoomControls()
    const reconnect = state.getReconnectEntries(gameKey, explicit)
    const requestId = Array.from(crypto.getRandomValues(new Uint8Array(12)))
      .map((num) => num.toString(16).padStart(2, '0'))
      .join('')
    this.pendingJoin = {
      key: gameKey,
      generation: network.generation,
      requestId,
      explicit,
      ids: new Set(reconnect.map((entry) => entry.id)),
      missing: state.getLocalPlayerIds(gameKey).length - reconnect.length,
      roomOwner: state.getRoomOwnerClaim(gameKey, explicit),
    }
    network.joinGame(gameKey, reconnect, requestId, this.pendingJoin.roomOwner)
    if (this.pendingJoin.missing) {
      this.configView.showFeedback(
        'Some saved players have missing or unusable credentials. They cannot be restored automatically.',
      )
    }
  }

  refreshRoomControls() {
    const inRoom = Boolean(this.currentGameKey)
    if (this.authorityContainer)
      this.authorityContainer.style.display = inRoom ? '' : 'none'
    if (this.ownerStatus) this.ownerStatus.textContent = state.ownerStatusText()
    this.configView.updatePermissions()
    this.gameView.updatePermissions()
    this.settingsView.updateRoomControls(
      inRoom,
      state.canChangeInterval(),
      state.speedReason(),
      state.roundInfo?.interval,
    )
  }

  showControlFeedback(message) {
    if (this.controlFeedback) this.controlFeedback.textContent = message
  }

  startRound() {
    if (!state.canStartRound()) {
      this.showControlFeedback(state.startRoundReason())
      this.refreshRoomControls()
      return
    }
    this.showControlFeedback('Requesting round start.')
    network.startGame()
  }

  changeRoomInterval(interval) {
    if (!state.canChangeInterval()) {
      this.showControlFeedback(state.speedReason())
      this.refreshRoomControls()
      return
    }
    this.pendingInterval = { interval }
    this.showControlFeedback('Requesting room speed change.')
    network.setInterval(interval)
    // Keep the acknowledged value until the authoritative snapshot arrives.
    this.refreshRoomControls()
  }

  clearPendingRegistrations() {
    for (const pending of this.pendingRegistrations.values())
      clearTimeout(pending.timer)
    this.pendingRegistrations.clear()
  }

  showConnectionFeedback(message, offerReload = false) {
    if (this.reloadButton)
      this.reloadButton.style.display = offerReload ? '' : 'none'
    if (!this.connectionFeedback) return
    this.connectionFeedback.textContent = message
    this.connectionFeedback.style.display = message ? '' : 'none'
  }

  leaveCurrentGame() {
    this.clearRoundCallbacks()
    this.currentStartId = null
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
    this.pendingInterval = null
    state.set('currentGame', { key: null, name: null })
    this.showControlFeedback('')
    this.refreshRoomControls()
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
