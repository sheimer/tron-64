import WebSocket from 'ws'

import { Arena } from './Arena.js'
import { Player } from '../shared/Player.js'
import { RoomOwnership } from './RoomOwnership.js'
import { PlayerOwnership } from './PlayerOwnership.js'
import {
  GRID_SIZE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  IDLE_ROOM_TIMEOUT_MS,
} from '../shared/constants.js'
import { roundsPlayedCounter, tickDurationSummary } from './metrics.js'

export class GameSession {
  constructor({
    key,
    name,
    size = GRID_SIZE,
    interval,
    isPublic,
    stats,
    players,
    private: privateData,
    firstRoundStarted,
    createdAt,
    onChange,
    onDestroy,
  }) {
    this.createdAt = createdAt || Date.now()
    this.key = key
    this.name = name
    this.isPublic = isPublic
    this.onChange = onChange
    this.onDestroy = onDestroy

    this.interval = interval
    this.timer = null
    this.nextTickTime = null
    this.gameStarted = null
    this.running = false
    this.stats = stats || {
      gamecount: 0,
      players: [],
      messages: [],
    }
    this.ownership = new PlayerOwnership(key)
    this.roomOwner = new RoomOwnership(key, privateData?.roomOwner)
    this.firstRoundStarted =
      firstRoundStarted === true || this.stats.gamecount > 0
    this.pendingStart = null
    // Restored ownership always starts empty; only matching persisted
    // verifiers allow a new socket to reclaim an existing player.
    if (Array.isArray(players)) {
      this.stats.players.forEach((p) => {
        p.connected = false
      })
      this.ownership.restore(
        privateData?.verifiers,
        new Set(players.map((player) => player.id)),
      )
    }

    this.arena = new Arena({
      size,
    })

    if (Array.isArray(players) && players.length > 0) {
      players.forEach((p) => {
        this.arena.addPlayer(new Player({ ...p, connected: false }))
      })
      this.acceptingPlayers = this.stats.players.length < MAX_PLAYERS
      this.arena.init()
    } else {
      this.acceptingPlayers = true
    }

    if (this.firstRoundStarted) this.acceptingPlayers = false
    this.clients = []
    this.allDisconnected = null
    this.statusTimer = null
    this.checkConnectionStatus()
  }

  destroy() {
    this.stop()
    if (this.statusTimer !== null) {
      clearTimeout(this.statusTimer)
      this.statusTimer = null
    }
    if (typeof this.arena?.destroy === 'function') {
      this.arena.destroy()
    }
    this.arena = null
    this.onChange = null
    this.clients = []
    this.ownership.clear()
    this.roomOwner.clear()

    if (typeof this.onDestroy === 'function') {
      this.onDestroy()
      this.onDestroy = null
    }
  }

  checkConnectionStatus() {
    // Prune closed socket references
    this.clients = this.clients.filter(
      (client) => client?.readyState === WebSocket.OPEN,
    )

    if (this.clients.length > 0) {
      this.allDisconnected = null
    } else {
      if (this.allDisconnected === null) {
        this.allDisconnected = Date.now()
      }
      if (Date.now() - this.allDisconnected > IDLE_ROOM_TIMEOUT_MS) {
        this.destroy()
        return
      }
    }
    this.statusTimer = setTimeout(() => {
      if (this.arena) {
        this.checkConnectionStatus()
      }
    }, 60 * 1000)
    if (this.statusTimer?.unref) {
      this.statusTimer.unref()
    }
  }

  connect({ client, ondraw, onfinish, onreset }) {
    // Prune closed socket references before adding new client
    this.clients = this.clients.filter((c) => c?.readyState === WebSocket.OPEN)
    this.clients.push(client)
    this.allDisconnected = null
    this.arena.addHandler({
      ondraw,
      onfinish: (stats) => {
        this.stop()
        this.addStats(stats)
        if (typeof onfinish === 'function') {
          onfinish(this.stats)
        }
      },
      onreset,
    })
  }

  // Trusted internal/fixture setter. Network mutations use changeInterval.
  setInterval(interval) {
    this.interval = interval
    if (typeof this.onChange === 'function') {
      this.onChange()
    }
  }

  isJoined(client) {
    return Boolean(
      client?.readyState === WebSocket.OPEN &&
      client.gameKey === this.key &&
      this.clients.includes(client),
    )
  }

  get eligiblePlayerCount() {
    return (
      this.arena?.players.filter((player) => {
        const owner = this.ownership.owners.get(player.id)
        return player.connected !== false && this.isJoined(owner)
      }).length ?? 0
    )
  }

  validateRound(client, { launching = false } = {}) {
    if (!launching && !this.isJoined(client))
      return { ok: false, code: 'NOT_IN_ROOM' }
    if (
      !this.firstRoundStarted &&
      (!this.isJoined(client) || !this.roomOwner.owns(client))
    )
      return { ok: false, code: 'CREATOR_REQUIRED' }
    if (this.running) return { ok: false, code: 'ROUND_RUNNING' }
    if (!launching && this.pendingStart)
      return { ok: false, code: 'ROUND_PENDING' }
    if (
      !this.arena ||
      this.arena.players.length < MIN_PLAYERS ||
      this.arena.players.length > MAX_PLAYERS ||
      this.eligiblePlayerCount < MIN_PLAYERS
    )
      return { ok: false, code: 'INSUFFICIENT_PLAYERS' }
    return { ok: true }
  }

  beginRound(client) {
    const result = this.validateRound(client)
    if (!result.ok) return result
    // This latch is owned by the room before reset or any timer is scheduled.
    // Full attempt-scoped cancellation and readiness are implemented in Phase 2.
    const pending = {
      requester: client,
      acceptingPlayers: this.acceptingPlayers,
      readyClients: new Set(),
      countdownStarted: false,
      fallbackTimer: null,
      startTimer: null,
    }
    this.pendingStart = pending
    this.acceptingPlayers = false
    this.arena.reset({ finish: false })
    return { ok: true, pending }
  }

  launchRound(pending, save) {
    if (this.pendingStart !== pending)
      return { ok: false, code: 'ROUND_PENDING' }
    const result = this.validateRound(pending.requester, { launching: true })
    if (!result.ok) {
      this.cancelPendingStart()
      return result
    }
    if (!this.firstRoundStarted) {
      this.firstRoundStarted = true
      if (!save()) {
        this.firstRoundStarted = false
        this.cancelPendingStart()
        return { ok: false, code: 'PERSISTENCE_FAILED' }
      }
    }
    this.start()
    return { ok: true }
  }

  changeInterval(client, interval, save) {
    if (!this.isJoined(client)) return { ok: false, code: 'NOT_IN_ROOM' }
    if (!this.roomOwner.owns(client))
      return { ok: false, code: 'CREATOR_REQUIRED' }
    if (this.running) return { ok: false, code: 'ROUND_RUNNING' }
    if (this.pendingStart) return { ok: false, code: 'ROUND_PENDING' }
    if (!Number.isInteger(interval) || interval < 10 || interval > 500)
      return { ok: false, code: 'INVALID_INTERVAL' }
    const previous = this.interval
    this.interval = interval
    if (!save()) {
      this.interval = previous
      return { ok: false, code: 'PERSISTENCE_FAILED' }
    }
    return { ok: true }
  }

  cancelPendingStart() {
    const pending = this.pendingStart
    if (!pending) return
    clearTimeout(pending.fallbackTimer)
    clearTimeout(pending.startTimer)
    this.pendingStart = null
    this.acceptingPlayers = pending.acceptingPlayers && !this.firstRoundStarted
  }

  addPlayer(player, { deferChange = false } = {}) {
    const validControl = (value) =>
      (Number.isInteger(value) && value >= 0 && value <= 255) ||
      value === 'btn-left' ||
      value === 'btn-right'
    if (
      typeof player?.id !== 'string' ||
      !player.id.trim() ||
      player.id.length > 16 ||
      player.id !== player.id.trim()
    ) {
      return { ok: false, code: 'INVALID_PLAYER_ID' }
    }
    if (
      this.arena.players.some((p) => p.id === player.id) ||
      this.stats.players.some((p) => p.id === player.id)
    ) {
      return { ok: false, code: 'DUPLICATE_PLAYER_ID' }
    }
    if (
      !validControl(player.left) ||
      !validControl(player.right) ||
      player.left === player.right
    ) {
      return { ok: false, code: 'INVALID_CONTROLS' }
    }
    if (
      this.arena.players.length >= MAX_PLAYERS ||
      this.stats.players.length >= MAX_PLAYERS
    ) {
      return { ok: false, code: 'PLAYER_LIMIT' }
    }
    if (
      !this.acceptingPlayers ||
      this.running ||
      this.pendingStart ||
      this.gameStarted ||
      this.stats.gamecount > 0
    ) {
      return { ok: false, code: 'REGISTRATION_CLOSED' }
    }
    this.arena.addPlayer(new Player({ ...player }))

    this.stats.players.push({
      id: player.id,
      name: player.name,
      kills: 0,
      killed: 0,
      escaped: 0,
      lastScore: 0,
      total: 0,
    })

    if (this.acceptingPlayers) {
      if (this.stats.players.length >= MAX_PLAYERS) {
        this.acceptingPlayers = false
      }
      if (!deferChange && typeof this.onChange === 'function') {
        this.onChange()
      }
    }
    return { ok: true }
  }

  rollbackPlayerRegistration(id, socket) {
    this.ownership.remove(id, socket)
    this.arena.players = this.arena.players.filter((player) => player.id !== id)
    this.stats.players = this.stats.players.filter((player) => player.id !== id)
    this.acceptingPlayers = true
  }

  addStats(stats) {
    const playerscount = this.stats.players.length
    const playersById = this.stats.players.reduce((players, player) => {
      players[player.id] = player
      return players
    }, Object.create(null))

    this.stats.gamecount++
    roundsPlayedCounter.inc()
    this.stats.messages = []
    for (let i = 0; i < playerscount; i++) {
      this.stats.players[i].lastScore = 0
    }

    Object.entries(stats.kills).forEach(([killerId, killedId]) => {
      const killer = playersById[killerId]
      const killed = playersById[killedId]
      if (killer && killed) {
        killer.kills++
        killed.killed++
        killer.lastScore += playerscount
        this.stats.messages.push({
          text: 'kills',
          playerPre: killerId,
          playerPost: killedId,
        })
      }
    })

    if (stats.escaped.length) {
      stats.escaped.forEach((id) => {
        const escapee = playersById[id]
        if (escapee) {
          escapee.escaped++
          escapee.lastScore += playerscount * 3
          this.stats.messages.push({ text: 'escaped!!!', playerPre: id })
        }
      })
    } else {
      Object.entries(stats.deadOnDeath).forEach(([id, deadcount]) => {
        const player = playersById[id]
        if (player) {
          player.lastScore += deadcount
        }
      })
      if (stats.winner !== null) {
        const player = playersById[stats.winner]
        if (player) {
          player.lastScore += playerscount * 2
          this.stats.messages.push({
            text: 'wins game!',
            playerPre: stats.winner,
          })
        }
      } else {
        this.stats.messages.push({ text: 'All players crashed' })
      }
    }
    this.stats.players.forEach((player) => {
      player.total += player.lastScore
      const arenaPlayer = this.arena?.players?.find((ap) => ap.id === player.id)
      player.connected = arenaPlayer ? arenaPlayer.connected !== false : true
    })
    if (typeof this.onChange === 'function') {
      this.onChange()
    }
  }

  reset() {
    this.cancelPendingStart()
    this.arena.reset({ finish: this.running })
  }

  // Trusted simulation/fixture entry point. Network launches use launchRound.
  start() {
    if (this.acceptingPlayers) {
      this.acceptingPlayers = false
      if (typeof this.onChange === 'function') {
        this.onChange()
      }
    }

    this.arena.startRound()

    this.stop()
    this.running = true
    this.gameStarted = Date.now()
    this.nextTickTime = Date.now() + this.interval

    this.scheduleNextTick()
  }

  disconnectPlayer(playerId) {
    const player = this.arena.disconnectPlayer(playerId)
    if (player) {
      const statPlayer = this.stats.players.find((p) => p.id === playerId)
      if (statPlayer) {
        statPlayer.connected = false
      }
      if (typeof this.onChange === 'function') {
        this.onChange()
      }
    }
    return player
  }

  reconnectPlayer(playerId) {
    const player = this.arena.reconnectPlayer(playerId)
    if (player) {
      const statPlayer = this.stats.players.find((p) => p.id === playerId)
      if (statPlayer) {
        statPlayer.connected = true
      }
      if (typeof this.onChange === 'function') {
        this.onChange()
      }
    }
    return player
  }

  stop() {
    this.cancelPendingStart()
    this.running = false
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.nextTickTime = null
    this.gameStarted = null
  }

  /**
   * Target-Timestamp Game Loop Scheduler.
   * Tracks absolute target time (nextTickTime) to absorb both OS setTimeout scheduler
   * jitter and physics execution duration, eliminating cumulative time drift without busy-waiting.
   * @see https://gafferongames.com/post/fix_your_timestep/
   * @see https://developer.mozilla.org/en-US/docs/Games/Anatomy#building_a_main_loop_in_javascript
   */
  scheduleNextTick() {
    const delay = Math.max(0, this.nextTickTime - Date.now())

    this.timer = setTimeout(() => {
      if (!this.running) return

      const endTimer = tickDurationSummary.startTimer()
      this.arena.run()
      endTimer()

      if (!this.running) {
        // Round ended during arena.run() (finish() was called)
        return
      }

      // Advance target timestamp by exact frame interval
      this.nextTickTime += this.interval

      // Prevent spiral-of-death if process was paused / lagged significantly
      if (Date.now() - this.nextTickTime > this.interval * 5) {
        this.nextTickTime = Date.now() + this.interval
      }

      this.scheduleNextTick()
    }, delay)
  }

  changeDir({ id, dir }) {
    const player = this.arena.players.find((p) => p.id === id)
    if (player) {
      player.changeDir(dir)
    }
  }
}
