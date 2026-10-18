import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

// Room-scoped authority. Socket indexes and handles are only accelerators;
// every connection-originated operation checks owners again.
export class PlayerOwnership {
  constructor(roomKey, room = null) {
    this.room = room
    this.roomKey = roomKey
    this.owners = new Map()
    this.verifiers = new Map()
  }

  hasSocketIndexes(socket) {
    return (
      socket.gameKey === this.roomKey &&
      (!this.room || !socket.gameSession || socket.gameSession === this.room)
    )
  }

  register(id, socket) {
    const token = randomBytes(32).toString('base64url')
    this.verifiers.set(id, createHash('sha256').update(token).digest())
    this.owners.set(id, socket)
    return token
  }

  restore(verifiers, playerIds) {
    if (
      !verifiers ||
      typeof verifiers !== 'object' ||
      Array.isArray(verifiers)
    ) {
      return
    }
    for (const [id, digest] of Object.entries(verifiers)) {
      if (
        playerIds.has(id) &&
        typeof digest === 'string' &&
        /^[a-f0-9]{64}$/.test(digest)
      ) {
        this.verifiers.set(id, Buffer.from(digest, 'hex'))
      }
    }
  }

  serializeVerifiers() {
    return Object.fromEntries(
      [...this.verifiers].map(([id, digest]) => [id, digest.toString('hex')]),
    )
  }

  remove(id, socket) {
    if (!this.release(id, socket)) {
      return false
    }
    this.verifiers.delete(id)
    return true
  }

  owns(id, socket) {
    return this.owners.get(id) === socket && socket.gameKey === this.roomKey
  }

  verify(id, token) {
    if (
      typeof id !== 'string' ||
      typeof token !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(token)
    ) {
      return false
    }
    const expected = this.verifiers.get(id)
    const actual = createHash('sha256').update(token).digest()
    return Boolean(expected && timingSafeEqual(expected, actual))
  }

  transfer(id, socket) {
    const previous = this.owners.get(id)
    if (previous && previous !== socket && this.hasSocketIndexes(previous)) {
      const handle = previous.handlesById.get(id)
      previous.handlesById.delete(id)
      if (handle !== undefined) {
        previous.idsByHandle.delete(handle)
      }
    }
    this.owners.set(id, socket)
    return previous
  }

  release(id, socket) {
    // Releasing authority uses the actual owner, even if its routing index is
    // stale. Indexes for a different current room must remain untouched.
    if (this.owners.get(id) !== socket) {
      return false
    }
    this.owners.delete(id)
    if (this.hasSocketIndexes(socket)) {
      const handle = socket.handlesById.get(id)
      socket.handlesById.delete(id)
      if (handle !== undefined) {
        socket.idsByHandle.delete(handle)
      }
    }
    return true
  }

  clear() {
    for (const [id, socket] of this.owners) {
      this.release(id, socket)
    }
    this.verifiers.clear()
  }
}
