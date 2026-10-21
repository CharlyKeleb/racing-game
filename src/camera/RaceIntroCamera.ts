import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'

export const RACE_INTRO_SECONDS = 4.8
/** Seconds into the intro where each shot cuts to the next. */
export const INTRO_CUTS = [1.4, 3] as const
/** Each whip-pan spins out for this long before a cut and lands for this long after it. */
export const WHIP_SECONDS = 0.16
/** How far the whip swings the view either side of a cut, radians. */
const WHIP_ANGLE = 1.1
export const introShot = (progress: number): number => progress < INTRO_CUTS[0] / RACE_INTRO_SECONDS ? 0 : progress < INTRO_CUTS[1] / RACE_INTRO_SECONDS ? 1 : 2
const smooth = (v: number) => { const t = Math.max(0,Math.min(1,v)); return t*t*(3-2*t) }

/** Visual-only three-shot sequence. Timing comes from the fixed-step race clock. */
export class RaceIntroCamera {
  private readonly camera: THREE.PerspectiveCamera
  private readonly position = new THREE.Vector3()
  private readonly look = new THREE.Vector3()
  private readonly direction = new THREE.Vector3()
  private readonly ray = new RAPIER.Ray({x:0,y:0,z:0},{x:0,y:0,z:1})
  /** Whip-pan strength this frame, 0..1 (drives the blur). */
  whip = 0
  /** Which way the current whip swings, ±1 (for the streak overlay on Low). */
  whipDirection = 1
  constructor(camera: THREE.PerspectiveCamera) { this.camera = camera }
  update(progress: number, player: THREE.Object3D, pole: THREE.Object3D, world?: RAPIER.World): void {
    const seconds = Math.max(0,Math.min(1,progress)) * RACE_INTRO_SECONDS
    const heading = Math.atan2(2*(player.quaternion.w*player.quaternion.y+player.quaternion.x*player.quaternion.z),1-2*(player.quaternion.y**2+player.quaternion.x**2))
    const fx = Math.sin(heading), fz = Math.cos(heading)
    const shot = introShot(progress)
    let fov = 54
    if (shot === 0) {
      const t = smooth(seconds / 1.4)
      this.look.lerpVectors(player.position,pole.position,0.5); this.look.y += 0.7
      this.position.copy(this.look)
      this.position.x += fx * 3 + fz * (12 - t*2)
      this.position.z += fz * 3 - fx * (12 - t*2)
      this.position.y += 5.5 - t*0.6
    } else if (shot === 1) {
      const t = smooth((seconds-1.4)/1.6)
      this.look.copy(player.position); this.look.y += 0.65
      this.position.copy(player.position)
      this.position.x += fx * (5.6-t) + fz * (3.2-t*0.5)
      this.position.z += fz * (5.6-t) - fx * (3.2-t*0.5)
      this.position.y += 1.2
      fov = 48
    } else {
      const t = smooth((seconds-3)/1.8)
      this.look.copy(player.position); this.look.x += fx*12; this.look.z += fz*12; this.look.y += 0.7
      this.position.copy(player.position)
      this.position.x -= fx*(10-2.5*t); this.position.z -= fz*(10-2.5*t)
      this.position.y += 4.2-1.6*t
      fov = 62
    }
    // Pull inside static obstructions instead of placing a cinematic camera in a wall.
    if (world) {
      this.direction.subVectors(this.position,this.look)
      const distance = this.direction.length()
      this.direction.divideScalar(distance || 1)
      this.ray.origin = this.look; this.ray.dir = this.direction
      const hit = world.castRay(this.ray,distance,true,RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC)
      if (hit) this.position.copy(this.look).addScaledVector(this.direction,Math.max(0.5,hit.timeOfImpact-0.4))
    }
    // Whip-pan: spin away just before each cut and land from the other side just after,
    // so the turn reads as one continuous swing that carries into the next shot.
    let swing = 0
    this.whip = 0
    for (let i = 0; i < INTRO_CUTS.length; i++) {
      const lead = (seconds - (INTRO_CUTS[i] - WHIP_SECONDS)) / WHIP_SECONDS
      if (lead < 0 || lead >= 2) continue
      const dir = i % 2 === 0 ? 1 : -1
      swing = dir * WHIP_ANGLE * (lead < 1 ? lead * lead : -(2 - lead) * (2 - lead))
      this.whip = lead < 1 ? lead * lead : (2 - lead) * (2 - lead)
      this.whipDirection = dir
    }
    if (swing !== 0) {
      const dx = this.look.x - this.position.x, dz = this.look.z - this.position.z
      const c = Math.cos(swing), s = Math.sin(swing)
      this.look.x = this.position.x + dx * c + dz * s
      this.look.z = this.position.z - dx * s + dz * c
      fov += 10 * this.whip
    }
    this.camera.position.copy(this.position)
    this.camera.up.set(0,1,0)
    this.camera.lookAt(this.look)
    if (swing !== 0) this.camera.rotateZ(-swing * 0.12)
    this.camera.near = 0.1; this.camera.fov = fov
    this.camera.updateProjectionMatrix()
  }
}
