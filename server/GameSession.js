import WebSocket from 'ws'

import { Arena } from './Arena.js'
import { Player } from '../shared/Player.js'
import {
  GRID_SIZE,
  MAX_PLAYERS,
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

    this.arena = new Arena({
      size,
    })

    if (Array.isArray(players) && players.length > 0) {
      players.forEach((p) => {
        this.arena.addPlayer(new Player({ ...p }))
      })
      this.acceptingPlayers = this.stats.players.length < MAX_PLAYERS
      this.arena.init()
    } else {
      this.acceptingPlayers = true
    }

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

  setInterval(interval) {
    this.interval = interval
    if (typeof this.onChange === 'function') {
      this.onChange()
    }
  }

  addPlayer(player) {
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
      if (typeof this.onChange === 'function') {
        this.onChange()
      }
    }
  }

  addStats(stats) {
    const playerscount = this.stats.players.length
    const playersById = this.stats.players.reduce((players, player) => {
      players[player.id] = player
      return players
    }, {})

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
    this.arena.reset({ finish: this.running })
  }

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
