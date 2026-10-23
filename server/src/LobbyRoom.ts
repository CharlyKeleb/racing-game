import { resultRecord } from './ResultRecord.js'
import type { ResultPersistenceService } from './ResultOutbox.js'
import { randomInt } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { RaceSession, SERVER_TICK_MS, type RaceFactory } from './RaceSession.js'
import { Room, ServerError, type Client } from '@colyseus/core'
import type { Authenticate, VerifiedRacer } from './auth.js'
import { isLobbyCar, LOBBY_PROTOCOL, type LobbyRacer, type LobbySnapshot, type ResultPersistence } from './protocol.js'

export const RECONNECT_GRACE_SECONDS = 15
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const lobbyDirectory = new Map<string, LobbyRoom>()
/** Single process ownership: one player can hold only one admitted seat. */
export const activePlayers = new Map<string, symbol>()
export function generateCode(): string {
  let code: string
  do { code = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('') } while (lobbyDirectory.has(code))
  return code
}
export class LobbyRoom extends Room {
  static authenticate: Authenticate
  racers = new Map<string, LobbyRacer>()
  code = ''
  hostId = ''
  laps = 3
  private raceFactory?: RaceFactory
  private resultWriter?: ResultPersistenceService
  private resultPersistence?: ResultPersistence
  private disposed = false
  private race: RaceSession | null = null
  private raceRacers: LobbyRacer[] | undefined
  private lastSnapshotTick = 0
  private readonly controlRates = new Map<string, { at: number; count: number }>()
  private readonly refreshing = new Map<string, Client>()
  private readonly leases = new Map<string, { expiresAt: number; recoverUntil: number | null }>()
  private readonly recoveries = new Map<string, ReturnType<Room['allowReconnection']>>()
  private expiry = new Map<string, ReturnType<typeof setTimeout>>()
  /** All HTTP SDK matchmake methods are denied. Only our verified /rooms endpoint reserves seats. */
  static async onAuth(): Promise<never> { throw new ServerError(403, 'Use private room admission.') }
  onCreate(options: { raceFactory?: RaceFactory; resultPersistence?: ResultPersistenceService } = {}) {
    this.raceFactory = options.raceFactory
    this.resultWriter = options.resultPersistence
    this.maxClients = 4
    this.maxMessagesPerSecond = this.raceFactory ? 80 : 10
    if (this.raceFactory) this.setSimulationInterval((dt) => this.advanceRace(dt), SERVER_TICK_MS)
    this.seatReservationTimeout = 15
    void this.setPrivate(true)
    this.code = generateCode()
    lobbyDirectory.set(this.code, this)
    this.clock.setTimeout(() => { this.broadcast('notice', 'This lobby expired. Create another to continue.'); void this.disconnect() }, 30 * 60_000)
    this.control('sync', (client) => {
      client.send('lobby', this.snapshot())
      const snapshot = this.race?.snapshot()
      if (snapshot) client.send('race', snapshot)
    })
    this.control('start', (client) => this.startRace(client))
    this.control('loaded', (client, value: unknown) => {
      if (this.race?.acknowledge(client.sessionId, value)) this.publish()
    })
    this.onMessage('input', (client, value: unknown) => { if (this.racers.get(client.sessionId)?.connected !== false) this.race?.input(client.sessionId, value, performance.now()) })
    this.control('cancelRace', (client) => {
      if (this.racers.get(client.sessionId)?.id === this.hostId && this.race && ['loading', 'countdown'].includes(this.race.phase)) {
        this.race.close('The host cancelled race loading.'); this.finishRace()
      }
    })
    this.control('returnLobby', (client) => {
      if (this.racers.get(client.sessionId)?.id === this.hostId && this.race?.phase === 'finished') {
        this.race.close(''); this.finishRace()
      }
    })
    this.control('ready', (client, value: unknown) => {
      const racer = this.racers.get(client.sessionId)
      if (!this.race && racer && typeof value === 'boolean') { racer.ready = value; this.publish() }
    })
    this.control('car', (client, value: unknown) => {
      const racer = this.racers.get(client.sessionId)
      if (!this.race && racer && isLobbyCar(value)) { racer.carId = value; racer.ready = false; this.publish() }
    })
    this.control('laps', (client, value: unknown) => {
      const racer = this.racers.get(client.sessionId)
      if (!this.race && racer?.id === this.hostId && Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 10) {
        this.laps = Number(value)
        for (const player of this.racers.values()) player.ready = false
        this.publish()
      }
    })
    this.control('refresh', async (client, token: unknown) => {
      if (this.refreshing.get(client.sessionId) === client) return
      this.refreshing.set(client.sessionId, client)
      try {
        if (typeof token !== 'string') throw new Error('Invalid session')
        const verified = await LobbyRoom.authenticate(token)
        if (verified.expiresAt <= Date.now() || !this.clients.includes(client) || verified.id !== this.racers.get(client.sessionId)?.id) throw new Error('Invalid session')
        const lease = this.leases.get(client.sessionId)
        if (!lease || (lease.recoverUntil !== null && Date.now() >= Math.min(lease.recoverUntil, lease.expiresAt))) throw new Error('Recovery expired')
        const recovering = this.racers.get(client.sessionId)!.connected === false
        lease.expiresAt = verified.expiresAt
        lease.recoverUntil = null
        this.racers.get(client.sessionId)!.connected = true
        if (recovering) this.race?.setConnected(client.sessionId, true)
        this.armExpiry(client.sessionId)
        client.send('refreshed')
        if (recovering) {
          this.publish()
          client.send('lobby', this.snapshot())
          const frame = this.race?.snapshot()
          if (frame) client.send('race', frame)
          client.send('resumed', { raceId: this.race?.descriptor.id ?? null, nextInputSequence: this.race?.nextInputSequence(client.sessionId) ?? 0 })
        }
      } catch { if (this.clients.includes(client)) client.leave(4001, 'Sign in again to continue.') }
      finally { if (this.refreshing.get(client.sessionId) === client) this.refreshing.delete(client.sessionId) }
    })
  }
  onJoin(client: Client, options: { carId?: unknown }) {
    if (this.race) throw new ServerError(409, 'This race has already started.')
    const racer = client.auth as VerifiedRacer | undefined
    if (!racer || racer.expiresAt <= Date.now() || [...this.racers.values()].some((r) => r.id === racer.id)) throw new ServerError(403, 'Invalid or duplicate racer session.')
    this.racers.set(client.sessionId, { sessionId: client.sessionId, id: racer.id, handle: racer.handle, displayName: racer.displayName, carId: isLobbyCar(options.carId) ? options.carId : 'porsche911', ready: false, connected: true })
    if (!this.hostId) this.hostId = racer.id
    this.leases.set(client.sessionId, { expiresAt: racer.expiresAt, recoverUntil: null })
    this.armExpiry(client.sessionId)
    this.publish()
  }
  onDrop(client: Client, code?: number): void {
    const racer = this.racers.get(client.sessionId), lease = this.leases.get(client.sessionId)
    // Production lobby-only rooms keep their existing immediate-leave policy.
    if (!this.raceFactory || !racer || !lease || ![1001, 1005, 1006, 4010].includes(code ?? 1006) || lease.expiresAt <= Date.now()) return
    lease.recoverUntil ??= Date.now() + RECONNECT_GRACE_SECONDS * 1000
    if (lease.recoverUntil <= Date.now()) return
    racer.connected = false
    this.controlRates.delete(client.sessionId)
    if (!this.race) racer.ready = false
    this.race?.setConnected(client.sessionId, false)
    const recovery = this.allowReconnection(client, Math.min(lease.expiresAt, lease.recoverUntil) / 1000 - Date.now() / 1000)
    this.recoveries.set(client.sessionId, recovery)
    void recovery.then(() => this.recoveries.delete(client.sessionId), () => this.recoveries.delete(client.sessionId))
    this.armExpiry(client.sessionId)
    this.publish()
  }
  onReconnect(client: Client): void {
    const lease = this.leases.get(client.sessionId), racer = this.racers.get(client.sessionId)
    if (!lease || !racer || lease.recoverUntil === null || Date.now() >= Math.min(lease.expiresAt, lease.recoverUntil)) throw new ServerError(4001, 'Your session expired. Rejoin the lobby.')
    // The seat secret restores only the socket. Fresh verified Auth restores controls.
    this.armExpiry(client.sessionId)
  }
  onLeave(client: Client, code?: number) {
    const racer = this.racers.get(client.sessionId)
    if (!racer) return
    const authExpired = (this.leases.get(client.sessionId)?.expiresAt ?? Infinity) <= Date.now()
    activePlayers.delete(racer.id)
    this.racers.delete(client.sessionId)
    this.controlRates.delete(client.sessionId)
    this.leases.delete(client.sessionId)
    this.refreshing.delete(client.sessionId)
    this.recoveries.delete(client.sessionId)
    if (this.race) {
      const wasFinished = this.race.phase === 'finished'
      const reason = code === 4001 || authExpired ? 'auth-expired' : code === 4000 ? 'left' : 'connection-lost'
      if (!this.race.retire(client.sessionId, reason)) {
        this.race.close('A racer left before the start. Return to the lobby to prepare another race.'); this.finishRace()
      } else if (!wasFinished && this.race.phase === 'finished') {
        this.persistResult(this.race)
        this.broadcast('race', this.race.snapshot())
      }
    }
    clearTimeout(this.expiry.get(client.sessionId))
    this.expiry.delete(client.sessionId)
    if (racer.id === this.hostId) this.hostId = this.racers.values().next().value?.id ?? ''
    this.publish()
  }
  onDispose() {
    this.disposed = true
    this.race?.close('The room closed.')
    this.race = null
    this.controlRates.clear()
    this.leases.clear()
    this.refreshing.clear()
    this.recoveries.clear()
    lobbyDirectory.delete(this.code)
    for (const racer of this.racers.values()) activePlayers.delete(racer.id)
    for (const timer of this.expiry.values()) clearTimeout(timer)
  }
  private armExpiry(sessionId: string): void {
    clearTimeout(this.expiry.get(sessionId))
    const lease = this.leases.get(sessionId)
    if (!lease) return
    const due = Math.min(lease.expiresAt, lease.recoverUntil ?? Infinity)
    this.expiry.set(sessionId, setTimeout(() => {
      this.recoveries.get(sessionId)?.reject(false)
      this.clients.find(c => c.sessionId === sessionId)?.leave(4001, 'Your session expired. Rejoin the lobby.')
    }, Math.max(0, Math.min(due - Date.now(), 2_147_483_647))))
  }
  snapshot(): LobbySnapshot {
    return { protocol: LOBBY_PROTOCOL, code: this.code, hostId: this.hostId, racers: [...this.racers.values()].map((r) => ({ ...r })), maxPlayers: 4, track: 'nurburgring', laps: this.laps, phase: this.race && this.race.phase !== 'closed' ? this.race.phase : 'lobby', raceEnabled: !!this.raceFactory, ...(this.raceFactory ? { reconnectGraceSeconds: RECONNECT_GRACE_SECONDS } : {}), race: this.race?.descriptor ?? null, raceRacers: this.raceRacers, resultPersistence: this.resultPersistence }
  }
  private startRace(client: Client): void {
    if (!this.raceFactory || this.race || this.racers.get(client.sessionId)?.id !== this.hostId) return
    if (this.resultWriter && !this.resultWriter.available) { client.send('notice', 'Result storage is full. Try again later.'); return }
    // Two-racer development gate; four-car capacity requires measurements first.
    if (this.racers.size !== 2 || ![...this.racers.values()].every(r => r.ready && r.connected !== false)) return
    const race = new RaceSession([...this.racers.values()].map(r => ({ id: r.id, sessionId: r.sessionId, carId: r.carId })), this.raceFactory, this.laps)
    this.race = race
    this.raceRacers = [...this.racers.values()].map(r => ({ ...r }))
    this.resultPersistence = { raceId: race.descriptor.id, state: 'disabled' }
    this.lastSnapshotTick = 0
    void this.lock()
    this.publish()
    void race.load(this.raceFactory).then(() => {
      if (this.race !== race) return
      if (race.phase === 'closed') this.finishRace()
      else this.publish()
    })
  }
  private advanceRace(dt: number): void {
    const race = this.race
    if (!race) return
    const phase = race.phase
    try { race.advance(dt) } catch { race.close('The race simulation stopped. Return to the lobby.') }
    if (race.phase === 'closed') { this.finishRace(); return }
    if (phase !== race.phase && race.phase === 'finished') this.persistResult(race)
    if (phase !== race.phase) this.publish()
    if (phase !== race.phase || race.tick - this.lastSnapshotTick >= 3) {
      const snapshot = race.snapshot()
      if (snapshot) { this.broadcast('race', snapshot); this.lastSnapshotTick = race.tick }
    }
  }
  private persistResult(race: RaceSession): void {
    const writer = this.resultWriter
    if (!writer) return
    const update = (state: ResultPersistence) => {
      if (!this.disposed && this.race === race && state.raceId === race.descriptor.id) { this.resultPersistence = state; this.publish() }
    }
    update({ raceId: race.descriptor.id, state: 'saving' })
    try {
      const record = resultRecord(race.descriptor, race.snapshot()!.result!)
      void writer.enqueue(record, update).catch(() => update({ raceId: race.descriptor.id, state: 'failed' }))
    } catch { update({ raceId: race.descriptor.id, state: 'failed' }) }
  }
  private finishRace(): void {
    const reason = this.race?.reason
    this.race = null
    this.resultPersistence = undefined
    this.raceRacers = undefined
    for (const racer of this.racers.values()) racer.ready = false
    void this.unlock()
    if (reason) this.broadcast('notice', reason)
    this.publish()
  }
  private control(type: string, handler: (client: Client, value: unknown) => void | Promise<void>): void {
    this.onMessage(type, (client, value: unknown) => {
      if (type !== 'refresh' && this.racers.get(client.sessionId)?.connected === false) return
      const now = performance.now()
      let rate = this.controlRates.get(client.sessionId)
      if (!rate || now - rate.at >= 1000) { rate = { at: now, count: 0 }; this.controlRates.set(client.sessionId, rate) }
      if (++rate.count <= 10) return handler(client, value)
    })
  }
  private publish() { this.broadcast('lobby', this.snapshot()) }
}
