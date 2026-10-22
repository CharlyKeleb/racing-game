import { describe, expect, it } from 'vitest'
import { ParticlePool, type ParticleSpawn } from '../src/effects/Particles'

const puff = (life: number, x = 0): ParticleSpawn => ({
  x, y: 1, z: 0, vx: 0, vy: 0, vz: 0, life,
  startSize: 1, endSize: 2, alpha: .2, r: 1, g: .5, b: .25, lift: 0, drag: 0,
})

describe('particle pool lifecycle', () => {
  it('expires a short-lived particle without losing the swapped survivor', () => {
    const pool = new ParticlePool(4, 'puff')
    try {
      pool.spawn(puff(.01, 10))
      pool.spawn(puff(1, 20))
      pool.update(.02)
      expect(pool.mesh.geometry.instanceCount).toBe(1)
      expect(pool.mesh.geometry.getAttribute('iPos').getX(0)).toBe(20)
      expect(pool.mesh.visible).toBe(true)
      pool.update(1)
      expect(pool.mesh.geometry.instanceCount).toBe(0)
      expect(pool.mesh.visible).toBe(false)
    } finally { pool.dispose() }
  })

  it('bounds saturated emissions and resets without drawing old particles', () => {
    const pool = new ParticlePool(2, 'grain')
    try {
      for (let i = 0; i < 10; i++) pool.spawn(puff(10, i))
      pool.update(.01)
      expect(pool.mesh.geometry.instanceCount).toBe(2)
      pool.clear()
      expect(pool.mesh.visible).toBe(false)
      pool.spawn(puff(1, 99))
      pool.update(.01)
      expect(pool.mesh.geometry.instanceCount).toBe(1)
      expect(pool.mesh.geometry.getAttribute('iPos').getX(0)).toBe(99)
    } finally { pool.dispose() }
  })

  it('can lower and restore a quality limit without resurrecting discarded slots', () => {
    const pool = new ParticlePool(4, 'puff')
    try {
      for (let i = 0; i < 4; i++) pool.spawn(puff(10, i))
      pool.update(.01)
      pool.setLimit(1)
      pool.update(.01)
      expect(pool.mesh.geometry.instanceCount).toBe(1)
      pool.setLimit(4)
      pool.update(.01)
      expect(pool.mesh.geometry.instanceCount).toBe(1)
      pool.spawn(puff(1, 44))
      pool.update(.01)
      expect(pool.mesh.geometry.instanceCount).toBe(2)
      expect(pool.mesh.geometry.getAttribute('iPos').getX(1)).toBe(44)
    } finally { pool.dispose() }
  })
})
