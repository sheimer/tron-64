import { fisherYatesShuffle } from '../shared/utils.js'
import {
  CELL_TYPE,
  START_POSITIONS,
  AVAILABLE_POSITIONS,
  GRID_SIZE,
  EXPLOSION_MAX_MS_RUNNING,
  EXPLOSION_MAX_MS_FINISHED,
} from '../shared/constants.js'
import { Explosion } from './Explosion.js'
import { crashesTotalCounter } from './metrics.js'

export class Arena {
  constructor({ size = GRID_SIZE } = {}) {
    this.size = size
    this.xMax = this.size.x - 1
    this.yMax = this.size.y - 1
    this.ondraw = null
    this.onfinish = null
    this.onreset = null
    this.players = []
    this.explosions = []
    this.fields = null
    this.fieldChanges = null
    /*
      2 dimensional array representing playing field, each field containing:
        -3:  explosion (CELL_TYPE.EXPLOSION)
        -2:  border    (CELL_TYPE.BORDER)
        -1:  empty     (CELL_TYPE.EMPTY)
        0-5: player ID / index
    */
    this.escaped = null
    this.deadPlayers = 0

    this.init()
  }

  destroy() {
    this.ondraw = null
    this.onreset = null
    this.onfinish = null
  }

  addHandler({ ondraw, onfinish, onreset }) {
    if (this.ondraw === null) {
      this.ondraw = ondraw
    }
    if (this.onfinish === null) {
      this.onfinish = onfinish
    }
    if (this.onreset === null) {
      this.onreset = onreset
    }
  }

  init() {
    this.escaped = []
    this.deadPlayers = 0
    this.explosions = []

    this.fields = []
    this.fieldChanges = []

    for (let x = 0; x < this.size.x; x++) {
      this.fields[x] = []
      for (let y = 0; y < this.size.y; y++) {
        if (x === 0 || y === 0 || x === this.xMax || y === this.yMax) {
          this.fields[x][y] = CELL_TYPE.BORDER
        } else {
          this.fields[x][y] = CELL_TYPE.EMPTY
        }
      }
    }

    this.players.forEach((player, index) => {
      if (player.pos !== null) {
        this.fields[player.pos.x][player.pos.y] = index
        this.fieldChanges.push([player.pos.x, player.pos.y, index])
      }
    })

    this.draw()
  }

  reset({ finish } = {}) {
    if (finish) {
      this.finish()
    }

    const positions = {}

    if (this.players?.length && this.players.length > 1) {
      const positionIndices = AVAILABLE_POSITIONS[this.players.length - 2]
      const randomPositions = fisherYatesShuffle([
        ...positionIndices,
      ])

      for (let i = 0; i < this.players.length; i++) {
        const player = this.players[i]
        const posId = randomPositions[i]
        positions[player.id] = posId
        const pos = { ...START_POSITIONS[posId] }
        const move = posId % 2 === 0 ? 1 : 3
        player.reset({ pos, move })
      }
    }
    if (typeof this.onreset === 'function') {
      this.onreset(positions)
    }
    this.init()
  }

  draw() {
    const changes = [...this.fieldChanges]
    this.fieldChanges = []
    if (typeof this.ondraw === 'function') {
      this.ondraw(changes)
    }
  }

  addPlayer(player) {
    this.players.push(player)
  }

  startRound() {
    let addDeadPlayers = 0
    for (let i = 0; i < this.players.length; i++) {
      const player = this.players[i]
      if (!player.connected && player.alive && player.pos) {
        addDeadPlayers++
        this.killPlayer(i, player, -1)
        // Clear starting dot so no trail or obstacle is left
        const x = player.pos.x
        const y = player.pos.y
        if (this.fields[x][y] === i) {
          this.fields[x][y] = CELL_TYPE.EMPTY
          this.fieldChanges.push([x, y, CELL_TYPE.EMPTY])
        }
      }
    }
    this.deadPlayers += addDeadPlayers
    if (addDeadPlayers > 0) {
      this.draw()
    }
  }

  disconnectPlayer(playerId) {
    const index = this.players.findIndex((p) => p.id === playerId)
    if (index === -1) return null

    const player = this.players[index]
    player.connected = false

    if (player.alive && player.pos) {
      this.deadPlayers++
      this.killPlayer(index, player, -1)
      this.draw()
    }
    return player
  }

  reconnectPlayer(playerId) {
    const player = this.players.find((p) => p.id === playerId)
    if (player) {
      player.connected = true
    }
    return player
  }

  killPlayer(index, player, killedBy) {
    crashesTotalCounter.inc()
    player.deadPlayers = this.deadPlayers
    player.alive = false
    if (killedBy >= 0) {
      const killer = this.players[killedBy]
      const killedOn = `${player.pos.x}-${player.pos.y}`

      player.killedBy = killer.killzone.includes(killedOn) ? killedBy : -1
    }
    this.explosions.push(new Explosion({ id: index, pos: { ...player.pos } }))
  }

  run() {
    let finished = 0
    let playersLeft = 0
    const prevPositions = new Array(this.players.length).fill(null)

    // calc new positions --> loop players, set their new pos
    for (let i = 0; i < this.players.length; i++) {
      const player = this.players[i]
      if (player.alive && player.pos) {
        prevPositions[i] = { ...player.pos }
        player.nextPos()
      }
    }

    // calc explosions
    const playersLeftBefore = this.players.filter((p) => p.alive).length
    const maxExplosionDuration =
      playersLeftBefore > 1
        ? EXPLOSION_MAX_MS_RUNNING
        : EXPLOSION_MAX_MS_FINISHED

    const renderParticle = (pos, value) => {
      const x = Math.round(pos.x)
      const y = Math.round(pos.y)
      if (x < 0 || x > this.xMax || y < 0 || y > this.yMax) {
        return
      }
      this.fields[x][y] = value
      this.fieldChanges.push([x, y, value])
    }

    const activeExplosions = []
    for (let i = 0; i < this.explosions.length; i++) {
      const explosion = this.explosions[i]
      if (explosion.isExpired(maxExplosionDuration)) {
        // Clear any residual rendered particles from the board
        for (let p = 0; p < explosion.particles.length; p++) {
          const particle = explosion.particles[p]
          if (particle.pos !== null) {
            renderParticle(particle.pos, CELL_TYPE.EMPTY)
          }
          if (particle.prev !== null) {
            renderParticle(particle.prev, CELL_TYPE.EMPTY)
          }
        }
        explosion.finish()
        continue
      }

      explosion.nextPos()
      for (let p = 0; p < explosion.particles.length; p++) {
        if (explosion.particles[p].prev !== null) {
          renderParticle(explosion.particles[p].prev, CELL_TYPE.EMPTY)
        }
        if (
          !explosion.particles[p].finished &&
          explosion.particles[p].pos !== null
        ) {
          renderParticle(explosion.particles[p].pos, CELL_TYPE.EXPLOSION)
        }
      }

      if (explosion.particles.length) {
        activeExplosions.push(explosion)
      }
    }
    this.explosions = activeExplosions

    // check on collisions --> incl. 2 in 1 spot detection
    const resetPlayers = []
    let addDeadPlayers = 0
    for (let i = 0; i < this.players.length; i++) {
      const player = this.players[i]
      if (player.alive && player.pos) {
        const x = player.pos.x
        const y = player.pos.y
        if (this.fields[x][y] !== CELL_TYPE.EMPTY) {
          addDeadPlayers++

          const killedBy =
            this.fields[x][y] >= 0 && this.fields[x][y] !== i
              ? this.fields[x][y]
              : -1
          this.killPlayer(i, player, killedBy)
          resetPlayers.push(i)
          if (killedBy >= 0 && killedBy < i) {
            const killer = this.players[killedBy]
            if (
              killer &&
              killer.pos &&
              x === killer.pos.x &&
              y === killer.pos.y
            ) {
              // both players tried to occupy same spot in one frame, but as "killedBy" player moved there it was not yet occupied...
              this.killPlayer(player.killedBy, killer, i)
              resetPlayers.push(player.killedBy)
            }
          }
        } else {
          if (
            x === 0 ||
            x === this.size.x - 1 ||
            y === 0 ||
            y === this.size.y - 1
          ) {
            player.escaped = true
            this.escaped.push(i)
            finished = 1
          } else {
            playersLeft++
          }
          this.fields[x][y] = i
          this.fieldChanges.push([x, y, i])
        }
      }
    }

    this.deadPlayers += addDeadPlayers

    for (let j = 0; j < resetPlayers.length; j++) {
      const id = resetPlayers[j]
      if (prevPositions[id]) {
        this.players[id].pos = prevPositions[id]
        this.players[id].killzone.fill(null)
      }
    }

    this.draw()

    // finished...
    if (finished || (!this.explosions.length && playersLeft <= 1)) {
      this.finish()
    }
  }

  finish() {
    const stats = { kills: {}, deadOnDeath: {}, escaped: [], winner: null }
    for (let i = 0; i < this.players.length; i++) {
      const player = this.players[i]
      stats.deadOnDeath[player.id] = player.deadPlayers
      if (player.killedBy >= 0) {
        const killer = this.players[player.killedBy].id
        stats.kills[killer] = player.id
      }
    }
    if (this.escaped.length) {
      this.escaped.forEach((index) =>
        stats.escaped.push(this.players[index].id),
      )
    } else {
      for (let i = 0; i < this.players.length; i++) {
        const player = this.players[i]
        if (player.alive) {
          stats.winner = player.id
        }
      }
    }
    if (typeof this.onfinish === 'function') {
      this.onfinish(stats)
    }
  }
}
