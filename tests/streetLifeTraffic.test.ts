import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { initRapier, PhysicsWorld } from '../src/engine/PhysicsWorld'
import { StreetLife, type TrafficModel } from '../src/world/StreetLife'

describe('street traffic models', () => {
  it('deals the cars across the models and keeps borrowed geometry alive', async () => {
    await initRapier()
    const physics = new PhysicsWorld()
    // A 1.2 km loop, 4 m between points, 10 m of paving either side.
    const line = Array.from({ length: 300 }, (_, i) => {
      const a = (i / 300) * Math.PI * 2
      return { x: Math.cos(a) * 190, y: 0, z: Math.sin(a) * 190 }
    })
    const edges = { left: new Float32Array(300).fill(10), right: new Float32Array(300).fill(10) }
    const life = new StreetLife(physics.world, line, edges, () => 0, { traffic: true })
    const model = (): TrafficModel => [{ geometry: new THREE.BoxGeometry(), material: new THREE.MeshStandardMaterial() }, { geometry: new THREE.BoxGeometry(), material: new THREE.MeshStandardMaterial() }]
    const models = [model(), model(), model()]
    life.setTrafficModels(models)
    life.reset(0)
    life.render()
    const cars = life.group.children.filter((o) => (o as THREE.InstancedMesh).isInstancedMesh && models.some((m) => m.some((p) => p.geometry === (o as THREE.Mesh).geometry))) as THREE.InstancedMesh[]
    // Three models × two materials; eight cars dealt 3 + 3 + 2, each car in both of its model's meshes.
    expect(cars).toHaveLength(6)
    expect(cars.map((m) => m.count).sort()).toEqual([2, 2, 3, 3, 3, 3])
    const spy = vi.spyOn(models[0][0].geometry, 'dispose')
    life.dispose()
    expect(spy).not.toHaveBeenCalled()
    physics.dispose()
  })
})
