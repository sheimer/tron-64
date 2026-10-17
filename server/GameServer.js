import { randomBytes } from 'crypto'

import { GameSession } from './GameSession.js'
import { storage } from './Storage.js'
import { setGameServer } from './metrics.js'
import { MAX_ACTIVE_GAMES } from '../shared/constants.js'

export class GameServer {
  constructor() {
    this.games = []
    this.changeHandler = null
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
            this.saveToStorage()
            if (this.changeHandler !== null) {
              this.changeHandler()
            }
          },
          onDestroy: () => {
            this.destroyGame(record.key)
            if (this.changeHandler !== null) {
              this.changeHandler()
            }
          },
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
    this.games.push(
      new GameSession({
        key,
        name,
        size,
        interval,
        isPublic,
        onChange: () => {
          this.saveToStorage()
          if (this.changeHandler !== null) {
            this.changeHandler()
          }
        },
        onDestroy: () => {
          this.destroyGame(key)
          if (this.changeHandler !== null) {
            this.changeHandler()
          }
        },
      }),
    )

    if (creator) {
      creator.credentials = this.games.at(-1).roomOwner.create()
    }
    if (!this.saveToStorage()) {
      const game = this.games.pop()
      game.onDestroy = null
      game.destroy()
      if (creator) {
        creator.credentials = null
      }
      return null
    }
    return key
  }

  destroyGame(key) {
    console.log('no connected clients anymore - destroy game key', key)
    const index = this.games.findIndex((game) => game.key === key)
    if (index !== -1) {
      this.games.splice(index, 1)
      this.saveToStorage()
    }
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
