import { MSG_TYPE } from '../../shared/protocol.js'
import { GRID_SIZE, LOBBY_CHECK_BATCH_SIZE } from '../../shared/constants.js'

// Owns lobby requests and private credential discovery. Presentation stays behind
// callbacks; importing this controller does not load browser singletons.
export class LobbySession {
  constructor({ state, network, settings, callbacks }) {
    this.state = state
    this.network = network
    this.settings = settings
    this.callbacks = callbacks
    this.unsubscribers = []
    this.pendingCreation = null
    this.pendingLobbyChecks = new Map()
    this.verifiedLobbyRecords = new Map()
    this.lobbyClaimsSignature = null
  }

  createGame(name) {
    const { network, settings } = this
    const payload = {
      name,
      size: GRID_SIZE,
      interval: Math.round(1000 / settings.speed),
      isPublic: true,
    }
    if (this.pendingCreation) {
      return
    }
    const requestId = Array.from(crypto.getRandomValues(new Uint8Array(12)))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
    const pending = {
      requestId,
      generation: network.generation,
      payload,
      attempts: 0,
      timer: null,
    }
    this.pendingCreation = pending
    const retry = () => {
      if (
        this.pendingCreation !== pending ||
        pending.generation !== network.generation
      ) {
        return
      }
      if (pending.attempts >= 3) {
        this.clearPendingCreation()
        this.callbacks.showError(
          'Room creation acknowledgement was lost. Try again or reload before creating another room.',
          true,
        )
        return
      }
      pending.attempts++
      network.createGame(payload, requestId)
      pending.timer = setTimeout(retry, 2000)
    }
    retry()
  }

  clearPendingCreation() {
    clearTimeout(this.pendingCreation?.timer)
    this.pendingCreation = null
  }

  requestLobbyList() {
    const { state, network } = this
    if (!network.isConnected() || !network.protocolReady) {
      return
    }
    const records = Object.entries(state.connectedGames).filter(([key]) =>
      /^[a-f0-9]{8}$/.test(key),
    )
    const signature = JSON.stringify([network.generation, records])
    if (signature === this.lobbyClaimsSignature) {
      return
    }
    this.lobbyClaimsSignature = signature
    this.pendingLobbyChecks.clear()
    for (const key of this.verifiedLobbyRecords.keys()) {
      if (!state.connectedGames[key]) {
        this.verifiedLobbyRecords.delete(key)
      }
    }
    for (
      let offset = 0;
      offset < Math.max(1, records.length);
      offset += LOBBY_CHECK_BATCH_SIZE
    ) {
      const batch = records.slice(offset, offset + LOBBY_CHECK_BATCH_SIZE)
      const requestId = Array.from(crypto.getRandomValues(new Uint8Array(12)))
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('')
      const snapshots = new Map(
        batch.map(([key, record]) => [key, JSON.stringify(record)]),
      )
      this.pendingLobbyChecks.set(requestId, {
        generation: network.generation,
        snapshots,
      })
      network.requestLobbyList(
        batch.map(([key]) => ({
          key,
          roomOwner: state.getRoomOwnerClaim(key, true),
          reconnect: state.getReconnectEntries(key, true),
        })),
        requestId,
      )
    }
  }

  receiveLobbyList(list, msg) {
    const { state, network } = this
    if (!Array.isArray(list)) {
      return
    }
    if (msg?.requestId !== undefined) {
      const pending = this.pendingLobbyChecks.get(msg.requestId)
      if (!pending || pending.generation !== network.generation) {
        return
      }
      this.pendingLobbyChecks.delete(msg.requestId)
      for (const [key, record] of pending.snapshots) {
        if (JSON.stringify(state.connectedGames[key]) === record) {
          this.verifiedLobbyRecords.set(key, record)
        }
      }
    }
    // Only an explicit server absence for an unchanged checked record retires
    // credentials. A public-only greeting or a rejected proof cannot do so.
    const missing = Array.isArray(msg?.missingKeys)
      ? msg.missingKeys.filter(
          (key) =>
            this.verifiedLobbyRecords.has(key) &&
            this.verifiedLobbyRecords.get(key) ===
              JSON.stringify(state.connectedGames[key]),
        )
      : []
    state.set('gamesList', list)
    if (missing.length) {
      for (const key of missing) {
        this.verifiedLobbyRecords.delete(key)
      }
      state.removeConnectedGames(missing)
    }
    this.callbacks.updateGamelistTable(list)
  }

  start() {
    const { state, network } = this
    this.unsubscribers.forEach((unsubscribe) => unsubscribe())
    this.unsubscribers = []
    if (!state.gamesList || state.gamesList.length === 0) {
      this.callbacks.renderStatusRow(
        network.isConnected()
          ? 'Fetching active games...'
          : 'Connecting to server & fetching games...',
      )
    } else {
      this.callbacks.updateGamelistTable(state.gamesList)
    }

    this.unsubscribers.push(
      state.subscribe('connectedGames', () => {
        this.callbacks.updateGamelistTable(state.gamesList)
        this.requestLobbyList()
      }),
    )

    this.unsubscribers.push(
      network.on('close', () => {
        this.clearPendingCreation()
        this.pendingLobbyChecks.clear()
        this.verifiedLobbyRecords.clear()
        this.lobbyClaimsSignature = null
        this.callbacks.renderStatusRow(
          'Connection lost. Reconnecting to server...',
          'fg-rose-muted',
        )
      }),
    )

    this.unsubscribers.push(
      network.on('open', () => {
        this.callbacks.renderStatusRow('Fetching active games...')
        this.requestLobbyList()
      }),
    )

    this.unsubscribers.push(
      network.on(MSG_TYPE.LOBBY_LIST, (list, msg) =>
        this.receiveLobbyList(list, msg),
      ),
    )

    this.unsubscribers.push(
      network.on(MSG_TYPE.GAME_CREATED, (created, msg) => {
        const pending = this.pendingCreation
        if (
          !pending ||
          msg?.requestId !== pending.requestId ||
          pending.generation !== network.generation ||
          !/^[a-f0-9]{8}$/.test(created?.key) ||
          !/^[a-f0-9]{32}$/.test(created.ownerClientId) ||
          !/^[A-Za-z0-9_-]{43}$/.test(created.roomOwnerToken)
        ) {
          return
        }
        this.clearPendingCreation()
        state.saveRoomOwner(created.key, {
          ownerClientId: created.ownerClientId,
          roomOwnerToken: created.roomOwnerToken,
        })
        this.callbacks.onSelectGame(created.key, pending.payload.name)
      }),
    )

    this.unsubscribers.push(
      network.on(MSG_TYPE.ERROR, (errorMessage, msg) => {
        if (msg?.requestId === this.pendingCreation?.requestId) {
          this.clearPendingCreation()
        }
        this.callbacks.showError(`[!] ${errorMessage}`)
      }),
    )

    this.lobbyClaimsSignature = null
    this.requestLobbyList()
  }

  stop() {
    this.clearPendingCreation()
    this.pendingLobbyChecks.clear()
    this.verifiedLobbyRecords.clear()
    this.lobbyClaimsSignature = null
    this.unsubscribers.forEach((unsubscribe) => unsubscribe())
    this.unsubscribers = []
  }
}
