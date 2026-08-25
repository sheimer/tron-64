import { MSG_TYPE, BINARY_OPCODE } from '/shared/protocol.js'

class NetworkClient {
  constructor() {
    this.socket = null
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 25
    this.reconnectDelay = 1000
    this.windowClosing = false
    this.pingInterval = null
    this.listeners = new Map()

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

    this.socket = new WebSocket(url)
    this.socket.binaryType = 'arraybuffer'

    this.socket.addEventListener('open', () => {
      this.reconnectAttempts = 0
      this.startPing()
      this.emit('open')
    })

    this.socket.addEventListener('close', () => {
      this.stopPing()
      this.updateCQI(null)
      if (this.pingElement) {
        this.pingElement.textContent = 'disconnected'
      }
      if (!this.windowClosing) {
        this.emit('close')
      }

      if (!this.windowClosing && this.reconnectAttempts < this.maxReconnectAttempts) {
        setTimeout(() => {
          this.reconnectAttempts++
          this.connect()
        }, this.reconnectDelay)
      }
    })

    this.socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') {
        if (event.data instanceof ArrayBuffer) {
          const view = new DataView(event.data)
          if (view.byteLength > 0) {
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

        if (type === MSG_TYPE.PONG || type === 'pong') {
          const latency = Date.now() - (msg.t || 0)
          if (this.pingElement) {
            this.pingElement.textContent = `${latency}ms ping`
          }
          this.updateCQI(latency)
          this.emit('pong', latency)
          return
        }

        this.emit(type, msg.payload, msg)
      } catch (err) {
        console.error('Error parsing WebSocket message:', err)
      }
    })

    this.socket.addEventListener('error', (err) => {
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
    if (!this.isConnected()) {
      return false
    }
    const data = JSON.stringify({ type, payload, ...extra })
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

  joinGame(key, playerIds = []) {
    this.send(MSG_TYPE.JOIN_GAME, { key, playerIds })
  }

  leaveGame() {
    this.send(MSG_TYPE.LEAVE_GAME)
  }

  addPlayer(player) {
    this.send(MSG_TYPE.ADD_PLAYER, player)
  }

  startGame() {
    this.send(MSG_TYPE.START_GAME)
  }

  setInterval(interval) {
    this.send(MSG_TYPE.SET_INTERVAL, interval)
  }

  changeDir({ id, dir }) {
    if (!this.isConnected()) return false
    const numericId = Number(id)
    if (Number.isInteger(numericId) && numericId >= 0 && numericId <= 255) {
      const dirByte = dir === 'left' ? 0 : dir === 'right' ? 1 : 255
      if (dirByte !== 255) {
        const buf = new Uint8Array([BINARY_OPCODE.CHANGE_DIR, numericId, dirByte])
        this.socket.send(buf)
        return true
      }
    }
    return this.send(MSG_TYPE.CHANGE_DIR, { id, dir })
  }
}

export const network = new NetworkClient()
