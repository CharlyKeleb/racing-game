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

describe('burnout camera hold', () => {
  /** Chase camera direction (camera → car), as a heading in degrees. */
  function cameraHeading(hold: number): number {
    const lens = new THREE.PerspectiveCamera()
    const rig = new ChaseCamera(lens)
    const car = new THREE.Object3D()
    for (let i = 0; i < 120; i++) rig.update(car, 0, 1 / 60)
    rig.burnoutHold = hold
    // The car swings 90° on the spot over two seconds, as in a rotating burnout.
    for (let i = 0; i < 120; i++) {
      car.rotation.y = (-Math.PI / 2 * (i + 1)) / 120
      car.updateMatrixWorld()
      rig.update(car, 0, 1 / 60)
    }
    const d = car.position.clone().sub(lens.position)
    return Math.atan2(d.x, d.z) * 180 / Math.PI
  }

  it('holds its direction while the car rotates in a burnout, so its side comes into view', () => {
    expect(Math.abs(cameraHeading(1))).toBeLessThan(15)
  })

  it('without a burnout it stays behind the car as usual', () => {
    expect(Math.abs(cameraHeading(0) + 90)).toBeLessThan(15)
  })
})
