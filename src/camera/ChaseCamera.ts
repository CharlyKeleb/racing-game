import * as THREE from 'three'
import type { CameraMode } from '../stores/gameStore'

const _desired = new THREE.Vector3()
const _look = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _side = new THREE.Vector3()
const _focus = new THREE.Vector3()

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
 * Runs in render (not fixed) time, reading the interpolated car transform.
 */
export class ChaseCamera {
  mode: CameraMode = 'chase'
  private readonly camera: THREE.PerspectiveCamera
  private readonly lookTarget = new THREE.Vector3()
  private initialised = false

  distance = 6.5
  height = 2.1
  baseFov = 60
  maxFovBoost = 18

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera
  }

  update(target: THREE.Object3D, speedKmh: number, dt: number): void {
    const speedT = Math.min(speedKmh / 300, 1)
    _fwd.set(0, 0, 1).applyQuaternion(target.quaternion)

    if (this.mode === 'cockpit') {
      _desired.set(0.35, 1.05, 0.1).applyQuaternion(target.quaternion).add(target.position)
      this.camera.position.copy(_desired)
      _look.copy(_desired).addScaledVector(_fwd, 10)
      this.camera.lookAt(_look)
    } else {
      // Flatten forward so pitching over bumps doesn't swing the camera.
      _fwd.y = 0
      _fwd.normalize()
      const dist = this.distance + speedT * 1.5
      _desired.copy(target.position).addScaledVector(_fwd, -dist)
      _desired.y += this.height
      _look.copy(target.position).addScaledVector(_fwd, 3)
      _look.y += 0.8

      if (!this.initialised) {
        this.camera.position.copy(_desired)
        this.lookTarget.copy(_look)
        this.initialised = true
      }
      this.camera.position.lerp(_desired, damp(6, dt))
      this.lookTarget.lerp(_look, damp(12, dt))
      this.camera.lookAt(this.lookTarget)
    }

    const fov = this.baseFov + this.maxFovBoost * speedT * speedT
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fov, damp(4, dt))
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
  }

  snap(): void {
    this.initialised = false
  }
}
