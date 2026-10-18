import * as THREE from 'three'
import type { CarModel } from '../vehicles/CarModel'
import type { VehicleConfig } from '../vehicles/VehicleConfig'

/**
 * From 0.6 m up the beam meets the road at grazing angles (~2° at 20 m), so
 * the cosine term leaves only a few percent of the light. Real eyes adapt;
 * here a gentler falloff (decay 1, not physical 2) carries it down the road
 * without blowing out the patch right in front of the bumper.
 */
const INTENSITY = 700
const DECAY = 1
const RANGE = 160
const AIM_AHEAD = 40
const AIM_DROP = 1.0

/**
 * Two spot beams from the car's headlight clusters, for night races. They're
 * only added to the scene while on: every extra light costs per-fragment work
 * on every lit material (and a shader recompile when toggled, which only
 * happens when the time of day changes in a menu).
 */
export class Headlights {
  private readonly lights: THREE.SpotLight[] = []
  private readonly root: THREE.Object3D
  private on = false

  constructor(model: CarModel, config: VehicleConfig) {
    this.root = model.root
    const [lx, ly, lz] = lampPositions(model, config)
    for (const side of [1, -1]) {
      const light = new THREE.SpotLight(0xfff2dc, INTENSITY, RANGE, 0.42, 0.55, DECAY)
      light.position.set(lx * side, ly, lz)
      light.target.position.set(lx * side * 0.6, ly - AIM_DROP, lz + AIM_AHEAD)
      light.castShadow = false
      light.name = side > 0 ? 'headlight-left' : 'headlight-right'
      this.lights.push(light)
    }
  }

  setOn(on: boolean): void {
    if (on === this.on) return
    this.on = on
    for (const light of this.lights) {
      if (on) this.root.add(light, light.target)
      else this.root.remove(light, light.target)
    }
  }

  dispose(): void {
    this.setOn(false)
    for (const light of this.lights) light.dispose()
  }
}

/** Left lamp position in car space (+X is left): from the model's Headlights node, else the chassis box. */
function lampPositions(model: CarModel, config: VehicleConfig): [number, number, number] {
  const node = model.root.getObjectByName('Headlights')
  if (node) {
    model.root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(node)
    const inv = new THREE.Matrix4().copy(model.root.matrixWorld).invert()
    box.applyMatrix4(inv)
    if (!box.isEmpty()) return [Math.max(Math.abs(box.min.x), Math.abs(box.max.x)) * 0.8, (box.min.y + box.max.y) / 2, box.max.z]
  }
  const [hx, hy, hz] = config.chassisHalfExtents
  const [cx, cy, cz] = config.chassisCenter
  return [cx + hx * 0.7, cy - hy * 0.2, cz + hz]
}
