/**
 * Reactive Client State Store
 */
class State {
  constructor() {
    this.screen = 'welcome' // 'welcome' | 'lobby' | 'config' | 'game'
    this.currentGame = {
      key: null,
      name: null,
    }
    try {
      this.connectedGames =
        typeof sessionStorage !== 'undefined'
          ? (JSON.parse(sessionStorage.getItem('connectedGames')) ?? {})
          : {}
    } catch {
      this.connectedGames = {}
    }
    if (
      !this.connectedGames ||
      typeof this.connectedGames !== 'object' ||
      Array.isArray(this.connectedGames)
    ) {
      this.connectedGames = {}
    }
    this.ownedPlayerIds = new Set()
    this.roomOwnerClientId = null
    this.roomOwnerBinding = null
    this.roomSession = null
    this.connectionIsCurrent = () => false
    this.roundInfo = null

    this.gamesList = []
    this.matchState = 'initializing'
    this.players = []
    this.positions = {}
    this.scores = { gamecount: 0, players: [], messages: [] }

    this.listeners = new Map()
  }

  get(key) {
    return this[key]
  }

  set(key, value) {
    const prev = this[key]
    this[key] = value
    this.emit(key, value, prev)
  }

  subscribe(key, callback) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set())
    }
    this.listeners.get(key).add(callback)
    return () => this.listeners.get(key).delete(callback)
  }

  emit(key, value, prev) {
    if (this.listeners.has(key)) {
      this.listeners.get(key).forEach((cb) => {
        try {
          cb(value, prev)
        } catch (err) {
          console.error(`Error in state listener for "${key}":`, err)
        }
      })
    }
  }

  setScreen(screen) {
    this.set('screen', screen)
  }

  setCurrentGame(key, name) {
    this.currentGame = { key, name }
    this.addConnectedGame(key)
    this.emit('currentGame', this.currentGame)
  }

  addConnectedGame(key) {
    if (
      !this.connectedGames[key] ||
      typeof this.connectedGames[key] !== 'object' ||
      !this.connectedGames[key].localPlayers ||
      typeof this.connectedGames[key].localPlayers !== 'object' ||
      Array.isArray(this.connectedGames[key].localPlayers)
    ) {
      const roomOwner = this.connectedGames[key]?.roomOwner
      this.connectedGames[key] = { localPlayers: Object.create(null) }
      if (roomOwner) {
        this.connectedGames[key].roomOwner = roomOwner
      }
      this.saveConnectedGames()
    } else if (
      Object.getPrototypeOf(this.connectedGames[key].localPlayers) !== null
    ) {
      this.connectedGames[key].localPlayers = Object.assign(
        Object.create(null),
        this.connectedGames[key].localPlayers,
      )
    }
  }

  addLocalPlayer(playerId, config, reconnectToken) {
    const key = this.currentGame.key
    if (key && this.connectedGames[key] && typeof reconnectToken === 'string') {
      this.connectedGames[key].localPlayers[playerId] = {
        version: 2,
        config,
        reconnectToken,
      }
      this.ownedPlayerIds.add(playerId)
      this.saveConnectedGames()
      this.emit('localPlayers', this.connectedGames[key].localPlayers)
    }
  }

  getLocalPlayerConfig(playerId) {
    const key = this.currentGame.key
    const entry = this.connectedGames[key]?.localPlayers?.[playerId]
    if (entry?.version === 2 && typeof entry.reconnectToken === 'string') {
      return entry.config
    }
    return null
  }

  getReconnectEntries(gameKey = this.currentGame.key, explicit = false) {
    const entries = this.connectedGames[gameKey]?.localPlayers
    if (!entries || typeof entries !== 'object') {
      return []
    }
    return Object.entries(entries)
      .flatMap(([id, entry]) =>
        entry?.version === 2 &&
        id.length > 0 &&
        /^[A-Za-z0-9_-]{43}$/.test(entry.reconnectToken) &&
        (explicit || !entry.revoked)
          ? [{ id, reconnectToken: entry.reconnectToken }]
          : [],
      )
      .slice(0, 6)
  }

  acknowledgeReconnect(id, gameKey) {
    const entry = this.connectedGames[gameKey]?.localPlayers?.[id]
    if (!entry || entry.version !== 2) {
      return null
    }
    entry.revoked = false
    this.ownedPlayerIds.add(id)
    this.saveConnectedGames()
    return entry.config
  }

  revokeOwnership(ids, gameKey) {
    for (const id of ids) {
      this.ownedPlayerIds.delete(id)
      const entry = this.connectedGames[gameKey]?.localPlayers?.[id]
      if (entry?.version === 2) {
        entry.revoked = true
      }
    }
    this.saveConnectedGames()
  }

  getLocalPlayerIds(gameKey = this.currentGame?.key) {
    if (!gameKey || !this.connectedGames[gameKey]) {
      return []
    }
    return Object.keys(this.connectedGames[gameKey].localPlayers || {})
  }

  isLocalPlayer(playerId) {
    return this.ownedPlayerIds.has(playerId)
  }

  clearOwnership() {
    this.ownedPlayerIds.clear()
    this.roomOwnerClientId = null
    this.roomOwnerBinding = null
    this.roomSession = null
    this.roundInfo = null
  }

  saveRoomOwner(key, credential) {
    this.addConnectedGame(key)
    this.connectedGames[key].roomOwner = { ...credential, revoked: false }
    this.saveConnectedGames()
  }

  getRoomOwnerClaim(key = this.currentGame.key, explicit = false) {
    const owner = this.connectedGames[key]?.roomOwner
    return /^[a-f0-9]{32}$/.test(owner?.ownerClientId) &&
      /^[A-Za-z0-9_-]{43}$/.test(owner?.roomOwnerToken) &&
      (explicit || !owner.revoked)
      ? {
          ownerClientId: owner.ownerClientId,
          roomOwnerToken: owner.roomOwnerToken,
        }
      : undefined
  }

  acknowledgeRoomOwner(key, ownerClientId) {
    const owner = this.connectedGames[key]?.roomOwner
    if (owner?.ownerClientId !== ownerClientId) {
      return false
    }
    owner.revoked = false
    this.roomOwnerClientId = ownerClientId
    this.roomOwnerBinding = { ...this.roomSession, ownerClientId }
    this.saveConnectedGames()
    return true
  }

  revokeRoomOwner(key) {
    this.roomOwnerClientId = null
    this.roomOwnerBinding = null
    const owner = this.connectedGames[key]?.roomOwner
    if (owner) {
      owner.revoked = true
    }
    this.saveConnectedGames()
  }

  acknowledgeRoomJoin(key, generation) {
    this.roomSession = { key, generation }
  }

  isJoinedRoom() {
    return Boolean(
      this.roomSession &&
      this.roomSession.key === this.currentGame.key &&
      this.connectionIsCurrent(this.roomSession),
    )
  }

  isRoomOwner() {
    return Boolean(
      this.isJoinedRoom() &&
      this.roomOwnerBinding?.key === this.roomSession.key &&
      this.roomOwnerBinding.generation === this.roomSession.generation &&
      this.roomOwnerBinding.ownerClientId === this.roomOwnerClientId,
    )
  }

  roomIdle() {
    return Boolean(
      this.roundInfo?.key === this.currentGame.key &&
      this.roundInfo.running === false &&
      ['configuration', 'finished'].includes(this.roundInfo.round?.stage),
    )
  }

  canStartRound() {
    return Boolean(
      this.isJoinedRoom() &&
      this.roomIdle() &&
      this.roundInfo.eligiblePlayerCount >= 2 &&
      this.roundInfo.eligiblePlayerCount <= 6 &&
      this.players.length <= 6 &&
      (this.roundInfo.firstRoundStarted === true || this.isRoomOwner()),
    )
  }

  canChangeInterval() {
    return this.isJoinedRoom() && this.isRoomOwner() && this.roomIdle()
  }

  ownerStatusText() {
    if (!this.isJoinedRoom()) {
      return 'Waiting for room authentication.'
    }
    const status = this.roundInfo?.ownerStatus
    if (this.isRoomOwner()) {
      return 'You created this room. Creator present.'
    }
    if (status === 'unrecoverable') {
      return 'Creator unrecoverable. Original creator credentials are unavailable; create a new room for creator controls.'
    }
    if (status === 'away') {
      return 'Creator away. The creator can rejoin with saved credentials.'
    }
    if (status === 'present') {
      return 'Creator present on another connection.'
    }
    return 'Waiting for creator status.'
  }

  startRoundReason() {
    if (!this.isJoinedRoom()) {
      return 'Join and authenticate this room before starting.'
    }
    if (!this.roomIdle()) {
      if (this.roundInfo?.running) {
        return 'Wait until the current round finishes.'
      }
      if (['preparation', 'countdown'].includes(this.roundInfo?.round?.stage)) {
        return 'A round is being prepared. Wait for it to start.'
      }
      return 'Waiting for room state.'
    }
    const eligible = this.roundInfo.eligiblePlayerCount
    const roster = `At least two authenticated, connected bikes are required (two on one keyboard is enough); up to six bike slots. ${eligible} eligible now.`
    if (!this.roundInfo.firstRoundStarted && !this.isRoomOwner()) {
      return `Only the authenticated room creator can start the first round. ${this.ownerStatusText()} ${roster}`
    }
    if (this.players.length > 6) {
      return `This room has more than six registered bike slots. Create a new room. ${roster}`
    }
    if (eligible < 2 || eligible > 6) {
      return roster
    }
    return this.roundInfo.firstRoundStarted
      ? `Any joined client, including spectators, can start the next round. ${roster}`
      : `You can start the first round without a bike of your own. ${roster}`
  }

  speedReason() {
    if (!this.currentGame.key) {
      return 'Personal speed preference for new rooms.'
    }
    if (!this.isJoinedRoom()) {
      return 'Room speed is available after joining and authenticating.'
    }
    if (!this.isRoomOwner()) {
      return `Only the authenticated room creator can change speed between rounds. ${this.ownerStatusText()}`
    }
    if (!this.roomIdle()) {
      return 'Speed can change only between rounds.'
    }
    return 'You can change room speed between rounds. Your personal speed preference is kept.'
  }

  removeConnectedGames(keys) {
    keys.forEach((key) => {
      delete this.connectedGames[key]
    })
    this.saveConnectedGames()
  }

  saveConnectedGames() {
    this.emit('connectedGames', this.connectedGames)
    if (typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.setItem(
          'connectedGames',
          JSON.stringify(this.connectedGames),
        )
      } catch {
        // Storage is optional; acknowledgement still owns this live socket.
      }
    }
  }
}

export const state = new State()
