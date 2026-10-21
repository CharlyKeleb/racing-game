import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { ChaseCamera } from '../src/camera/ChaseCamera'

/** Run the chase camera at speed with nitro and return the lens FOV it settles on. */
function settledFov(fovEffects: boolean): { fov: number; base: number } {
  const lens = new THREE.PerspectiveCamera()
  const rig = new ChaseCamera(lens)
  rig.fovEffects = fovEffects
  const car = new THREE.Object3D()
  for (let i = 0; i < 240; i++) rig.update(car, 250, 1 / 60, 1)
  return { fov: lens.fov, base: rig.baseFov }
}

describe('motion settings (#18)', () => {
  it('speed and nitro widen the FOV by default', () => {
    const { fov, base } = settledFov(true)
    expect(fov).toBeGreaterThan(base + 10)
  })

  it('with FOV effects off the lens stays at its base FOV at speed and on nitro', () => {
    const { fov, base } = settledFov(false)
    expect(fov).toBeCloseTo(base, 1)
  })
})
