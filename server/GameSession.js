import WebSocket from 'ws'
import { randomBytes } from 'node:crypto'

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
    this.physicsGeneration = 0
    this.activeRoundIsCurrent = () => true
    this.nextTickTime = null
    this.gameStarted = null
    this.running = false
    this.stats = stats
      ? { ...stats, gamecount: stats.gamecount ?? 0 }
      : {
          gamecount: 0,
          players: [],
          messages: [],
        }
    this.destroyed = false
    this.ownership = new PlayerOwnership(key, this)
    this.roomOwner = new RoomOwnership(key, privateData?.roomOwner)
    this.firstRoundStarted =
      firstRoundStarted === true || this.stats.gamecount > 0
    this.pendingStart = null
    this.stage = this.firstRoundStarted ? 'finished' : 'configuration'
    this.startId = null
    this.onstate = null
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
      this.arena.init()
    }
    this.acceptingPlayers =
      !this.firstRoundStarted &&
      this.arena.players.length < MAX_PLAYERS &&
      this.stats.players.length < MAX_PLAYERS
    this.clients = new Set()
    this.allDisconnected = Date.now()
    this.statusTimer = null
    this.checkConnectionStatus()
  }

  destroy() {
    if (this.destroyed) {
      return false
    }
    // Invalidate captured callbacks before cancellation or releasing room data.
    this.destroyed = true
    const onDestroy = this.onDestroy
    this.onDestroy = null
    this.onstate = null
    this.onleave = null
    this.onChange = null
    this.stop()
    this.stage = 'destroyed'
    this.activeRoundIsCurrent = () => false
    if (this.statusTimer !== null) {
      clearTimeout(this.statusTimer)
      this.statusTimer = null
    }
    const sockets = new Set([
      ...this.clients,
      ...this.ownership.owners.values(),
      this.roomOwner.socket,
    ])
    this.ownership.clear()
    this.roomOwner.clear()
    for (const client of sockets) {
      this.clearClientRouting(client)
    }
    this.clients.clear()
    this.arena?.destroy()
    this.arena = null
    this.stats = null
    this.startId = null
    this.acceptingPlayers = false
    onDestroy?.(this)
    return true
  }

  checkConnectionStatus() {
    if (this.destroyed) {
      return
    }
    // Manual checks replace the existing timer rather than creating parallel loops.
    if (this.statusTimer !== null) {
      clearTimeout(this.statusTimer)
      this.statusTimer = null
    }
    this.pruneClients()
    this.updateActivity()
    if (
      this.allDisconnected !== null &&
      Date.now() - this.allDisconnected >= IDLE_ROOM_TIMEOUT_MS
    ) {
      this.destroy()
      return
    }
    const timer = setTimeout(() => {
      if (!this.destroyed && this.statusTimer === timer) {
        this.checkConnectionStatus()
      }
    }, 60 * 1000)
    this.statusTimer = timer
    timer?.unref?.()
  }

  updateActivity() {
    if (this.liveClients.length > 0) {
      this.allDisconnected = null
    } else if (this.allDisconnected === null) {
      this.allDisconnected = Date.now()
    }
  }

  clearClientRouting(client) {
    if (client?.gameSession === this && client.gameKey !== this.key) {
      // Drop a stale instance pointer without touching a different room's indexes.
      client.gameSession = null
      return true
    }
    if (
      client?.gameKey !== this.key ||
      (client.gameSession && client.gameSession !== this)
    ) {
      return false
    }
    client.gameKey = null
    client.gameSession = null
    client.protocolReady = false
    client.playerIds?.clear()
    client.handlesById?.clear()
    client.idsByHandle?.clear()
    client.registrationRetries?.clear()
    return true
  }

  connect({ client, ondraw, onfinish, onreset, onstate, onleave }) {
    if (this.destroyed) {
      return
    }
    this.pruneClients()
    if (this.clients.has(client)) {
      return
    }
    this.clients.add(client)
    client.gameSession = this
    this.updateActivity()
    if (!this.onstate && typeof onstate === 'function') {
      this.onstate = (...args) => {
        if (!this.destroyed) {
          onstate?.(...args)
        }
      }
    }
    if (!this.onleave && typeof onleave === 'function') {
      this.onleave = () => {
        if (!this.destroyed) {
          onleave?.()
        }
      }
    }
    this.arena.addHandler({
      ondraw: (changes) => {
        if (!this.destroyed) {
          ondraw?.(changes)
        }
      },
      onfinish: (stats) => {
        if (this.destroyed || !this.running) {
          return
        }
        this.stop()
        this.stage = 'finished'
        this.addStats(stats)
        if (typeof onfinish === 'function') {
          onfinish({ key: this.key, startId: this.startId, scores: this.stats })
        }
      },
      onreset: (positions) => {
        if (this.destroyed) {
          return
        }
        if (this.pendingStart) {
          this.pendingStart.positions = positions
        }
        if (typeof onreset === 'function') {
          onreset({ key: this.key, startId: this.startId, positions })
        }
      },
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
      !this.destroyed &&
      client?.readyState === WebSocket.OPEN &&
      (!client.gameSession || client.gameSession === this) &&
      client.gameKey === this.key &&
      this.clients.has(client),
    )
  }

  get liveClients() {
    return [...this.clients].filter((client) => this.isJoined(client))
  }

  pruneClients() {
    for (const client of this.clients) {
      if (!this.isJoined(client)) {
        this.disconnect(client)
      }
    }
  }

  disconnect(client) {
    if (this.destroyed) {
      return false
    }
    // Remove membership first: departure effects and cancellation packets must
    // reach only the remaining live members, including during defensive pruning.
    let changed = this.clients.delete(client)
    this.updateActivity()
    for (const [id, owner] of this.ownership.owners) {
      if (owner === client && this.ownership.release(id, client)) {
        changed = true
        this.disconnectPlayer(id)
      }
    }
    changed = this.roomOwner.release(client) || changed
    // A stale old-room member may already belong to another room. Its current
    // handles/indexes belong to that room and must survive old-room cleanup.
    changed = this.clearClientRouting(client) || changed
    if (changed) {
      this.reconcilePendingStart()
      this.onleave?.()
    }
    return changed
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
    if (!launching && !this.isJoined(client)) {
      return { ok: false, code: 'NOT_IN_ROOM' }
    }
    if (
      !this.firstRoundStarted &&
      (!this.isJoined(client) || !this.roomOwner.owns(client))
    ) {
      return { ok: false, code: 'CREATOR_REQUIRED' }
    }
    if (this.running) {
      return { ok: false, code: 'ROUND_RUNNING' }
    }
    if (!launching && this.pendingStart) {
      return { ok: false, code: 'ROUND_PENDING' }
    }
    if (
      !this.arena ||
      this.arena.players.length < MIN_PLAYERS ||
      this.arena.players.length > MAX_PLAYERS ||
      this.eligiblePlayerCount < MIN_PLAYERS
    ) {
      return { ok: false, code: 'INSUFFICIENT_PLAYERS' }
    }
    return { ok: true }
  }

  captureRoundRoster() {
    return (
      this.arena?.players.map((player) => {
        const owner = this.ownership.owners.get(player.id) ?? null
        return {
          id: player.id,
          owner,
          connected: player.connected !== false,
          eligible: player.connected !== false && this.isJoined(owner),
        }
      }) ?? []
    )
  }

  sameRoundRoster(roster) {
    const current = this.captureRoundRoster()
    return (
      current.length === roster.length &&
      current.every((entry, index) =>
        Object.keys(entry).every((key) => entry[key] === roster[index][key]),
      )
    )
  }

  publishStage(reason, startId = this.startId) {
    this.onstate?.({
      key: this.key,
      startId,
      stage: this.stage,
      ...(reason ? { reason } : {}),
    })
  }

  reconcilePendingStart(reason = 'PARTICIPANTS_CHANGED') {
    const pending = this.pendingStart
    if (!pending) {
      return
    }
    if (!this.sameRoundRoster(pending.roster)) {
      this.cancelPendingStart(reason)
    } else if (
      !this.firstRoundStarted &&
      (!this.isJoined(pending.creator) || !this.roomOwner.owns(pending.creator))
    ) {
      this.cancelPendingStart('CREATOR_CHANGED')
    }
  }

  beginRound(
    client,
    { save = () => true, isCurrent = () => true, onError, requestId } = {},
  ) {
    const result = this.validateRound(client)
    if (!result.ok) {
      return result
    }
    const roster = this.captureRoundRoster()
    const pending = {
      startId: randomBytes(16).toString('hex'),
      requester: client,
      creator: this.firstRoundStarted ? null : client,
      acceptingPlayers: this.acceptingPlayers,
      roster,
      expectedClients: new Set(
        roster.filter((entry) => entry.eligible).map((entry) => entry.owner),
      ),
      readyClients: new Set(),
      countdownStarted: false,
      fallbackTimer: null,
      startTimer: null,
      isCurrent,
      requestId,
    }
    this.pendingStart = pending
    this.startId = pending.startId
    this.stage = 'preparation'
    this.acceptingPlayers = false
    this.arena.reset({ finish: false })
    this.publishStage()
    pending.launchCountdown = () => {
      if (
        !isCurrent() ||
        this.pendingStart !== pending ||
        this.stage !== 'preparation'
      ) {
        return
      }
      this.reconcilePendingStart()
      if (this.pendingStart !== pending) {
        return
      }
      pending.countdownStarted = true
      clearTimeout(pending.fallbackTimer)
      pending.fallbackTimer = null
      this.stage = 'countdown'
      this.publishStage()
      pending.startTimer = setTimeout(() => {
        if (
          !isCurrent() ||
          this.pendingStart !== pending ||
          this.stage !== 'countdown'
        ) {
          return
        }
        const launched = this.launchRound(pending, save, isCurrent)
        if (!launched.ok) {
          onError?.(launched)
        }
      }, 1000)
      pending.startTimer?.unref?.()
    }
    pending.fallbackTimer = setTimeout(pending.launchCountdown, 2000)
    pending.fallbackTimer?.unref?.()
    return { ok: true, pending }
  }

  acknowledgeReady(client, startId) {
    const pending = this.pendingStart
    if (
      !pending ||
      this.stage !== 'preparation' ||
      pending.startId !== startId ||
      !pending.isCurrent() ||
      !pending.expectedClients.has(client) ||
      !this.isJoined(client)
    ) {
      return false
    }
    this.reconcilePendingStart()
    if (this.pendingStart !== pending) {
      return false
    }
    pending.readyClients.add(client)
    if (pending.readyClients.size === pending.expectedClients.size) {
      pending.launchCountdown()
    }
    return true
  }

  launchRound(pending, save, isCurrent = pending?.isCurrent ?? (() => true)) {
    if (
      !pending ||
      !isCurrent() ||
      this.pendingStart !== pending ||
      !['preparation', 'countdown'].includes(this.stage)
    ) {
      return { ok: false, code: 'ROUND_PENDING' }
    }
    const result = this.validateRound(pending.requester, { launching: true })
    if (!result.ok) {
      this.cancelPendingStart(result.code)
      return result
    }
    if (!this.sameRoundRoster(pending.roster)) {
      this.cancelPendingStart('PARTICIPANTS_CHANGED')
      return { ok: false, code: 'PARTICIPANTS_CHANGED' }
    }
    if (
      !this.firstRoundStarted &&
      (!this.isJoined(pending.creator) || !this.roomOwner.owns(pending.creator))
    ) {
      this.cancelPendingStart('CREATOR_CHANGED')
      return { ok: false, code: 'CREATOR_REQUIRED' }
    }
    if (!this.firstRoundStarted) {
      this.firstRoundStarted = true
      if (!save()) {
        this.firstRoundStarted = false
        this.cancelPendingStart('PERSISTENCE_FAILED')
        return { ok: false, code: 'PERSISTENCE_FAILED' }
      }
    }
    clearTimeout(pending.fallbackTimer)
    clearTimeout(pending.startTimer)
    this.pendingStart = null
    this.start({ isCurrent })
    this.stage = 'running'
    this.publishStage()
    return { ok: true }
  }

  changeInterval(client, interval, save) {
    if (!this.isJoined(client)) {
      return { ok: false, code: 'NOT_IN_ROOM' }
    }
    if (!this.roomOwner.owns(client)) {
      return { ok: false, code: 'CREATOR_REQUIRED' }
    }
    if (this.running) {
      return { ok: false, code: 'ROUND_RUNNING' }
    }
    if (this.pendingStart) {
      return { ok: false, code: 'ROUND_PENDING' }
    }
    if (!Number.isInteger(interval) || interval < 10 || interval > 500) {
      return { ok: false, code: 'INVALID_INTERVAL' }
    }
    const previous = this.interval
    this.interval = interval
    if (!save()) {
      this.interval = previous
      return { ok: false, code: 'PERSISTENCE_FAILED' }
    }
    return { ok: true }
  }

  cancelPendingStart(reason = 'CANCELLED') {
    const pending = this.pendingStart
    if (!pending) {
      return false
    }
    clearTimeout(pending.fallbackTimer)
    clearTimeout(pending.startTimer)
    pending.fallbackTimer = null
    pending.startTimer = null
    this.pendingStart = null
    this.startId = null
    this.stage = this.firstRoundStarted ? 'finished' : 'configuration'
    this.acceptingPlayers =
      !this.firstRoundStarted &&
      pending.acceptingPlayers &&
      this.arena.players.length < MAX_PLAYERS &&
      this.stats.players.length < MAX_PLAYERS
    this.publishStage(reason, pending.startId)
    return true
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

    // A completed trusted/internal round also establishes launch history, so
    // every saved snapshot respects the same marker/count invariant.
    this.firstRoundStarted = true
    this.acceptingPlayers = false
    if (!this.running && !this.pendingStart) {
      this.stage = 'finished'
    }
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
  start({ isCurrent = () => true } = {}) {
    if (this.acceptingPlayers) {
      this.acceptingPlayers = false
      if (typeof this.onChange === 'function') {
        this.onChange()
      }
    }

    this.arena.startRound()

    this.stop()
    this.activeRoundIsCurrent = isCurrent
    this.running = true
    this.stage = 'running'
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
    this.physicsGeneration++
    this.cancelPendingStart()
    this.running = false
    if (this.stage === 'running') {
      this.stage = 'finished'
    }
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
    const generation = this.physicsGeneration
    const delay = Math.max(0, this.nextTickTime - Date.now())

    const timer = setTimeout(() => {
      if (
        !this.running ||
        generation !== this.physicsGeneration ||
        this.timer !== timer ||
        !this.activeRoundIsCurrent()
      ) {
        return
      }

      const endTimer = tickDurationSummary.startTimer()
      this.arena.run()
      endTimer()

      if (
        !this.running ||
        generation !== this.physicsGeneration ||
        this.timer !== timer ||
        !this.activeRoundIsCurrent()
      ) {
        // Finish hooks may stop, destroy, or replace this round synchronously.
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
    this.timer = timer
  }

  changeDir({ id, dir }) {
    const player = this.arena.players.find((p) => p.id === id)
    if (player) {
      player.changeDir(dir)
    }
  }
}
