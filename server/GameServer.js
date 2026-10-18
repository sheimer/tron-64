import { randomBytes } from 'crypto'

import { GameSession } from './GameSession.js'
import { storage } from './Storage.js'
import { setGameServer } from './metrics.js'
import { MAX_ACTIVE_GAMES } from '../shared/constants.js'

export class GameServer {
  constructor() {
    this.games = []
    this.changeHandler = null
    this.destroyHandler = null
    this.loadFromStorage()
  }

  loadFromStorage() {
    const saved = storage.loadGames()
    if (!Array.isArray(saved) || saved.length === 0) {
      return
    }

    saved.forEach((record) => {
      try {
        if (!record || typeof record.key !== 'string' || !record.key) {
          return
        }
        const session = new GameSession({
          key: record.key,
          name: record.name,
          interval: record.interval,
          isPublic: record.isPublic,
          stats: record.stats,
          players: record.players,
          private: record.private,
          firstRoundStarted: record.firstRoundStarted,
          createdAt: record.createdAt,
          onChange: () => {
            if (this.getGame(record.key) !== session) {
              return
            }
            this.saveToStorage()
            if (this.changeHandler !== null) {
              this.changeHandler()
            }
          },
          onDestroy: (game) => this.destroyGame(record.key, game),
        })
        this.games.push(session)
      } catch {
        // Snapshot content is untrusted and can include private records.
        console.error('[GameServer] Could not restore a session record.')
      }
    })

    console.log(
      `[GameServer] Restored ${this.games.length} game sessions from persistent storage.`,
    )
  }

  saveToStorage() {
    return storage.saveGames(this.games)
  }

  createGame({ name, size, interval, isPublic, creator }) {
    if (storage.readOnly || this.games.length >= MAX_ACTIVE_GAMES) {
      return null
    }
    const key = randomBytes(4).toString('hex')
    const game = new GameSession({
      key,
      name,
      size,
      interval,
      isPublic,
      onChange: () => {
        if (this.getGame(key) !== game) {
          return
        }
        this.saveToStorage()
        this.changeHandler?.()
      },
      onDestroy: (session) => this.destroyGame(key, session),
    })
    this.games.push(game)
    if (creator) {
      creator.credentials = game.roomOwner.create()
    }
    if (!this.saveToStorage()) {
      // Creation was never acknowledged; dispose this exact instance without
      // another write or publishing a transient room to discovery.
      this.destroyGame(key, game, { persist: false, notify: false })
      if (creator) {
        creator.credentials = null
      }
      return null
    }
    return key
  }

  destroyGame(
    key,
    expected = this.getGame(key),
    { persist = true, notify = true } = {},
  ) {
    const index = this.games.indexOf(expected)
    if (index === -1 || expected.key !== key) {
      return false
    }
    // Remove first, so the session callback cannot recurse or remove a
    // replacement with the same key. Session-first destruction is safe too.
    this.games.splice(index, 1)
    expected.onDestroy = null
    expected.destroy()
    this.destroyHandler?.(expected)
    if (persist) {
      this.saveToStorage()
    }
    if (notify) {
      this.changeHandler?.()
    }
    return true
  }

  setDestroyHandler(handler) {
    this.destroyHandler = handler
  }

  getGameList(visibleRooms = new Set()) {
    return this.games
      .filter((game) => game.isPublic || visibleRooms.has(game))
      .map((game) => ({
        key: game.key,
        name: game.name,
        numPlayers: game.arena.players.length,
        acceptingPlayers: game.acceptingPlayers,
        isPublic: game.isPublic,
      }))
  }

  getGame(key) {
    return this.games.find((game) => game.key === key)
  }

  getGameInfo(key) {
    const game = this.getGame(key)
    if (!game) {
      return null
    }
    return {
      key: game.key,
      name: game.name,
      players: game.arena.players.map((player) => ({
        id: player.id,
        name: player.name,
        color: player.color,
        left: player.left,
        right: player.right,
        connected: player.connected,
      })),
      ownerClientId: game.roomOwner.clientId,
      ownerStatus: game.roomOwner.status,
      firstRoundStarted: game.firstRoundStarted,
      acceptingPlayers: game.acceptingPlayers,
      eligiblePlayerCount: game.eligiblePlayerCount,
      started:
        game.firstRoundStarted ||
        Boolean(game.pendingStart) ||
        Boolean(game.gameStarted) ||
        game.stats.gamecount > 0,
      running: game.running,
      round: {
        stage: game.stage,
        startId: game.startId,
        ...(game.pendingStart
          ? { positions: game.pendingStart.positions }
          : {}),
      },
      scores: {
        gamecount: game.stats.gamecount,
        players: game.stats.players.map((player) => ({
          id: player.id,
          name: player.name,
          kills: player.kills,
          killed: player.killed,
          escaped: player.escaped,
          lastScore: player.lastScore,
          total: player.total,
          connected: player.connected,
        })),
        messages: game.stats.messages.map((message) => ({
          text: message.text,
          playerPre: message.playerPre,
          playerPost: message.playerPost,
        })),
      },
      interval: game.interval,
    }
  }

  setChangeHandler(handler) {
    this.changeHandler = handler
  }
}

const gameServer = new GameServer()
setGameServer(gameServer)

export { gameServer }
