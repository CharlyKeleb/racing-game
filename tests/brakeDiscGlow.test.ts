import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { BrakeDiscGlow } from '../src/vehicles/BrakeDiscGlow'
import type { CarModel } from '../src/vehicles/CarModel'
import { DEFAULT_VEHICLE_CONFIG, type VehicleConfig, type WheelId } from '../src/vehicles/VehicleConfig'

/** A car whose wheels hold a rim, a tyre and (optionally) a disc mesh sharing one disc material. */
function car(withDisc: boolean): { model: CarModel; disc: THREE.MeshStandardMaterial; rim: THREE.MeshStandardMaterial } {
  const disc = new THREE.MeshStandardMaterial({ name: 'Disc_Mat' })
  const rim = new THREE.MeshStandardMaterial({ name: 'rim' })
  const wheels = {} as CarModel['wheels']
  for (const id of ['FL', 'FR', 'RL', 'RR'] as WheelId[]) {
    const pivot = new THREE.Group(), spinner = new THREE.Group()
    pivot.add(spinner)
    spinner.add(new THREE.Mesh(new THREE.BoxGeometry(), rim))
    if (withDisc) spinner.add(new THREE.Mesh(new THREE.BoxGeometry(), disc))
    wheels[id] = { pivot, spinner }
  }
  return { model: { root: new THREE.Group(), body: new THREE.Group(), wheels }, disc, rim }
}
const config: VehicleConfig = { ...DEFAULT_VEHICLE_CONFIG, brakeDisc: { material: 'Disc_Mat' } }
const discMaterialOf = (model: CarModel, id: WheelId) => (model.wheels[id].spinner.children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial

describe('brake disc glow (#92)', () => {
  it('glows per-axle copies of the disc material, never the shared source or the rim', () => {
    const { model, disc, rim } = car(true)
    const glow = new BrakeDiscGlow(model, config)
    expect(glow.layout).toEqual({ discMaterials: 2, rings: 0 })
    const front = discMaterialOf(model, 'FL'), rear = discMaterialOf(model, 'RL')
    expect(front).not.toBe(disc)
    expect(discMaterialOf(model, 'FR')).toBe(front)
    expect(rear).not.toBe(front)
    glow.update(1, 0.2)
    expect(front.emissiveIntensity).toBeGreaterThan(rear.emissiveIntensity)
    expect(front.emissive.r).toBeGreaterThan(front.emissive.g) // red-orange, not white
    expect(front.emissive.g).toBeGreaterThan(rear.emissive.g) // hotter → more orange
    expect(disc.emissiveIntensity).toBe(1)
    expect(rim.emissive.getHex()).toBe(0)
    glow.update(0, 0)
    expect(front.emissiveIntensity).toBe(0)
    glow.dispose()
  })

  it('falls back to a ring behind the spokes, drawn only while glowing, when the model has no disc', () => {
    const { model } = car(false)
    const glow = new BrakeDiscGlow(model, config)
    expect(glow.layout).toEqual({ discMaterials: 0, rings: 4 })
    const ring = model.wheels.FL.spinner.getObjectByName('BrakeDiscGlow') as THREE.Mesh
    expect(ring.visible).toBe(false)
    glow.update(0.6, 0)
    expect(ring.visible).toBe(true)
    expect((model.wheels.RL.spinner.getObjectByName('BrakeDiscGlow') as THREE.Mesh).visible).toBe(false)
    // Inside the wheel: the ring's outer edge stays well within the tyre.
    ring.geometry.computeBoundingSphere()
    expect(ring.geometry.boundingSphere!.radius * ring.scale.x).toBeLessThan(DEFAULT_VEHICLE_CONFIG.wheels[0].radius * 0.6)
    glow.dispose()
    expect(model.wheels.FL.spinner.getObjectByName('BrakeDiscGlow')).toBeUndefined()
  })
})
