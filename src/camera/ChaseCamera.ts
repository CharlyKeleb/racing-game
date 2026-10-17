import * as THREE from 'three'
import type { CameraMode } from '../stores/gameStore'
import type { VehicleMotion } from '../vehicles/Vehicle'

const _desired = new THREE.Vector3()
const _look = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _side = new THREE.Vector3()
const _focus = new THREE.Vector3()
const _shake = new THREE.Vector3()
const _vdir = new THREE.Vector3()

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
   * Extra chase distance at top speed, meters. Zero: the car stays big on
   * screen at any speed, and the FOV widening sells the speed instead.
   */
  speedPullBack = 0
  /** Aim point: this far ahead of the car's centre and this high, so the camera looks down the road, not at the roof. */
  lookAhead = 9
  lookHeight = 0.7
  baseFov = 58
  maxFovBoost = 18
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
  speedShake = 0.03
  nitroShake = 0.05

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
  update(target: THREE.Object3D, speedKmh: number, dt: number, boost = 0, motion?: VehicleMotion): void {
    const speedT = Math.min(speedKmh / 300, 1)
    this.time += dt
    boost = Math.min(boost, 1.3)
    this.kick += (boost - this.kick) * damp(boost > this.kick ? 10 : 2.5, dt)
    _fwd.set(0, 0, 1).applyQuaternion(target.quaternion)

    // Shake: a few incommensurate sines, so it never visibly loops.
    const amp = this.speedShake * speedT * speedT + this.nitroShake * this.kick
    const t = this.time
    _shake.set(
      (Math.sin(t * 37.1) + 0.6 * Math.sin(t * 61.7 + 1.3)) * amp,
      (Math.sin(t * 43.3 + 0.7) + 0.6 * Math.sin(t * 71.9)) * amp,
      0,
    )

    if (this.mode === 'cockpit') {
      _desired.set(0.35, 1.05, 0.1).applyQuaternion(target.quaternion).add(target.position)
      this.camera.position.copy(_desired)
      _look.copy(_desired).addScaledVector(_fwd, 10)
      this.camera.lookAt(_look)
      this.camera.translateX(_shake.x * 0.4)
      this.camera.translateY(_shake.y * 0.4)
    } else {
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
      const dist = this.distance + speedT * this.speedPullBack + this.kick * this.nitroPullBack + surge
      _desired.copy(target.position).addScaledVector(_fwd, -dist)
      _desired.y += this.height - this.kick * 0.15
      _look.copy(target.position).addScaledVector(_fwd, this.lookAhead)
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
      this.camera.translateY(_shake.y)
      // Bank into the corner a little, like a head leaning with the g-force.
      if (motion) this.camera.rotateZ(THREE.MathUtils.clamp(motion.accelLat * this.bank, -this.maxBank, this.maxBank))
    }

    // Kick is already smoothed, so it is added directly: fast in, slow out.
    const fov = this.baseFov + this.maxFovBoost * speedT * speedT
    const speedFov = THREE.MathUtils.lerp(this.camera.fov - this.appliedKick, fov, damp(4, dt))
    this.appliedKick = this.nitroFovKick * this.kick
    const next = speedFov + this.appliedKick
    if (Math.abs(this.camera.fov - next) > 0.01) {
      this.camera.fov = next
      this.camera.updateProjectionMatrix()
    }
  }

  /**
   * Menu/garage turntable: orbit a point on the parked car. `framing.focus` is
   * in car-local space (the car's center, or a wheel); `yaw` orbits around it.
   * `shift` (meters) slides the subject right of frame to clear a left panel.
   * Switching framings glides because position and look target are damped.
   */
  showroom(target: THREE.Object3D, yaw: number, dt: number, framing: ShowroomFraming): void {
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
    if (Math.abs(this.camera.fov - framing.fov) > 0.01) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, framing.fov, damp(4, dt))
      this.camera.updateProjectionMatrix()
    }
    // Hand back to the chase cam without a swoop from the turntable.
    this.initialised = false
    this.kick = this.appliedKick = 0
  }

  snap(): void {
    this.initialised = false
  }
}
