import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'

export const RACE_INTRO_SECONDS = 4.8
export const introShot = (progress: number): number => progress < 1.4 / RACE_INTRO_SECONDS ? 0 : progress < 3 / RACE_INTRO_SECONDS ? 1 : 2
const smooth = (v: number) => { const t = Math.max(0,Math.min(1,v)); return t*t*(3-2*t) }

/** Visual-only three-shot sequence. Timing comes from the fixed-step race clock. */
export class RaceIntroCamera {
  private readonly camera: THREE.PerspectiveCamera
  private readonly position = new THREE.Vector3()
  private readonly look = new THREE.Vector3()
  private readonly direction = new THREE.Vector3()
  private readonly ray = new RAPIER.Ray({x:0,y:0,z:0},{x:0,y:0,z:1})
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
    this.camera.position.copy(this.position)
    this.camera.up.set(0,1,0)
    this.camera.lookAt(this.look)
    this.camera.near = 0.1; this.camera.fov = fov
    this.camera.updateProjectionMatrix()
  }
}
