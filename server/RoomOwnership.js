import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import WebSocket from 'ws'

// A room role belongs to a logical creator client, independently of bike owners.
export class RoomOwnership {
  constructor(roomKey, saved) {
    this.roomKey = roomKey
    this.clientId = null
    this.verifier = null
    this.socket = null
    if (
      typeof saved?.ownerClientId === 'string' &&
      /^[a-f0-9]{32}$/.test(saved.ownerClientId) &&
      typeof saved.verifier === 'string' &&
      /^[a-f0-9]{64}$/.test(saved.verifier)
    ) {
      this.clientId = saved.ownerClientId
      this.verifier = Buffer.from(saved.verifier, 'hex')
    }
  }

  create() {
    this.clientId = randomBytes(16).toString('hex')
    const roomOwnerToken = randomBytes(32).toString('base64url')
    this.verifier = createHash('sha256').update(roomOwnerToken).digest()
    return { ownerClientId: this.clientId, roomOwnerToken }
  }

  verify(claim) {
    if (
      !this.verifier ||
      claim?.ownerClientId !== this.clientId ||
      typeof claim.roomOwnerToken !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(claim.roomOwnerToken)
    ) {
      return false
    }
    return timingSafeEqual(
      this.verifier,
      createHash('sha256').update(claim.roomOwnerToken).digest(),
    )
  }

  owns(socket) {
    return Boolean(
      socket &&
      this.socket === socket &&
      socket.readyState === WebSocket.OPEN &&
      socket.gameKey === this.roomKey,
    )
  }

  bind(socket) {
    const previous = this.socket
    this.socket = socket
    return previous
  }

  release(socket) {
    if (this.socket !== socket) {
      return false
    }
    this.socket = null
    return true
  }

  get status() {
    return !this.verifier
      ? 'unrecoverable'
      : this.owns(this.socket)
        ? 'present'
        : 'away'
  }

  serialize() {
    return this.verifier
      ? {
          ownerClientId: this.clientId,
          verifier: this.verifier.toString('hex'),
        }
      : null
  }

  clear() {
    this.socket = null
    this.clientId = null
    this.verifier = null
  }
}
