import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

// Room-scoped authority. Socket indexes and handles are only accelerators;
// every connection-originated operation checks owners again.
export class PlayerOwnership {
  constructor(roomKey) {
    this.roomKey = roomKey
    this.owners = new Map()
    this.verifiers = new Map()
  }

  register(id, socket) {
    const token = randomBytes(32).toString('base64url')
    this.verifiers.set(id, createHash('sha256').update(token).digest())
    this.owners.set(id, socket)
    socket.playerIds.add(id)
    return token
  }

  restore(verifiers, playerIds) {
    if (!verifiers || typeof verifiers !== 'object' || Array.isArray(verifiers))
      return
    for (const [id, digest] of Object.entries(verifiers)) {
      if (
        playerIds.has(id) &&
        typeof digest === 'string' &&
        /^[a-f0-9]{64}$/.test(digest)
      )
        this.verifiers.set(id, Buffer.from(digest, 'hex'))
    }
  }

  serializeVerifiers() {
    return Object.fromEntries(
      [...this.verifiers].map(([id, digest]) => [id, digest.toString('hex')]),
    )
  }

  remove(id, socket) {
    if (!this.release(id, socket)) return false
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
    )
      return false
    const expected = this.verifiers.get(id)
    const actual = createHash('sha256').update(token).digest()
    return Boolean(expected && timingSafeEqual(expected, actual))
  }

  transfer(id, socket) {
    const previous = this.owners.get(id)
    if (previous && previous !== socket) {
      previous.playerIds.delete(id)
      const handle = previous.handlesById.get(id)
      previous.handlesById.delete(id)
      if (handle !== undefined) previous.idsByHandle.delete(handle)
    }
    this.owners.set(id, socket)
    socket.playerIds.add(id)
    return previous
  }

  release(id, socket) {
    if (!this.owns(id, socket)) return false
    this.owners.delete(id)
    socket.playerIds.delete(id)
    const handle = socket.handlesById.get(id)
    socket.handlesById.delete(id)
    if (handle !== undefined) socket.idsByHandle.delete(handle)
    return true
  }

  clear() {
    for (const [id, socket] of this.owners) {
      socket.playerIds.delete(id)
      const handle = socket.handlesById.get(id)
      socket.handlesById.delete(id)
      if (handle !== undefined) socket.idsByHandle.delete(handle)
    }
    this.owners.clear()
    this.verifiers.clear()
  }
}
