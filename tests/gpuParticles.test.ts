import { describe, expect, it } from 'vitest'
import type { WebGPURenderer } from 'three/webgpu'
import { GpuParticlePool } from '../src/engine/nodes/particles'
import { createParticles, particleBudget, ParticlePool, type ParticleSpawn } from '../src/effects/Particles'

/** Records compute dispatches; the kernels themselves need a GPU. */
function stubRenderer() {
  const dispatched: unknown[] = []
  return { renderer: { compute: (node: unknown) => dispatched.push(node) } as unknown as WebGPURenderer, dispatched }
}

const puff = (life: number): ParticleSpawn => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life, startSize: 1, endSize: 2, alpha: 0.5, r: 1, g: 1, b: 1, lift: 0, drag: 0 })

describe('GPU particle pool (CPU side)', () => {
  it('draws nothing until something spawns, and dispatches nothing while idle', () => {
    const { renderer, dispatched } = stubRenderer()
    const pool = new GpuParticlePool(renderer, 1000, 'puff')
    pool.update(1 / 60)
    expect(pool.mesh.count).toBe(0)
    const afterClear = dispatched.length // the one-off clear kernel
    pool.update(1 / 60)
    expect(dispatched.length).toBe(afterClear)
  })

  it('draws only the newest slots that can still be alive', () => {
    const { renderer } = stubRenderer()
    const pool = new GpuParticlePool(renderer, 1000, 'puff')
    for (let i = 0; i < 30; i++) pool.spawn(puff(1))
    pool.update(1 / 60)
    expect(pool.mesh.count).toBe(30)
    for (let i = 0; i < 20; i++) pool.spawn(puff(1))
    pool.update(1 / 60)
    expect(pool.mesh.count).toBe(50)
    // Past the longest life: all dead, nothing drawn, no more dispatches.
    for (let f = 0; f < 120; f++) pool.update(1 / 60)
    expect(pool.mesh.count).toBe(0)
  })

  it('never draws more than the pool holds', () => {
    const { renderer } = stubRenderer()
    const pool = new GpuParticlePool(renderer, 100, 'spark')
    for (let f = 0; f < 10; f++) {
      for (let i = 0; i < 40; i++) pool.spawn(puff(5))
      pool.update(1 / 60)
    }
    expect(pool.mesh.count).toBe(100)
  })

  it('forgets everything on clear', () => {
    const { renderer } = stubRenderer()
    const pool = new GpuParticlePool(renderer, 100, 'grain')
    for (let i = 0; i < 10; i++) pool.spawn(puff(3))
    pool.update(1 / 60)
    pool.clear()
    pool.update(1 / 60)
    expect(pool.mesh.count).toBe(0)
  })
})

describe('particle factory', () => {
  it('uses the CPU pool and budget under WebGL', () => {
    expect(particleBudget()).toBe(1)
    expect(createParticles(64, 'puff')).toBeInstanceOf(ParticlePool)
  })
})
