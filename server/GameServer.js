import { randomBytes } from 'crypto'

import { GameSession } from './GameSession.js'
import { storage } from './Storage.js'
import { setGameServer } from './metrics.js'
import { MAX_ACTIVE_GAMES } from '../shared/constants.js'

class GameServer {
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
      if (!record.key) return
      try {
        const session = new GameSession({
          key: record.key,
          name: record.name,
          interval: record.interval,
          isPublic: record.isPublic,
          stats: record.stats,
          players: record.players,
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
      } catch (err) {
        console.error(`[GameServer] Error restoring session ${record.key}:`, err)
      }
    })

    console.log(
      `[GameServer] Restored ${this.games.length} game sessions from persistent storage.`,
    )
  }

  saveToStorage() {
    storage.saveGames(this.games)
  }

  createGame({ name, size, interval, isPublic }) {
    if (this.games.length >= MAX_ACTIVE_GAMES) {
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

    this.saveToStorage()
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

  getGameList() {
    return this.games
      .filter((game) => game.isPublic)
      .map((game) => ({
        key: game.key,
        name: game.name,
        numPlayers: game.arena.players.length,
        acceptingPlayers: game.acceptingPlayers,
      }))
  }

  getGame(key) {
    return this.games.find((game) => game.key === key)
  }

  getGameInfo(key) {
    const game = this.getGame(key)
    if (!game) return null
    return {
      key: game.key,
      name: game.name,
      players: game.arena.players.map((player) => player),
      started:
        Boolean(game.gameStarted) ||
        game.stats.gamecount > 0 ||
        !game.acceptingPlayers,
      running: game.running,
      scores: game.stats,
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
