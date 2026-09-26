import { createHash, randomBytes } from 'node:crypto'

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

  owns(id, socket) {
    return this.owners.get(id) === socket && socket.gameKey === this.roomKey
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
