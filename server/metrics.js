import client from '@prometheus-io/client'
import { gameServer } from './GameServer.js'

export const register = new client.Registry()

// Enable default Node.js runtime metrics (heap, event loop lag, CPU, handles)
client.collectDefaultMetrics({ register, prefix: 'nodejs_' })

// Custom Gauges
export const activeRoomsGauge = new client.Gauge({
  name: 'bitcycles_active_rooms',
  help: 'Number of active game rooms on the server',
  labelNames: ['visibility'],
  registers: [register],
  collect() {
    let pub = 0
    let priv = 0
    if (gameServer && Array.isArray(gameServer.games)) {
      for (const g of gameServer.games) {
        if (g.isPublic) pub++
        else priv++
      }
    }
    this.set({ visibility: 'public' }, pub)
    this.set({ visibility: 'private' }, priv)
  },
})

export const connectedPlayersGauge = new client.Gauge({
  name: 'bitcycles_connected_players',
  help: 'Total registered players in active game rooms',
  registers: [register],
  collect() {
    let total = 0
    if (gameServer && Array.isArray(gameServer.games)) {
      for (const g of gameServer.games) {
        total += g.arena?.players?.length || 0
      }
    }
    this.set(total)
  },
})

export const wsClientsGauge = new client.Gauge({
  name: 'bitcycles_ws_clients_active',
  help: 'Total active open WebSocket connections',
  registers: [register],
})

// Custom Counters
export const roundsPlayedCounter = new client.Counter({
  name: 'bitcycles_rounds_played_total',
  help: 'Cumulative count of finished match rounds',
  registers: [register],
})

export const crashesTotalCounter = new client.Counter({
  name: 'bitcycles_crashes_total',
  help: 'Cumulative count of lightcycle collisions and crashes',
  registers: [register],
})

export const wsMessagesSentCounter = new client.Counter({
  name: 'bitcycles_ws_messages_sent_total',
  help: 'Total outgoing WebSocket frames',
  labelNames: ['type'],
  registers: [register],
})

export const wsMessagesReceivedCounter = new client.Counter({
  name: 'bitcycles_ws_messages_received_total',
  help: 'Total incoming WebSocket frames',
  labelNames: ['type'],
  registers: [register],
})

// Summary for game loop tick duration
export const tickDurationSummary = new client.Summary({
  name: 'bitcycles_tick_duration_seconds',
  help: 'Duration of the 40 FPS game loop tick in seconds',
  percentiles: [0.5, 0.9, 0.99],
  registers: [register],
})

export const getMetrics = async () => {
  return await register.metrics()
}

export const getContentType = () => register.contentType

/**
 * Validates whether an incoming HTTP request is authorized to scrape /metrics.
 * Localhost (127.0.0.1, ::1) is always allowed.
 * Additional IPs can be specified via METRICS_ALLOWED_IPS (comma-separated).
 * Optional Bearer token can be specified via METRICS_TOKEN.
 */
export const isMetricsRequestAuthorized = (req) => {
  const configuredToken = process.env.METRICS_TOKEN
  if (configuredToken) {
    const authHeader = req?.headers ? req.headers['authorization'] : null
    const bearerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : null
    const customToken = req?.headers ? req.headers['x-metrics-token'] : null
    if (bearerToken === configuredToken || customToken === configuredToken) {
      return true
    }
  }

  const forwardedFor = req?.headers ? req.headers['x-forwarded-for'] : null
  const clientIp = (
    (typeof forwardedFor === 'string' ? forwardedFor.split(',')[0].trim() : null) ||
    (req?.headers ? req.headers['x-real-ip'] : null) ||
    req?.ip ||
    req?.socket?.remoteAddress ||
    ''
  ).replace(/^::ffff:/, '')

  if (
    clientIp === '127.0.0.1' ||
    clientIp === '::1' ||
    clientIp === 'localhost' ||
    clientIp === ''
  ) {
    return true
  }

  const allowedIpsStr = process.env.METRICS_ALLOWED_IPS
  if (allowedIpsStr) {
    const allowedIps = allowedIpsStr
      .split(',')
      .map((ip) => ip.trim().replace(/^::ffff:/, ''))
      .filter(Boolean)
    if (allowedIps.includes(clientIp)) {
      return true
    }
  }

  return false
}

