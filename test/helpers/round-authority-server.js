// Trusted fixture process: real routes, GameSession, physics, storage and sockets.
// A controlled server clock allows a crash after durable launch, before tick 1.
import { once } from 'node:events'
import { mock } from 'node:test'
import { MSG_TYPE, PROTOCOL_VERSION } from '../../shared/protocol.js'

mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
const { server } = await import('../../app.js')
const { gameServer } = await import('../../server/GameServer.js')
const { storage } = await import('../../server/Storage.js')
let failedWrites = 0
const saveGames = storage.saveGames.bind(storage)
storage.saveGames = (...args) => {
  if (failedWrites > 0) {
    failedWrites--
    return false
  }
  return saveGames(...args)
}
server.listen(Number(process.env.ROUND_AUTHORITY_PORT || 0), '127.0.0.1')
await once(server, 'listening')
process.send({ ready: true, port: server.address().port })

function inspect(game) {
  return {
    info: gameServer.getGameInfo(game.key),
    acceptingPlayers: game.acceptingPlayers,
    pending: Boolean(game.pendingStart),
    physicsTimer: Boolean(game.timer),
    nextTick: game.nextTickTime !== null,
    gameStarted: game.gameStarted !== null,
    creatorBound: Boolean(game.roomOwner.socket),
    owners: game.ownership.owners.size,
    clients: game.liveClients.map((client) => ({
      ids: [...game.ownership.owners]
        .filter(([, owner]) => owner === client)
        .map(([id]) => id),
      handles: [...client.handlesById],
      owner: game.roomOwner.owns(client),
    })),
    bikes: game.arena.players.map(({ id, pos, move, alive, connected }) => ({
      id,
      pos,
      move,
      alive,
      connected,
    })),
  }
}
function publish(game) {
  const data = JSON.stringify({
    type: MSG_TYPE.GAME_INFO,
    payload: gameServer.getGameInfo(game.key),
    protocolVersion: PROTOCOL_VERSION,
  })
  for (const client of game.liveClients) {
    if (client.readyState === 1) {
      client.send(data)
    }
  }
}
process.on('message', ({ id, command, key, milliseconds, value }) => {
  try {
    const game = gameServer.getGame(key)
    if (!game) {
      throw new Error('Fixture room missing')
    }
    if (command === 'tick') {
      mock.timers.tick(milliseconds)
    } else if (command === 'interval') {
      game.setInterval(value)
      publish(game)
    } else if (command === 'public') {
      game.isPublic = value
      game.onChange()
    } else if (command === 'failWrite') {
      failedWrites = 1
    } else if (command === 'finishPhysics') {
      // Run the real queued physics to a real collision/finish; never addStats.
      for (let ticks = 0; game.running && ticks < 2500; ticks++) {
        mock.timers.tick(game.interval)
      }
      if (game.running) {
        throw new Error('Real physics did not finish within bound')
      }
    } else if (command !== 'inspect') {
      throw new Error('Unknown fixture command')
    }
    process.send({ id, result: inspect(game) })
  } catch (error) {
    process.send({ id, error: error.message })
  }
})
