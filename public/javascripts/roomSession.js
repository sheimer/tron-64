import { MSG_TYPE } from '../../shared/protocol.js'

// Coordinates room membership and private ownership acknowledgements. Views and
// round rendering stay behind explicit callbacks supplied by the coordinator.
export class RoomSession {
  constructor({ state, network, directRoomKey = null, callbacks }) {
    this.state = state
    this.network = network
    this.callbacks = callbacks
    this.currentGameKey = null
    this.directRoomKey = directRoomKey
    this.localPlayersConfig = new Map() // playerId -> { left, right }
    this.pendingRegistrations = new Map()
    this.pendingJoin = null
    this.recoveryNotice = false
  }

  addPlayer({ name, left, right, color }) {
    const { network } = this
    const id = Array.from(crypto.getRandomValues(new Uint8Array(4)))
      .map((num) => num.toString(16).padStart(2, '0'))
      .join('')

    const player = {
      id,
      name,
      color,
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
      ) {
        return
      }
      if (pending.attempts >= 3) {
        this.pendingRegistrations.delete(requestId)
        this.callbacks.showRegistrationFeedback(
          'Registration acknowledgement was lost. Try a new player in this room if available, or create a new room.',
        )
        return
      }
      pending.attempts++
      network.addPlayer(player, requestId)
      pending.timer = setTimeout(retry, 2000)
    }
    retry()
  }

  initNetworkListeners() {
    const { state, network } = this
    network.on('open', () => {
      if (this.directRoomKey) {
        const key = this.directRoomKey
        this.directRoomKey = null
        state.setCurrentGame(key, key)
        this.callbacks.setScreen('lobby')
        this.joinGame(key)
        return
      }
      if (this.currentGameKey) {
        this.joinGame(this.currentGameKey, false)
        if (this.recoveryNotice) {
          this.callbacks.showConnectionFeedback(
            'Connection restored. Authenticating saved players.',
          )
        }
      }
    })

    network.on('close', () => {
      this.callbacks.clearRoundCallbacks(false)
      if (this.currentGameKey) {
        this.recoveryNotice = true
      }
      this.clearPendingRegistrations()
      this.pendingJoin = null
      this.localPlayersConfig.clear()
      state.clearOwnership()
      this.callbacks.clearPendingInterval()
      this.callbacks.refreshRoomControls()
      if (this.currentGameKey) {
        this.callbacks.showConnectionFeedback(
          'Connection lost. Reconnecting and authenticating saved players.',
        )
        this.callbacks.setScreen('game')
        this.callbacks.setMatchState('scoresWaiting')
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
      ) {
        return
      }
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
      this.callbacks.showRegistrationFeedback(
        `${pending.player.name} registered.`,
      )
      this.recoveryNotice = false
      this.callbacks.showConnectionFeedback('')
      // GAME_INFO can arrive before the private acknowledgement.
      state.set(
        'players',
        state.players.map((p) =>
          p.id === binding.id ? { ...p, isLocal: true } : p,
        ),
      )
      this.callbacks.updatePlayersTable(state.players)
      this.callbacks.refreshRoomControls()
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
      ) {
        return
      }
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
      ) {
        return
      }
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
      ) {
        return
      }
      this.pendingJoin = null
      state.acknowledgeRoomJoin(pending.key, pending.generation)
      if (
        pending.roomOwner &&
        result.roomOwner?.accepted === true &&
        result.roomOwner.ownerClientId === pending.roomOwner.ownerClientId
      ) {
        state.acknowledgeRoomOwner(pending.key, result.roomOwner.ownerClientId)
      }
      for (const binding of accepted) {
        const config = state.acknowledgeReconnect(binding.id, pending.key)
        if (!config) {
          continue
        }
        network.bindPlayer(binding.id, binding.inputHandle)
        this.localPlayersConfig.set(binding.id, config)
      }
      const rejected = result.rejected.length
      if (pending.roomOwner && !state.isRoomOwner()) {
        this.callbacks.showConnectionFeedback(
          'Room creator credential could not be authenticated. Saved credentials were kept; rejoin explicitly to try again.',
        )
      } else if (rejected) {
        this.callbacks.showConnectionFeedback(
          `${rejected} saved player${rejected === 1 ? '' : 's'} could not be restored. Check the saved credentials or join a new room.`,
        )
      } else if (pending.missing) {
        this.callbacks.showConnectionFeedback(
          `${pending.missing} saved player${pending.missing === 1 ? '' : 's'} had no usable credential.`,
        )
      } else {
        this.callbacks.showConnectionFeedback('')
      }
      this.recoveryNotice = false
      state.set(
        'players',
        state.players.map((p) => ({
          ...p,
          isLocal: state.isLocalPlayer(p.id),
        })),
      )
      this.callbacks.updatePlayersTable(state.players)
      this.callbacks.refreshRoomControls()
    })

    network.on(MSG_TYPE.ROOM_OWNER_REVOKED, (notice) => {
      if (
        notice?.key !== this.currentGameKey ||
        notice.ownerClientId !== state.roomOwnerClientId
      ) {
        return
      }
      state.revokeRoomOwner(notice.key)
      this.callbacks.updatePlayersTable(state.players)
      this.callbacks.refreshRoomControls()
      this.callbacks.showConnectionFeedback(
        'Room creator controls moved to another connection. Rejoin explicitly to recover them.',
      )
    })

    network.on(MSG_TYPE.OWNERSHIP_REVOKED, (notice) => {
      if (notice?.key !== this.currentGameKey || !Array.isArray(notice.ids)) {
        return
      }
      state.revokeOwnership(notice.ids, notice.key)
      network.revokePlayers(notice.ids)
      for (const id of notice.ids) {
        this.localPlayersConfig.delete(id)
      }
      state.set(
        'players',
        state.players.map((p) => ({
          ...p,
          isLocal: state.isLocalPlayer(p.id),
        })),
      )
      this.callbacks.updatePlayersTable(state.players)
      this.callbacks.refreshRoomControls()
      this.callbacks.showConnectionFeedback(
        'Player control moved to another connection. Select the room again to reclaim it explicitly.',
      )
    })

    network.on(MSG_TYPE.ERROR, (message, msg) => {
      if (msg?.code === 'PROTOCOL_MISMATCH') {
        this.callbacks.clearRoundCallbacks(false)
        this.clearPendingRegistrations()
        this.pendingJoin = null
        this.callbacks.clearPendingInterval()
        this.localPlayersConfig.clear()
        state.clearOwnership()
        this.callbacks.showControlFeedback(message)
        this.callbacks.refreshRoomControls()
        this.callbacks.showConnectionFeedback(message, true)
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
          this.callbacks.leaveCurrentGame()
          this.callbacks.showConnectionFeedback(message)
          return
        }
      }
      if (this.currentGameKey) {
        this.callbacks.showRegistrationFeedback(message)
        this.callbacks.clearPendingInterval()
        this.callbacks.showControlFeedback(message)
        this.callbacks.refreshRoomControls()
      }
      if (msg?.code === 'INPUT_HANDLE_EXHAUSTED' && this.currentGameKey) {
        this.callbacks.showConnectionFeedback(message, true)
        return
      }
      if (
        msg?.code === 'PROTOCOL_MISMATCH' ||
        (this.currentGameKey && state.screen === 'game')
      ) {
        this.callbacks.showConnectionFeedback(message)
      }
    })

    network.on(MSG_TYPE.GAME_INFO, (info) => {
      if (!info || !this.currentGameKey || info.key !== this.currentGameKey) {
        return
      }
      if (this.recoveryNotice) {
        this.callbacks.showConnectionFeedback(
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
      this.callbacks.updatePlayersTable(players)

      this.callbacks.handleRoomInfo(info)
    })
  }

  joinGame(gameKey, explicit = true) {
    const { state, network } = this
    this.callbacks.clearRoundCallbacks(true)
    this.clearPendingRegistrations()
    this.localPlayersConfig.clear()
    state.clearOwnership()
    this.currentGameKey = gameKey
    this.callbacks.clearPendingInterval()
    this.callbacks.showControlFeedback('')
    this.callbacks.refreshRoomControls()
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
      this.callbacks.showRegistrationFeedback(
        'Some saved players have missing or unusable credentials. They cannot be restored automatically.',
      )
    }
  }

  clearPendingRegistrations() {
    for (const pending of this.pendingRegistrations.values()) {
      clearTimeout(pending.timer)
    }
    this.pendingRegistrations.clear()
  }

  leaveCurrentGame() {
    const { state, network } = this
    this.callbacks.clearRoundCallbacks(true)
    if (this.currentGameKey) {
      network.leaveGame()
    }
    this.currentGameKey = null
    this.recoveryNotice = false
    this.callbacks.showConnectionFeedback('')
    this.clearPendingRegistrations()
    this.pendingJoin = null
    this.localPlayersConfig.clear()
    state.clearOwnership()
    this.callbacks.clearPendingInterval()
    state.set('currentGame', { key: null, name: null })
    this.callbacks.showControlFeedback('')
    this.callbacks.refreshRoomControls()
    state.set('players', [])
    state.set('scores', { gamecount: 0, players: [], messages: [] })
    state.set('positions', {})
    this.callbacks.updatePlayersTable([])
    this.callbacks.updateScores({ gamecount: 0, players: [], messages: [] }, [])
    this.callbacks.setScreen('lobby')
    network.requestLobbyList()
  }
}
