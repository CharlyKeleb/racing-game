import type { InputState } from '../input/InputManager'

/** Local predicted ticks, not input sequence numbers or wall-clock milliseconds. */
export class InputHistory {
  private readonly throttle: Float64Array
  private readonly brake: Float64Array
  private readonly steer: Float64Array
  private readonly flags: Uint8Array
  private first = 0
  private length = 0
  private lastTick: number | null = null
  private blocked = false
  readonly capacity: number
  constructor(capacity = 120) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 600) throw new Error('Input history capacity must be 1–600 ticks')
    this.capacity = capacity
    this.throttle = new Float64Array(capacity); this.brake = new Float64Array(capacity)
    this.steer = new Float64Array(capacity); this.flags = new Uint8Array(capacity)
  }
  get size(): number { return this.length }
  get needsResync(): boolean { return this.blocked }
  get oldestTick(): number | null { return this.length ? this.lastTick! - this.length + 1 : null }
  get newestTick(): number | null { return this.length ? this.lastTick : null }

  /** Copies one complete tick; never silently drops history to make room. No per-call allocation. */
  record(tick: number, input: InputState): boolean {
    if (this.blocked) return false
    if (!Number.isSafeInteger(tick) || tick < 1 || (this.lastTick !== null && tick !== this.lastTick + 1)
      || !Number.isFinite(input.throttle) || input.throttle < 0 || input.throttle > 1
      || !Number.isFinite(input.brake) || input.brake < 0 || input.brake > 1
      || !Number.isFinite(input.steer) || Math.abs(input.steer) > 1
      || typeof input.handbrake !== 'boolean' || typeof input.nitro !== 'boolean'
      || (input.steerSource !== undefined && input.steerSource !== 'keyboard' && input.steerSource !== 'analog')
      || this.length === this.capacity) { this.blocked = true; return false }
    const index = (this.first + this.length) % this.capacity
    this.throttle[index] = input.throttle; this.brake[index] = input.brake; this.steer[index] = input.steer
    this.flags[index] = (input.handbrake ? 1 : 0) | (input.nitro ? 2 : 0)
      | (input.steerSource === 'keyboard' ? 4 : input.steerSource === 'analog' ? 8 : 0)
    this.lastTick = tick; this.length++
    return true
  }
  /** Caller owns out. Missing/expired ticks leave it untouched; lookBack is presentation only. */
  copy(tick: number, out: InputState): boolean {
    const oldest = this.oldestTick
    if (this.blocked || oldest === null || !Number.isSafeInteger(tick) || tick < oldest || tick > this.lastTick!) return false
    const index = (this.first + tick - oldest) % this.capacity, flags = this.flags[index]
    out.throttle = this.throttle[index]; out.brake = this.brake[index]; out.steer = this.steer[index]
    out.handbrake = !!(flags & 1); out.nitro = !!(flags & 2)
    out.steerSource = flags & 4 ? 'keyboard' : flags & 8 ? 'analog' : undefined
    out.lookBack = undefined
    return true
  }
  /** Prune only using an explicitly mapped local tick. A server sequence alone is insufficient. */
  discardThrough(tick: number): boolean {
    if (this.blocked || !Number.isSafeInteger(tick) || tick < 0 || this.lastTick === null || tick > this.lastTick) return false
    const oldest = this.oldestTick
    if (oldest === null || tick < oldest) return true
    const remove = tick - oldest + 1
    this.first = (this.first + remove) % this.capacity; this.length -= remove
    return true
  }
  /** Reset after a trusted correction/resync. The next recorded tick must follow this local base. */
  reset(baseTick: number): void {
    if (!Number.isSafeInteger(baseTick) || baseTick < 0 || baseTick === Number.MAX_SAFE_INTEGER) throw new Error('Invalid input history base tick')
    this.first = 0; this.length = 0; this.lastTick = baseTick; this.blocked = false
  }
}
