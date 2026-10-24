import { Quaternion } from 'three'
import { isInputApplication, type RaceSnapshot, type RaceVehicleState } from '../../server/src/protocol'

const TICK_MS = 1000 / 60
const MAX_FRAMES = 32
const DELAY_TICKS = 6
const MAX_EXTRAPOLATION_TICKS = 2
const VECTOR_FIELDS = ['position', 'velocity', 'angularVelocity'] as const
const SCALAR_FIELDS = ['speed', 'steer', 'rpm', 'nitro'] as const
const aQuat = new Quaternion(), bQuat = new Quaternion()
const finiteVector = (v: { x: number; y: number; z: number }) => v && [v.x, v.y, v.z].every(Number.isFinite)

/** Presentation only: a 100 ms interpolation buffer with at most 33 ms velocity extrapolation. */
export class SnapshotBuffer {
  private readonly frames: RaceSnapshot[] = []
  private receivedAt = -Infinity
  private playhead = -Infinity
  readonly raceId: string
  private readonly racerIds: readonly string[]
  constructor(raceId: string, racerIds: readonly string[]) { this.raceId = raceId; this.racerIds = racerIds }

  push(frame: RaceSnapshot, now: number): boolean {
    const last = this.frames.at(-1)
    if (frame.raceId !== this.raceId || !Number.isSafeInteger(frame.tick) || frame.tick < 0 || (last && frame.tick <= last.tick)
      || !Number.isFinite(now) || now < this.receivedAt || !['countdown', 'racing', 'finished'].includes(frame.phase)
      || !Number.isFinite(frame.countdownTicks) || frame.countdownTicks < 0 || frame.vehicles.length !== this.racerIds.length) return false
    const seen = new Set<string>()
    for (const v of frame.vehicles) {
      if (!this.racerIds.includes(v.id) || seen.has(v.id) || !finiteVector(v.position) || !finiteVector(v.velocity) || !finiteVector(v.angularVelocity)
        || !finiteVector(v.rotation) || !Number.isFinite(v.rotation.w) || Math.hypot(v.rotation.x, v.rotation.y, v.rotation.z, v.rotation.w) < .5
        || ![v.speed, v.steer, v.rpm, v.gear, v.nitro].every(Number.isFinite)) return false
      if (v.wheelOffsets !== undefined && (!Array.isArray(v.wheelOffsets) || v.wheelOffsets.length !== 4 || !v.wheelOffsets.every(Number.isFinite))) return false
      if (v.nitroIntensity !== undefined && !Number.isFinite(v.nitroIntensity)) return false
      if (v.braking !== undefined && !Number.isFinite(v.braking)) return false
      if (!Number.isSafeInteger(v.acknowledgedSequence) || v.acknowledgedSequence < -1
        || (last && v.acknowledgedSequence < last.vehicles.find(previous => previous.id === v.id)!.acknowledgedSequence)
        || (v.inputApplication !== undefined && !isInputApplication(v.inputApplication, v.acknowledgedSequence, frame.tick))) return false
      seen.add(v.id)
    }
    this.frames.push(structuredClone(frame))
    if (this.frames.length > MAX_FRAMES) this.frames.shift()
    this.receivedAt = now
    return true
  }

  get latest(): RaceSnapshot | undefined { return this.frames.at(-1) }
  delayed(now: number): boolean { return !this.latest || (this.latest.phase !== 'finished' && now - this.receivedAt > 500) }
  resync(): void { this.frames.splice(0, Math.max(0, this.frames.length - 1)); this.playhead = -Infinity }

  sample(id: string, now: number, out: RaceVehicleState): boolean {
    const latest = this.latest
    if (!latest) return false
    const target = latest.tick + Math.max(0, now - this.receivedAt) / TICK_MS - DELAY_TICKS
    this.playhead = Math.max(this.playhead, Math.min(latest.tick + MAX_EXTRAPOLATION_TICKS, target))
    let before = this.frames[0], after = latest
    for (const frame of this.frames) {
      if (frame.tick <= this.playhead) before = frame
      if (frame.tick >= this.playhead) { after = frame; break }
    }
    if (latest.phase === 'finished') { before = latest; after = latest }
    let index = -1, afterIndex = -1
    for (let i = 0; i < before.vehicles.length; i++) if (before.vehicles[i].id === id) index = i
    for (let i = 0; i < after.vehicles.length; i++) if (after.vehicles[i].id === id) afterIndex = i
    if (index < 0 || afterIndex < 0) return false
    const a = before.vehicles[index], b = after.vehicles[afterIndex]
    const t = before.tick === after.tick ? 0 : Math.max(0, Math.min(1, (this.playhead - before.tick) / (after.tick - before.tick)))
    for (const key of VECTOR_FIELDS) {
      out[key].x = a[key].x + (b[key].x - a[key].x) * t
      out[key].y = a[key].y + (b[key].y - a[key].y) * t
      out[key].z = a[key].z + (b[key].z - a[key].z) * t
    }
    aQuat.set(a.rotation.x, a.rotation.y, a.rotation.z, a.rotation.w).normalize()
    bQuat.set(b.rotation.x, b.rotation.y, b.rotation.z, b.rotation.w).normalize()
    aQuat.slerp(bQuat, t)
    out.rotation.x = aQuat.x; out.rotation.y = aQuat.y; out.rotation.z = aQuat.z; out.rotation.w = aQuat.w
    for (const key of SCALAR_FIELDS) out[key] = a[key] + (b[key] - a[key]) * t
    out.gear = b.gear
    if (a.wheelOffsets && b.wheelOffsets) {
      out.wheelOffsets ??= [0, 0, 0, 0]
      for (let i = 0; i < 4; i++) out.wheelOffsets[i] = a.wheelOffsets[i] + (b.wheelOffsets[i] - a.wheelOffsets[i]) * t
    } else out.wheelOffsets = undefined
    out.nitroIntensity = (a.nitroIntensity ?? 0) + ((b.nitroIntensity ?? 0) - (a.nitroIntensity ?? 0)) * t
    out.braking = (a.braking ?? 0) + ((b.braking ?? 0) - (a.braking ?? 0)) * t
    if (latest.phase !== 'finished' && this.playhead > latest.tick) {
      const dt = Math.min(MAX_EXTRAPOLATION_TICKS, this.playhead - latest.tick) / 60
      out.position.x += b.velocity.x * dt; out.position.y += b.velocity.y * dt; out.position.z += b.velocity.z * dt
    }
    return true
  }
}

export function emptyVehicleState(id: string): RaceVehicleState {
  return { id, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, velocity: { x: 0, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0 }, speed: 0, steer: 0, rpm: 900, gear: 1, nitro: 0 }
}
