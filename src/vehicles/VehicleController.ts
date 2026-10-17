import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { InputState } from '../input/InputManager'
import { Drivetrain } from './Drivetrain'
import { Suspension } from './Suspension'
import { computeTireForces } from './TirePhysics'
import type { VehicleConfig, WheelConfig } from './VehicleConfig'

/** Per-wheel runtime state, read by visuals, audio and effects. */
export interface WheelState {
  cfg: WheelConfig
  suspension: Suspension
  grounded: boolean
  contactPoint: THREE.Vector3
  /** Accumulated roll angle for the visual wheel, radians. */
  spin: number
  /** 0..1, for skid marks / tire squeal. */
  slip: number
}

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
  steerAngle = 0
  /** Signed forward speed of the chassis, m/s. */
  forwardSpeed = 0
  /** Pedals after ramping, 0..1. Keyboards are on/off; this fades them in over ~1/pedalRate s. */
  private throttle = 0
  private brake = 0
  /** Chassis yaw inertia (matches Vehicle's box inertia) and front-to-rear axle distance. */
  private readonly yawInertia: number
  private readonly wheelbase: number
  private readonly cfg: VehicleConfig
  private readonly body: RAPIER.RigidBody
  private readonly world: RAPIER.World

  constructor(cfg: VehicleConfig, body: RAPIER.RigidBody, world: RAPIER.World) {
    this.cfg = cfg
    this.body = body
    this.world = world
    this.drivetrain = new Drivetrain(cfg.engine)
    const [hx, , hz] = cfg.chassisHalfExtents
    this.yawInertia = (cfg.massKg / 3) * (hx * hx + hz * hz)
    const zs = cfg.wheels.map((w) => w.position[2])
    this.wheelbase = Math.max(1, Math.max(...zs) - Math.min(...zs))
    this.wheels = cfg.wheels.map((w) => ({
      cfg: w,
      suspension: new Suspension(cfg.suspension),
      grounded: false,
      contactPoint: new THREE.Vector3(),
      spin: 0,
      slip: 0,
    }))
  }

  /** Apply all forces for one fixed tick. Call before PhysicsWorld.step(). */
  update(input: InputState, dt: number): void {
    const cfg = this.cfg
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

    // Steering: angle and turn-in rate both shrink with speed, so a keyboard tap
    // at 200 km/h is a lane change, not a spin. Returning to center is faster.
    const speedFactor = 1 / (1 + speed / cfg.steerFalloffSpeed)
    const targetSteer = -input.steer * cfg.maxSteerAngle * speedFactor
    const centering = Math.abs(targetSteer) < Math.abs(this.steerAngle) || targetSteer * this.steerAngle < 0
    const maxDelta = cfg.steerSpeed * speedFactor * (centering ? cfg.steerReturnScale : 1) * dt
    this.steerAngle += Math.max(-maxDelta, Math.min(maxDelta, targetSteer - this.steerAngle))

    // Pedals ramp instead of stepping; brakes bite twice as fast as the throttle.
    this.throttle = approach(this.throttle, input.throttle, cfg.pedalRate * dt)
    this.brake = approach(this.brake, input.brake, cfg.pedalRate * 2 * dt)

    // Reverse logic: brake at standstill engages reverse; in reverse, pedals swap.
    const reversing = this.drivetrain.gear < 0
    // Total speed, not forward speed: forward speed crosses 0 mid-spin.
    const wantsReverse = input.brake > 0.1 && input.throttle < 0.1 && _vel.length() < 1
    const driveThrottle = reversing ? this.brake : this.throttle
    const brakeInput = reversing ? this.throttle : this.brake

    const driven = this.wheels.filter((w) => w.cfg.driven)
    const drivenRadius = driven[0]?.cfg.radius ?? 0.35
    const driveForce = this.drivetrain.update(this.forwardSpeed, drivenRadius, driveThrottle, wantsReverse, dt)
    const driveForcePerWheel = driven.length ? driveForce / driven.length : 0

    const massShare = cfg.massKg / this.wheels.length

    for (const w of this.wheels) {
      const wc = w.cfg
      _mount.set(wc.position[0], wc.position[1], wc.position[2]).applyQuaternion(_q).add(_pos)

      _ray.origin = { x: _mount.x, y: _mount.y, z: _mount.z }
      _ray.dir = { x: -_up.x, y: -_up.y, z: -_up.z }
      const maxDist = cfg.suspension.restLength + wc.radius
      const hit = this.world.castRay(_ray, maxDist, true, undefined, undefined, undefined, body)

      const load = w.suspension.update(hit ? hit.timeOfImpact : null, wc.radius, dt)
      w.grounded = !!hit
      if (!hit) {
        w.slip = 0
        if (wc.driven) w.spin += driveThrottle * 30 * dt
        continue
      }

      w.contactPoint.copy(_mount).addScaledVector(_up, -hit.timeOfImpact)

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

      let longitudinal = wc.driven ? driveForcePerWheel : 0
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
        },
        cfg.tires,
      )
      w.slip = tire.slip

      // Apply tire forces slightly above the contact patch to tame body roll.
      _point.copy(w.contactPoint).addScaledVector(_up, wc.radius * 0.6)
      _impulse
        .copy(_wFwd)
        .multiplyScalar(tire.longitudinal * dt)
        .addScaledVector(_wRight, tire.lateral * dt)
      body.applyImpulseAtPoint(_impulse, _point, true)

      w.spin += (vLong / wc.radius) * dt
    }

    this.applyStabilityAssist(input.handbrake, speed, dt)

    // Aerodynamics: quadratic drag + downforce.
    _vel.set(lv.x, lv.y, lv.z)
    const v2 = _vel.lengthSq()
    if (v2 > 0.01) {
      _impulse.copy(_vel).normalize().multiplyScalar(-cfg.dragCoefficient * v2 * dt)
      _impulse.addScaledVector(_up, -cfg.downforceCoefficient * this.forwardSpeed * this.forwardSpeed * dt)
      body.applyImpulse(_impulse, true)
    }
  }

  /**
   * ESC-style yaw trim. The bicycle model gives the yaw rate the steering asks
   * for (v·tanδ/L), capped by what the tires can hold (μg/v). Rotation beyond
   * that, or against it, is damped back; understeer is left alone.
   */
  private applyStabilityAssist(handbrake: boolean, speed: number, dt: number): void {
    const rate = this.cfg.yawStability
    if (rate <= 0 || handbrake || speed < 3) return
    const yaw = this.body.angvel()
    const yawRate = yaw.x * _up.x + yaw.y * _up.y + yaw.z * _up.z
    const gripLimit = (this.cfg.tires.grip * 9.81 * 1.15) / speed
    const wanted = (this.forwardSpeed * Math.tan(this.steerAngle)) / this.wheelbase
    const target = Math.max(-gripLimit, Math.min(gripLimit, wanted))
    const excess = yawRate - Math.max(Math.min(0, target), Math.min(Math.max(0, target), yawRate))
    if (excess === 0) return
    const k = 1 - Math.exp(-rate * dt)
    _impulse.copy(_up).multiplyScalar(-excess * this.yawInertia * k)
    this.body.applyTorqueImpulse(_impulse, true)
  }

  reset(): void {
    this.steerAngle = 0
    this.throttle = 0
    this.brake = 0
    this.drivetrain.reset()
    for (const w of this.wheels) {
      w.suspension.reset()
      w.slip = 0
    }
  }
}
