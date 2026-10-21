import { keyboardSteeringAngle } from './KeyboardSteering'
import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { InputState } from '../input/InputManager'
import { Backfire } from './Backfire'
import { Burnout, BURNOUT_BRAKE, BURNOUT_THROTTLE } from './Burnout'
import { Drift, type DriftConfig, type DriftGuide } from './Drift'
import { Drivetrain, type GearRequest } from './Drivetrain'
import { Nitro } from './Nitro'
import { Surface, surfaceProps } from './Surface'
import { Suspension } from './Suspension'
import { steeringLimit, type SteeringLimitConfig } from './SteeringLimit'
import { computeTireForces, peakSlipAngle } from './TirePhysics'
import type { VehicleConfig, WheelConfig } from './VehicleConfig'

/** Per-wheel runtime state, read by visuals, audio and effects. */
export interface WheelState {
  cfg: WheelConfig
  suspension: Suspension
  grounded: boolean
  contactPoint: THREE.Vector3
  /** Accumulated roll angle for the visual wheel, radians. */
  spin: number
  /** 0..1 use of the friction circle, for nitro fill and tire squeal. */
  slip: number
  /**
   * Speed the contact patch is actually sliding at, m/s (see TireOutput.slide).
   * Zero in normal grippy cornering, so skid marks and smoke mean a real slide.
   */
  slide: number
  /** What the tire is on, for grip and for sand / dust effects. */
  surface: Surface
}

/** Burnout: tread sliding speed at full spin (m/s; smoke is full at 12), extra visual wheel spin (rad/s) and revs (share of redline). */
const BURNOUT_SLIDE = 16
const BURNOUT_SPIN = 70
const BURNOUT_RPM = 0.8
/** Steering in a held burnout pivots the car around its braked front wheels (like NFS): yaw rate at full lock, rad/s. */
const BURNOUT_YAW_RATE = 1
/** Lateral grip the spinning tyres keep in a burnout: little, so the tail swings round. */
const BURNOUT_LATERAL_GRIP = 0.2

// Scratch objects — the controller runs at 60 Hz, so avoid per-tick allocation.
const _q = new THREE.Quaternion()
const _pos = new THREE.Vector3()
const _up = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _right = new THREE.Vector3()
const _wFwd = new THREE.Vector3()
const _wRight = new THREE.Vector3()
const _mount = new THREE.Vector3()
const _vel = new THREE.Vector3()
const _impulse = new THREE.Vector3()
const _point = new THREE.Vector3()
const _vh = new THREE.Vector3()
const _fh = new THREE.Vector3()
const _cross = new THREE.Vector3()
const _carve = new THREE.Vector3()
const _roadNormal = new THREE.Vector3()
const _roadForward = new THREE.Vector3()
const _roadRight = new THREE.Vector3()
/** Extra yaw the stability assist allows at full brake, as a share of the grip limit. */
const TRAIL_BRAKE_ROTATION = 0.35
/** Body slip angle (rad) above which a countersteered slide counts as a drift. */
const DRIFT_MIN_ANGLE = 0.1
const _ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })

/** Moves `value` toward `target` by at most `step`. */
function approach(value: number, target: number, step: number): number {
  return value + Math.max(-step, Math.min(step, target - value))
}

/**
 * Raycast-wheel vehicle: one rigid body for the chassis, four suspension rays,
 * tire forces applied as impulses at the contact patches. This is the approach
 * used by most arcade/sim-cade racers — it feels like a car, not a sliding box.
 */
export class VehicleController {
  readonly wheels: WheelState[]
  readonly drivetrain: Drivetrain
  drafting = 0
  /** Launch push along the car this tick, m/s² (LaunchControl.push); the race sets it. */
  launchPush = 0
  readonly nitro: Nitro
  readonly drift = new Drift()
  /** Brake + full throttle at a standstill: driven tyres spin and smoke while the car is held. */
  readonly burnout = new Burnout()
  /** Exhaust pops and bangs: overrun crackle, hard upshifts, nitro lighting, burnouts. */
  readonly backfire = new Backfire()
  private eventDrift: DriftConfig | null = null
  setDriftMode(enabled: boolean): void {
    this.eventDrift = enabled ? {...this.cfg.drift, minSpeed:9, entryLock:.4, baseAngle:.46, holdAngle:.78, minAngle:.18, exitTime:.55, counterExitTime:.9, scrub:.025, pathG:.5} : null
  }
  private readonly driftGuide: DriftGuide = { angle: 0, pathRate: 0 }
  steerAngle = 0
  /** Signed forward speed of the chassis, m/s. */
  forwardSpeed = 0
  /** Brake pedal actually braking (not driving in reverse), 0..1. Brake lights. */
  braking = 0
  /** Ground type under a world XZ point; the track sets this. Default: all asphalt. */
  surfaceAt: (x: number, z: number) => Surface = () => Surface.Asphalt
  /** Pedals after ramping, 0..1. Keyboards are on/off; this fades them in over ~1/pedalRate s. */
  private throttle = 0
  private brake = 0
  /** Rear wheels (behind the axle midpoint): the ones that let go in a drift. */
  private readonly isRear: boolean[]
  /** Wheels that spin in a burnout: the driven axle (the rears on an AWD car; the fronts hold). */
  private readonly burnoutWheel: boolean[]
  /** Fraction of the drivetrain's force each wheel gets (0 for undriven wheels). */
  private readonly driveShare: number[]
  private readonly drivenRadius: number
  /** Chassis yaw inertia (matches Vehicle's box inertia) and front-to-rear axle distance. */
  private readonly yawInertia: number
  private readonly wheelbase: number
  private readonly steeringConfig: SteeringLimitConfig
  /** Axle positions along the car (local Z), where downforce acts. */
  private readonly frontAxleZ: number
  private readonly rearAxleZ: number
  private readonly cfg: VehicleConfig
  private readonly body: RAPIER.RigidBody
  private readonly world: RAPIER.World

  constructor(cfg: VehicleConfig, body: RAPIER.RigidBody, world: RAPIER.World) {
    this.cfg = cfg
    this.body = body
    this.world = world
    this.drivetrain = new Drivetrain(cfg.engine)
    this.nitro = new Nitro(cfg.nitro)
    const [hx, , hz] = cfg.chassisHalfExtents
    this.yawInertia = (cfg.massKg / 3) * (hx * hx + hz * hz)
    const zs = cfg.wheels.map((w) => w.position[2])
    this.wheelbase = Math.max(1, Math.max(...zs) - Math.min(...zs))
    this.steeringConfig = {
      wheelbase: this.wheelbase, maxSteerAngle: cfg.maxSteerAngle, steerFalloffSpeed: cfg.steerFalloffSpeed,
      grip: cfg.tires.grip, peakSlip: peakSlipAngle(cfg.tires),
      arcade: cfg.arcade,
      downforcePerKg: cfg.downforceCoefficient / cfg.massKg, steerPeakSlipScale: cfg.steerPeakSlipScale,
    }
    this.frontAxleZ = Math.max(...zs)
    this.rearAxleZ = Math.min(...zs)
    // Split drive between axles: front = +Z. With both axles driven, the front
    // gets frontDriveShare; otherwise the driven axle takes everything.
    const zMid = (Math.max(...zs) + Math.min(...zs)) / 2
    const isFront = (w: WheelConfig) => w.position[2] > zMid
    const frontDriven = cfg.wheels.filter((w) => w.driven && isFront(w)).length
    const rearDriven = cfg.wheels.filter((w) => w.driven && !isFront(w)).length
    const frontShare = !frontDriven ? 0 : !rearDriven ? 1 : cfg.frontDriveShare
    this.driveShare = cfg.wheels.map((w) =>
      !w.driven ? 0 : isFront(w) ? frontShare / frontDriven : (1 - frontShare) / rearDriven,
    )
    this.drivenRadius = cfg.wheels.find((w) => w.driven)?.radius ?? 0.35
    this.isRear = cfg.wheels.map((w) => !isFront(w))
    this.burnoutWheel = cfg.wheels.map((w) => w.driven && (rearDriven > 0 ? !isFront(w) : isFront(w)))
    this.wheels = cfg.wheels.map((w) => ({
      cfg: w,
      suspension: new Suspension(cfg.suspension),
      grounded: false,
      contactPoint: new THREE.Vector3(),
      spin: 0,
      slip: 0,
      slide: 0,
      surface: Surface.Asphalt,
    }))
  }

  /** Apply all forces for one fixed tick. Call before PhysicsWorld.step(). */
  update(input: InputState, dt: number): void {
    const cfg = this.cfg
    const driftCfg = this.eventDrift ?? cfg.drift
    const body = this.body
    const r = body.rotation()
    const t = body.translation()
    _q.set(r.x, r.y, r.z, r.w)
    _pos.set(t.x, t.y, t.z)
    _up.set(0, 1, 0).applyQuaternion(_q)
    _fwd.set(0, 0, 1).applyQuaternion(_q)
    _right.set(-1, 0, 0).applyQuaternion(_q)

    const lv = body.linvel()
    _vel.set(lv.x, lv.y, lv.z)
    this.forwardSpeed = _vel.dot(_fwd)
    const speed = Math.abs(this.forwardSpeed)

    // Steering: limit road-speed lock to the grip-supported turn plus a tire-slip
    // allowance. Turn-in still slows with speed; returning to center is faster.
    // In a drift the driver needs real opposite lock, so the high-speed limit opens up.
    const gripFactor = 1 / (1 + speed / cfg.steerFalloffSpeed)
    const speedFactor = gripFactor + (Math.max(gripFactor, 0.55) - gripFactor) * this.drift.amount
    const available = steeringLimit(this.steeringConfig, speed, input.handbrake ? 1 : this.drift.amount, surfaceProps(this.surfaceAt(t.x,t.z)).grip)
    const targetSteer = -input.steer * available
    if (input.steerSource === 'keyboard') {
      this.steerAngle = keyboardSteeringAngle(this.steerAngle, targetSteer, available, dt, cfg.keyboardSteering)
    } else {
      const centering = Math.abs(targetSteer) < Math.abs(this.steerAngle) || targetSteer * this.steerAngle < 0
      const maxDelta = cfg.steerSpeed * speedFactor * (centering ? cfg.steerReturnScale : 1) * dt
      this.steerAngle += Math.max(-maxDelta, Math.min(maxDelta, targetSteer - this.steerAngle))
    }

    // Pedals ramp instead of stepping; brakes bite twice as fast as the throttle.
    this.throttle = approach(this.throttle, input.throttle, cfg.pedalRate * dt)
    this.brake = approach(this.brake, input.brake, cfg.pedalRate * 2 * dt)

    // Reverse logic: brake at standstill engages reverse, throttle at standstill
    // goes back to 1st; in reverse, pedals swap.
    const reversing = this.drivetrain.gear < 0
    // Total speed, not forward speed: forward speed crosses 0 mid-spin.
    const stopped = _vel.length() < 1
    // Both pedals at a standstill is a burnout, which wants 1st (brake-then-throttle
    // used to drop into reverse first and back away instead).
    const burnoutPedals = input.throttle >= BURNOUT_THROTTLE && input.brake >= BURNOUT_BRAKE
    const gearRequest: GearRequest = !stopped
      ? 0
      : burnoutPedals
        ? 1
        : input.brake > 0.1 && input.throttle < 0.1
        ? -1
        : input.throttle > 0.1 && input.brake < 0.1
          ? 1
          : 0
    const driveThrottle = reversing ? this.brake : this.throttle
    const brakeInput = reversing ? this.throttle : this.brake
    this.braking = brakeInput

    // Nitro reads last tick's tire slip; boosting only pushes forward gears.
    let slipSum = 0
    let groundedCount = 0
    for (const w of this.wheels) {
      if (!w.grounded) continue
      slipSum += w.slip
      groundedCount++
    }
    this.nitro.update(
      {
        slip: groundedCount ? slipSum / groundedCount : 0,
        speed: _vel.length(),
        grounded: groundedCount > 0,
        airborne: groundedCount === 0,
        drifting: this.drift.active,
        wantsBoost: input.nitro && !reversing,
        drafting: this.drafting,
      },
      dt,
    )

    this.burnout.update(dt, {
      throttle: input.throttle,
      brake: input.brake,
      handbrake: input.handbrake,
      speed,
      forward: this.drivetrain.gear > 0 || (stopped && burnoutPedals),
      grounded: groundedCount > 0,
    })

    const gearBefore = this.drivetrain.gear
    const driveForce = this.drivetrain.update(this.forwardSpeed, this.drivenRadius, driveThrottle, gearRequest, dt, brakeInput)
    const burn = this.burnout.intensity
    // The engine screams against the spinning tyres (the drivetrain alone would sit at its clutch-slip revs).
    if (burn > 0) this.drivetrain.rpm = Math.max(this.drivetrain.rpm, cfg.engine.idleRpm + (cfg.engine.redlineRpm * BURNOUT_RPM - cfg.engine.idleRpm) * burn * input.throttle)
    this.backfire.update(dt, {
      throttle: reversing ? 0 : input.throttle,
      revs: this.drivetrain.rpm / cfg.engine.redlineRpm,
      gear: this.drivetrain.gear,
      burnout: burn,
      nitroLit: this.nitro.ignited,
    })
    const downshift = this.drivetrain.gear > 0 && this.drivetrain.gear < gearBefore

    // Drift: entries (fast turn-in, brake-tap, downshift, handbrake) and exits.
    const sideways = Math.abs(lv.x * _right.x + lv.y * _right.y + lv.z * _right.z)
    this.drift.update(
      {
        speed,
        steer: input.steer,
        throttle: driveThrottle,
        // The raw pedal, not the ramped one: the ramp's fade after release would
        // overlap turning in and read as a tap made while steering.
        brake: reversing ? input.throttle : input.brake,
        handbrake: input.handbrake,
        slipAngle: Math.atan2(sideways, Math.max(speed, 0.1)),
        downshift,
        // Normal keyboard cornering must not switch to scripted drift on brake release.
        allowBrakeTap: input.steerSource !== 'keyboard' || this.eventDrift !== null,
      },
      driftCfg,
      dt,
    )
    if (this.drift.entry !== 0 && !input.handbrake) {
      // Swing the tail out toward the turn: +steer (right) yaws clockwise from above (−Y).
      _impulse.copy(_up).multiplyScalar(-this.drift.entry * driftCfg.kick * this.yawInertia)
      body.applyTorqueImpulse(_impulse, true)
    }
    const rearGrip = this.drift.rearGripScale(driveThrottle, driftCfg)
    const combinedRear = this.drift.amount > 0.3

    const massShare = cfg.massKg / this.wheels.length

    let supportCount = 0
    let supportGrip = 0
    _roadNormal.set(0, 0, 0)
    const arcadeBlend = cfg.arcade.enabled && !input.handbrake ? 1 - this.drift.amount : 0
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i]
      const wc = w.cfg
      _mount.set(wc.position[0], wc.position[1], wc.position[2]).applyQuaternion(_q).add(_pos)

      _ray.origin = { x: _mount.x, y: _mount.y, z: _mount.z }
      _ray.dir = { x: -_up.x, y: -_up.y, z: -_up.z }
      const maxDist = cfg.suspension.restLength + wc.radius
      const contact = this.world.castRayAndGetNormal(_ray, maxDist, true, undefined, undefined, undefined, body)
      const hit = contact && contact.normal.x * _up.x + contact.normal.y * _up.y + contact.normal.z * _up.z > .35 ? contact : null

      const load = w.suspension.update(hit ? hit.timeOfImpact : null, wc.radius, dt)
      w.grounded = !!hit
      if (!hit) {
        w.slip = 0
        w.slide = 0
        if (wc.driven) w.spin += driveThrottle * 30 * dt
        continue
      }

      w.contactPoint.copy(_mount).addScaledVector(_up, -hit.timeOfImpact)
      w.surface = this.surfaceAt(w.contactPoint.x, w.contactPoint.z)
      const ground = surfaceProps(w.surface)
      if (load > 0) {
        supportCount++
        supportGrip += ground.grip
        _roadNormal.x += hit.normal.x
        _roadNormal.y += hit.normal.y
        _roadNormal.z += hit.normal.z
      }

      // Suspension pushes the chassis along its up axis.
      _impulse.copy(_up).multiplyScalar(load * dt)
      body.applyImpulseAtPoint(_impulse, w.contactPoint, true)

      // Tire frame (steered wheels rotate around the chassis up axis).
      _wFwd.copy(_fwd)
      _wRight.copy(_right)
      if (wc.steered) {
        _wFwd.applyAxisAngle(_up, this.steerAngle)
        _wRight.applyAxisAngle(_up, this.steerAngle)
      }
      const pv = body.velocityAtPoint(w.contactPoint)
      _vel.set(pv.x, pv.y, pv.z)
      const vLong = _vel.dot(_wFwd)
      const vLat = _vel.dot(_wRight)

      // Held in a burnout, the drive goes into spinning the tyres, not moving the car.
      let longitudinal = this.burnout.holding ? 0 : driveForce * this.driveShare[i]
      const brake = (cfg.brakeForce / this.wheels.length) * brakeInput + (wc.handbrake && input.handbrake ? cfg.handbrakeForce / 2 : 0)
      if (brake > 0) {
        // Clamp so brakes stop the wheel instead of reversing it.
        const stop = (Math.abs(vLong) * massShare) / dt
        longitudinal -= Math.sign(vLong) * Math.min(brake, stop)
      }

      const tire = computeTireForces(
        {
          vLong,
          vLat,
          load,
          longitudinalForce: longitudinal,
          handbrake: wc.handbrake && input.handbrake,
          massShare,
          dt,
          surfaceGrip: ground.grip,
          surfaceDrag: ground.drag,
          // Spinning in a burnout, these tyres get no arcade grip assist: the tail must be free to swing.
          arcadeGripScale: 1 + (cfg.arcade.lateralGripMultiplier - 1) * arcadeBlend * ground.grip * (this.burnoutWheel[i] ? 1 - burn : 1),
          postPeakGrip: cfg.arcade.postPeakGrip * arcadeBlend * ground.grip * (this.burnoutWheel[i] ? 1 - burn : 1),
          // In a drift the guidance carves the path, so the tires' sideways grip steps back.
          lateralGripScale: (this.isRear[i] ? rearGrip : 1) * (1 - driftCfg.lateralRelief * this.drift.amount) *
            (this.burnoutWheel[i] ? 1 - (1 - BURNOUT_LATERAL_GRIP) * burn : 1),
          combined: this.isRear[i] && combinedRear,
        },
        cfg.tires,
      )
      w.slip = tire.slip
      w.slide = tire.slide
      if (burn > 0 && this.burnoutWheel[i]) {
        // The tread is spinning over the road: that's what smokes, marks and squeals.
        w.slip = Math.max(w.slip, burn)
        w.slide = Math.max(w.slide, burn * BURNOUT_SLIDE)
      }

      // Apply tire forces slightly above the contact patch to tame body roll.
      _point.copy(w.contactPoint).addScaledVector(_up, wc.radius * 0.6)
      _impulse
        .copy(_wFwd)
        .multiplyScalar(tire.longitudinal * dt)
        .addScaledVector(_wRight, tire.lateral * dt)
      body.applyImpulseAtPoint(_impulse, _point, true)

      w.spin += (vLong / wc.radius + (this.burnoutWheel[i] ? burn * BURNOUT_SPIN : 0)) * dt
    }

    if (cfg.arcade.enabled) {
      this.applyArcadeHandling(supportCount, supportGrip, arcadeBlend, lv, dt)
    } else {
      this.applyStabilityAssist(input.handbrake, speed, lv, dt)
    }
    this.applyDriftGuidance(input.steer, groundedCount, dt)
    // Rotating burnout: steer to swing the tail round on the spot, pivoting on the held front wheels.
    if (this.burnout.holding && groundedCount > 2 && Math.abs(input.steer) > 0.05) {
      const av = body.angvel()
      const yawRate = av.x * _up.x + av.y * _up.y + av.z * _up.z
      const target = -input.steer * BURNOUT_YAW_RATE * burn
      _impulse.copy(_up).multiplyScalar((target - yawRate) * (1 - Math.exp(-14 * dt)) * this.yawInertia)
      body.applyTorqueImpulse(_impulse, true)
    }

    // Nitro is thrust at the center of mass, not tire force: the rears are
    // already near their grip limit under power, so routing it through the
    // friction circle would mostly turn into wheelspin. Grounded only.
    if (this.nitro.intensity > 0 && groundedCount > 0) {
      _impulse.copy(_fwd).multiplyScalar((this.nitro.force + this.nitro.surgeForce) * dt)
      body.applyImpulse(_impulse, true)
    }

    // Launch: like nitro, a push at the centre of mass, so it isn't lost to
    // wheelspin. A reward needs the throttle in a forward gear; a bog only
    // slows a car that's already rolling forward, so it can never pull it back.
    const launch = this.launchPush
    if (launch !== 0 && groundedCount > 0 && this.drivetrain.gear > 0 && (launch > 0 ? driveThrottle > 0.1 : this.forwardSpeed > 1)) {
      _impulse.copy(_fwd).multiplyScalar(launch * cfg.massKg * dt)
      body.applyImpulse(_impulse, true)
    }

    // Aerodynamics: quadratic drag through the centre of mass, downforce
    // (from airflow along the car, so forward speed) split over the axles by
    // the car's aero balance — a rear wing pins the rear, not the middle.
    _vel.set(lv.x, lv.y, lv.z)
    const v2 = _vel.lengthSq()
    if (v2 > 0.01) {
      _impulse.copy(_vel).normalize().multiplyScalar(-cfg.dragCoefficient * this.nitro.dragScale * v2 * dt)
      body.applyImpulse(_impulse, true)
      const down = cfg.downforceCoefficient * this.forwardSpeed * this.forwardSpeed * dt
      const comY = cfg.centerOfMass[1]
      _point.set(0, comY, this.frontAxleZ).applyQuaternion(_q).add(_pos)
      body.applyImpulseAtPoint(_impulse.copy(_up).multiplyScalar(-down * cfg.downforceFrontShare), _point, true)
      _point.set(0, comY, this.rearAxleZ).applyQuaternion(_q).add(_pos)
      body.applyImpulseAtPoint(_impulse.copy(_up).multiplyScalar(-down * (1 - cfg.downforceFrontShare)), _point, true)
    }
  }

  /** Grounded arcade yaw and trajectory support, bounded by the authored tune. */
  private applyArcadeHandling(contacts: number, gripSum: number, blend: number, initial: RAPIER.Vector, dt: number): void {
    const cfg = this.cfg.arcade
    if (contacts < 3 || blend <= 0 || this.forwardSpeed < cfg.minSpeed) return
    _roadNormal.normalize()
    _roadForward.copy(_fwd).addScaledVector(_roadNormal, -_fwd.dot(_roadNormal)).normalize()
    _roadRight.crossVectors(_roadForward, _roadNormal).normalize()
    const grip = Math.max(.1, Math.min(1, gripSum / contacts))
    const strength = blend * contacts / this.wheels.length
    const forward = initial.x * _roadForward.x + initial.y * _roadForward.y + initial.z * _roadForward.z
    const side = initial.x * _roadRight.x + initial.y * _roadRight.y + initial.z * _roadRight.z
    const maxAcceleration = cfg.maxLateralG * 9.81 * grip
    const yawLimit = maxAcceleration / Math.max(cfg.minSpeed, Math.abs(forward))
    const target = Math.max(-yawLimit, Math.min(yawLimit, forward * Math.tan(this.steerAngle) / this.wheelbase))
    const angular = this.body.angvel()
    const yaw = angular.x * _roadNormal.x + angular.y * _roadNormal.y + angular.z * _roadNormal.z
    const correction = (target - yaw) * (1 - Math.exp(-cfg.yawResponse * dt))
    const maxChange = cfg.maxYawAcceleration * dt
    _impulse.copy(_roadNormal).multiplyScalar(Math.max(-maxChange, Math.min(maxChange, correction)) * this.yawInertia * strength)
    this.body.applyTorqueImpulse(_impulse, true)

    // Supply only the lateral acceleration the tires have not already delivered.
    const desired = Math.max(-maxAcceleration, Math.min(maxAcceleration, -forward * target - side * cfg.sidewaysRecovery)) * dt
    const current = this.body.linvel()
    const delivered = (current.x - initial.x) * _roadRight.x + (current.y - initial.y) * _roadRight.y + (current.z - initial.z) * _roadRight.z
    const budget = cfg.assistMaxG * 9.81 * grip * dt
    _impulse.copy(_roadRight).multiplyScalar(Math.max(-budget, Math.min(budget, desired - delivered)) * this.cfg.massKg * strength)
    this.body.applyImpulse(_impulse, true)
  }

  /**
   * ESC-style yaw trim. The bicycle model gives the yaw rate the steering asks
   * for (v·tanδ/L), capped by what the tires can hold (μg/v, with extra room
   * on the brakes for trail-brake rotation). Rotation beyond
   * that, or against it, is damped back; understeer is left alone.
   *
   * Drifts: once the car is travelling sideways and the driver countersteers,
   * the assist backs off to `driftAssist` so the slide can be held and steered
   * on throttle and opposite lock — until the angle passes `maxDriftAngle`,
   * where it comes back in full to catch a spin (like a sport-mode ESC).
   */
  private applyStabilityAssist(handbrake: boolean, speed: number, lv: RAPIER.Vector, dt: number): void {
    const cfg = this.cfg
    let rate = cfg.yawStability
    if (rate <= 0 || handbrake || speed < 3) return
    const yaw = this.body.angvel()
    const yawRate = yaw.x * _up.x + yaw.y * _up.y + yaw.z * _up.z
    // Follow available tire load, including aerodynamic load. Damping toward the
    // steady turn rate catches oscillation on both sides of the target.
    const normalAcceleration = 9.81 + cfg.downforceCoefficient * speed * speed / cfg.massKg
    const gripLimit = (cfg.tires.grip * normalAcceleration * (1.15 + TRAIL_BRAKE_ROTATION * this.brake)) / speed
    const wanted = (this.forwardSpeed * Math.tan(this.steerAngle)) / this.wheelbase
    const target = Math.max(-gripLimit, Math.min(gripLimit, wanted))
    const excess = yawRate - target
    // Tire forces supply turn-in; use a gentler correction while building yaw.
    if (yawRate * target >= 0 && Math.abs(yawRate) < Math.abs(target)) rate *= 0.2
    if (excess === 0) return

    const sideways = Math.abs(lv.x * _right.x + lv.y * _right.y + lv.z * _right.z)
    const driftAngle = Math.atan2(sideways, Math.abs(this.forwardSpeed))
    const countersteering = wanted * yawRate < 0
    // Relax in a countersteered slide, or while a drift is under way; either way
    // it comes back in full past maxDriftAngle to catch a spin.
    const relax = Math.max(countersteering && driftAngle > DRIFT_MIN_ANGLE ? 1 : 0, this.drift.amount)
    if (relax > 0) {
      const t = Math.min(1, Math.max(0, (driftAngle - cfg.maxDriftAngle * 0.8) / (cfg.maxDriftAngle * 0.2)))
      const scale = cfg.driftAssist + (1 - cfg.driftAssist) * t
      rate *= 1 - relax * (1 - scale)
    }
    // A guided drift holds its own angle (applyDriftGuidance); the assist steps aside.
    rate *= 1 - this.drift.amount
    const k = 1 - Math.exp(-rate * dt)
    _impulse.copy(_up).multiplyScalar(-excess * this.yawInertia * k)
    this.body.applyTorqueImpulse(_impulse, true)
  }

  /**
   * Arcade drift (NFS / Asphalt): while a drift is on, carve the direction of
   * travel along the drift's arc, keeping the speed (less a little scrub), and
   * swing the body to the drift angle. Both are blended in by `drift.amount`,
   * so entries and exits ease rather than snap. Steering sets the angle and
   * the arc (see Drift.guide).
   */
  private applyDriftGuidance(steer: number, groundedCount: number, dt: number): void {
    const amount = this.drift.amount
    if (amount < 0.01 || groundedCount < 2) return
    const cfgD = this.eventDrift ?? this.cfg.drift
    const body = this.body
    const lv = body.linvel()
    _vh.set(lv.x, lv.y, lv.z)
    _vh.addScaledVector(_up, -_vh.dot(_up))
    const speed = _vh.length()
    if (speed < 4) return
    const guide = this.drift.guide(steer, speed, cfgD, this.driftGuide)

    // Carve: turn the travel direction at the arc's rate, keeping its speed.
    _carve.copy(_vh).applyAxisAngle(_up, guide.pathRate * dt).multiplyScalar(Math.exp(-cfgD.scrub * dt))
    _impulse.subVectors(_carve, _vh).multiplyScalar(this.cfg.massKg * amount)
    body.applyImpulse(_impulse, true)

    // Angle: body slip β (signed, travel direction → nose) toward the target,
    // on top of turning with the arc.
    _fh.copy(_fwd).addScaledVector(_up, -_fwd.dot(_up)).normalize()
    _vh.divideScalar(speed)
    const beta = Math.atan2(_cross.crossVectors(_vh, _fh).dot(_up), _vh.dot(_fh))
    const av = body.angvel()
    const yawRate = av.x * _up.x + av.y * _up.y + av.z * _up.z
    const wanted = guide.pathRate + cfgD.angleGain * (guide.angle - beta)
    const k = 1 - Math.exp(-cfgD.yawResponse * dt)
    _impulse.copy(_up).multiplyScalar((wanted - yawRate) * k * amount * this.yawInertia)
    body.applyTorqueImpulse(_impulse, true)
  }

  /** Throttle pedal after ramping, 0..1: what the engine actually gets (audio reads it). */
  get throttlePedal(): number {
    return this.drivetrain.gear < 0 ? this.brake : this.throttle
  }

  reset(): void {
    this.forwardSpeed = 0
    this.steerAngle = 0
    this.drafting = 0
    this.launchPush = 0
    this.throttle = 0
    this.brake = 0
    this.braking = 0
    this.drivetrain.reset()
    this.nitro.reset()
    this.drift.reset()
    this.burnout.reset()
    this.backfire.reset()
    for (const w of this.wheels) {
      w.suspension.reset()
      w.slip = 0
      w.slide = 0
      w.surface = Surface.Asphalt
    }
  }
}
