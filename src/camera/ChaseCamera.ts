import * as THREE from 'three'
import type { CameraMode } from '../stores/gameStore'

const _desired = new THREE.Vector3()
const _look = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _side = new THREE.Vector3()
const _focus = new THREE.Vector3()
const _shake = new THREE.Vector3()

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
  /** Chase position before shake, so the shake never feeds back into the smoothing. */
  private readonly chasePos = new THREE.Vector3()
  private initialised = false

  distance = 6.5
  height = 2.1
  baseFov = 60
  maxFovBoost = 18
  /** Extra degrees of FOV at full nitro. */
  nitroFovKick = 14
  /** Extra chase distance at full nitro, meters (the car surges away from the lens). */
  nitroPullBack = 1.4
  /** Camera shake amplitude at top speed and at full nitro, meters. */
  speedShake = 0.025
  nitroShake = 0.05

  private time = 0
  /** Nitro intensity, smoothed separately so the FOV kicks fast and relaxes slowly. */
  private kick = 0
  private appliedKick = 0

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera
  }

  /** @param boost nitro intensity, 0..1. */
  update(target: THREE.Object3D, speedKmh: number, dt: number, boost = 0): void {
    const speedT = Math.min(speedKmh / 300, 1)
    this.time += dt
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
      const dist = this.distance + speedT * 1.8 + this.kick * this.nitroPullBack
      _desired.copy(target.position).addScaledVector(_fwd, -dist)
      _desired.y += this.height - this.kick * 0.25
      _look.copy(target.position).addScaledVector(_fwd, 3)
      _look.y += 0.8

      if (!this.initialised) {
        this.chasePos.copy(_desired)
        this.lookTarget.copy(_look)
        this.initialised = true
      }
      this.chasePos.lerp(_desired, damp(6, dt))
      this.camera.position.copy(this.chasePos)
      this.lookTarget.lerp(_look, damp(12, dt))
      this.camera.lookAt(this.lookTarget)
      // Shake in camera space after aiming, so it jitters the view, not the chase.
      this.camera.translateX(_shake.x)
      this.camera.translateY(_shake.y)
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
