import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { WhipStreaks } from '../src/effects/WhipStreaks'

// Node has no canvas: a 2D context that just records nothing is enough to build the texture.
beforeAll(() => {
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true })
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) })
})
afterAll(() => vi.unstubAllGlobals())

describe('whip streaks fallback (#46)', () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100)
  camera.position.set(5, 2, -3)
  camera.lookAt(0, 0, 10)
  camera.updateMatrixWorld()

  it('stays hidden with no whip and shows, in front of the lens and covering the frame, during one', () => {
    const streaks = new WhipStreaks()
    streaks.update(camera, 0, 1, 1 / 60)
    expect(streaks.mesh.visible).toBe(false)
    streaks.update(camera, 0.8, 1, 1 / 60)
    expect(streaks.mesh.visible).toBe(true)
    // In view, just ahead of the camera.
    const local = streaks.mesh.position.clone().applyMatrix4(camera.matrixWorldInverse)
    expect(local.z).toBeLessThan(-camera.near)
    expect(Math.hypot(local.x, local.y)).toBeLessThan(1e-6)
    // At least as big as the view at that depth.
    const height = 2 * -local.z * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    expect(streaks.mesh.scale.y).toBeGreaterThanOrEqual(height)
    expect(streaks.mesh.scale.x).toBeGreaterThanOrEqual(height * camera.aspect)
    streaks.dispose()
  })

  it('fades with the whip and scrolls with the swing direction', () => {
    const streaks = new WhipStreaks()
    const material = streaks.mesh.material as THREE.MeshBasicMaterial
    streaks.update(camera, 0.3, 1, 1 / 60)
    const light = material.opacity
    const offset = material.map!.offset.x
    streaks.update(camera, 1, 1, 1 / 60)
    expect(material.opacity).toBeGreaterThan(light)
    expect(material.map!.offset.x).toBeGreaterThan(offset)
    streaks.update(camera, 1, -1, 1 / 60)
    expect(material.map!.offset.x).toBeLessThan(offset + 1)
    streaks.dispose()
  })
})
