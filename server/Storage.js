import fs from 'node:fs'
import path from 'node:path'

export const SNAPSHOT_VERSION = 1

// Reject an incomplete room before restoration; a broken record must not be
// treated as an empty registry and overwritten by the next save. Credential
// fields are intentionally omitted here so invalid verifiers fail per player.
const validRoomRecord = (record) =>
  record !== null &&
  typeof record === 'object' &&
  !Array.isArray(record) &&
  typeof record.key === 'string' &&
  record.key.length > 0 &&
  Array.isArray(record.players) &&
  record.players.every(
    (player) =>
      player && typeof player === 'object' && typeof player.id === 'string',
  ) &&
  record.stats !== null &&
  typeof record.stats === 'object' &&
  Array.isArray(record.stats.players) &&
  record.stats.players.every(
    (player) =>
      player && typeof player === 'object' && typeof player.id === 'string',
  ) &&
  Array.isArray(record.stats.messages) &&
  record.stats.messages.every(
    (message) =>
      message !== null &&
      typeof message === 'object' &&
      !Array.isArray(message),
  )

export class Storage {
  constructor() {
    this.dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data')
    this.filePath = path.join(this.dataDir, 'games.json')
    this.tempPath = path.join(this.dataDir, 'games.json.tmp')
    this.readOnly = false
    this.loadError = null
  }

  ensureDir() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true })
      }
      return true
    } catch (err) {
      console.error(
        `[Storage] Failed to create data directory ${this.dataDir}:`,
        err,
      )
      return false
    }
  }

  /**
   * Serializes active game sessions and writes an atomic JSON snapshot.
   * @param {Array<import('./GameSession.js').GameSession>} games
   */
  saveGames(games) {
    if (!Array.isArray(games) || this.readOnly) return false

    if (!this.ensureDir()) return false

    try {
      const serialized = games.map((game) => ({
        key: game.key,
        name: game.name,
        interval: game.interval,
        isPublic: game.isPublic,
        createdAt: game.createdAt,
        stats: {
          gamecount: game.stats.gamecount,
          players: game.stats.players.map((player) => ({
            id: player.id,
            name: player.name,
            kills: player.kills,
            killed: player.killed,
            escaped: player.escaped,
            lastScore: player.lastScore,
            total: player.total,
            connected: false,
          })),
          messages: game.stats.messages.map((message) => ({
            text: message.text,
            playerPre: message.playerPre,
            playerPost: message.playerPost,
          })),
        },
        players:
          game.arena?.players?.map((p) => ({
            id: p.id,
            name: p.name,
            color: p.color,
            left: p.left,
            right: p.right,
          })) || [],
        private: { verifiers: game.ownership.serializeVerifiers() },
        savedAt: Date.now(),
      }))

      const json = JSON.stringify(
        { version: SNAPSHOT_VERSION, games: serialized },
        null,
        2,
      )
      fs.writeFileSync(this.tempPath, json, 'utf8')
      fs.renameSync(this.tempPath, this.filePath)
      return true
    } catch {
      // Serialization failures must be reported to the registration caller
      // without quoting private verifier or token-bearing input.
      console.error('[Storage] Error writing atomic games snapshot.')
      return false
    }
  }

  /**
   * Loads persisted game snapshots from disk.
   * @returns {Array<object>} Array of serialized game records
   */
  loadGames() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return []
      }
      const data = fs.readFileSync(this.filePath, 'utf8')
      if (!data.trim()) {
        this.readOnly = true
        this.loadError = 'INVALID_SNAPSHOT'
        console.error(
          '[Storage] Empty games snapshot; original file preserved.',
        )
        return []
      }

      const parsed = JSON.parse(data)
      const records = Array.isArray(parsed)
        ? parsed.map((record) => ({ ...record, private: undefined }))
        : parsed?.version === SNAPSHOT_VERSION && Array.isArray(parsed.games)
          ? parsed.games
          : null
      // The versioned schema is the only format allowed to restore verifiers.
      if (records && records.every(validRoomRecord)) return records
      this.readOnly = true
      this.loadError =
        parsed?.version === SNAPSHOT_VERSION || Array.isArray(parsed)
          ? 'INVALID_SNAPSHOT'
          : 'UNSUPPORTED_SNAPSHOT_VERSION'
      console.error(
        '[Storage] Unsupported or malformed games snapshot; original file preserved.',
      )
      return []
    } catch {
      this.readOnly = true
      this.loadError = 'INVALID_SNAPSHOT'
      // Do not log parser input or parse errors, which may quote private data.
      console.error(
        '[Storage] Invalid games snapshot; original file preserved.',
      )
      return []
    }
  }
}

export const storage = new Storage()
