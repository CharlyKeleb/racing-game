import { steeringLimit, type SteeringLimitConfig } from '../vehicles/SteeringLimit'
import type { InputState } from '../input/InputManager'
import type { Point3 } from './TrackProgress'
import { AI_DIFFICULTIES, DRIVER_PROFILES, type AiDifficulty, type DriverProfile } from './AiProfiles'
import { Overtaking } from './Overtaking'
import { TrackProgress } from './TrackProgress'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
export interface DriverPose { x: number; z: number; heading: number; speed: number }
export interface TrafficCar extends DriverPose { id: number }
export interface DriverResources { charge: number; boosting: boolean; drifting: boolean }
const EMPTY_RESOURCES: DriverResources = { charge: 0, boosting: false, drifting: false }
export interface SteeringConfig extends SteeringLimitConfig {
  /** Brake force over mass, m/s²: a hard cap on planned braking. */
  brakeDecel?: number
}

/** Default grip for numeric callers without a vehicle configuration. */
const REFERENCE_GRIP = 1.25
/** Straight-line speed the plan allows, m/s (×profile.straight); the engine caps it before this. */
const STRAIGHT_CAP = 88
/**
 * Catch-up: a rival behind the player asks for up to CATCH_UP more pace,
 * reaching it CATCH_UP_METRES back; one ahead eases by at most EASE_OFF.
 */
const CATCH_UP = 0.08
const CATCH_UP_METRES = 250
const EASE_OFF = 0.02

/** Numeric, deterministic controller. Owns inputs, never moves a rigid body. */
export class AiDriver {
  readonly input: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false }
  readonly progress: TrackProgress
  readonly distances: Float64Array
  readonly speeds: Float64Array
  readonly length: number
  readonly passing = new Overtaking()
  readonly profile: DriverProfile
  readonly difficulty: AiDifficulty
  private elapsed = 0
  private boostTime = 0
  private boostCooldown = 0
  private cornerBefore = false
  private exitWindow = 0
  private driftCooldown = 0
  private driftPulse = 0
  private driftingFor = 0
  targetSpeed = 0
  needsRecovery = false
  private integral = 0
  private previousError = 0
  private derivative = 0
  private lane = 0
  private stuck = 0
  private reverse = 0
  private recoveryTime = 0

  readonly line: readonly Point3[]
  readonly pace: number
  private readonly config: SteeringConfig
  constructor(line: readonly Point3[], config: SteeringConfig, pace = 1, profile: DriverProfile = DRIVER_PROFILES[0], difficulty: AiDifficulty = 'challenging') {
    this.line = line; this.config = config; this.pace = pace
    this.profile = profile; this.difficulty = difficulty
    if (line.length < 3) throw new Error('AI requires a closed racing line with at least three points')
    this.progress = new TrackProgress(line)
    const n = line.length
    this.distances = new Float64Array(n + 1)
    this.speeds = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const a = line[i], b = line[(i + 1) % n]
      this.distances[i + 1] = this.distances[i] + Math.hypot(b.x - a.x, b.z - a.z)
    }
    this.length = this.distances[n]
    const grip = config.grip ?? REFERENCE_GRIP
    const downforce = (config.downforcePerKg ?? 0) / 9.81
    const preset = AI_DIFFICULTIES[difficulty]
    const braking = Math.min(preset.brakeGripShare * grip * 9.81 * profile.braking, config.brakeDecel ?? Infinity)
    for (let i = 0; i < n; i++) {
      const a = line[(i - 2 + n) % n], b = line[i], c = line[(i + 2) % n]
      const ab = Math.hypot(b.x - a.x, b.z - a.z)
      const bc = Math.hypot(c.x - b.x, c.z - b.z)
      const ac = Math.hypot(c.x - a.x, c.z - a.z)
      const curvature = 2 * Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / Math.max(0.001, ab * bc * ac)
      // Lateral grip a(v) = A·(1 + k·v²) with downforce; v²·κ = a(v) gives v² = A / (κ − A·k).
      // Where downforce outgrows the bend (κ ≤ A·k) only the straight-line cap applies.
      const lateral = preset.cornerGripShare * grip * 9.81 * profile.corner
      const room = Math.max(curvature, 0.001) - lateral * downforce
      this.speeds[i] = clamp(room > 0 ? Math.sqrt(lateral / room) : Infinity, 9, STRAIGHT_CAP * profile.straight)
    }
    // Two backward passes propagate braking through the closed seam.
    for (let k = n * 2 - 1; k >= 0; k--) {
      const i = k % n, next = (i + 1) % n
      const ds = this.distances[i + 1] - this.distances[i]
      this.speeds[i] = Math.min(this.speeds[i], Math.sqrt(this.speeds[next] ** 2 + 2 * braking * ds))
    }
  }

  reset(): void {
    this.progress.reset()
    this.passing.reset()
    this.elapsed = this.boostTime = this.boostCooldown = this.driftCooldown = this.driftPulse = this.driftingFor = this.exitWindow = 0
    this.cornerBefore = false
    this.integral = this.previousError = this.derivative = this.lane = 0
    this.stuck = this.reverse = this.recoveryTime = 0
    this.needsRecovery = false
    this.targetSpeed = 0
    this.input.throttle = this.input.brake = this.input.steer = 0
    this.input.handbrake = this.input.nitro = false
  }

  /** gap is meters behind the player (negative when ahead). Catch-up: see CATCH_UP / EASE_OFF. */
  update(dt: number, pose: DriverPose, traffic: readonly TrafficCar[], id: number, gap: number, laneLimit: number, resources: DriverResources = EMPTY_RESOURCES): InputState {
    const index = this.progress.update(pose.x, pose.z)
    const n = this.line.length
    const p = this.line[index]
    const distanceFromLine = Math.hypot(pose.x - p.x, pose.z - p.z)
    const speed = Math.abs(pose.speed)
    const look = clamp(7 + speed * 0.48, 8, 26)
    let target = index, ahead = 0
    while (ahead < look) {
      ahead += this.distances[target + 1] - this.distances[target]
      target = (target + 1) % n
      if (target === index) break
    }
    const before = this.line[(target - 1 + n) % n], after = this.line[(target + 1) % n]
    const tl = Math.hypot(after.x - before.x, after.z - before.z) || 1
    const tx = (after.x - before.x) / tl, tz = (after.z - before.z) / tl
    const fx = Math.sin(pose.heading), fz = Math.cos(pose.heading)
    this.elapsed += dt
    this.driftingFor = resources.drifting ? this.driftingFor + dt : 0
    const roadBefore = this.line[(index - 1 + n) % n], roadAfter = this.line[(index + 1) % n]
    const roadLength = Math.hypot(roadAfter.x - roadBefore.x, roadAfter.z - roadBefore.z) || 1
    this.passing.update(dt, pose, traffic, id, laneLimit, (roadAfter.z - roadBefore.z) / roadLength, -(roadAfter.x - roadBefore.x) / roadLength, p.x, p.z, resources.charge)
    const laneTarget = this.passing.lane, trafficSpeed = this.passing.speedLimit
    this.lane += (laneTarget - this.lane) * Math.min(1, dt * 1.3)
    this.lane = clamp(this.lane, -laneLimit, laneLimit)
    const dest = this.line[target]
    const dx = dest.x + tz * this.lane - pose.x, dz = dest.z - tx * this.lane - pose.z
    const lateral = dx * fz - dz * fx
    // Pure pursuit feed-forward with a bounded PID trim. Positive yaw is left;
    // InputState steering is positive right, hence the final minus sign.
    const error = Math.atan2(lateral, dx * fx + dz * fz)
    this.integral = clamp(this.integral + error * dt, -0.25, 0.25)
    this.derivative += ((error - this.previousError) / dt - this.derivative) * Math.min(1, dt * 5)
    this.previousError = error
    const angle = Math.atan2(2 * this.config.wheelbase * lateral, dx * dx + dz * dz) + 0.06 * error + 0.015 * this.integral + 0.012 * this.derivative
    const available = steeringLimit(this.config, speed, resources.drifting ? 1 : 0)
    const difficulty = AI_DIFFICULTIES[this.difficulty]
    const wantedSteer = clamp(-angle / available, -1, 1)
    this.input.steer += (wantedSteer - this.input.steer) * Math.min(1, dt / difficulty.reaction)
    const rubber = 1 + clamp((gap / CATCH_UP_METRES) * CATCH_UP, -EASE_OFF, CATCH_UP)
    this.targetSpeed = Math.min(this.speeds[index] * this.pace * rubber * difficulty.pace * (1 - difficulty.variation * (0.5 + 0.5 * Math.sin(this.elapsed * 0.37 + id * 2))), trafficSpeed)
    if (distanceFromLine > 5 || Math.abs(error) > 0.8) this.targetSpeed = Math.min(this.targetSpeed, 10)
    const delta = this.targetSpeed - pose.speed
    this.input.throttle = delta > 0 ? clamp(delta * 0.45, 0, 1) : 0
    this.input.brake = delta < -0.7 && speed > 1.5 ? clamp(-delta * 0.22, 0, 1) : 0
    this.input.handbrake = this.targetSpeed < 0.5 && speed < 1.5
    this.boostCooldown = Math.max(0, this.boostCooldown - dt)
    this.driftCooldown = Math.max(0, this.driftCooldown - dt)
    this.driftPulse = Math.max(0, this.driftPulse - dt)
    const corner = this.speeds[index] < 26
    const exit = this.cornerBefore && !corner
    this.cornerBefore = corner
    this.exitWindow = exit ? 2.5 : Math.max(0, this.exitWindow - dt)
    // A brief rotation on medium bends; grip drivers never ask for handbrake.
    const cleanCorner = trafficSpeed === Infinity && this.passing.phase === 'follow' && distanceFromLine < 2 && Math.abs(error) < 0.4
    if (this.profile.style === 'drift' && corner && cleanCorner && !resources.drifting && this.driftCooldown === 0 && speed > 17 && speed < 26 && Math.abs(this.input.steer) > 0.16) {
      this.driftPulse = 0.10
      this.driftCooldown = 7
    }
    if (this.driftPulse > 0) {
      this.input.handbrake = true
      this.input.brake = 0
      this.input.steer = Math.sign(this.input.steer) * Math.max(0.32, Math.abs(this.input.steer))
    }
    const maxDriftSeconds = this.difficulty === 'relaxed' ? .65 : this.difficulty === 'intense' ? 1.5 : 1.1
    if (resources.drifting && this.driftingFor > maxDriftSeconds) {
      // Release at every difficulty: a long bend must not latch a drift forever.
      // Faster rivals can hold a longer rotation, then resume grip steering.
      this.input.handbrake = false
      this.input.steer = 0
      this.input.throttle = Math.min(this.input.throttle,0.6)
    }
    let straightClear = true, scan = index, scanDistance = 0
    while (scanDistance < speed * 1.5 + 15) {
      scanDistance += this.distances[scan + 1] - this.distances[scan]
      scan = (scan + 1) % n
      if (this.speeds[scan] < Math.max(28, speed * 0.85)) { straightClear = false; break }
      if (scan === index) break
    }
    const boostSafe = straightClear && this.input.brake === 0 && speed < this.targetSpeed - 1 && this.speeds[index] > 28 && this.speeds[target] > 28 && Math.abs(error) < 0.16 && Math.abs(this.input.steer) < 0.3 && distanceFromLine < 2.5 && trafficSpeed === Infinity && !resources.drifting && this.reverse <= 0 && speed > 12
    if (this.boostTime > 0) {
      this.boostTime -= dt
      if (!boostSafe || resources.charge < 0.02) { this.boostTime = 0; this.boostCooldown = 2 }
    } else if (boostSafe && this.boostCooldown === 0 && resources.charge >= this.profile.boostReserve && (this.passing.phase === 'pass' || this.exitWindow > 0 || (this.profile.style === 'power' && speed > 25))) {
      this.boostTime = this.profile.style === 'power' ? 0.9 : 0.65
      this.exitWindow = 0
    }
    this.input.nitro = this.boostTime > 0
    if (this.input.nitro) this.input.throttle = 1
    else if (resources.boosting) this.boostCooldown = 2
    this.stuck = speed < 1.5 && (this.targetSpeed > 4 || (trafficSpeed < 1 && laneTarget !== 0)) ? this.stuck + dt : 0
    this.recoveryTime = distanceFromLine > 12 || this.stuck > 0 ? this.recoveryTime + dt : 0
    if (this.stuck > 3 && this.reverse <= 0) { this.reverse = 2; this.stuck = 0 }
    if (this.reverse > 0) {
      this.reverse -= dt
      this.input.throttle = 0
      this.input.brake = 1
      this.input.steer *= -1
      this.input.handbrake = false
      this.input.nitro = false
    }
    this.needsRecovery = this.recoveryTime > 10
    return this.input
  }
}
