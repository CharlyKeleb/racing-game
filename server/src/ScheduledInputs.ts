import type { RaceInput } from './protocol.js'
export const INPUT_LOOKAHEAD_TICKS = 24
/** Fixed storage for at most 400 ms of server-tick controls. Never advances simulation time. */
export class ScheduledInputs {
  private readonly ticks = new Float64Array(INPUT_LOOKAHEAD_TICKS).fill(-1)
  private readonly sequences = new Float64Array(INPUT_LOOKAHEAD_TICKS)
  private readonly throttle = new Float64Array(INPUT_LOOKAHEAD_TICKS)
  private readonly brake = new Float64Array(INPUT_LOOKAHEAD_TICKS)
  private readonly steer = new Float64Array(INPUT_LOOKAHEAD_TICKS)
  private readonly flags = new Uint8Array(INPUT_LOOKAHEAD_TICKS)
  private lastTick = -1
  enqueue(now: number, tick: number, command: RaceInput): boolean {
    if (!Number.isSafeInteger(tick) || tick <= now || tick > now + INPUT_LOOKAHEAD_TICKS || tick <= this.lastTick) return false
    const index = tick % INPUT_LOOKAHEAD_TICKS
    this.ticks[index] = tick; this.sequences[index] = command.sequence
    this.throttle[index] = command.throttle; this.brake[index] = command.brake; this.steer[index] = command.steer
    this.flags[index] = (command.handbrake ? 1 : 0) | (command.nitro ? 2 : 0)
      | (command.steerSource === 'keyboard' ? 4 : command.steerSource === 'analog' ? 8 : 0)
    this.lastTick = tick
    return true
  }
  /** Copies one scheduled command into reusable seat storage. Missing ticks are neutral, never replayed late. */
  take(tick: number, out: RaceInput): boolean {
    const index = tick % INPUT_LOOKAHEAD_TICKS
    if (this.ticks[index] !== tick) return false
    const flags = this.flags[index]
    out.sequence = this.sequences[index]; out.throttle = this.throttle[index]; out.brake = this.brake[index]; out.steer = this.steer[index]
    out.handbrake = !!(flags & 1); out.nitro = !!(flags & 2)
    out.steerSource = flags & 4 ? 'keyboard' : flags & 8 ? 'analog' : undefined
    this.ticks[index] = -1
    return true
  }
  clear(): void { this.ticks.fill(-1); this.lastTick = -1 }
}
