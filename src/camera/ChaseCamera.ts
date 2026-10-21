import { cockpitProfile, DEFAULT_COCKPIT_ADJUSTMENT, type CockpitAdjustment } from '../vehicles/CockpitConfig'
import { FeedbackSpring } from '../effects/FeedbackSpring'
import * as THREE from 'three'
import type { CameraMode } from '../stores/gameStore'
import type { VehicleMotion } from '../vehicles/Vehicle'

/** Race camera near plane (m). The showroom pushes it out; update() restores it. */
const NEAR = 0.1

const _desired = new THREE.Vector3()
const _look = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _side = new THREE.Vector3()
const _focus = new THREE.Vector3()
const _shake = new THREE.Vector3()
const _vdir = new THREE.Vector3()
const _cockpitEye = new THREE.Vector3()
const _cockpitQuaternion = new THREE.Quaternion()
const _cockpitAim = new THREE.Quaternion()
const _cockpitEuler = new THREE.Euler()

/** Where the showroom camera looks and from how far; see ChaseCamera.showroom. */
export interface ShowroomFraming {
  focus: THREE.Vector3
  distance: number
  height: number
  shift: number
  fov: number
}

/** Framerate-independent exponential smoothing factor. */
function damp(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * dt)
}

/**
 * Third-person chase cam with speed-based FOV + pull-back, and a cockpit mode.
 * Nitro adds an FOV kick, a longer pull-back and a buzz on top of the
 * speed shake, so a boost reads as a lurch forward.
 * Runs in render (not fixed) time, reading the interpolated car transform.
 */
export class ChaseCamera {
  mode: CameraMode = 'chase'
  /** Held override: never changes the selected mode or its normal offsets. */
  lookBack = false
  private wasLookingBack = false
  cameraMotion = true
  /** Speed and nitro FOV widening; off keeps the lens fixed (motion comfort). */
  fovEffects = true
  cockpitCar = 'porsche911'
  cockpitAdjustment: Readonly<CockpitAdjustment> = DEFAULT_COCKPIT_ADJUSTMENT
  private readonly head = new FeedbackSpring(12, .9)
  private lastMode: CameraMode = 'chase'
  private transition = 1
  viewOpacity = 1
  private readonly transitionPosition = new THREE.Vector3()
  private readonly transitionQuaternion = new THREE.Quaternion()
  private readonly reduced = typeof matchMedia === 'undefined' ? null : matchMedia('(prefers-reduced-motion: reduce)')
  private readonly camera: THREE.PerspectiveCamera
  private readonly lookTarget = new THREE.Vector3()
  /**
   * Camera and aim point relative to the car, smoothed. Smoothing the offset
   * (not the world position) keeps the camera from trailing further behind
   * the faster the car goes, while turns and bumps still swing it softly.
   */
  private readonly chaseOffset = new THREE.Vector3()
  private readonly lookOffset = new THREE.Vector3()
  private initialised = false

  /**
   * Framed like Need for Speed (2015): low and close, the car's rear filling
   * the lower middle of the screen with the horizon just above its roof.
   * Distance is from the car's centre, so ~2.4 m behind the bumper.
   */
  distance = 5.0
  height = 1.5
  /**
   * Extra chase distance at top speed, meters. A small pull-back lets the
   * car settle in frame without shrinking it away from the player.
   */
  speedPullBack = .65
  /** Aim point: this far ahead of the car's centre and this high, so the camera looks down the road, not at the roof. */
  lookAhead = 9
  lookHeight = 0.7
  baseFov = 58
  maxFovBoost = 15
  /**
   * Weight you can feel: meters the camera drops back per m/s² of
   * acceleration (the car surges away) or closes in under braking (the car
   * dives toward the lens), and its limits.
   */
  surge = 0.05
  maxSurgeBack = 0.6
  maxSurgeIn = 0.35
  /** Camera bank into a corner, radians per m/s² of lateral acceleration, and its limit. */
  bank = 0.0022
  maxBank = 0.035
  /** In a slide the camera swings toward the direction of travel by up to this share, so you see the car sideways. */
  driftFraming = 0.55
  /** Extra degrees of FOV at full nitro. */
  nitroFovKick = 9
  /** Extra chase distance at full nitro, meters (the car surges away from the lens). */
  nitroPullBack = 0.7
  /** Camera shake amplitude at top speed and at full nitro, meters. */
  speedShake = 0.009
  nitroShake = 0.025

  private readonly impactY = new FeedbackSpring(22, .72)
  private readonly impactZ = new FeedbackSpring(18, .75)
  private readonly impactRoll = new FeedbackSpring(20, .75)
  private lastJolt = -Infinity
  private lastJoltStrength = 0
  private lastJoltCurb = false
  /** Contact-driven impulse; the camera responds once, then settles. */
  jolt(strength: number, curb = false): void {
    const s = THREE.MathUtils.clamp(strength, 0, 1)
    if (curb && !this.lastJoltCurb && this.time - this.lastJolt < .12) return
    if (s <= 0 || (this.time - this.lastJolt < .12 && !(this.lastJoltCurb && !curb) && s <= this.lastJoltStrength + .2)) return
    this.lastJolt = this.time; this.lastJoltStrength = s; this.lastJoltCurb = curb
    this.impactY.velocity = Math.min(1.5, this.impactY.velocity + s * (curb ? .45 : 1.1))
    if (!curb) {
      this.impactZ.velocity = Math.min(2, this.impactZ.velocity + s * 1.4)
      this.impactRoll.velocity = THREE.MathUtils.clamp(this.impactRoll.velocity + Math.sin(this.time * 19) * s * .25, -.4, .4)
    }
  }

  private time = 0
  /** Nitro intensity, smoothed separately so the FOV kicks fast and relaxes slowly. */
  private kick = 0
  private appliedKick = 0

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera
  }

  /**
   * @param boost nitro intensity: 0..1, up to ~1.6 in a perfect boost (capped at 1.3 here).
   * @param motion the car's smoothed acceleration and velocity, for surge, bank and drift framing.
   */
  update(target: THREE.Object3D, speedKmh: number, dt: number, boost = 0, motion?: VehicleMotion, gridFraming = 0, cockpitBody?: THREE.Object3D): void {
    dt = Math.max(0, Math.min(dt, .1))
    const movement = this.cameraMotion && !this.reduced?.matches
    const near = !this.lookBack && this.mode === 'cockpit' && gridFraming === 0 ? .025 : NEAR
    if (this.camera.near !== near) { this.camera.near = near; this.camera.updateProjectionMatrix() }
    if (this.mode !== this.lastMode) {
      this.transitionPosition.copy(this.camera.position).sub(target.position); this.transitionQuaternion.copy(this.camera.quaternion)
      this.transition = this.initialised && movement ? 0 : 1; this.lastMode = this.mode
    }
    const speedT = THREE.MathUtils.smoothstep(Math.abs(speedKmh), 35, 260)
    const impactY = this.impactY.step(0, dt) * (movement ? 1 : 0), impactZ = this.impactZ.step(0, dt) * (movement ? 1 : 0)
    const impactRoll = this.impactRoll.step(0, dt) * (movement ? 1 : 0)
    this.time += dt
    boost = Math.min(boost, 1.3)
    this.kick += (boost - this.kick) * damp(boost > this.kick ? 10 : 2.5, dt)
    _fwd.set(0, 0, 1).applyQuaternion(target.quaternion)

    // Shake: a few incommensurate sines, so it never visibly loops.
    const roughness = motion?.roadRoughness ?? 0
    const amp = movement ? this.speedShake * speedT * speedT + this.nitroShake * this.kick + roughness * .012 : 0
    const t = this.time
    _shake.set(
      (Math.sin(t * 37.1) + 0.6 * Math.sin(t * 61.7 + 1.3)) * amp,
      (Math.sin(t * 43.3 + 0.7) + 0.6 * Math.sin(t * 71.9)) * amp,
      0,
    )

    if (this.mode === 'cockpit' && gridFraming === 0) {
      const profile = cockpitProfile(this.cockpitCar), adjust = this.cockpitAdjustment
      const heave = this.head.step(movement ? THREE.MathUtils.clamp((motion?.accelLong ?? 0) * -.001, -.012, .012) : 0, dt)
      _cockpitEye.set(profile.eye[0], profile.eye[1] + adjust.height, profile.eye[2] + adjust.distance + heave)
      const body = cockpitBody ?? target
      body.updateWorldMatrix(true, false)
      _desired.copy(_cockpitEye).applyMatrix4(body.matrixWorld)
      body.getWorldQuaternion(_cockpitQuaternion)
      _cockpitEuler.set(THREE.MathUtils.degToRad(adjust.pitch) + .025, THREE.MathUtils.degToRad(adjust.yaw), 0, 'YXZ')
      _cockpitAim.setFromEuler(_cockpitEuler)
      _fwd.set(0, 0, 1).applyQuaternion(_cockpitAim).applyQuaternion(_cockpitQuaternion)
      this.camera.position.copy(_desired)
      _look.copy(_desired).addScaledVector(_fwd, 10)
      this.camera.up.set(0, 1, 0).applyQuaternion(_cockpitQuaternion)
      this.camera.lookAt(_look)
      this.camera.translateX(_shake.x * .25)
      this.camera.translateY(_shake.y * .25 + impactY * .2)
      this.camera.translateZ(impactZ * .2)
      this.camera.rotateZ(impactRoll * .2)
      this.initialised = true
    } else {
      this.camera.up.set(0, 1, 0)
      // Flatten forward so pitching over bumps doesn't swing the camera.
      _fwd.y = 0
      _fwd.normalize()
      let surge = 0
      if (motion) {
        surge = THREE.MathUtils.clamp(motion.accelLong * this.surge, -this.maxSurgeIn, this.maxSurgeBack)
        // Sliding: swing the chase direction toward where the car is actually going.
        _vdir.set(motion.velocity.x, 0, motion.velocity.z)
        const v = _vdir.length()
        if (v > 5) {
          _vdir.divideScalar(v)
          const slip = Math.acos(THREE.MathUtils.clamp(_vdir.dot(_fwd), -1, 1))
          const t = Math.min(1, slip / 0.6) * this.driftFraming
          if (t > 0 && _vdir.dot(_fwd) > 0) _fwd.lerp(_vdir, t).normalize()
        }
      }
      const dist = this.distance + gridFraming * 2.5 + speedT * this.speedPullBack + this.kick * this.nitroPullBack + surge
      _desired.copy(target.position).addScaledVector(_fwd, -dist)
      _desired.y += this.height + gridFraming * 1.1 - this.kick * 0.15
      _look.copy(target.position).addScaledVector(_fwd, this.lookAhead + gridFraming * 3)
      _look.y += this.lookHeight

      _desired.sub(target.position)
      _look.sub(target.position)
      if (!this.initialised) {
        this.chaseOffset.copy(_desired)
        this.lookOffset.copy(_look)
        this.initialised = true
      }
      this.chaseOffset.lerp(_desired, damp(6, dt))
      this.lookOffset.lerp(_look, damp(12, dt))
      this.camera.position.copy(target.position).add(this.chaseOffset)
      this.lookTarget.copy(target.position).add(this.lookOffset)
      this.camera.lookAt(this.lookTarget)
      // Shake in camera space after aiming, so it jitters the view, not the chase.
      this.camera.translateX(_shake.x)
      this.camera.translateY(_shake.y + impactY)
      this.camera.translateZ(impactZ)
      this.camera.rotateZ(impactRoll)
      // Bank into the corner a little, like a head leaning with the g-force.
      if (motion && movement) this.camera.rotateZ(THREE.MathUtils.clamp(motion.accelLat * this.bank, -this.maxBank, this.maxBank))
    }

    // A rear check must never inherit a mode fade or fly through the body.
    if (this.lookBack || this.wasLookingBack) this.transition = 1
    this.wasLookingBack = this.lookBack
    if (this.transition < 1) {
      this.transition = Math.min(1, this.transition + dt / .18)
      // Fade through black; never interpolate a camera through the car's shell.
      if (this.transition < .5) {
        this.camera.position.copy(target.position).add(this.transitionPosition)
        this.camera.quaternion.copy(this.transitionQuaternion)
      }
    }

    this.viewOpacity = Math.abs(this.transition * 2 - 1)

    // Kick is already smoothed, so it is added directly: fast in, slow out.
    const inCockpit = this.mode === 'cockpit' && gridFraming === 0
    const fovFx = this.fovEffects && !this.reduced?.matches
    const fov = inCockpit ? cockpitProfile(this.cockpitCar).fov + this.cockpitAdjustment.fov : this.baseFov + gridFraming * 4 + (fovFx ? this.maxFovBoost * speedT : 0)
    const speedFov = THREE.MathUtils.lerp(this.camera.fov - this.appliedKick, fov, damp(4, dt))
    this.appliedKick = fovFx ? (inCockpit ? movement ? 2 : 0 : this.nitroFovKick) * this.kick : 0
    const next = speedFov + this.appliedKick
    if (Math.abs(this.camera.fov - next) > 0.0001) {
      this.camera.fov = next
      this.camera.updateProjectionMatrix()
    }
    if (this.lookBack) {
      // Normal camera history keeps advancing above, so release restores it immediately.
      // External framing clears the seats/roof in every cockpit asset.
      _fwd.set(0, 0, 1).applyQuaternion(target.quaternion).setY(0).normalize()
      this.camera.position.copy(target.position).addScaledVector(_fwd, 5)
      this.camera.position.y += 1.5
      _look.copy(target.position).addScaledVector(_fwd, -9); _look.y += .7
      this.camera.up.set(0, 1, 0); this.camera.lookAt(_look)
      if(this.camera.near!==NEAR){this.camera.near=NEAR;this.camera.updateProjectionMatrix()}
      this.viewOpacity=1
    }
  }

  /**
   * Menu/garage turntable: orbit a point on the parked car. `framing.focus` is
   * in car-local space (the car's center, or a wheel); `yaw` orbits around it.
   * `shift` (meters) slides the subject right of frame to clear a left panel.
   * Switching framings glides because position and look target are damped.
   */
  showroom(target: THREE.Object3D, yaw: number, dt: number, framing: ShowroomFraming): void {
    this.lookBack=this.wasLookingBack=false
    _focus.copy(framing.focus).applyQuaternion(target.quaternion).add(target.position)
    _desired.set(Math.sin(yaw) * framing.distance, framing.height, Math.cos(yaw) * framing.distance)
    _desired.applyQuaternion(target.quaternion).add(_focus)
    _desired.y = Math.max(_desired.y, target.position.y + 0.25) // never dip under the floor
    _side.subVectors(_focus, _desired).setY(0).normalize()
    // Camera-right of a forward vector f is (−f.z, 0, f.x); look left of the subject to push it right.
    _look.set(_focus.x + _side.z * framing.shift, _focus.y, _focus.z - _side.x * framing.shift)

    const k = damp(4, dt)
    this.camera.position.lerp(_desired, k)
    this.lookTarget.lerp(_look, k)
    this.camera.lookAt(this.lookTarget)
    // Clip away anything hugging the lens (pillars, shelving the orbit passes
    // beside); the subject is always further than this.
    // Framing changes immediately, but the camera is still gliding out of the
    // wheel/plate close-up. Keep clipping outside a sphere containing the car,
    // using the actual camera position, not the destination's distance.
    const carClearance = Math.max(NEAR, this.camera.position.distanceTo(target.position) - 3)
    const near = Math.min(carClearance, THREE.MathUtils.clamp(framing.distance - 2.2, NEAR, 1.6))
    let dirty = Math.abs(this.camera.near - near) > 0.01
    if (dirty) this.camera.near = near
    if (Math.abs(this.camera.fov - framing.fov) > 0.01) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, framing.fov, damp(4, dt))
      dirty = true
    }
    if (dirty) this.camera.updateProjectionMatrix()
    // Hand back to the chase cam without a swoop from the turntable.
    this.initialised = false
    this.impactY.reset(); this.impactZ.reset(); this.impactRoll.reset()
    this.lastJolt = -Infinity
    this.kick = this.appliedKick = 0
  }

  /** Move the garage between track origins without changing the view relative to the car. */
  relocateShowroom(from: THREE.Object3D, to: THREE.Object3D): void {
    from.updateMatrix()
    to.updateMatrix()
    const transform = to.matrix.clone().multiply(from.matrix.clone().invert())
    this.camera.position.applyMatrix4(transform)
    this.lookTarget.applyMatrix4(transform)
    this.camera.lookAt(this.lookTarget)
  }

  snap(): void {
    this.lookBack=this.wasLookingBack=false
    this.camera.up.set(0, 1, 0)
    this.impactY.reset(); this.impactZ.reset(); this.impactRoll.reset()
    this.lastJolt = -Infinity
    this.kick = this.appliedKick = 0
    this.initialised = false
    this.head.reset(); this.transition = 1; this.viewOpacity = 1; this.lastMode = this.mode
  }
}
