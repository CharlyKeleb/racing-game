import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { InputState } from '../input/InputManager'
import type { CarModel } from './CarModel'
import { VehicleController } from './VehicleController'
import type { VehicleConfig } from './VehicleConfig'

/** Fixed tick length the vehicle is stepped at (matches GameLoop.FIXED_DT). */
const TICK = 1 / 60
/**
 * Visual weight transfer, on top of what the physics body does. Degrees of body
 * pitch / roll per m/s² of acceleration, their limits, and the spring the body
 * settles on — a touch under-damped so it bobs once, like real suspension.
 */
const PITCH_PER_ACCEL = 0.28
const ROLL_PER_ACCEL = 0.36
/**
 * Squat (nose up) is capped well below dive: a stiff sports car barely squats,
 * and nitro's surge pinned the old shared 3.5° cap, lifting the nose ~13 cm
 * off the front wheels so the car looked airborne.
 */
const MAX_SQUAT = 1.2
const MAX_DIVE = 2.5
const MAX_ROLL = 4.5
const LEAN_FREQ = 9 // rad/s
const LEAN_DAMPING = 0.5
/** Acceleration low-pass, 1/s: tick-to-tick contact noise would make the body buzz. */
const ACCEL_SMOOTHING = 9
const DEG = Math.PI / 180

const _v = new THREE.Vector3()
const _a = new THREE.Vector3()
const _f = new THREE.Vector3()
const _l = new THREE.Vector3()
const _pivot = new THREE.Vector3()
const _euler = new THREE.Euler()

/** Smoothed chassis motion in the car's frame, for the camera and body lean. */
export interface VehicleMotion {
  /** m/s², + = speeding up. */
  accelLong: number
  /** m/s², + = toward the car's left (turning left). */
  accelLat: number
  /** World velocity, m/s. */
  velocity: THREE.Vector3
}

export interface SpawnPoint {
  position: THREE.Vector3
  /** Yaw in radians; 0 faces +Z. */
  heading: number
}

/**
 * A car in the world: Rapier chassis body + raycast controller + interpolated
 * visual model. Owns nothing global — Game wires it to input and camera.
 */
export class Vehicle {
  readonly config: VehicleConfig
  readonly controller: VehicleController
  readonly model: CarModel
  readonly body: RAPIER.RigidBody
  /** The chassis box: only touches things in a hit (the wheels are raycasts). */
  readonly chassis: RAPIER.Collider
  readonly massKg: number
  /**
   * Physics ticks left in which hits are ignored: a respawn drops the car onto
   * the road, and landing (or spawning against something) isn't a crash.
   */
  quietTicks = 0

  // Physics state at the previous and current tick, for render interpolation.
  private readonly prevPos = new THREE.Vector3()
  private readonly currPos = new THREE.Vector3()
  private readonly prevQuat = new THREE.Quaternion()
  private readonly currQuat = new THREE.Quaternion()
  // Steer angle and per-wheel suspension offset at the previous/current tick, same idea.
  private prevSteer = 0
  private currSteer = 0
  private readonly prevOffset: number[]
  private readonly currOffset: number[]
  readonly motion: VehicleMotion = { accelLong: 0, accelLat: 0, velocity: new THREE.Vector3() }
  private readonly lastVel = new THREE.Vector3()
  // Body lean spring state, radians and rad/s.
  /** Body lean pivot height: the axle line (mean wheel radius). */
  private readonly pivotHeight: number
  private pitch = 0
  private pitchVel = 0
  private roll = 0
  private rollVel = 0
  /** Tail-light materials (owned copies), lit up under braking. */
  private readonly taillights: THREE.MeshStandardMaterial[] = []
  /** Headlight lens materials (owned copies), lit at night. */
  private readonly headlights: THREE.MeshStandardMaterial[] = []
  private brakeGlow = 0
  /** Night driving: headlight lenses glow and the tail lights run brighter. */
  lightsOn = false

  constructor(config: VehicleConfig, model: CarModel, world: RAPIER.World, spawn: SpawnPoint) {
    this.config = config
    this.pivotHeight = config.wheels.reduce((sum, w) => sum + w.radius, 0) / config.wheels.length
    this.model = model

    const [hx, hy, hz] = config.chassisHalfExtents
    const m = config.massKg
    // Box inertia from the collision hull; COM comes from config (kept low).
    const inertia = {
      x: (m / 3) * (hy * hy + hz * hz),
      y: (m / 3) * (hx * hx + hz * hz),
      z: (m / 3) * (hx * hx + hy * hy),
    }
    const [comX, comY, comZ] = config.centerOfMass
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setAdditionalMassProperties(m, { x: comX, y: comY, z: comZ }, inertia, { x: 0, y: 0, z: 0, w: 1 })
      .setLinearDamping(0) // air drag and rolling resistance are modelled in VehicleController
      .setAngularDamping(0.6)
      .setCcdEnabled(true)
    this.body = world.createRigidBody(bodyDesc)

    const [cx, cy, cz] = config.chassisCenter
    // The wheels are raycasts, so this box only touches things in a real hit
    // (another car, a wall, the ground when bottoming out): it reports the
    // contact force for the crash sounds. 1.5 g filters out brushing contacts.
    this.chassis = world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setDensity(0).setFriction(0.2).setRestitution(0.1)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(m * 9.81 * 1.5),
      this.body,
    )
    this.massKg = m

    this.controller = new VehicleController(config, this.body, world)
    model.root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const mat = mesh.material as THREE.MeshStandardMaterial
      if (Array.isArray(mat) || !mat?.isMeshStandardMaterial) return
      if (/^lights$|head ?light/i.test(mat.name)) {
        const own = mat.clone()
        own.emissive.setRGB(1, 0.96, 0.88)
        own.emissiveIntensity = 0
        mesh.material = own
        this.headlights.push(own)
        return
      }
      if (!/tail ?light|brake ?light/i.test(mat.name)) return
      const own = mat.clone()
      // Deep red lens; a saturated red glow survives tone mapping as red, not pale orange.
      own.color.setRGB(0.55, 0.06, 0.05)
      own.emissive.setRGB(1, 0.02, 0.01)
      own.emissiveMap = null // a baked lens texture would tint the glow orange
      own.emissiveIntensity = 0
      mesh.material = own
      this.taillights.push(own)
    })
    this.prevOffset = config.wheels.map(() => config.suspension.restLength)
    this.currOffset = [...this.prevOffset]
    this.respawn(spawn)
  }

  get position(): THREE.Vector3 {
    return this.model.root.position
  }

  get quaternion(): THREE.Quaternion {
    return this.model.root.quaternion
  }

  get speedKmh(): number {
    return Math.abs(this.controller.forwardSpeed) * 3.6
  }

  fixedUpdate(input: InputState, dt: number): void {
    if (this.quietTicks > 0) this.quietTicks--
    this.controller.update(input, dt)
  }

  /** Call after the physics step to record the new tick's transform. */
  capture(): void {
    this.prevPos.copy(this.currPos)
    this.prevQuat.copy(this.currQuat)
    const t = this.body.translation()
    const r = this.body.rotation()
    this.currPos.set(t.x, t.y, t.z)
    this.currQuat.set(r.x, r.y, r.z, r.w)
    this.prevSteer = this.currSteer
    this.currSteer = this.controller.steerAngle
    const wheels = this.controller.wheels
    for (let i = 0; i < wheels.length; i++) {
      this.prevOffset[i] = this.currOffset[i]
      this.currOffset[i] = wheels[i].suspension.wheelOffset()
    }

    // Acceleration in the car's frame, low-passed. Clamped: a barrier hit is
    // a spike the body shouldn't fold over.
    const lv = this.body.linvel()
    _v.set(lv.x, lv.y, lv.z)
    _a.subVectors(_v, this.lastVel).divideScalar(TICK)
    this.lastVel.copy(_v)
    _f.set(0, 0, 1).applyQuaternion(this.currQuat)
    _l.set(1, 0, 0).applyQuaternion(this.currQuat)
    const k = 1 - Math.exp(-ACCEL_SMOOTHING * TICK)
    const m = this.motion
    m.accelLong += (THREE.MathUtils.clamp(_a.dot(_f), -25, 25) - m.accelLong) * k
    m.accelLat += (THREE.MathUtils.clamp(_a.dot(_l), -25, 25) - m.accelLat) * k
    m.velocity.copy(_v)
  }

  /**
   * Interpolate visuals between ticks, pose the wheels, lean the body and
   * light the brakes. `dt` = 0 (paused, snapshots) freezes the springs.
   */
  render(alpha: number, dt = 0): void {
    const root = this.model.root
    root.position.lerpVectors(this.prevPos, this.currPos, alpha)
    root.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha)

    const steer = this.prevSteer + (this.currSteer - this.prevSteer) * alpha
    const wheels = this.controller.wheels
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i]
      const rig = this.model.wheels[w.cfg.id]
      const [x, y, z] = w.cfg.position
      const offset = this.prevOffset[i] + (this.currOffset[i] - this.prevOffset[i]) * alpha
      rig.pivot.position.set(x, y - offset, z)
      rig.pivot.rotation.y = w.cfg.steered ? steer : 0
      rig.spinner.rotation.x = w.spin
    }

    if (dt > 0) {
      const h = Math.min(dt, 1 / 20)
      // Braking dives the nose (+X rotation tips +Z down); speeding up squats it.
      const pitchTarget = THREE.MathUtils.clamp(-this.motion.accelLong * PITCH_PER_ACCEL, -MAX_SQUAT, MAX_DIVE) * DEG
      // Cornering rolls the body to the outside: turning left lifts the left (+X) side.
      const rollTarget = THREE.MathUtils.clamp(this.motion.accelLat * ROLL_PER_ACCEL, -MAX_ROLL, MAX_ROLL) * DEG
      const w2 = LEAN_FREQ * LEAN_FREQ
      const c = 2 * LEAN_DAMPING * LEAN_FREQ
      this.pitchVel += (w2 * (pitchTarget - this.pitch) - c * this.pitchVel) * h
      this.pitch += this.pitchVel * h
      this.rollVel += (w2 * (rollTarget - this.roll) - c * this.rollVel) * h
      this.roll += this.rollVel * h
      // Lean about the axle line, not the ground under the car: pivoting at
      // ground level swung the whole body up and away from its wheels.
      const body = this.model.body
      _euler.set(this.pitch, 0, this.roll)
      body.rotation.copy(_euler)
      _pivot.set(0, this.pivotHeight, 0)
      body.position.copy(_pivot).sub(_pivot.applyEuler(_euler))

      // Kept near 1: ACES tone mapping washes brighter emissive out toward white.
      const running = this.lightsOn ? 0.45 : 0.15
      const glowTarget = this.controller.braking > 0.05 ? 1.3 : running // brake lights vs running lights
      const lens = this.lightsOn ? 1.6 : 0
      for (const mat of this.headlights) mat.emissiveIntensity = lens
      this.brakeGlow += (glowTarget - this.brakeGlow) * (1 - Math.exp(-25 * h))
      for (const mat of this.taillights) mat.emissiveIntensity = this.brakeGlow
    }
  }

  /** Only the lamp copies belong to Vehicle; source model resources are shared. */
  disposeMaterials(): void {
    for (const material of this.headlights) material.dispose()
    for (const material of this.taillights) material.dispose()
  }

  respawn(spawn: SpawnPoint): void {
    this.quietTicks = 30
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spawn.heading)
    this.body.setTranslation(spawn.position, true)
    this.body.setRotation(q, true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.controller.reset()
    this.currPos.copy(spawn.position)
    this.currQuat.copy(q)
    this.prevPos.copy(spawn.position)
    this.prevQuat.copy(q)
    this.prevSteer = this.currSteer = 0
    this.lastVel.set(0, 0, 0)
    this.motion.accelLong = this.motion.accelLat = 0
    this.motion.velocity.set(0, 0, 0)
    this.pitch = this.pitchVel = this.roll = this.rollVel = 0
    this.model.body.rotation.set(0, 0, 0)
    this.model.body.position.set(0, 0, 0)
  }
}
