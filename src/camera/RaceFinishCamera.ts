import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'

const ease = (v: number) => { const t = THREE.MathUtils.clamp(v, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10) }

/** One continuous tracking move, matched to the exact view at the crossing. */
export class RaceFinishCamera {
  private readonly camera: THREE.PerspectiveCamera
  private readonly position = new THREE.Vector3()
  private readonly look = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()
  private readonly side = new THREE.Vector3()
  private readonly offset = new THREE.Vector3()
  private readonly initialPosition = new THREE.Vector3()
  private readonly initialLook = new THREE.Vector3()
  private readonly initialUp = new THREE.Vector3()
  private readonly direction = new THREE.Vector3()
  private readonly up = new THREE.Vector3(0, 1, 0)
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })
  private cockpit = false
  private angle = Math.PI
  private radius = 6
  private height = 1.5
  private fov = 58
  constructor(camera: THREE.PerspectiveCamera) { this.camera = camera }
  start(player: THREE.Object3D): void {
    this.forward.set(0, 0, 1).applyQuaternion(player.quaternion).setY(0).normalize()
    this.side.set(this.forward.z, 0, -this.forward.x)
    this.offset.subVectors(this.camera.position, player.position)
    this.angle = Math.atan2(this.offset.dot(this.side), this.offset.dot(this.forward))
    this.radius = Math.hypot(this.offset.x, this.offset.z)
    this.initialPosition.copy(this.offset)
    this.cockpit = this.radius < 2
    this.height = this.offset.y
    this.fov = this.camera.fov
    this.camera.getWorldDirection(this.direction)
    this.initialLook.copy(this.camera.position).addScaledVector(this.direction, 10).sub(player.position)
    this.initialUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion)
  }
  update(progress: number, player: THREE.Object3D, world?: RAPIER.World): void {
    const p = THREE.MathUtils.clamp(progress, 0, 1), t = ease(p)
    if (this.cockpit) {
      // Keep the driver's view rather than flying through the car's bodywork.
      this.camera.position.copy(player.position).add(this.initialPosition)
      this.camera.up.copy(this.initialUp)
      this.look.copy(player.position).add(this.initialLook)
      this.camera.lookAt(this.look)
      return
    }
    const sign = this.angle < 0 ? -1 : 1
    // Stay behind the car and settle into a low rear-quarter tracking shot.
    // Do not spin through a front shot or cut to a different lens.
    const angle = THREE.MathUtils.lerp(this.angle, sign * Math.PI * .62, t)
    const radius = THREE.MathUtils.lerp(this.radius, 6.1, t)
    this.position.copy(player.position)
      .addScaledVector(this.forward, Math.cos(angle) * radius)
      .addScaledVector(this.side, Math.sin(angle) * radius)
    this.position.y += THREE.MathUtils.lerp(this.height, 1.3, t)
    this.look.copy(this.initialLook).multiplyScalar(1 - t).addScaledVector(this.up, .7 * t).add(player.position)
    // Bring in the results framing only toward the end of the same move.
    const framing = ease((p - .55) / .45) * 1.15
    this.direction.subVectors(this.look, this.position).setY(0).normalize()
    this.look.x -= this.direction.z * framing; this.look.z += this.direction.x * framing
    if (world && p > 0) {
      this.offset.copy(player.position); this.offset.y += .7
      this.direction.subVectors(this.position, this.offset)
      const distance = this.direction.length()
      this.direction.divideScalar(distance || 1)
      this.ray.origin = this.offset; this.ray.dir = this.direction
      const hit = world.castRay(this.ray, distance, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC)
      if (hit) {
        const safe = Math.max(.45, hit.timeOfImpact - .35)
        this.position.copy(this.offset).addScaledVector(this.direction, THREE.MathUtils.lerp(distance, safe, ease(p / .18)))
      }
    }
    this.camera.position.copy(this.position)
    this.camera.up.copy(this.initialUp).lerp(this.up, t).normalize()
    this.camera.lookAt(this.look)
    this.camera.near = .1
    this.camera.fov = THREE.MathUtils.lerp(this.fov, 54, t)
    this.camera.updateProjectionMatrix()
  }
}
