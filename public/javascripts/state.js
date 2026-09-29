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
    )
      this.connectedGames = {}
    this.ownedPlayerIds = new Set()

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
      this.connectedGames[key] = { localPlayers: Object.create(null) }
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
    if (!entries || typeof entries !== 'object') return []
    return Object.entries(entries)
      .flatMap(([id, entry]) =>
        entry?.version === 2 &&
        typeof id === 'string' &&
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
    if (!entry || entry.version !== 2) return null
    entry.revoked = false
    this.ownedPlayerIds.add(id)
    this.saveConnectedGames()
    return entry.config
  }

  revokeOwnership(ids, gameKey) {
    for (const id of ids) {
      this.ownedPlayerIds.delete(id)
      const entry = this.connectedGames[gameKey]?.localPlayers?.[id]
      if (entry?.version === 2) entry.revoked = true
    }
    this.saveConnectedGames()
  }

  getLocalPlayerIds(gameKey = this.currentGame?.key) {
    if (!gameKey || !this.connectedGames[gameKey]) return []
    return Object.keys(this.connectedGames[gameKey].localPlayers || {})
  }

  isLocalPlayer(playerId) {
    return this.ownedPlayerIds.has(playerId)
  }

  clearOwnership() {
    this.ownedPlayerIds.clear()
  }

  removeConnectedGames(keys) {
    keys.forEach((key) => {
      delete this.connectedGames[key]
    })
    this.saveConnectedGames()
  }

  saveConnectedGames() {
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
