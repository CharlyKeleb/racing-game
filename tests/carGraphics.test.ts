import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyCarReflections } from '../src/world/CarReflections'
import { createContactShadow, setContactShadowGround } from '../src/vehicles/ContactShadow'
import { DEFAULT_VEHICLE_CONFIG } from '../src/vehicles/VehicleConfig'

describe('car reflections', () => {
  it('points lit car materials at the car map, leaves unlit ones, and restores the scene map', () => {
    const root = new THREE.Group()
    const paint = new THREE.MeshPhysicalMaterial()
    const flame = new THREE.MeshBasicMaterial()
    root.add(new THREE.Mesh(new THREE.BufferGeometry(), paint), new THREE.Mesh(new THREE.BufferGeometry(), [flame, paint]))
    const map = new THREE.Texture()
    const version = paint.version
    applyCarReflections(root, map, 0.7)
    expect(paint.envMap).toBe(map)
    expect(paint.envMapIntensity).toBe(0.7)
    expect(flame.envMap).toBeNull()
    expect(paint.version).toBe(version + 1)
    applyCarReflections(root, map, 0.7)
    expect(paint.version).toBe(version + 1)
    applyCarReflections(root, null, 0.7)
    expect(paint.envMap).toBeNull()
    expect(paint.envMapIntensity).toBe(1)
  })
})

describe('contact shadow', () => {
  it('sits at wheel-contact height under the chassis and fades with airtime', () => {
    const cfg = DEFAULT_VEHICLE_CONFIG
    const pad = createContactShadow(cfg)
    const contact = cfg.wheels.reduce((sum, w) => sum + w.position[1] - cfg.suspension.restLength - w.radius, 0) / cfg.wheels.length
    expect(pad.position.y).toBeCloseTo(contact + 0.025)
    expect(pad.position.z).toBeCloseTo(cfg.chassisCenter[2])
    const material = pad.material as THREE.MeshBasicMaterial
    const full = material.opacity
    setContactShadowGround(pad, 0.5)
    expect(material.opacity).toBeCloseTo(full / 2)
    setContactShadowGround(pad, 0)
    expect(material.opacity).toBe(0)
  })
})
