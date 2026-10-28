import type { InputState } from '../input/InputManager'
import type { CorrectionState } from './CorrectionState'
import { InputHistory } from './InputHistory'
export interface PredictedPhysics {
  restore(state: CorrectionState): void
  step(input: InputState): void
}
const HOLD: InputState = Object.freeze({ throttle: 0, brake: 0, steer: 0, handbrake: true, nitro: false })
const NEUTRAL: InputState = Object.freeze({ ...HOLD, handbrake: false })
export const MAX_PREDICTION_LEAD_TICKS = 24
/**
 * A correction this far behind is still replayed. Prediction suspends after 500 ms without one, so this
 * covers the full lead plus a 30-tick stall; past it prediction reboots, jumps and resends old ticks.
 */
export const MAX_REPLAY_TICKS = 60
/** Lead error (ticks) tolerated before the local clock is nudged; corrections jitter by a few ticks. */
const LEAD_DEADBAND = 2
/** Fixed steps between one-tick nudges, so a nudge reads as a ~4% speed change rather than a hitch. */
const NUDGE_INTERVAL = 24
/** A deficit this large means local time was lost (a long frame): catch up at once, the frame hitched anyway. */
const CATCH_UP_TICKS = 6
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
  private lead: number
  /** Smoothed `predictedTick - correction.tick` at arrival: how far ahead of the server the inputs land. */
  private gap = 0
  private sinceNudge = 0
  private steps = 0
  constructor(physics: PredictedPhysics, send: (tick: number, input: InputState) => boolean, leadTicks = 12) {
    if (!PredictionReconciler.validLead(leadTicks)) throw new Error('Prediction lead must be 6–24 ticks')
    this.physics = physics; this.send = send; this.lead = leadTicks
  }
  private static validLead(ticks: number): boolean { return Number.isSafeInteger(ticks) && ticks >= 6 && ticks <= MAX_PREDICTION_LEAD_TICKS }
  get ready(): boolean { return this.running }
  get predictedTick(): number { return this.tick }
  get leadTicks(): number { return this.lead }
  /** Ticks stepped by the last successful `advance`: 1 normally, 0 or 2+ while re-aligning with the server clock. */
  get lastSteps(): number { return this.steps }
  /** Retargets the lead in place; the clock drifts to it instead of rebooting prediction with neutral input. */
  setLeadTicks(ticks: number): void { if (PredictionReconciler.validLead(ticks)) this.lead = ticks }
  suspend(): void { this.running = false; this.sent = false; this.history.reset(0) }
  accept(state: CorrectionState, now: number): boolean {
    if (!Number.isFinite(now) || now < this.lastNow || !Number.isSafeInteger(state.tick) || state.tick < 1 || state.tick > 36180 || state.tick <= this.correctedTick) return false
    this.lastNow = now
    const replay = this.running && state.tick < this.tick && this.tick - state.tick <= MAX_REPLAY_TICKS
      && this.history.oldestTick !== null && this.history.oldestTick <= state.tick + 1 && !this.history.needsResync
    try {
      this.physics.restore(state)
      if (replay) {
        const gap = this.tick - state.tick
        this.gap += (gap - this.gap) * (gap < this.gap - CATCH_UP_TICKS ? 1 : .2)
        for (let tick = state.tick + 1; tick <= this.tick; tick++) {
          if (!this.history.copy(tick, this.scratch)) throw new Error('Missing prediction history')
          this.physics.step(this.scratch)
        }
        this.history.discardThrough(state.tick)
      } else {
        this.tick = state.tick; this.history.reset(this.tick); this.gap = this.lead; this.sinceNudge = 0
        // Neutral lookahead bootstraps a future server-tick clock without sending a burst of late inputs.
        for (let i = 0; i < this.lead && this.tick < 36180; i++) {
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
    // Client and server fixed steps drift apart (long frames drop local time, a busy server falls
    // behind). Without re-aligning, inputs start landing late, the server drives them as neutral and
    // corrections drag the car around, worst in corners; past zero lead prediction reboots and jumps.
    const error = this.gap - this.lead
    let steps = 1
    if (error < -CATCH_UP_TICKS) steps = 1 + Math.min(MAX_PREDICTION_LEAD_TICKS, Math.round(-error))
    else if (++this.sinceNudge >= NUDGE_INTERVAL && Math.abs(error) > LEAD_DEADBAND) steps = error < 0 ? 2 : 0
    if (steps !== 1) { this.sinceNudge = 0; this.gap += steps - 1 }
    this.steps = 0
    for (let i = 0; i < steps; i++) {
      const tick = this.tick + 1, controls = tick <= 180 ? HOLD : input
      if (tick > 36180 || !this.history.record(tick, controls)) { this.suspend(); return false }
      try {
        this.physics.step(controls); this.tick = tick; this.steps++
        if (tick > 180) {
          if (!this.send(tick, controls)) { this.suspend(); return false }
          if (!this.sent) { this.sent = true; this.ackAt = now }
        }
      } catch { this.suspend(); return false }
    }
    return true
  }
}
