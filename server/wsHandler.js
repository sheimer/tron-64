import WebSocket, { WebSocketServer } from 'ws'
import { createHash } from 'node:crypto'
import { gameServer } from './GameServer.js'
import { storage } from './Storage.js'
import {
  MSG_TYPE,
  BINARY_OPCODE,
  PROTOCOL_VERSION,
} from '../shared/protocol.js'
import {
  GRID_SIZE,
  MAX_ACTIVE_GAMES,
  MAX_CLIENTS_PER_ROOM,
} from '../shared/constants.js'
import {
  wsClientsGauge,
  wsMessagesSentCounter,
  wsMessagesReceivedCounter,
} from './metrics.js'

const sanitizeString = (str, maxLength = 32) =>
  typeof str === 'string' ? str.trim().slice(0, maxLength) : ''

const sanitizeInterval = (interval) =>
  Math.max(10, Math.min(500, Math.round(Number(interval)) || 25))

const retryLimit = 32
const requestIdPattern = /^[a-zA-Z0-9_-]{1,64}$/
const sendError = (ws, code, message, requestId) => {
  ws.send(
    JSON.stringify({
      type: MSG_TYPE.ERROR,
      code,
      requestId,
      payload: message,
      protocolVersion: PROTOCOL_VERSION,
    }),
  )
}

const controlErrors = {
  NOT_IN_ROOM: 'Join this room before using its controls.',
  CREATOR_REQUIRED:
    'Only the authenticated room creator can perform this action.',
  INSUFFICIENT_PLAYERS:
    'At least two authenticated, connected bikes are required to start a round.',
  ROUND_PENDING: 'A round is already being prepared. Wait for it to start.',
  ROUND_RUNNING: 'Wait until the current round finishes.',
  INVALID_INTERVAL:
    'Game interval must be an integer between 10 and 500 milliseconds.',
  PERSISTENCE_FAILED: 'The change could not be saved. Try again later.',
}

const releaseOwnedPlayers = (ws, game) => {
  // The room map is authoritative even if the socket index is stale.
  for (const [id, owner] of game?.ownership.owners ?? []) {
    if (owner === ws && game.ownership.release(id, ws))
      game.disconnectPlayer(id)
  }
  game?.roomOwner.release(ws)
  ws.playerIds.clear()
  ws.handlesById.clear()
  ws.idsByHandle.clear()
  ws.registrationRetries.clear()
}

const encodeBinaryDraw = (changes) => {
  if (!changes || !changes.length) return null
  const buf = Buffer.allocUnsafe(1 + changes.length * 5)
  buf.writeUInt8(BINARY_OPCODE.DRAW, 0)
  for (let i = 0; i < changes.length; i++) {
    const offset = 1 + i * 5
    buf.writeUInt16BE(changes[i][0], offset)
    buf.writeUInt16BE(changes[i][1], offset + 2)
    buf.writeInt8(changes[i][2], offset + 4)
  }
  return buf
}

export const setupWebSocketServer = (server) => {
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
  })

  server.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith('/ws')) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req)
      })
    } else {
      socket.destroy()
    }
  })

  const broadcastToRoom = (gameKey, message) => {
    const isBuffer = Buffer.isBuffer(message) || message instanceof Uint8Array
    const data = isBuffer
      ? message
      : typeof message === 'string'
        ? message
        : JSON.stringify(message)

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN && client.gameKey === gameKey) {
        wsMessagesSentCounter.inc({ type: isBuffer ? 'binary' : 'text' })
        if (isBuffer) {
          client.send(data, { binary: true })
        } else {
          client.send(data)
        }
      }
    })
  }

  const broadcastLobbyList = () => {
    const message = JSON.stringify({
      type: MSG_TYPE.LOBBY_LIST,
      payload: gameServer.getGameList(),
      protocolVersion: PROTOCOL_VERSION,
    })
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        wsMessagesSentCounter.inc({ type: 'text' })
        client.send(message)
      }
    })
  }

  gameServer.setChangeHandler(() => {
    broadcastLobbyList()
  })

  wss.on('connection', (ws) => {
    wsClientsGauge.set(wss.clients.size)
    ws.gameKey = null
    ws.playerIds = new Set()
    ws.handlesById = new Map()
    ws.idsByHandle = new Map()
    ws.nextInputHandle = 0
    ws.registrationRetries = new Map()
    ws.creationRetries = new Map()
    ws.protocolReady = false

    // Send initial lobby list
    wsMessagesSentCounter.inc({ type: 'text' })
    ws.send(
      JSON.stringify({
        type: MSG_TYPE.LOBBY_LIST,
        payload: gameServer.getGameList(),
        protocolVersion: PROTOCOL_VERSION,
      }),
    )

    ws.on('message', (raw, isBinary) => {
      wsMessagesReceivedCounter.inc({
        type: isBinary ? 'binary' : 'text',
      })
      // Input handle is connection-local; even a valid byte is not an ID.
      if (isBinary) {
        if (
          !ws.protocolReady ||
          !ws.gameKey ||
          raw.length !== 3 ||
          raw[0] !== BINARY_OPCODE.CHANGE_DIR ||
          raw[2] > 1
        )
          return
        const game = gameServer.getGame(ws.gameKey)
        const id = ws.idsByHandle.get(raw[1])
        if (game && id !== undefined && game.ownership.owns(id, ws)) {
          game.changeDir({ id, dir: raw[2] === 0 ? 'left' : 'right' })
        }
        return
      }

      try {
        const msg = JSON.parse(raw.toString())
        const type = msg.type
        const payload = msg.payload

        if (msg.protocolVersion !== PROTOCOL_VERSION) {
          sendError(
            ws,
            'PROTOCOL_MISMATCH',
            'Your game version is out of date. Reload this page before joining.',
            msg.requestId,
          )
          return
        }
        switch (type) {
          case MSG_TYPE.PING: {
            ws.send(
              JSON.stringify({
                type: MSG_TYPE.PONG,
                t: msg.t ?? payload ?? Date.now(),
                serverT: Date.now(),
              }),
            )
            break
          }

          case MSG_TYPE.LOBBY_LIST: {
            ws.send(
              JSON.stringify({
                type: MSG_TYPE.LOBBY_LIST,
                payload: gameServer.getGameList(),
                protocolVersion: PROTOCOL_VERSION,
              }),
            )
            break
          }

          case MSG_TYPE.CREATE_GAME: {
            const requestId = msg.requestId
            if (
              typeof requestId !== 'string' ||
              !requestIdPattern.test(requestId)
            ) {
              sendError(
                ws,
                'INVALID_CREATION',
                'Send a valid creation requestId.',
                requestId,
              )
              return
            }
            const fingerprint = createHash('sha256')
              .update(JSON.stringify(payload) ?? 'undefined')
              .digest('hex')
            const cached = ws.creationRetries.get(requestId)
            if (cached) {
              if (
                cached.fingerprint === fingerprint &&
                gameServer.getGame(cached.response.payload.key) === cached.game
              ) {
                ws.send(JSON.stringify(cached.response))
              } else {
                sendError(
                  ws,
                  'REQUEST_ID_CONFLICT',
                  'Use a new requestId for a different or expired room creation.',
                  requestId,
                )
              }
              return
            }
            const name = sanitizeString(payload?.name, 32) || 'Tron Game'
            const interval = sanitizeInterval(payload?.interval)
            const isPublic = Boolean(payload?.isPublic ?? true)

            const creator = {}
            const key = gameServer.createGame({
              creator,
              name,
              size: GRID_SIZE,
              interval,
              isPublic,
            })
            if (!key) {
              const blocked = storage.readOnly
              const full = gameServer.games.length >= MAX_ACTIVE_GAMES
              sendError(
                ws,
                blocked
                  ? 'SNAPSHOT_UNSUPPORTED'
                  : full
                    ? 'SERVER_CAPACITY'
                    : 'PERSISTENCE_FAILED',
                blocked
                  ? 'The saved games format is unsupported. Back up the snapshot and use a compatible server version before creating rooms.'
                  : full
                    ? `Server at full capacity (maximum ${MAX_ACTIVE_GAMES} concurrent games). Please join an existing match.`
                    : 'Room creation could not be saved. Try again later.',
                requestId,
              )
              return
            }
            const response = {
              type: MSG_TYPE.GAME_CREATED,
              requestId,
              protocolVersion: PROTOCOL_VERSION,
              payload: { key, ...creator.credentials },
            }
            ws.creationRetries.set(requestId, {
              fingerprint,
              response,
              game: gameServer.getGame(key),
            })
            if (ws.creationRetries.size > retryLimit)
              ws.creationRetries.delete(ws.creationRetries.keys().next().value)
            ws.send(JSON.stringify(response))
            broadcastLobbyList()
            break
          }

          case MSG_TYPE.JOIN_GAME: {
            const gameKey = sanitizeString(payload?.key, 16)
            const claims = payload?.reconnect ?? []
            const ownerClaim = payload?.roomOwner
            if (
              ownerClaim !== undefined &&
              (typeof msg.requestId !== 'string' ||
                !requestIdPattern.test(msg.requestId))
            ) {
              sendError(
                ws,
                'INVALID_OWNER_CREDENTIAL',
                'Owner authentication requires a valid requestId.',
                msg.requestId,
              )
              return
            }
            if (
              !Array.isArray(claims) ||
              claims.length > 6 ||
              (claims.length > 0 &&
                (typeof msg.requestId !== 'string' ||
                  !requestIdPattern.test(msg.requestId))) ||
              new Set(claims.map((claim) => claim?.id)).size !== claims.length
            ) {
              sendError(
                ws,
                'INVALID_RECONNECT',
                'Invalid or duplicate reconnect entries (maximum six).',
                msg.requestId,
              )
              return
            }
            const game = gameServer.getGame(gameKey)
            if (!game) {
              sendError(
                ws,
                'GAME_NOT_FOUND',
                `Game ${gameKey} not found`,
                msg.requestId,
              )
              return
            }

            const openClients = game.clients.filter(
              (c) => c?.readyState === WebSocket.OPEN,
            )
            if (
              ws.gameKey !== gameKey &&
              openClients.length >= MAX_CLIENTS_PER_ROOM
            ) {
              sendError(
                ws,
                'ROOM_FULL',
                `Game room ${gameKey} is full (maximum ${MAX_CLIENTS_PER_ROOM} clients).`,
                msg.requestId,
              )
              return
            }

            // Check every claim independently, then preflight all new handles
            // before changing room membership or a single owner.
            const ownerAccepted =
              ownerClaim !== undefined && game.roomOwner.verify(ownerClaim)
            const ownerResult =
              ownerClaim === undefined
                ? null
                : ownerAccepted
                  ? { accepted: true, ownerClientId: game.roomOwner.clientId }
                  : { accepted: false, code: 'INVALID_OWNER_CREDENTIAL' }
            const accepted = []
            const rejected = []
            for (const claim of claims) {
              if (game.ownership.verify(claim?.id, claim?.reconnectToken))
                accepted.push(claim.id)
              else
                rejected.push({
                  id: typeof claim?.id === 'string' ? claim.id : null,
                  code: 'INVALID_CREDENTIAL',
                })
            }
            const allocations = accepted.filter(
              (id) =>
                ws.gameKey !== gameKey ||
                !game.ownership.owns(id, ws) ||
                !ws.handlesById.has(id),
            ).length
            if (ws.nextInputHandle + allocations > 256) {
              sendError(
                ws,
                'INPUT_HANDLE_EXHAUSTED',
                'This connection has no input handles left. Reload the page, then rejoin the room with saved credentials. Reloading disconnects your players until the next round.',
                msg.requestId,
              )
              return
            }

            if (ws.gameKey && ws.gameKey !== gameKey) {
              const oldKey = ws.gameKey
              const oldGame = gameServer.getGame(oldKey)
              releaseOwnedPlayers(ws, oldGame)
              if (oldGame)
                oldGame.clients = oldGame.clients.filter((c) => c !== ws)
              ws.gameKey = null
              if (oldGame) {
                broadcastToRoom(oldKey, {
                  type: MSG_TYPE.GAME_INFO,
                  payload: gameServer.getGameInfo(oldKey),
                })
              }
            }
            if (ws.gameKey !== gameKey) {
              ws.gameKey = gameKey
              ws.protocolReady = true
              game.connect({
                client: ws,
                ondraw: (changes) => {
                  const buf = encodeBinaryDraw(changes)
                  if (buf) {
                    broadcastToRoom(gameKey, buf)
                  }
                },
                onfinish: (stats) => {
                  broadcastToRoom(gameKey, {
                    type: MSG_TYPE.GAME_FINISH,
                    payload: stats,
                  })
                },
                onreset: (positions) => {
                  broadcastToRoom(gameKey, {
                    type: MSG_TYPE.GAME_RESET,
                    payload: positions,
                  })
                },
              })
            }

            if (ownerAccepted) {
              const previous = game.roomOwner.bind(ws)
              if (
                previous &&
                previous !== ws &&
                previous.readyState === WebSocket.OPEN
              )
                previous.send(
                  JSON.stringify({
                    type: MSG_TYPE.ROOM_OWNER_REVOKED,
                    protocolVersion: PROTOCOL_VERSION,
                    payload: {
                      key: gameKey,
                      ownerClientId: game.roomOwner.clientId,
                    },
                  }),
                )
            }
            const revoked = new Map()
            const bindings = accepted.map((id) => {
              const previous = game.ownership.transfer(id, ws)
              if (
                previous &&
                previous !== ws &&
                previous.readyState === WebSocket.OPEN
              ) {
                if (!revoked.has(previous)) revoked.set(previous, [])
                revoked.get(previous).push(id)
              }
              let inputHandle = ws.handlesById.get(id)
              if (inputHandle === undefined) {
                inputHandle = ws.nextInputHandle++
                ws.handlesById.set(id, inputHandle)
                ws.idsByHandle.set(inputHandle, id)
              }
              if (!previous) game.reconnectPlayer(id)
              return { id, inputHandle }
            })
            for (const [previous, ids] of revoked) {
              previous.send(
                JSON.stringify({
                  type: MSG_TYPE.OWNERSHIP_REVOKED,
                  payload: { key: gameKey, ids },
                  protocolVersion: PROTOCOL_VERSION,
                }),
              )
            }

            if (claims.length || msg.requestId) {
              ws.send(
                JSON.stringify({
                  type: MSG_TYPE.JOIN_RESULT,
                  requestId: msg.requestId,
                  protocolVersion: PROTOCOL_VERSION,
                  payload: {
                    key: gameKey,
                    accepted: bindings,
                    rejected,
                    roomOwner: ownerResult,
                  },
                }),
              )
            }

            const gameInfo = gameServer.getGameInfo(gameKey)
            ws.send(
              JSON.stringify({
                type: MSG_TYPE.GAME_INFO,
                payload: gameInfo,
              }),
            )
            if (bindings.length || ownerAccepted)
              broadcastToRoom(gameKey, {
                type: MSG_TYPE.GAME_INFO,
                payload: gameServer.getGameInfo(gameKey),
              })

            break
          }

          case MSG_TYPE.LEAVE_GAME: {
            if (ws.gameKey) {
              const gameKey = ws.gameKey
              const game = gameServer.getGame(gameKey)
              releaseOwnedPlayers(ws, game)
              if (game) game.clients = game.clients.filter((c) => c !== ws)
              ws.gameKey = null
              ws.protocolReady = false
              if (game) {
                broadcastToRoom(gameKey, {
                  type: MSG_TYPE.GAME_INFO,
                  payload: gameServer.getGameInfo(gameKey),
                })
              }
              broadcastLobbyList()
            }
            break
          }

          case MSG_TYPE.ADD_PLAYER: {
            const requestId = msg.requestId
            if (
              !ws.gameKey ||
              !ws.protocolReady ||
              typeof requestId !== 'string' ||
              !requestIdPattern.test(requestId)
            ) {
              sendError(
                ws,
                'INVALID_REGISTRATION',
                'Join a room and send a valid registration requestId.',
                requestId,
              )
              return
            }
            const game = gameServer.getGame(ws.gameKey)
            if (game && payload) {
              const fingerprint = createHash('sha256')
                .update(JSON.stringify(payload) ?? 'undefined')
                .digest('hex')
              const cached = ws.registrationRetries.get(requestId)
              if (cached) {
                if (
                  cached.fingerprint === fingerprint &&
                  cached.room === ws.gameKey &&
                  game.ownership.owns(cached.response.payload.id, ws)
                ) {
                  ws.send(JSON.stringify(cached.response))
                } else {
                  sendError(
                    ws,
                    'REQUEST_ID_CONFLICT',
                    'Use a new requestId for a different registration.',
                    requestId,
                  )
                }
                return
              }
              if (ws.nextInputHandle >= 256) {
                sendError(
                  ws,
                  'INPUT_HANDLE_EXHAUSTED',
                  'This connection has no input handles left. Reload the page, then rejoin the room with saved credentials. Reloading disconnects your players until the next round.',
                  requestId,
                )
                return
              }
              const name = sanitizeString(payload.name, 24) || 'Player'
              const id = payload.id
              const color = sanitizeString(payload.color, 16) || 'fg'
              const left = payload.left
              const right = payload.right
              const result = game.addPlayer(
                { id, name, color, left, right },
                { deferChange: true },
              )
              if (!result.ok) {
                sendError(
                  ws,
                  result.code,
                  `Player registration failed: ${result.code}.`,
                  requestId,
                )
                return
              }
              const reconnectToken = game.ownership.register(id, ws)
              if (!gameServer.saveToStorage()) {
                game.rollbackPlayerRegistration(id, ws)
                sendError(
                  ws,
                  'PERSISTENCE_FAILED',
                  'Player registration could not be saved. No player was registered; try again later.',
                  requestId,
                )
                return
              }
              const inputHandle = ws.nextInputHandle++
              ws.idsByHandle.set(inputHandle, id)
              ws.handlesById.set(id, inputHandle)
              const response = {
                type: MSG_TYPE.PLAYER_REGISTERED,
                requestId,
                protocolVersion: PROTOCOL_VERSION,
                payload: { key: ws.gameKey, id, reconnectToken, inputHandle },
              }
              ws.registrationRetries.set(requestId, {
                fingerprint,
                room: ws.gameKey,
                response,
              })
              if (ws.registrationRetries.size > retryLimit) {
                ws.registrationRetries.delete(
                  ws.registrationRetries.keys().next().value,
                )
              }
              ws.send(JSON.stringify(response))
              gameServer.changeHandler?.()
              broadcastToRoom(ws.gameKey, {
                type: MSG_TYPE.GAME_INFO,
                payload: gameServer.getGameInfo(ws.gameKey),
              })
            } else
              sendError(
                ws,
                'INVALID_REGISTRATION',
                'Invalid player registration.',
                requestId,
              )
            break
          }

          case MSG_TYPE.START_GAME: {
            const gameKey = ws.gameKey
            const game = gameServer.getGame(gameKey)
            const result = game?.beginRound(ws) ?? {
              ok: false,
              code: 'NOT_IN_ROOM',
            }
            if (!result.ok) {
              sendError(
                ws,
                result.code,
                controlErrors[result.code],
                msg.requestId,
              )
              return
            }
            const pending = result.pending
            pending.requestId = msg.requestId
            pending.expectedClients = new Set(
              game.clients.filter((client) => game.isJoined(client)),
            )
            const isCurrent = () =>
              gameServer.getGame(gameKey) === game &&
              game.pendingStart === pending
            const launchCountdown = () => {
              if (!isCurrent() || pending.countdownStarted) return
              pending.countdownStarted = true
              clearTimeout(pending.fallbackTimer)
              pending.fallbackTimer = null
              broadcastToRoom(gameKey, {
                type: MSG_TYPE.GAME_STATE,
                payload: 'running',
              })
              pending.startTimer = setTimeout(() => {
                if (!isCurrent()) return
                const launched = game.launchRound(pending, () =>
                  gameServer.saveToStorage(),
                )
                if (!launched.ok && ws.readyState === WebSocket.OPEN)
                  sendError(
                    ws,
                    launched.code,
                    controlErrors[launched.code],
                    pending.requestId,
                  )
                broadcastToRoom(gameKey, {
                  type: MSG_TYPE.GAME_INFO,
                  payload: gameServer.getGameInfo(gameKey),
                })
              }, 1000)
            }
            pending.launchCountdown = launchCountdown
            pending.fallbackTimer = setTimeout(launchCountdown, 2000)
            if (pending.expectedClients.size === 0) launchCountdown()
            break
          }

          case MSG_TYPE.ARENA_READY: {
            const game = gameServer.getGame(ws.gameKey)
            const pending = game?.pendingStart
            if (
              pending &&
              !pending.countdownStarted &&
              pending.expectedClients.has(ws) &&
              game.isJoined(ws)
            ) {
              pending.readyClients.add(ws)
              if (pending.readyClients.size >= pending.expectedClients.size)
                pending.launchCountdown()
            }
            break
          }

          case MSG_TYPE.SET_INTERVAL: {
            const game = gameServer.getGame(ws.gameKey)
            const result = game?.changeInterval(ws, payload, () =>
              gameServer.saveToStorage(),
            ) ?? { ok: false, code: 'NOT_IN_ROOM' }
            if (!result.ok) {
              sendError(
                ws,
                result.code,
                controlErrors[result.code],
                msg.requestId,
              )
              return
            }
            gameServer.changeHandler?.()
            broadcastToRoom(ws.gameKey, {
              type: MSG_TYPE.GAME_INFO,
              payload: gameServer.getGameInfo(ws.gameKey),
            })
            break
          }

          default:
            sendError(
              ws,
              'UNKNOWN_MESSAGE_TYPE',
              `Unknown message type: ${type}`,
              msg.requestId,
            )
        }
      } catch {
        // A message can contain a submitted secret. Never log the raw parse
        // exception or the inbound frame.
        sendError(ws, 'INVALID_MESSAGE', 'Invalid message.')
      }
    })

    ws.on('close', () => {
      wsClientsGauge.set(wss.clients.size)
      if (ws.gameKey) {
        const game = gameServer.getGame(ws.gameKey)
        releaseOwnedPlayers(ws, game)
        if (game) {
          game.clients = game.clients.filter((c) => c !== ws)
          broadcastToRoom(ws.gameKey, {
            type: MSG_TYPE.GAME_INFO,
            payload: gameServer.getGameInfo(ws.gameKey),
          })
        }
      }
      ws.gameKey = null
      ws.protocolReady = false
      ws.playerIds.clear()
    })
  })
}
