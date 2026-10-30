import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, expect, it } from 'vitest'
import { initRapier } from '../src/engine/PhysicsWorld'
import { DEFAULT_VEHICLE_CONFIG as config } from '../src/vehicles/VehicleConfig'
import { VehiclePhysics } from '../src/vehicles/VehiclePhysics'
import { planSafetyWalls, type BarrierProbe } from '../src/world/SafetyWalls'

beforeAll(() => initRapier())

// A straight road along +Z on a floor that carries on sideways (a street circuit's pavement).
const line = Array.from({ length: 20 }, (_, i) => ({ x: 0, y: 0, z: i * 4 }))
const floor = () => 0
/** A thin barrier along x = 9 on both sides, from z0 to z1; probes run along ±X only. */
const barrier = (z0 = -Infinity, z1 = Infinity): BarrierProbe => (x, _y, z, dx, _dz, max) => {
  if (z < z0 || z > z1 || dx === 0) return null
  const t = (9 * Math.sign(dx) - x) / dx
  return t >= 0 && t <= max ? t : null
}
const wallXs = (vertices: Float32Array) => {
  const xs = new Set<number>()
  for (let i = 0; i < vertices.length; i += 3) xs.add(Math.round(Math.abs(vertices[i]) * 100) / 100)
  return xs
}

it('stands a wall just in front of a thin barrier the floor probes step over', () => {
  const walls = planSafetyWalls(line, { floor, barrier: barrier() })
  expect(walls.segments).toBeGreaterThan(0)
  for (const x of wallXs(walls.vertices)) expect(x).toBeCloseTo(8.95, 2)
})

it('gives a post or a bollard no wall', () => {
  // Solid only where a probe crosses z = 40 ± 0.5: nothing 2 m either side along the road.
  expect(planSafetyWalls(line, { floor, barrier: barrier(39.5, 40.5) }).segments).toBe(0)
})

it('ends a barrier wall at a gap instead of joining it across to the floor further out', () => {
  // Barrier for the first half only; past it the floor runs on (no other edge).
  const walls = planSafetyWalls(line, { floor, barrier: barrier(-Infinity, 36) })
  expect(walls.segments).toBeGreaterThan(0)
  for (let i = 0; i < walls.vertices.length; i += 3) expect(walls.vertices[i + 2]).toBeLessThanOrEqual(36)
  for (const x of wallXs(walls.vertices)) expect(x).toBeCloseTo(8.95, 2)
})

it('caps the upward speed a step of contacts adds, but not suspension or a landing', () => {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  world.timestep = 1 / 60
  world.createCollider(RAPIER.ColliderDesc.cuboid(100, 0.1, 100).setTranslation(0, -0.1, 0))
  const car = new VehiclePhysics(config, world, { position: { x: 0, y: 0.6, z: 0 }, heading: 0 })
  const idle = { throttle: 0, brake: 1, steer: 0, handbrake: false, nitro: false }
  try {
    for (let i = 0; i < 120; i++) { car.fixedUpdate(idle, 1 / 60); world.step() }
    const rest = car.body.translation().y
    // A wall's flared foot throws the car up 8 m/s in one step (as at Marina Bay).
    car.fixedUpdate(idle, 1 / 60); world.step()
    const v = car.body.linvel()
    car.body.setLinvel({ x: v.x, y: 8, z: v.z }, true)
    car.fixedUpdate(idle, 1 / 60)
    expect(car.body.linvel().y).toBeLessThan(1.5)
    // Dropped from 3 m, it lands and settles as before.
    car.respawn({ position: { x: 0, y: 3, z: 0 }, heading: 0 })
    for (let i = 0; i < 180; i++) { car.fixedUpdate(idle, 1 / 60); world.step() }
    expect(car.body.translation().y).toBeCloseTo(rest, 2)
  } finally { world.free() }
})
