import WebSocket, { WebSocketServer } from 'ws'
import { gameServer } from './GameServer.js'
import { MSG_TYPE, BINARY_OPCODE } from '../shared/protocol.js'
import { GRID_SIZE, MAX_ACTIVE_GAMES, MAX_CLIENTS_PER_ROOM } from '../shared/constants.js'

const sanitizeString = (str, maxLength = 32) =>
  typeof str === 'string' ? str.trim().slice(0, maxLength) : ''

const sanitizeInterval = (interval) =>
  Math.max(10, Math.min(500, Math.round(Number(interval)) || 25))

const sanitizeDir = (dir) => (dir === 'left' || dir === 'right' ? dir : null)

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
      if (
        client.readyState === WebSocket.OPEN &&
        client.gameKey === gameKey
      ) {
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
    })
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message)
      }
    })
  }

  gameServer.setChangeHandler(() => {
    broadcastLobbyList()
  })

  const pendingStarts = new Map()

  wss.on('connection', (ws) => {
    ws.gameKey = null
    ws.playerIds = new Set()

    // Send initial lobby list
    ws.send(
      JSON.stringify({
        type: MSG_TYPE.LOBBY_LIST,
        payload: gameServer.getGameList(),
      }),
    )

    ws.on('message', (raw) => {
      // Fast path for 3-byte binary CHANGE_DIR frames: [OPCODE, playerId, dirByte]
      if (
        Buffer.isBuffer(raw) &&
        raw.length === 3 &&
        raw[0] === BINARY_OPCODE.CHANGE_DIR
      ) {
        if (!ws.gameKey) return
        const game = gameServer.getGame(ws.gameKey)
        if (game) {
          const id = raw[1]
          const dir = raw[2] === 0 ? 'left' : raw[2] === 1 ? 'right' : null
          if (dir !== null) {
            game.changeDir({ id, dir })
          }
        }
        return
      }

      try {
        const msg = JSON.parse(raw.toString())
        const type = msg.type || msg.action
        const payload = msg.payload

        switch (type) {
          case MSG_TYPE.PING:
          case 'ping': {
            ws.send(
              JSON.stringify({
                type: MSG_TYPE.PONG,
                t: msg.t ?? payload ?? Date.now(),
                serverT: Date.now(),
              }),
            )
            break
          }

          case MSG_TYPE.LOBBY_LIST:
          case 'list': {
            ws.send(
              JSON.stringify({
                type: MSG_TYPE.LOBBY_LIST,
                payload: gameServer.getGameList(),
              }),
            )
            break
          }

          case MSG_TYPE.CREATE_GAME:
          case 'create': {
            const name = sanitizeString(payload?.name, 32) || 'Tron Game'
            const interval = sanitizeInterval(payload?.interval)
            const isPublic = Boolean(payload?.isPublic ?? true)

            const key = gameServer.createGame({
              name,
              size: GRID_SIZE,
              interval,
              isPublic,
            })
            if (!key) {
              ws.send(
                JSON.stringify({
                  type: MSG_TYPE.ERROR,
                  payload: `Server at full capacity (maximum ${MAX_ACTIVE_GAMES} concurrent games). Please join an existing match.`,
                }),
              )
              return
            }
            ws.send(
              JSON.stringify({
                type: MSG_TYPE.GAME_CREATED,
                payload: key,
              }),
            )
            broadcastLobbyList()
            break
          }

          case MSG_TYPE.JOIN_GAME:
          case 'join': {
            const gameKey = sanitizeString(payload?.key || payload, 16)
            const playerIds = Array.isArray(payload?.playerIds)
              ? payload.playerIds
              : []
            const game = gameServer.getGame(gameKey)
            if (!game) {
              ws.send(
                JSON.stringify({
                  type: MSG_TYPE.ERROR,
                  payload: `Game ${gameKey} not found`,
                }),
              )
              return
            }

            const openClients = game.clients.filter(
              (c) => c?.readyState === WebSocket.OPEN,
            )
            if (openClients.length >= MAX_CLIENTS_PER_ROOM) {
              ws.send(
                JSON.stringify({
                  type: MSG_TYPE.ERROR,
                  payload: `Game room ${gameKey} is full (maximum ${MAX_CLIENTS_PER_ROOM} clients).`,
                }),
              )
              return
            }

            ws.gameKey = gameKey
            let reconnectedAny = false
            playerIds.forEach((pid) => {
              const cleanId = sanitizeString(pid, 16)
              if (cleanId) {
                ws.playerIds.add(cleanId)
                game.reconnectPlayer(cleanId)
                reconnectedAny = true
              }
            })

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

            const gameInfo = gameServer.getGameInfo(gameKey)
            ws.send(
              JSON.stringify({
                type: MSG_TYPE.GAME_INFO,
                payload: gameInfo,
              }),
            )

            if (reconnectedAny) {
              broadcastToRoom(gameKey, {
                type: MSG_TYPE.GAME_INFO,
                payload: gameInfo,
              })
            }
            break
          }

          case MSG_TYPE.ADD_PLAYER:
          case 'addPlayer': {
            if (!ws.gameKey) return
            const game = gameServer.getGame(ws.gameKey)
            if (game && payload) {
              const name = sanitizeString(payload.name, 24) || 'Player'
              const id = sanitizeString(payload.id, 16)
              const color = sanitizeString(payload.color, 16) || 'fg'
              const left = payload.left
              const right = payload.right

              ws.playerIds.add(id)
              game.addPlayer({ id, name, color, left, right })
              broadcastToRoom(ws.gameKey, {
                type: MSG_TYPE.GAME_INFO,
                payload: gameServer.getGameInfo(ws.gameKey),
              })
            }
            break
          }

          case MSG_TYPE.START_GAME:
          case 'start': {
            if (!ws.gameKey || ws.playerIds.size === 0) return
            const gameKey = ws.gameKey
            const game = gameServer.getGame(gameKey)
            if (!game) return

            // Clear any prior pending start in this room
            const prevPending = pendingStarts.get(gameKey)
            if (prevPending) {
              clearTimeout(prevPending.fallbackTimer)
              clearTimeout(prevPending.startTimer)
              pendingStarts.delete(gameKey)
            }

            game.reset()

            const roomClients = Array.from(wss.clients).filter(
              (c) => c.readyState === WebSocket.OPEN && c.gameKey === gameKey,
            )

            const pending = {
              readyClients: new Set(),
              expectedCount: roomClients.length,
              countdownStarted: false,
              fallbackTimer: null,
              startTimer: null,
            }
            pendingStarts.set(gameKey, pending)

            const launchCountdown = () => {
              if (pending.countdownStarted) return
              pending.countdownStarted = true
              if (pending.fallbackTimer) {
                clearTimeout(pending.fallbackTimer)
                pending.fallbackTimer = null
              }

              broadcastToRoom(gameKey, {
                type: MSG_TYPE.GAME_STATE,
                payload: 'running',
              })

              pending.startTimer = setTimeout(() => {
                const g = gameServer.getGame(gameKey)
                if (g) {
                  g.start()
                }
                pendingStarts.delete(gameKey)
              }, 1000)
            }

            pending.launchCountdown = launchCountdown
            pending.fallbackTimer = setTimeout(launchCountdown, 2000)

            if (pending.expectedCount === 0) {
              launchCountdown()
            }
            break
          }

          case MSG_TYPE.ARENA_READY:
          case 'ARENA_READY': {
            if (!ws.gameKey) return
            const pending = pendingStarts.get(ws.gameKey)
            if (pending && !pending.countdownStarted) {
              pending.readyClients.add(ws)
              if (pending.readyClients.size >= pending.expectedCount) {
                pending.launchCountdown()
              }
            }
            break
          }

          case MSG_TYPE.SET_INTERVAL:
          case 'setInterval': {
            if (!ws.gameKey || ws.playerIds.size === 0) return
            const game = gameServer.getGame(ws.gameKey)
            if (game) {
              game.setInterval(sanitizeInterval(payload))
              broadcastToRoom(ws.gameKey, {
                type: MSG_TYPE.GAME_INFO,
                payload: gameServer.getGameInfo(ws.gameKey),
              })
            }
            break
          }

          case MSG_TYPE.CHANGE_DIR:
          case 'changeDir': {
            if (!ws.gameKey) return
            const game = gameServer.getGame(ws.gameKey)
            if (game && payload) {
              const dir = sanitizeDir(payload.dir)
              const id = sanitizeString(payload.id, 16)
              if (dir && id) {
                game.changeDir({ id, dir })
              }
            }
            break
          }

          default:
            ws.send(
              JSON.stringify({
                type: MSG_TYPE.ERROR,
                payload: `Unknown message type: ${type}`,
              }),
            )
        }
      } catch (err) {
        console.error('Error handling WebSocket message:', err)
      }
    })

    ws.on('close', () => {
      if (ws.gameKey) {
        const game = gameServer.getGame(ws.gameKey)
        if (game && ws.playerIds.size > 0) {
          ws.playerIds.forEach((pid) => {
            game.disconnectPlayer(pid)
          })
          broadcastToRoom(ws.gameKey, {
            type: MSG_TYPE.GAME_INFO,
            payload: gameServer.getGameInfo(ws.gameKey),
          })
        }
      }
      ws.gameKey = null
      ws.playerIds.clear()
    })
  })
}
