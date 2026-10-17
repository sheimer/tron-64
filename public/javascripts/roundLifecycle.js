import { MSG_TYPE } from '../../shared/protocol.js'

export class RoundLifecycle {
  constructor({
    state,
    network,
    renderer,
    gameView,
    getRoomKey,
    setScreen,
    refreshRoomControls,
    showConnectionFeedback,
    showControlFeedback,
  }) {
    this.state = state
    this.network = network
    this.renderer = renderer
    this.gameView = gameView
    this.getRoomKey = getRoomKey
    this.setScreen = setScreen
    this.refreshRoomControls = refreshRoomControls
    this.showConnectionFeedback = showConnectionFeedback
    this.showControlFeedback = showControlFeedback
    this.currentStartId = null
    this.roundStage = 'configuration'
    this.roundGeneration = 0
    this.resetTimer = null
    this.scoreTimer = null
  }

  initNetworkListeners() {
    const { state, network } = this
    network.on(MSG_TYPE.GAME_STATE, (transition) => {
      if (!transition || transition.key !== this.getRoomKey()) {
        return
      }
      if (transition.startId !== this.currentStartId) {
        return
      }
      if (transition.reason) {
        this.clearRoundCallbacks()
        this.currentStartId = null
        this.roundStage = transition.stage
        if (state.roundInfo) {
          state.roundInfo = {
            ...state.roundInfo,
            running: false,
            round: { stage: transition.stage, startId: null },
          }
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
      if (state.roundInfo) {
        state.roundInfo = {
          ...state.roundInfo,
          running: transition.stage === 'running',
          round: { ...state.roundInfo.round, stage: transition.stage },
        }
      }
      if (transition.stage === 'running') {
        this.setMatchState('running')
      } else if (['preparation', 'countdown'].includes(transition.stage)) {
        this.setMatchState('start')
      }
    })

    network.on(MSG_TYPE.GAME_RESET, (reset) => {
      this.prepareRound(reset)
    })

    network.on(MSG_TYPE.GAME_DRAW, (changes) => {
      if (!this.getRoomKey()) {
        return
      }
      this.renderer.draw(changes)
    })

    network.on(MSG_TYPE.GAME_FINISH, (result) => {
      if (
        !result ||
        result.key !== this.getRoomKey() ||
        typeof result.startId !== 'string' ||
        result.startId !== this.currentStartId
      ) {
        return
      }
      this.clearRoundCallbacks()
      this.roundStage = 'finished'
      if (state.roundInfo) {
        state.roundInfo = {
          ...state.roundInfo,
          running: false,
          round: { stage: 'finished', startId: result.startId },
        }
      }
      state.set('scores', result.scores)
      this.gameView.updateScores(result.scores, state.players)
      this.renderer.clear()
      this.setMatchState('scores')
      const guard = this.roundCallbackGuard()
      this.scoreTimer = setTimeout(() => {
        if (!guard()) {
          return
        }
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
    const { network } = this
    const key = this.getRoomKey()
    const startId = this.currentStartId
    const socketGeneration = network.generation
    const roundGeneration = this.roundGeneration
    return () =>
      key === this.getRoomKey() &&
      startId === this.currentStartId &&
      socketGeneration === network.generation &&
      roundGeneration === this.roundGeneration
  }

  prepareRound(round) {
    const { state, network } = this
    if (
      !round ||
      round.key !== this.getRoomKey() ||
      typeof round.startId !== 'string' ||
      !round.positions ||
      typeof round.positions !== 'object'
    ) {
      return
    }
    if (this.currentStartId === round.startId) {
      return
    }
    this.clearRoundCallbacks()
    this.currentStartId = round.startId
    this.roundStage = round.stage ?? 'preparation'
    if (state.roundInfo) {
      state.roundInfo = {
        ...state.roundInfo,
        running: false,
        round: { ...round, stage: this.roundStage },
      }
    }
    this.showConnectionFeedback('')
    state.set('positions', round.positions)
    this.renderer.clear()
    this.setScreen('game')
    this.setMatchState('start')
    this.gameView.updatePlayerPositions(state.players, round.positions)
    const guard = this.roundCallbackGuard()
    this.resetTimer = setTimeout(() => {
      if (!guard() || !['preparation', 'countdown'].includes(this.roundStage)) {
        return
      }
      this.resetTimer = null
      this.renderer.resetGrid()
      if (
        state.players.some(
          (player) =>
            player.connected !== false && state.isLocalPlayer(player.id),
        )
      ) {
        network.arenaReady(round.startId)
      }
    }, 50)
  }

  setMatchState(matchState) {
    const { state } = this
    state.set('matchState', matchState)
    this.gameView.updateState(matchState)
    this.refreshRoomControls()
  }

  applySnapshot(info) {
    const { state } = this
    const round = info.round
    if (!round) {
      return
    }
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
      if (this.currentStartId !== round.startId) {
        this.clearRoundCallbacks()
      }
      this.currentStartId = round.startId
      this.roundStage = round.stage
      this.setScreen('game')
      if (!revealing) {
        this.setMatchState('finished')
      }
      if (info.firstRoundStarted && info.scores?.gamecount === 0) {
        this.showConnectionFeedback(
          'The first round launch was saved, but no round completed. Registration is closed. Reconnect saved bikes to start the next round.',
        )
      }
    } else if (round.stage === 'running') {
      const prepared =
        this.currentStartId === round.startId &&
        state.matchState !== 'scoresWaiting'
      if (!prepared) {
        this.clearRoundCallbacks()
      }
      this.currentStartId = round.startId
      this.roundStage = round.stage
      this.setScreen('game')
      this.setMatchState(prepared ? 'running' : 'scoresWaiting')
    }
  }
}
