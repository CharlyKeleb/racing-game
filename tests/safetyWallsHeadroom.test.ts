import { expect, it } from 'vitest'
import { planSafetyWalls } from '../src/world/SafetyWalls'

// A straight road along +Z whose floor carries on sideways, under rock from |x| = 7.3 m.
const line = Array.from({ length: 20 }, (_, i) => ({ x: 0, y: 0, z: i * 4 }))
const floor = () => 0
const rock = (x: number, _y: number, _z: number, max: number) => Math.abs(x) >= 7.3 && max >= 1 ? 1 : null

it('stands a wall where rock comes down over the road mesh, at the foot of it', () => {
  const walls = planSafetyWalls(line, { floor, headroom: rock })
  expect(walls.segments).toBeGreaterThan(0)
  const xs = new Set<number>()
  for (let i = 0; i < walls.vertices.length; i += 3) xs.add(Math.round(Math.abs(walls.vertices[i]) * 4) / 4)
  // Within a quarter step of where the rock starts, never out past it or into the road.
  for (const x of xs) expect(x).toBeGreaterThanOrEqual(7)
  for (const x of xs) expect(x).toBeLessThanOrEqual(7.3)
})

it('leaves open run-off alone, as before, when nothing hangs low over it', () => {
  expect(planSafetyWalls(line, { floor, headroom: () => null, barrier: () => null }).segments).toBe(0)
  expect(planSafetyWalls(line, { floor }).segments).toBe(0)
})
