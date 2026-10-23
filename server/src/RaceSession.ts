import { RaceProgress, type RaceGate, type RacePosition } from './RaceProgress.js'
import { randomUUID } from 'node:crypto'
import { RACE_PROTOCOL, type LobbyCar, type RaceDescriptor, type RaceInput, type RaceSnapshot, type RaceVehicleState, type RaceResult } from './protocol.js'

export const SERVER_TICK_MS = 1000 / 60
export const INPUT_TIMEOUT_TICKS = 15
const HOLD: RaceInput = { raceId: '', sequence: 0, throttle: 0, brake: 0, steer: 0, handbrake: true, nitro: false }
const NEUTRAL: RaceInput = { ...HOLD, handbrake: false }

/** Numeric adapter: server rooms never load render assets or accept racer-authored transforms/configs. */
export interface ServerRaceSimulation {
  step(): void
  setInput(id: string, input: RaceInput): void
  position(id: string, out: RacePosition): void
  states(): RaceVehicleState[]
  dispose(): void
}
export interface RaceSeat { sessionId: string; id: string; carId: LobbyCar }
export interface RaceFactory {
  checkpoints: readonly RaceGate[]
  fingerprint: string
  simulationVersion: number
  create(seats: readonly RaceSeat[]): Promise<ServerRaceSimulation>
}
interface SeatInput {
  received: number
  applied: number
  tick: number
  command: RaceInput
  rateAt: number
  rateCount: number
}
const INPUT_KEYS = new Set(['raceId', 'sequence', 'throttle', 'brake', 'steer', 'steerSource', 'handbrake', 'nitro'])
function isInput(value: unknown, raceId: string): value is RaceInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as RaceInput
  return Object.keys(v).every(k => INPUT_KEYS.has(k)) && v.raceId === raceId
    && Number.isSafeInteger(v.sequence) && v.sequence >= 0
    && Number.isFinite(v.throttle) && v.throttle >= 0 && v.throttle <= 1
    && Number.isFinite(v.brake) && v.brake >= 0 && v.brake <= 1
    && Number.isFinite(v.steer) && Math.abs(v.steer) <= 1
    && typeof v.handbrake === 'boolean' && typeof v.nitro === 'boolean'
    && (v.steerSource === undefined || v.steerSource === 'keyboard' || v.steerSource === 'analog')
}

/** Server-owned lifecycle. All time advancement is bounded and uses fixed physics ticks. */
export class RaceSession {
  readonly descriptor: RaceDescriptor
  phase: 'loading' | 'countdown' | 'racing' | 'finished' | 'closed' = 'loading'
  tick = 0
  private simulation: ServerRaceSimulation | null = null
  private readonly seats = new Map<string, SeatInput>()
  private readonly loaded = new Set<string>()
  private loadingMs = 0
  private accumulator = 0
  private readonly progress = new Map<string, RaceProgress>()
  private readonly position = { x: 0, y: 0, z: 0 }
  private firstFinishTick: number | null = null
  private finalSnapshot: RaceSnapshot | null = null
  private loadingResolved = false
  reason: string | null = null

  constructor(readonly racers: readonly RaceSeat[], factory: RaceFactory, readonly laps = 3) {
    if (racers.length !== 2 || new Set(racers.map(r => r.id)).size !== 2 || new Set(racers.map(r => r.sessionId)).size !== 2) throw new Error('A race needs two distinct authenticated seats')
    for (const r of racers) this.progress.set(r.id, new RaceProgress(factory.checkpoints, laps))
    this.descriptor = { protocol: RACE_PROTOCOL, id: randomUUID(), fingerprint: factory.fingerprint, simulationVersion: factory.simulationVersion, tickRate: 60, snapshotRate: 20, countdownTicks: 180 }
    for (const r of racers) this.seats.set(r.sessionId, { received: -1, applied: -1, tick: -Infinity, command: { ...NEUTRAL }, rateAt: -Infinity, rateCount: 0 })
  }

  /** A late-loading simulation is freed even when the room was cancelled/disposed meanwhile. */
  async load(factory: RaceFactory): Promise<void> {
    try {
      const simulation = await factory.create(this.racers)
      if (this.phase === 'closed') { simulation.dispose(); return }
      this.simulation = simulation
      this.loadingResolved = true
      this.tryCountdown()
    } catch { if (this.phase !== 'closed') this.close('The race could not load. Try another lobby.') }
  }

  acknowledge(sessionId: string, value: unknown): boolean {
    if (this.phase !== 'loading' || !this.seats.has(sessionId) || !value || typeof value !== 'object') return false
    const v = value as { raceId?: unknown; fingerprint?: unknown; simulationVersion?: unknown; protocol?: unknown }
    if (v.protocol !== RACE_PROTOCOL || v.raceId !== this.descriptor.id || v.fingerprint !== this.descriptor.fingerprint || v.simulationVersion !== this.descriptor.simulationVersion) return false
    this.loaded.add(sessionId)
    this.tryCountdown()
    return true
  }

  private tryCountdown(): void {
    if (this.phase === 'loading' && this.loadingResolved && this.loaded.size === this.seats.size) this.phase = 'countdown'
  }

  input(sessionId: string, value: unknown, nowMs: number): boolean {
    const seat = this.seats.get(sessionId)
    if (this.phase !== 'racing' || !seat || this.progress.get(this.racers.find(r => r.sessionId === sessionId)!.id)!.finishTicks !== null || !isInput(value, this.descriptor.id)) return false
    // A latest-input mailbox: never build a queue from client traffic. Bound jumps and message rate.
    if (value.sequence <= seat.received || value.sequence > seat.received + 120) return false
    if (nowMs - seat.rateAt >= 1000) { seat.rateAt = nowMs; seat.rateCount = 0 }
    if (++seat.rateCount > 30) return false
    seat.received = value.sequence
    seat.command = { ...value }
    seat.tick = this.tick
    return true
  }

  advance(deltaMs: number): void {
    if (this.phase === 'closed' || this.phase === 'finished') return
    if (!Number.isFinite(deltaMs) || deltaMs < 0 || deltaMs > 250) { this.close('The race server fell behind. Return to the lobby.'); return }
    if (this.phase === 'loading') {
      this.loadingMs += deltaMs
      if (this.loadingMs >= 30_000) this.close('Loading timed out. Everyone must load the same race assets.')
      return
    }
    this.accumulator += deltaMs
    let steps = 0
    while (this.accumulator + 1e-6 >= SERVER_TICK_MS && steps < 5) {
      this.accumulator -= SERVER_TICK_MS
      steps++
      const racing = this.phase === 'racing'
      for (const r of this.racers) {
        const seat = this.seats.get(r.sessionId)!
        const driving = racing && this.progress.get(r.id)!.finishTicks === null
        const fresh = driving && this.tick - seat.tick < INPUT_TIMEOUT_TICKS
        this.simulation!.setInput(r.id, driving ? fresh ? seat.command : NEUTRAL : HOLD)
        if (fresh) seat.applied = seat.received
      }
      this.simulation!.step()
      this.tick++
      const elapsed = this.tick - this.descriptor.countdownTicks
      let allFinished = true
      for (const racer of this.racers) {
        const progress = this.progress.get(racer.id)!
        this.simulation!.position(racer.id, this.position)
        if (racing) progress.update(this.position, elapsed)
        else progress.seed(this.position)
        if (progress.finishTicks === null) allFinished = false
        else this.firstFinishTick ??= elapsed
      }
      if (this.phase === 'countdown' && elapsed >= 0) this.phase = 'racing'
      if (allFinished) { this.finish('all-finished'); return }
      if (this.firstFinishTick !== null && elapsed - this.firstFinishTick >= 60 * 60) { this.finish('finish-window'); return }
      if (elapsed >= 60 * 600) { this.finish('time-limit'); return }
    }
    // Never silently discard simulation debt and pretend the race stayed synchronized.
    if (this.accumulator > 250) this.close('The race server fell behind. Return to the lobby.')
  }

  snapshot(): RaceSnapshot | null {
    if (this.finalSnapshot) return this.finalSnapshot
    if (!this.simulation || this.phase === 'closed' || this.phase === 'loading') return null
    return { raceId: this.descriptor.id, tick: this.tick, phase: this.phase,
      countdownTicks: Math.max(0, this.descriptor.countdownTicks - this.tick),
      progress: this.racers.map(r => {
        const p = this.progress.get(r.id)!
        return { id: r.id, completedLaps: p.lapTicks.length, nextCheckpoint: p.nextCheckpoint, lapTicks: [...p.lapTicks], finishTicks: p.finishTicks }
      }),
      vehicles: this.simulation.states().map(v => {
        const racer = this.racers.find(r => r.id === v.id)!
        return { ...v, acknowledgedSequence: this.seats.get(racer.sessionId)!.applied }
      }) }
  }

  private finish(reason: RaceResult['reason']): void {
    const snapshot = this.snapshot()!
    const racers: RaceResult['racers'] = this.racers.map(r => {
      const p = this.progress.get(r.id)!
      let rank = 1
      for (const other of this.progress.values()) if (other.finishTicks !== null && p.finishTicks !== null && other.finishTicks < p.finishTicks) rank++
      return { id: r.id, carId: r.carId, status: p.finishTicks === null ? 'dnf' : 'finished',
        rank: p.finishTicks === null ? null : rank, finishTicks: p.finishTicks, lapTicks: Object.freeze([...p.lapTicks]) }
    })
    for (const r of racers) Object.freeze(r)
    const result: RaceResult = Object.freeze({ raceId: this.descriptor.id, track: 'nurburgring', laps: this.laps,
      tickRate: 60, completedTick: this.tick, reason, racers: Object.freeze(racers) })
    this.phase = 'finished'
    this.finalSnapshot = { ...snapshot, phase: 'finished', result }
    this.simulation?.dispose()
    this.simulation = null
  }

  close(reason: string): void {
    if (this.phase === 'closed') return
    this.finalSnapshot = null
    this.reason = reason
    this.phase = 'closed'
    this.simulation?.dispose()
    this.simulation = null
  }
}
