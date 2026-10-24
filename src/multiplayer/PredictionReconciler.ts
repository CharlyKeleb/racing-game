import type { InputState } from '../input/InputManager'
import type { CorrectionState } from './CorrectionState'
import { InputHistory } from './InputHistory'
export interface PredictedPhysics {
  restore(state: CorrectionState): void
  step(input: InputState): void
}
const HOLD: InputState = Object.freeze({ throttle: 0, brake: 0, steer: 0, handbrake: true, nitro: false })
const NEUTRAL: InputState = Object.freeze({ ...HOLD, handbrake: false })
export const MAX_REPLAY_TICKS = 24
/** Tick-keyed scheduling makes correction replay explicit; input sequences are never used as durations. */
export class PredictionReconciler {
  private readonly physics: PredictedPhysics
  private readonly send: (tick: number, input: InputState) => boolean
  private readonly history = new InputHistory(120)
  private readonly scratch: InputState = { ...NEUTRAL }
  private tick = 0
  private correctedTick = -1
  private correctedAt = -Infinity
  private lastNow = -Infinity
  private running = false
  private sent = false
  private ackAt = -Infinity
  private lastAck = -1
  readonly leadTicks: number
  constructor(physics: PredictedPhysics, send: (tick: number, input: InputState) => boolean, leadTicks = 12) {
    if (!Number.isSafeInteger(leadTicks) || leadTicks < 6 || leadTicks > 18) throw new Error('Prediction lead must be 6–18 ticks')
    this.physics = physics; this.send = send; this.leadTicks = leadTicks
  }
  get ready(): boolean { return this.running }
  get predictedTick(): number { return this.tick }
  suspend(): void { this.running = false; this.sent = false; this.history.reset(0) }
  accept(state: CorrectionState, now: number): boolean {
    if (!Number.isFinite(now) || now < this.lastNow || !Number.isSafeInteger(state.tick) || state.tick < 1 || state.tick > 36180 || state.tick <= this.correctedTick) return false
    this.lastNow = now
    const replay = this.running && state.tick < this.tick && this.tick - state.tick <= MAX_REPLAY_TICKS
      && this.history.oldestTick !== null && this.history.oldestTick <= state.tick + 1 && !this.history.needsResync
    try {
      this.physics.restore(state)
      if (replay) {
        for (let tick = state.tick + 1; tick <= this.tick; tick++) {
          if (!this.history.copy(tick, this.scratch)) throw new Error('Missing prediction history')
          this.physics.step(this.scratch)
        }
        this.history.discardThrough(state.tick)
      } else {
        this.tick = state.tick; this.history.reset(this.tick)
        // Neutral lookahead bootstraps a future server-tick clock without sending a burst of late inputs.
        for (let i = 0; i < this.leadTicks && this.tick < 36180; i++) {
          const tick = ++this.tick, input = tick <= 180 ? HOLD : NEUTRAL
          this.history.record(tick, input); this.physics.step(input)
        }
      }
      if (state.acknowledgedSequence > this.lastAck) { this.lastAck = state.acknowledgedSequence; this.ackAt = now }
      this.correctedTick = state.tick; this.correctedAt = now; this.running = true
      return true
    } catch { this.suspend(); return false }
  }
  advance(input: InputState, now: number): boolean {
    if (!this.running) return false
    if (!Number.isFinite(now) || now < this.lastNow || now - this.correctedAt > 500 || (this.sent && now - this.ackAt > 500) || this.tick >= 36180) { this.suspend(); return false }
    this.lastNow = now
    const tick = this.tick + 1, controls = tick <= 180 ? HOLD : input
    if (!this.history.record(tick, controls)) { this.suspend(); return false }
    try {
      this.physics.step(controls); this.tick = tick
      if (tick > 180) {
        if (!this.send(tick, controls)) { this.suspend(); return false }
        if (!this.sent) { this.sent = true; this.ackAt = now }
      }
      return true
    } catch { this.suspend(); return false }
  }
}
