import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { shotAt, type FinishShot } from '../racing/FinishSequence'

const ease = (v: number) => { const t = THREE.MathUtils.clamp(v, 0, 1); return t * t * (3 - 2 * t) }
const DEG = Math.PI / 180

export interface FinishCameraPlan {
  /** Side the car slides toward: +1 its left, −1 its right (glTF +X is left). The road is wider there. */
  side: 1 | -1
  /** Speed at the line, m/s. */
  speed: number
  /**
   * Open space on that side before anything solid, m (measured at the line).
   * The pass and slide cameras stand inside it: catch fences and pit walls
   * aren't always in the collision mesh, so the room is measured, not assumed.
   */
  room: number
}

/**
 * The finish cinematic's cameras, one per shot (see FinishSequence), cut
 * hard between them like a broadcast:
 *
 *   line          the chase camera carries on (update returns false)
 *   pass          a low camera at the roadside ahead, panning as the car blasts past
 *   slide         a wheel-height camera tracking alongside, on the side the nose swings to
 *   stop          a still low front-quarter, pushing in slowly as the smoke clears
 *   beauty-*      three slow shots of the parked car: front quarter, rear quarter, nose
 *
 * Every shot is placed relative to the car's heading at the line or, from
 * the stop on, its parked pose, and pulled in front of any wall between it
 * and the car.
 */
export class RaceFinishCamera {
  private readonly camera: THREE.PerspectiveCamera
  /** Heading at the line (flat), its left, and where the car crossed. */
  private readonly travel = new THREE.Vector3()
  private readonly left = new THREE.Vector3()
  private readonly crossing = new THREE.Vector3()
  /** Fixed pass-by camera position, chosen at the line. */
  private readonly passAt = new THREE.Vector3()
  /** The car's pose when it stopped: the frame for the stop and beauty shots. */
  private readonly parked = new THREE.Vector3()
  private readonly parkedForward = new THREE.Vector3()
  private readonly parkedLeft = new THREE.Vector3()
  private hasParked = false
  private side: 1 | -1 = 1
  /** How far out the pass and slide cameras stand, m: inside the measured room. */
  private lateral = 7.5
  /** +1 = the planned side for the pass and slide cameras, −1 = mirrored (a wall was in the way). */
  private passSide: 1 | -1 = 1
  private slideSide: 1 | -1 = 1
  /** The orbit angle offset chosen at the cut for a clear view, degrees. */
  private orbitNudge = 0
  private lastShot: FinishShot | null = null
  private readonly position = new THREE.Vector3()
  private readonly look = new THREE.Vector3()
  private readonly offset = new THREE.Vector3()
  private readonly from = new THREE.Vector3()
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera
  }

  start(player: THREE.Object3D, plan: FinishCameraPlan): void {
    this.travel.set(0, 0, 1).applyQuaternion(player.quaternion).setY(0).normalize()
    this.left.set(this.travel.z, 0, -this.travel.x)
    this.crossing.copy(player.position)
    this.side = plan.side
    this.lateral = Math.max(3, Math.min(7.5, plan.room - 1.5))
    // Where the car will be about a second after the cut, at the roadside on
    // the open side (the car is past it before it slides that way).
    this.passAt.copy(player.position)
      .addScaledVector(this.travel, Math.max(18, plan.speed * 1.15 + 4))
      .addScaledVector(this.left, this.side * Math.min(6.5, this.lateral))
    this.passAt.y += 0.9
    this.hasParked = false
    this.lastShot = null
  }

  /**
   * Frame the shot for `seconds` since the line. Returns false while the
   * chase camera should carry on (the line itself). `follow` re-reads the
   * car's pose every frame (behind the results, where it may still roll).
   */
  update(seconds: number, player: THREE.Object3D, world?: RAPIER.World, follow = false): boolean {
    const { shot, local } = shotAt(seconds)
    const cut = shot !== this.lastShot
    this.lastShot = shot
    if (shot === 'line') return false
    // After the sequence (or a skip) the car may still be rolling: keep the frame on it.
    if ((follow || !this.hasParked) && (shot === 'stop' || shot.startsWith('beauty'))) this.park(player)

    let fov = 50
    switch (shot) {
      case 'pass': {
        // Chosen once at the cut: the planned side, or the mirror side if a wall is in the way.
        if (cut) this.passSide = this.clearSide(this.passAt, this.crossing, world) ? 1 : -1
        this.mirrorAcross(this.passAt, this.crossing, this.passSide, this.position)
        this.aimAtCar(player, 0.6)
        fov = 50 - 6 * local
        break
      }
      case 'slide': {
        // Alongside, slightly behind, at wheel height: the car swings its nose toward us
        // (or, with a wall on that side, the mirror shot from the other side).
        this.offset.copy(player.position).addScaledVector(this.left, this.side * this.lateral).addScaledVector(this.travel, -1.2)
        this.offset.y = player.position.y + 0.55
        if (cut) this.slideSide = this.clearSide(this.offset, player.position, world) ? 1 : -1
        this.mirrorAcross(this.offset, player.position, this.slideSide, this.offset)
        if (cut) this.position.copy(this.offset)
        else this.position.lerp(this.offset, 0.18)
        this.aimAtCar(player, 0.5)
        fov = 42
        break
      }
      case 'stop':
        this.orbitClear(cut, world, -this.side * 35, THREE.MathUtils.lerp(7.6, 6.2, ease(local)), 0.75, 0)
        fov = 36
        break
      case 'beauty-front':
        this.orbitClear(cut, world, this.side * 42, 6.6, 0.45, THREE.MathUtils.lerp(-0.8, 0.8, ease(local)))
        fov = 34
        break
      case 'beauty-rear':
        this.orbitClear(cut, world, -this.side * 145, THREE.MathUtils.lerp(7.2, 6.2, ease(local)), 0.7, 0)
        fov = 36
        break
      case 'beauty-nose':
        this.orbitClear(cut, world, 0, THREE.MathUtils.lerp(5.4, 4.7, ease(local)), THREE.MathUtils.lerp(0.36, 0.55, ease(local)), 0)
        fov = 40
        break
    }
    // Last resort: nothing clear anywhere round the car, so come in front of the wall.
    this.keepClear(this.position, world, shot === 'pass' ? this.crossing : shot === 'slide' ? player.position : this.parked)
    this.camera.position.copy(this.position)
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(this.look)
    this.camera.near = 0.1
    this.camera.fov = fov
    this.camera.updateProjectionMatrix()
    return true
  }

  private park(player: THREE.Object3D): void {
    this.parked.copy(player.position)
    this.parkedForward.set(0, 0, 1).applyQuaternion(player.quaternion).setY(0).normalize()
    this.parkedLeft.set(this.parkedForward.z, 0, -this.parkedForward.x)
    this.hasParked = true
  }

  /**
   * A camera `degrees` round from the parked car's nose (+ = toward its
   * left), `distance` away and `height` up, trucked `truck` m sideways; it
   * looks at the car's middle.
   */
  private orbit(degrees: number, distance: number, height: number, truck: number): void {
    const a = degrees * DEG
    this.offset.copy(this.parkedForward).multiplyScalar(Math.cos(a)).addScaledVector(this.parkedLeft, Math.sin(a))
    this.position.copy(this.parked).addScaledVector(this.offset, distance)
    // Truck across the line of sight.
    this.position.x += this.offset.z * truck
    this.position.z -= this.offset.x * truck
    this.position.y = this.parked.y + height
    this.look.copy(this.parked)
    this.look.y += 0.55
  }

  /** Mirror `position` across the line of travel through `about` when `which` is −1 (into `out`). */
  private mirrorAcross(position: THREE.Vector3, about: THREE.Vector3, which: 1 | -1, out: THREE.Vector3): void {
    out.copy(position)
    if (which === 1) return
    this.offset.subVectors(position, about)
    const lateral = this.offset.dot(this.left)
    out.addScaledVector(this.left, -2 * lateral)
  }

  /** True if nothing static stands between `target` and the planned `position` (or there's no world to ask). */
  private clearSide(position: THREE.Vector3, target: THREE.Vector3, world?: RAPIER.World): boolean {
    return !world || !this.blocked(position, target, world)
  }

  private blocked(position: THREE.Vector3, target: THREE.Vector3, world: RAPIER.World): boolean {
    this.from.copy(target)
    this.from.y += 0.7
    this.offset.subVectors(position, this.from)
    const distance = this.offset.length()
    if (distance < 0.5) return false
    this.offset.divideScalar(distance)
    this.ray.origin = this.from
    this.ray.dir = this.offset
    return world.castRay(this.ray, distance, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC) !== null
  }

  /**
   * An orbit shot, its angle nudged round the car at the cut (0, ±50°, ±100°,
   * 180°) until nothing solid stands between camera and car; kept for the shot.
   */
  private orbitClear(cut: boolean, world: RAPIER.World | undefined, degrees: number, distance: number, height: number, truck: number): void {
    if (cut) {
      this.orbitNudge = 0
      if (world) for (const nudge of [0, 50, -50, 100, -100, 180]) {
        this.orbit(degrees + nudge, distance, height, truck)
        if (!this.blocked(this.position, this.parked, world)) {
          this.orbitNudge = nudge
          break
        }
      }
    }
    this.orbit(degrees + this.orbitNudge, distance, height, truck)
  }

  private aimAtCar(player: THREE.Object3D, height: number): void {
    this.look.copy(player.position)
    this.look.y += height
  }

  /** Pull the camera in front of a wall between it and `target` (static geometry only, not cars). */
  private keepClear(position: THREE.Vector3, world: RAPIER.World | undefined, target: THREE.Vector3): void {
    if (!world) return
    this.from.copy(target)
    this.from.y += 0.7
    this.offset.subVectors(position, this.from)
    const distance = this.offset.length()
    if (distance < 0.5) return
    this.offset.divideScalar(distance)
    this.ray.origin = this.from
    this.ray.dir = this.offset
    const hit = world.castRay(this.ray, distance, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC)
    if (hit) position.copy(this.from).addScaledVector(this.offset, Math.max(2.5, hit.timeOfImpact - 0.4))
  }
}
