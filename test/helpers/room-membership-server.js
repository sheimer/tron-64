// Private IPC fixture only: production HTTP/WebSocket routes, physics, storage
// and cleanup run against an isolated DATA_DIR and a controlled server clock.
import { once } from 'node:events'
import { mock } from 'node:test'
import { IDLE_ROOM_TIMEOUT_MS } from '../../shared/constants.js'

mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
const { server } = await import('../../app.js')
const { gameServer } = await import('../../server/GameServer.js')
server.listen(0, '127.0.0.1')
await once(server, 'listening')
process.send({ ready: true, port: server.address().port })

function inspect(key) {
  const game = gameServer.getGame(key)
  if (!game) {
    return { exists: false }
  }
  return {
    exists: true,
    info: gameServer.getGameInfo(key),
    emptySince: game.allDisconnected,
    clients: game.liveClients.map((client) => ({
      ids: [...client.playerIds],
      handles: [...client.handlesById],
      nextHandle: client.nextInputHandle,
      owner: game.roomOwner.owns(client),
    })),
  }
}
process.on('message', ({ id, command, key, milliseconds }) => {
  try {
    const game = gameServer.getGame(key)
    if (command === 'createTarget') {
      const target = gameServer.createGame({
        name: 'Other membership room',
        interval: 20,
        isPublic: true,
      })
      if (!target) {
        throw new Error('Fixture target creation failed')
      }
      process.send({ id, result: { key: target } })
      return
    }
    if (command === 'advance') {
      if (
        !Number.isInteger(milliseconds) ||
        milliseconds < 0 ||
        milliseconds > IDLE_ROOM_TIMEOUT_MS
      ) {
        throw new Error('Fixture clock advance out of bounds')
      }
      mock.timers.tick(milliseconds)
      // Use the production check at the exact boundary too; the periodic
      // callback still runs normally when the controlled clock crosses it.
      game?.checkConnectionStatus()
    } else if (command === 'finishPhysics') {
      if (!game?.running) {
        throw new Error('Fixture expected running physics')
      }
      for (let ticks = 0; game.running && ticks < 2500; ticks++) {
        mock.timers.tick(game.interval)
      }
      if (game.running) {
        throw new Error('Fixture physics exceeded collision bound')
      }
    } else if (command !== 'inspect') {
      throw new Error('Unknown fixture command')
    }
    process.send({ id, result: inspect(key) })
  } catch {
    // Never echo request data, saved records or private frames into diagnostics.
    process.send({ id, error: 'Room membership fixture command failed' })
  }
})
