import { INPUT_HOLD_TICKS, ScheduledInputs } from './ScheduledInputs.js'
import { RaceProgress, type RaceGate, type RacePosition } from './RaceProgress.js'
import { randomUUID } from 'node:crypto'
import { CORRECTION_VERSION, MAX_CORRECTION_BYTES, type CorrectionPhysicsState, type CorrectionEnvelope, RACE_PROTOCOL, FINISH_WINDOW_TICKS, RESET_INTERVAL_MS, RESET_VERSION, type LobbyCar, type RaceDescriptor, type RaceInput, type RaceSnapshot, type RaceVehicleState, type RaceResult, type RetirementReason } from './protocol.js'

export const SERVER_TICK_MS = 1000 / 60
export const INPUT_TIMEOUT_TICKS = 15
const HOLD: RaceInput = { raceId: '', sequence: 0, throttle: 0, brake: 0, steer: 0, handbrake: true, nitro: false }
const NEUTRAL: RaceInput = { ...HOLD, handbrake: false }
/** A reset lands this far before the last counted gate, so the racer drives back through it. */
export const RESET_BACK_METRES = 6

/** Numeric adapter: server rooms never load render assets or accept racer-authored transforms/configs. */
export interface ServerRaceSimulation {
  step(): void
  setInput(id: string, input: RaceInput): void
  position(id: string, out: RacePosition): void
  correction?(id: string): CorrectionPhysicsState
  /** Stationary, upright placement on the road under (x, z); y is the course height near that point. */
  respawn?(id: string, spawn: RaceSpawn): void
  states(): RaceVehicleState[]
  dispose(): void
}
export interface RaceSpawn { x: number; y: number; z: number; heading: number }
export interface RaceSeat { sessionId: string; id: string; carId: LobbyCar }
export interface RaceFactory {
  correctionVersion?: typeof CORRECTION_VERSION
  scheduledInputVersion?: 1
  resetVersion?: typeof RESET_VERSION
  checkpoints: readonly RaceGate[]
  fingerprint: string
  simulationVersion: number
  create(seats: readonly RaceSeat[]): Promise<ServerRaceSimulation>
}
interface SeatInput {
  id: string
  scheduled: boolean
  schedule: ScheduledInputs
  connected: boolean
  received: number
  applied: number
  appliedMode: 'hold' | 'neutral' | 'command'
  firstAppliedTick: number | null
  lastAppliedTick: number | null
  tick: number
  command: RaceInput
  /** Scheduled tick `command` was sent for; a gap in the schedule repeats it until it is this stale. */
  commandTick: number
  rateAt: number
  rateCount: number
  scheduledRateCount: number
  resetAt: number
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
  private readonly retirements = new Map<string, { retiredTicks: number; dnfReason: RetirementReason }>()
  private readonly loaded = new Set<string>()
  private loadingMs = 0
  private accumulator = 0
  private readonly progress = new Map<string, RaceProgress>()
  private readonly position = { x: 0, y: 0, z: 0 }
  private readonly spawn: RaceSpawn = { x: 0, y: 0, z: 0, heading: 0 }
  private readonly gates: readonly RaceGate[]
  private firstFinishTick: number | null = null
  private finalSnapshot: RaceSnapshot | null = null
  private loadingResolved = false
  reason: string | null = null
  readonly racers: readonly RaceSeat[]
  readonly laps: number

  constructor(racers: readonly RaceSeat[], factory: RaceFactory, laps = 3) {
    this.racers = racers; this.laps = laps; this.gates = factory.checkpoints
    if (racers.length !== 2 || new Set(racers.map(r => r.id)).size !== 2 || new Set(racers.map(r => r.sessionId)).size !== 2) throw new Error('A race needs two distinct authenticated seats')
    for (const r of racers) this.progress.set(r.id, new RaceProgress(factory.checkpoints, laps))
    this.descriptor = { protocol: RACE_PROTOCOL, id: randomUUID(), fingerprint: factory.fingerprint, simulationVersion: factory.simulationVersion, tickRate: 60, snapshotRate: 20, countdownTicks: 180, ...(factory.correctionVersion === CORRECTION_VERSION ? { correctionVersion: CORRECTION_VERSION, ...(factory.scheduledInputVersion === 1 ? { scheduledInputVersion: 1 as const } : {}) } : {}),
      ...(factory.resetVersion === RESET_VERSION ? { resetVersion: RESET_VERSION } : {}) }
    for (const r of racers) this.seats.set(r.sessionId, { id: r.id, scheduled: false, schedule: new ScheduledInputs(), connected: true, received: -1, applied: -1, appliedMode: 'hold', firstAppliedTick: null, lastAppliedTick: null, tick: -Infinity, command: { ...NEUTRAL }, commandTick: -Infinity, rateAt: -Infinity, rateCount: 0, scheduledRateCount: 0, resetAt: -Infinity })
  }

  /** A late-loading simulation is freed even when the room was cancelled/disposed meanwhile. */
  async load(factory: RaceFactory): Promise<void> {
    try {
      const simulation = await factory.create(this.racers)
      if (this.phase === 'closed') { simulation.dispose(); return }
      if (this.descriptor.correctionVersion === CORRECTION_VERSION && !simulation.correction) { simulation.dispose(); this.close('The race correction adapter could not load.'); return }
      this.simulation = simulation
      this.loadingResolved = true
      this.tryCountdown()
    } catch { if (this.phase !== 'closed') this.close('The race could not load. Try another lobby.') }
  }

  acknowledge(sessionId: string, value: unknown): boolean {
    if (this.phase !== 'loading' || !this.seats.get(sessionId)?.connected || !value || typeof value !== 'object') return false
    const v = value as { raceId?: unknown; fingerprint?: unknown; simulationVersion?: unknown; protocol?: unknown }
    if (v.protocol !== RACE_PROTOCOL || v.raceId !== this.descriptor.id || v.fingerprint !== this.descriptor.fingerprint || v.simulationVersion !== this.descriptor.simulationVersion) return false
    this.loaded.add(sessionId)
    this.tryCountdown()
    return true
  }

  private tryCountdown(): void {
    if (this.phase === 'loading' && this.loadingResolved && this.loaded.size === this.seats.size && [...this.seats.values()].every(s => s.connected)) this.phase = 'countdown'
  }

  /** Transport recovery never resets physics, progress, nitro or accepted sequence history. */
  setConnected(sessionId: string, connected: boolean): void {
    const seat = this.seats.get(sessionId)
    if (!seat) return
    seat.connected = connected
    seat.schedule.clear(); seat.scheduled = false
    seat.tick = -Infinity
    seat.command = { ...NEUTRAL }; seat.commandTick = -Infinity
    if (!connected && this.phase === 'loading') this.loaded.delete(sessionId)
  }

  /** Final departure after racing starts is terminal; reconnect never invokes this. */
  retire(sessionId: string, reason: RetirementReason): boolean {
    if (this.phase !== 'racing' && this.phase !== 'finished') return false
    const racer = this.racers.find(r => r.sessionId === sessionId)
    if (!racer) return false
    this.setConnected(sessionId, false)
    if (this.phase === 'finished' || this.progress.get(racer.id)!.finishTicks !== null || this.retirements.has(racer.id)) return true
    // The first racing tick establishes a positive result time, even for an immediate exit.
    this.retirements.set(racer.id, { retiredTicks: Math.max(1, this.tick - this.descriptor.countdownTicks), dnfReason: reason })
    if (this.racers.every(r => this.retirements.has(r.id) || this.progress.get(r.id)!.finishTicks !== null)) {
      if (this.tick === this.descriptor.countdownTicks) this.advance(SERVER_TICK_MS)
      else this.finish('all-resolved')
    }
    return true
  }

  /** Age of the latest accepted mailbox command, not a network RTT measurement. */
  maximumInputAge(): number | null {
    let maximum: number | null = null
    for (const seat of this.seats.values()) {
      if (!seat.connected || !Number.isFinite(seat.tick) || this.retirements.has(seat.id) || this.progress.get(seat.id)!.finishTicks !== null) continue
      maximum = Math.max(maximum ?? 0, this.tick - seat.tick)
    }
    return maximum
  }

  nextInputSequence(sessionId: string): number { return (this.seats.get(sessionId)?.received ?? -1) + 1 }

  input(sessionId: string, value: unknown, nowMs: number): boolean {
    const seat = this.seats.get(sessionId)
    if (this.phase !== 'racing' || !seat || seat.scheduled || !seat.connected || this.retirements.has(seat.id) || this.progress.get(seat.id)!.finishTicks !== null || !isInput(value, this.descriptor.id)) return false
    // A latest-input mailbox: never build a queue from client traffic. Bound jumps and message rate.
    if (value.sequence <= seat.received || value.sequence > seat.received + 120) return false
    if (nowMs - seat.rateAt >= 1000) { seat.rateAt = nowMs; seat.rateCount = 0; seat.scheduledRateCount = 0 }
    if (++seat.rateCount > 30) return false
    seat.received = value.sequence
    seat.command = { ...value }
    seat.tick = this.tick
    return true
  }

  scheduledInput(sessionId: string, value: unknown, nowMs: number): boolean {
    const seat = this.seats.get(sessionId)
    if (this.descriptor.scheduledInputVersion !== 1 || !seat?.connected || !['countdown', 'racing'].includes(this.phase)
      || this.retirements.has(seat.id) || this.progress.get(seat.id)!.finishTicks !== null || !value || typeof value !== 'object' || Array.isArray(value)) return false
    const v = value as RaceInput & { version: number; tick: number }
    if (v.version !== 1 || !Object.keys(v).every(key => INPUT_KEYS.has(key) || key === 'tick' || key === 'version')) return false
    const { tick, version: _version, ...command } = v
    if (!isInput(command, this.descriptor.id) || tick <= this.descriptor.countdownTicks || tick > this.descriptor.countdownTicks + 36_000
      || command.sequence <= seat.received || command.sequence > seat.received + 120 || !Number.isFinite(nowMs)) return false
    if (nowMs - seat.rateAt >= 1000) { seat.rateAt = nowMs; seat.rateCount = 0; seat.scheduledRateCount = 0 }
    // Accepted ticks only ever increase and stay within the lookahead, so this only bounds junk.
    if (++seat.scheduledRateCount > 120) return false
    if (!seat.schedule.enqueue(this.tick, tick, command)) {
      // Late (a network stall): dropping it left the car on neutral controls for that tick, which
      // in a corner sends it straight on and drags the predicting racer back with a correction.
      if (!seat.schedule.late(this.tick, tick)) return false
      const held = seat.command
      held.sequence = command.sequence; held.throttle = command.throttle; held.brake = command.brake; held.steer = command.steer
      held.steerSource = command.steerSource; held.handbrake = command.handbrake; held.nitro = command.nitro
      seat.commandTick = tick
    }
    seat.received = command.sequence; seat.tick = this.tick; seat.scheduled = true; seat.command.raceId = this.descriptor.id
    return true
  }

  /** Explicit fallback cancels queued controls, never resets a car or reuses the old mailbox. */
  useMailbox(sessionId: string, value: unknown): boolean {
    const seat = this.seats.get(sessionId)
    if (this.descriptor.scheduledInputVersion !== 1 || !seat?.connected || !['countdown', 'racing'].includes(this.phase)
      || !value || typeof value !== 'object' || Array.isArray(value)) return false
    const v = value as { raceId: string; version: number; mode: string }
    if (Object.keys(v).length !== 3 || !Object.keys(v).every(key => ['raceId', 'version', 'mode'].includes(key))
      || v.raceId !== this.descriptor.id || v.version !== 1 || v.mode !== 'mailbox') return false
    seat.schedule.clear(); seat.scheduled = false; seat.tick = -Infinity
    seat.command = { ...NEUTRAL }; seat.commandTick = -Infinity
    return true
  }

  /**
   * Racer-requested recovery, as offline R: back on the course a few metres before the last gate
   * the server counted, facing along it, stopped. Progress and lap times are kept, and the sweep is
   * reseeded so the jump is neither a discontinuity nor a credited crossing.
   */
  reset(sessionId: string, value: unknown, nowMs: number): boolean {
    const seat = this.seats.get(sessionId)
    if (this.descriptor.resetVersion !== RESET_VERSION || this.phase !== 'racing' || !this.simulation?.respawn || !seat?.connected
      || this.retirements.has(seat.id) || !value || typeof value !== 'object' || Array.isArray(value)) return false
    const progress = this.progress.get(seat.id)!
    const v = value as { version: number; raceId: string }
    if (progress.finishTicks !== null || Object.keys(v).length !== 2 || v.version !== RESET_VERSION || v.raceId !== this.descriptor.id
      || !Number.isFinite(nowMs) || nowMs - seat.resetAt < RESET_INTERVAL_MS) return false
    const gate = this.gates[(progress.nextCheckpoint - 1 + this.gates.length) % this.gates.length]
    const tx = gate.tangent[0], tz = gate.tangent[2], length = Math.hypot(tx, tz)
    this.spawn.x = gate.position[0] - tx / length * RESET_BACK_METRES
    this.spawn.y = gate.position[1]
    this.spawn.z = gate.position[2] - tz / length * RESET_BACK_METRES
    this.spawn.heading = Math.atan2(tx, tz)
    this.simulation.respawn(seat.id, this.spawn)
    this.simulation.position(seat.id, this.position)
    progress.seed(this.position)
    seat.resetAt = nowMs
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
        const driving = racing && !this.retirements.has(r.id) && this.progress.get(r.id)!.finishTicks === null
        let fresh = false
        if (driving && seat.connected) {
          if (!seat.scheduled) fresh = this.tick - seat.tick < INPUT_TIMEOUT_TICKS
          else if (seat.schedule.take(this.tick + 1, seat.command)) { seat.commandTick = this.tick + 1; fresh = true }
          // A missing tick repeats the newest control, which is far closer to what the racer pressed than neutral.
          else fresh = this.tick + 1 - seat.commandTick <= INPUT_HOLD_TICKS
        }
        this.simulation!.setInput(r.id, driving ? fresh ? seat.command : NEUTRAL : HOLD)
        seat.appliedMode = !driving ? 'hold' : fresh ? 'command' : 'neutral'
        if (fresh) {
          const applied = seat.scheduled ? seat.command.sequence : seat.received
          if (seat.applied !== applied) seat.firstAppliedTick = this.tick + 1
          seat.applied = applied
          seat.lastAppliedTick = this.tick + 1
        }
      }
      this.simulation!.step()
      this.tick++
      const elapsed = this.tick - this.descriptor.countdownTicks
      let allFinished = true
      for (const racer of this.racers) {
        const progress = this.progress.get(racer.id)!
        this.simulation!.position(racer.id, this.position)
        if (racing && !this.retirements.has(racer.id)) progress.update(this.position, elapsed)
        else if (!racing) progress.seed(this.position)
        if (progress.finishTicks === null && !this.retirements.has(racer.id)) allFinished = false
        if (progress.finishTicks !== null) this.firstFinishTick ??= elapsed
      }
      if (this.phase === 'countdown' && elapsed >= 0) this.phase = 'racing'
      if (racing && allFinished) { this.finish(this.retirements.size ? 'all-resolved' : 'all-finished'); return }
      if (this.firstFinishTick !== null && elapsed - this.firstFinishTick >= FINISH_WINDOW_TICKS) { this.finish('finish-window'); return }
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
        return { id: r.id, completedLaps: p.lapTicks.length, nextCheckpoint: p.nextCheckpoint, lapTicks: [...p.lapTicks], finishTicks: p.finishTicks, ...this.retirements.get(r.id) }
      }),
      vehicles: this.simulation.states().map(v => {
        const racer = this.racers.find(r => r.id === v.id)!
        const seat = this.seats.get(racer.sessionId)!
        return { ...v, acknowledgedSequence: seat.applied, inputApplication: { mode: seat.appliedMode, firstTick: seat.firstAppliedTick, lastTick: seat.lastAppliedTick } }
      }) }
  }

  /** Exact current own-seat state only; serializing is opt-in and outside the per-tick physics loop. */
  correction(sessionId: string): string | null {
    const seat = this.seats.get(sessionId)
    if (this.descriptor.correctionVersion !== CORRECTION_VERSION || !this.simulation?.correction || !seat?.connected
      || this.tick < 1 || (this.phase !== 'countdown' && this.phase !== 'racing')) return null
    try {
      const state = this.simulation.correction(seat.id)
      const envelope: CorrectionEnvelope = { body: state.body, controller: state.controller,
        version: CORRECTION_VERSION, raceProtocol: RACE_PROTOCOL, raceId: this.descriptor.id, racerId: seat.id,
        carId: this.racers.find(r => r.sessionId === sessionId)!.carId, fingerprint: this.descriptor.fingerprint,
        simulationVersion: this.descriptor.simulationVersion, tick: this.tick, acknowledgedSequence: seat.applied,
        inputApplication: { mode: seat.appliedMode, firstTick: seat.firstAppliedTick, lastTick: seat.lastAppliedTick } }
      const json = JSON.stringify(envelope)
      return Buffer.byteLength(json) <= MAX_CORRECTION_BYTES ? json : null
    } catch { return null } // A failed optional diagnostic/correction capture must not terminate a race.
  }

  private finish(reason: RaceResult['reason']): void {
    const snapshot = this.snapshot()!
    const racers: RaceResult['racers'] = this.racers.map(r => {
      const p = this.progress.get(r.id)!
      let rank = 1
      for (const other of this.progress.values()) if (other.finishTicks !== null && p.finishTicks !== null && other.finishTicks < p.finishTicks) rank++
      return { id: r.id, carId: r.carId, status: p.finishTicks === null ? 'dnf' : 'finished',
        rank: p.finishTicks === null ? null : rank, finishTicks: p.finishTicks, ...this.retirements.get(r.id), lapTicks: Object.freeze([...p.lapTicks]) }
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
