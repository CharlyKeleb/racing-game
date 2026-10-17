import * as THREE from 'three'
import type { VehicleConfig } from '../vehicles/VehicleConfig'

const FLAME_LENGTH = 1.3
const FLAME_RADIUS = 0.11

/** Default exhaust tips: twin pipes low at the rear bumper. */
function defaultExhausts(cfg: VehicleConfig): [number, number, number][] {
  const z = cfg.chassisCenter[2] - cfg.chassisHalfExtents[2]
  return [
    [0.32, 0.36, z],
    [-0.32, 0.36, z],
  ]
}

/**
 * Blue nitro flames out of the exhausts. Additive cones parented to the car
 * model (so they follow the interpolated transform), stretched and flickered
 * by boost intensity. Colors go above 1 so the bloom pass picks them up.
 */
export class NitroFlames {
  readonly group = new THREE.Group()
  private readonly flames: THREE.Object3D[] = []
  private readonly geometry: THREE.ConeGeometry
  private readonly materials: THREE.MeshBasicMaterial[]
  private time = 0

  constructor(cfg: VehicleConfig) {
    // Cone tip points -Z (backwards), base at the pipe.
    this.geometry = new THREE.ConeGeometry(FLAME_RADIUS, FLAME_LENGTH, 12, 1, true)
    this.geometry.rotateX(-Math.PI / 2)
    this.geometry.translate(0, 0, -FLAME_LENGTH / 2)

    const flameMat = (color: number, intensity: number) =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(intensity),
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      })
    const outer = flameMat(0x2a7dff, 2.4)
    const core = flameMat(0xc8f0ff, 3)
    this.materials = [outer, core]

    for (const [x, y, z] of cfg.exhausts ?? defaultExhausts(cfg)) {
      const flame = new THREE.Group()
      flame.position.set(x, y, z)
      flame.add(new THREE.Mesh(this.geometry, outer))
      const inner = new THREE.Mesh(this.geometry, core)
      inner.scale.set(0.45, 0.45, 0.6)
      flame.add(inner)
      this.flames.push(flame)
      this.group.add(flame)
    }
    this.group.visible = false
  }

  update(intensity: number, dt: number): void {
    this.time += dt
    this.group.visible = intensity > 0.02
    if (!this.group.visible) return
    for (let i = 0; i < this.flames.length; i++) {
      const t = this.time * 38 + i * 1.7
      const flicker = 0.8 + 0.12 * Math.sin(t) + 0.08 * Math.sin(t * 2.3 + 1)
      const f = this.flames[i]
      f.scale.set(0.8 + 0.2 * intensity, 0.8 + 0.2 * intensity, intensity * flicker)
    }
  }

  dispose(): void {
    this.group.removeFromParent()
    this.geometry.dispose()
    for (const m of this.materials) m.dispose()
  }
}
