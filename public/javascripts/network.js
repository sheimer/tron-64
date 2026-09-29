import { MSG_TYPE, BINARY_OPCODE, PROTOCOL_VERSION } from '/shared/protocol.js'

class NetworkClient {
  constructor() {
    this.socket = null
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 25
    this.reconnectDelay = 1000
    this.windowClosing = false
    this.pingInterval = null
    this.listeners = new Map()
    this.inputHandles = new Map()
    this.generation = 0
    this.protocolReady = false

    this.pingElement = document.getElementById('ping')
    this.cqiElement = document.getElementById('cqi')

    if (this.pingElement) {
      this.pingElement.textContent = 'connecting...'
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.windowClosing = true
      })
      this.connect()
    }
  }

  connect() {
    const { protocol, hostname, port } = window.location
    const wsProto = protocol.startsWith('https') ? 'wss' : 'ws'
    const portStr = port ? `:${port}` : ''
    const url = `${wsProto}://${hostname}${portStr}/ws`

    const socket = new WebSocket(url)
    this.socket = socket
    this.generation++
    this.protocolReady = false
    socket.binaryType = 'arraybuffer'

    socket.addEventListener('open', () => {
      if (socket !== this.socket) return
      this.reconnectAttempts = 0
    })

    socket.addEventListener('close', () => {
      if (socket !== this.socket) {
        if (socket === this.previousSocket) {
          this.previousSocket = null
          this.previousHandles?.clear()
          this.emit('previous-close')
        }
        return
      }
      if (this.abortFreshConnection()) {
        this.emit(
          'fresh-recovery-failed',
          'Fresh connection closed. Existing player controls remain active.',
        )
        return
      }
      this.completeFreshConnection()
      this.inputHandles.clear()
      this.protocolReady = false
      this.stopPing()
      this.updateCQI(null)
      if (this.pingElement) {
        this.pingElement.textContent = 'disconnected'
      }
      if (!this.windowClosing) {
        this.emit('close')
      }

      if (
        !this.windowClosing &&
        this.reconnectAttempts < this.maxReconnectAttempts
      ) {
        setTimeout(() => {
          this.reconnectAttempts++
          this.connect()
        }, this.reconnectDelay)
      }
    })

    socket.addEventListener('message', (event) => {
      if (socket !== this.socket) {
        if (socket === this.previousSocket && typeof event.data === 'string') {
          try {
            const notice = JSON.parse(event.data)
            if (
              notice.type === MSG_TYPE.OWNERSHIP_REVOKED &&
              notice.protocolVersion === PROTOCOL_VERSION
            ) {
              this.revokePlayers(notice.payload?.ids || [])
              this.emit(MSG_TYPE.OWNERSHIP_REVOKED, notice.payload, notice)
            }
          } catch {
            // No raw private frames or parse exceptions in logs.
          }
        }
        return
      }
      if (typeof event.data !== 'string') {
        if (this.protocolReady && event.data instanceof ArrayBuffer) {
          const view = new DataView(event.data)
          if (view.byteLength > 1 && (view.byteLength - 1) % 5 === 0) {
            const opcode = view.getUint8(0)
            if (opcode === BINARY_OPCODE.DRAW) {
              this.emit(MSG_TYPE.GAME_DRAW, view)
            }
          }
        }
        return
      }

      try {
        const msg = JSON.parse(event.data)
        const type = msg.type || msg.action

        if (!this.protocolReady) {
          if (
            type !== MSG_TYPE.LOBBY_LIST ||
            msg.protocolVersion !== PROTOCOL_VERSION
          ) {
            this.windowClosing = true
            this.emit(
              MSG_TYPE.ERROR,
              'Game protocol changed. Reload this page to continue.',
              { code: 'PROTOCOL_MISMATCH' },
            )
            socket.close()
            return
          }
          this.protocolReady = true
          this.startPing()
          this.emit('open')
        }

        if (
          msg.protocolVersion !== undefined &&
          msg.protocolVersion !== PROTOCOL_VERSION
        ) {
          this.emit(
            MSG_TYPE.ERROR,
            'Game protocol changed. Reload the page to continue.',
            { code: 'PROTOCOL_MISMATCH' },
          )
          return
        }

        // Drawing deltas are binary-only. A legacy JSON type or action
        // cannot reach the renderer, even inside another control envelope.
        if (
          msg.type === MSG_TYPE.GAME_DRAW ||
          msg.action === MSG_TYPE.GAME_DRAW
        )
          return

        if (type === MSG_TYPE.PONG || type === 'pong') {
          const latency = Date.now() - (msg.t || 0)
          if (this.pingElement) {
            this.pingElement.textContent = `${latency}ms ping`
          }
          this.updateCQI(latency)
          this.emit('pong', latency)
          return
        }

        if (
          type === MSG_TYPE.PLAYER_REGISTERED &&
          msg.protocolVersion !== PROTOCOL_VERSION
        ) {
          this.emit(
            MSG_TYPE.ERROR,
            'Game protocol changed. Reload the page to continue.',
            { code: 'PROTOCOL_MISMATCH' },
          )
          return
        }
        this.emit(type, msg.payload, msg)
      } catch {
        // The server can return credential-bearing private frames. Avoid
        // logging parse exceptions that quote raw response contents.
        this.emit(MSG_TYPE.ERROR, 'Invalid server message.', {
          code: 'INVALID_MESSAGE',
        })
      }
    })

    socket.addEventListener('error', (err) => {
      if (socket !== this.socket) return
      this.emit('error', err)
    })
  }

  updateCQI(latency) {
    if (!this.cqiElement) {
      this.cqiElement = document.getElementById('cqi')
    }
    if (!this.cqiElement) return

    this.cqiElement.className = ''
    if (latency === null || typeof latency === 'undefined') {
      this.cqiElement.title = 'Disconnected'
    } else if (latency < 60) {
      this.cqiElement.classList.add('optimal')
      this.cqiElement.title = `Connection: Optimal (${latency}ms)`
    } else if (latency <= 120) {
      this.cqiElement.classList.add('moderate')
      this.cqiElement.title = `Connection: Moderate (${latency}ms)`
    } else {
      this.cqiElement.classList.add('poor')
      this.cqiElement.title = `Connection: High Latency (${latency}ms)`
    }
  }

  startPing() {
    this.stopPing()
    this.sendPing()
    this.pingInterval = setInterval(() => {
      this.sendPing()
    }, 1000)
  }

  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }

  sendPing() {
    if (this.isConnected()) {
      this.send(MSG_TYPE.PING, null, { t: Date.now() })
    } else if (this.pingElement) {
      this.pingElement.textContent = 'disconnected'
    }
  }

  isConnected() {
    return this.socket?.readyState === WebSocket.OPEN
  }

  send(type, payload = null, extra = {}) {
    if (!this.isConnected() || !this.protocolReady) {
      return false
    }
    const data = JSON.stringify({
      type,
      payload,
      protocolVersion: PROTOCOL_VERSION,
      ...extra,
    })
    this.socket.send(data)
    return true
  }

  on(type, callback) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type).add(callback)
    return () => this.off(type, callback)
  }

  off(type, callback) {
    if (this.listeners.has(type)) {
      this.listeners.get(type).delete(callback)
    }
  }

  emit(type, ...args) {
    if (this.listeners.has(type)) {
      this.listeners.get(type).forEach((cb) => {
        try {
          cb(...args)
        } catch (err) {
          console.error(`Error in listener for message type ${type}:`, err)
        }
      })
    }
  }

  // High-level Actions
  requestLobbyList() {
    this.send(MSG_TYPE.LOBBY_LIST)
  }

  createGame({ name, size, interval, isPublic = true }) {
    this.send(MSG_TYPE.CREATE_GAME, { name, size, interval, isPublic })
  }

  joinGame(key, reconnect = [], requestId) {
    this.inputHandles.clear()
    this.send(
      MSG_TYPE.JOIN_GAME,
      { key, reconnect, requireAll: Boolean(this.previousSocket) },
      { requestId },
    )
  }

  revokePlayers(ids) {
    for (const id of ids) {
      this.inputHandles.delete(id)
      this.previousHandles?.delete(id)
    }
  }

  openFreshConnection() {
    if (!this.isConnected() || this.previousSocket) return false
    const previous = this.socket
    this.previousHandles = new Map(this.inputHandles)
    this.inputHandles.clear()
    this.connect()
    this.previousSocket = previous
    return true
  }

  abortFreshConnection() {
    if (
      !this.previousSocket ||
      this.previousSocket.readyState !== WebSocket.OPEN
    )
      return false
    const replacement = this.socket
    this.stopPing()
    this.socket = this.previousSocket
    this.previousSocket = null
    this.inputHandles = this.previousHandles
    this.previousHandles = null
    this.protocolReady = true
    this.generation++
    replacement.close()
    this.startPing()
    return true
  }

  completeFreshConnection() {
    const previous = this.previousSocket
    this.previousSocket = null
    this.previousHandles = null
    previous?.close()
  }

  leaveGame() {
    this.completeFreshConnection()
    this.inputHandles.clear()
    this.send(MSG_TYPE.LEAVE_GAME)
  }

  addPlayer(player, requestId) {
    return this.send(MSG_TYPE.ADD_PLAYER, player, { requestId })
  }

  bindPlayer(id, inputHandle) {
    if (
      typeof id !== 'string' ||
      !Number.isInteger(inputHandle) ||
      inputHandle < 0 ||
      inputHandle > 255
    )
      return false
    this.inputHandles.set(id, inputHandle)
    return true
  }

  startGame() {
    this.send(MSG_TYPE.START_GAME)
  }

  setInterval(interval) {
    this.send(MSG_TYPE.SET_INTERVAL, interval)
  }

  changeDir({ id, dir }) {
    if (!this.isConnected() || !this.protocolReady) return false
    const inputHandle = this.inputHandles.get(id)
    if (inputHandle === undefined || (dir !== 'left' && dir !== 'right'))
      return false
    this.socket.send(
      new Uint8Array([
        BINARY_OPCODE.CHANGE_DIR,
        inputHandle,
        dir === 'left' ? 0 : 1,
      ]),
    )
    return true
  }
}

export const network = new NetworkClient()
