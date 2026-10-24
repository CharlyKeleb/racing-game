import { MultiplayerMetrics, type MetricsOptions } from './MultiplayerMetrics.js'
import { createServer } from 'node:http'
import express from 'express'
import { rateLimit, ipKeyGenerator } from 'express-rate-limit'
import { Server, matchMaker } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { AdmissionError, type Authenticate } from './auth.js'
import { activePlayers, LobbyRoom, lobbyDirectory } from './LobbyRoom.js'
import type { ResultPersistenceService } from './ResultOutbox.js'
import type { RaceFactory } from './RaceSession.js'
import { isLobbyCar, LOBBY_PROTOCOL } from './protocol.js'

export interface ShutdownReport { abortedRaces: number; pendingResultWrites: number }
export interface BackendOptions { authenticate: Authenticate; origins: string[]; maxRooms?: number; raceFactory?: RaceFactory; resultPersistence?: ResultPersistenceService; metrics?: MetricsOptions }
export function createBackend(options: BackendOptions) {
  const origins = new Set(options.origins)
  if (!origins.size || origins.has('*')) throw new Error('Set explicit allowed frontend origins.')
  const app = express()
  const http = createServer(app)
  let draining = false
  let creating = 0
  let shutdownPromise: Promise<ShutdownReport> | undefined
  const admissionClaims = new Map<string, { lease: symbol; timer?: ReturnType<typeof setTimeout> }>()
  const metrics = options.metrics ? new MultiplayerMetrics() : undefined
  const metricInterval = options.metrics?.intervalMs ?? 60_000
  if (options.metrics && (!Number.isInteger(metricInterval) || metricInterval < 1000 || metricInterval > 300_000)) throw new Error('Metrics interval must be between one and three hundred seconds')
  const pendingWrites = new Set<Promise<void>>()
  const writer = options.resultPersistence
  const trackedWriter: ResultPersistenceService | undefined = writer && {
    get available() { return writer.available },
    enqueue(record, notify) {
      const pending = Promise.resolve().then(() => writer.enqueue(record, notify))
      pendingWrites.add(pending)
      void pending.finally(() => pendingWrites.delete(pending)).catch(() => {})
      return pending
    },
  }
  const rejectDraining = () => { if (draining) throw new AdmissionError(503, 'Server is restarting. Try again shortly.') }
  const drain = () => {
    if (draining) return
    draining = true
    for (const room of lobbyDirectory.values()) room.beginDrain()
  }
  app.disable('x-powered-by')
  app.get('/healthz', (_req, res) => res.json({ ok: true, protocol: LOBBY_PROTOCOL }))
  app.get('/readyz', (_req, res) => res.status(draining ? 503 : 200).json({ ready: !draining }))
  app.use((req, res, next) => {
    const origin = req.get('origin')
    if (origin && !origins.has(origin)) { res.status(403).json({ error: 'This game origin is not allowed.' }); return }
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    if (req.method === 'OPTIONS') { res.sendStatus(204); return }
    next()
  })
  app.use(express.json({ limit: '2kb' }))
  app.use('/rooms', rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator((process.env.FLY_APP_NAME ? req.get('fly-client-ip') : undefined) || req.ip || 'unknown'),
    handler: (_req, res) => { metrics?.count('admission_rate_limited'); res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' }) },
  }))
  // Never accept arbitrary profile UUIDs/handles from the client.
  LobbyRoom.authenticate = options.authenticate
  const transport = new WebSocketTransport({ server: http, maxPayload: 10_240, pingInterval: options.raceFactory ? 1000 : 6000, pingMaxRetries: 3,
    beforeUpgrade: (request) => {
      const origin = request.headers.get('origin')
      if (origin && !origins.has(origin)) return new Response(null, { status: 403 })
      // New reservations are stopped; a held seat can still recover under its original deadline.
      if (draining && !new URL(request.url).searchParams.has('reconnectionToken')) return new Response(null, { status: 503 })
    },
  })
  const gameServer = new Server({ transport, greet: false, gracefullyShutdown: false })
  gameServer.define('private_lobby', LobbyRoom, { raceFactory: options.raceFactory, resultPersistence: trackedWriter, isDraining: () => draining, metrics })
  app.post('/rooms', async (req, res) => {
    let playerId: string | null = null
    let lease: symbol | undefined
    let created: LobbyRoom | undefined
    try {
      rejectDraining()
      if (req.body?.protocol !== LOBBY_PROTOCOL) throw new AdmissionError(409, 'Refresh the game to use this multiplayer server.')
      if (!isLobbyCar(req.body.carId) || !['create', 'join'].includes(req.body.action)) throw new AdmissionError(400, 'Choose a valid car and room action.')
      const token = req.get('authorization')?.match(/^Bearer (.+)$/)?.[1]
      if (!token) throw new AdmissionError(401, 'Sign in to join online.')
      const racer = await options.authenticate(token)
      rejectDraining()
      playerId = racer.id
      if (activePlayers.has(playerId)) throw new AdmissionError(409, 'You already have a lobby open. Leave it before joining another.')
      // Claimed before any await: simultaneous admissions cannot create duplicate seats.
      lease = Symbol(playerId)
      activePlayers.set(playerId, lease)
      const claim = { lease, timer: undefined as ReturnType<typeof setTimeout> | undefined }
      admissionClaims.set(playerId, claim)
      let cache: Awaited<ReturnType<typeof matchMaker.createRoom>>
      if (req.body.action === 'create') {
        if (lobbyDirectory.size + creating >= (options.maxRooms ?? 100)) throw new AdmissionError(503, 'All lobbies are busy. Try again shortly.')
        creating++
        try { cache = await matchMaker.createRoom('private_lobby', {}) } finally { creating-- }
        created = [...lobbyDirectory.values()].find((room) => room.roomId === cache.roomId)
      } else {
        const code = typeof req.body.code === 'string' ? req.body.code.trim().toUpperCase() : ''
        if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) throw new AdmissionError(400, 'Enter the 8-character room code.')
        const room = lobbyDirectory.get(code)
        if (room && room.snapshot().phase !== 'lobby') throw new AdmissionError(409, 'This race has already started. Wait for the next lobby.')
        if (!room) throw new AdmissionError(404, 'Room not found or full. Check the code with your host.')
        cache = await matchMaker.getRoomById(room.roomId)
      }
      rejectDraining()
      // Trusted auth data stays in memory; the HTTP response contains a short-lived seat, never the JWT.
      const seat = await matchMaker.reserveSeatFor(cache, { carId: req.body.carId }, racer)
      rejectDraining()
      claim.timer = setTimeout(() => {
        const connected = [...lobbyDirectory.values()].some((room) => [...room.racers.values()].some((r) => r.id === racer.id))
        if (!connected && activePlayers.get(racer.id) === lease) activePlayers.delete(racer.id)
        if (admissionClaims.get(racer.id) === claim) admissionClaims.delete(racer.id)
      }, 16_000)
      claim.timer.unref()
      metrics?.count('admission_ok')
      res.json(seat)
    } catch (error) {
      metrics?.count('admission_rejected')
      if (lease && playerId) {
        if (activePlayers.get(playerId) === lease) activePlayers.delete(playerId)
        if (admissionClaims.get(playerId)?.lease === lease) admissionClaims.delete(playerId)
      }
      if (created && created.racers.size === 0) void created.disconnect()
      const status = error instanceof AdmissionError ? error.status : 503
      res.status(status).json({ error: error instanceof AdmissionError ? error.message : 'Could not join the room. It may be full; try again.' })
    }
  })
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }))
  app.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status === 413 ? 413 : 400).json({ error: 'Invalid request.' })
  })
  const getMetrics = () => {
    if (!metrics) return null
    let racers = 0, heldSeats = 0, activeRaces = 0
    for (const room of lobbyDirectory.values()) {
      racers += room.racers.size
      if (room.hasActiveRace()) activeRaces++
      for (const racer of room.racers.values()) if (racer.connected === false) heldSeats++
    }
    const memory = process.memoryUsage()
    return metrics.snapshot({ rooms: lobbyDirectory.size, racers, heldSeats, activeRaces,
      admissionClaims: admissionClaims.size, pendingResultWrites: pendingWrites.size,
      rssMiB: memory.rss / 1024 / 1024, heapUsedMiB: memory.heapUsed / 1024 / 1024 })
  }
  const reportMetrics = () => {
    const report = getMetrics()
    // Diagnostics must never affect simulation, admission or shutdown correctness.
    if (report) try { options.metrics!.report(report) } catch { /* reporter is non-authoritative */ }
  }
  const metricsTimer = metrics ? setInterval(reportMetrics, metricInterval) : undefined
  metricsTimer?.unref()
  gameServer.onShutdown(() => { clearInterval(metricsTimer); reportMetrics() })
  const shutdown = (graceMs = 15_000): Promise<ShutdownReport> => {
    if (!Number.isFinite(graceMs) || graceMs < 0 || graceMs > 60_000) throw new Error('Shutdown grace must be between zero and sixty seconds')
    if (shutdownPromise) return shutdownPromise
    drain()
    shutdownPromise = (async () => {
      const deadline = Date.now() + graceMs
      while (Date.now() < deadline && ([...lobbyDirectory.values()].some(room => room.hasActiveRace()) || pendingWrites.size)) {
        await new Promise(resolve => setTimeout(resolve, Math.min(25, Math.max(0, deadline - Date.now()))))
      }
      const abortedRaces = [...lobbyDirectory.values()].filter(room => room.hasActiveRace()).length
      await gameServer.gracefullyShutdown(false)
      for (const [id, claim] of admissionClaims) {
        clearTimeout(claim.timer)
        if (activePlayers.get(id) === claim.lease) activePlayers.delete(id)
      }
      admissionClaims.clear()
      return { abortedRaces, pendingResultWrites: pendingWrites.size }
    })()
    return shutdownPromise
  }
  return { gameServer, drain, shutdown, getMetrics, listen: (port: number, host = '0.0.0.0') => gameServer.listen(port, host) }
}
