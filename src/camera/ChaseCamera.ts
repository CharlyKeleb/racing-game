import * as THREE from 'three'
import type { CameraMode } from '../stores/gameStore'

const _desired = new THREE.Vector3()
const _look = new THREE.Vector3()
const _fwd = new THREE.Vector3()

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

  snap(): void {
    this.initialised = false
  }
}
