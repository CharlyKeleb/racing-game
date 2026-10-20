import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { WetReflections } from '../src/effects/WetReflections'
import type { AnyRenderer } from '../src/engine/Renderer'

function fixture(fail = false) {
  const scene = new THREE.Scene(), track = new THREE.Group()
  const material = new THREE.MeshLambertMaterial(); material.userData.layer = 'road'
  const road = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), material)
  road.rotation.x = -Math.PI / 2; track.add(road); scene.add(track)
  const camera = new THREE.PerspectiveCamera(60, 2, .1, 200)
  camera.position.set(0, 3, 6); camera.lookAt(0, 0, 0)
  let target: unknown = null
  const renderer = {
    autoClear: false, shadowMap: { autoUpdate: true },
    getRenderTarget: () => target, setRenderTarget: (t: unknown) => { target = t },
    render: () => { expect(road.visible).toBe(false); if (fail) throw new Error('capture failed') },
  }
  return { scene, track, road, camera, renderer }
}
describe('wet road planar reflections', () => {
  it('reflects the camera in the sampled road and restores capture state', () => {
    const f = fixture(), effect = new WetReflections()
    effect.update(f.renderer as unknown as AnyRenderer, f.scene, f.track, f.camera, new THREE.Vector3(), 1, .016)
    expect(effect.camera.position.y).toBeCloseTo(-3)
    expect(effect.uniforms.uWetReflectionReady.value).toBe(1)
    expect(f.road.visible).toBe(true)
    expect(f.renderer.autoClear).toBe(false)
    expect(f.renderer.shadowMap.autoUpdate).toBe(true)
    expect(f.renderer.getRenderTarget()).toBeNull()
    effect.dispose()
  })
  it('restores roads and state when rendering fails', () => {
    const f = fixture(true), effect = new WetReflections()
    expect(() => effect.update(f.renderer as unknown as AnyRenderer, f.scene, f.track, f.camera, new THREE.Vector3(), 1, .016)).toThrow('capture failed')
    expect(f.road.visible).toBe(true)
    expect(f.renderer.getRenderTarget()).toBeNull()
    expect(effect.uniforms.uWetReflectionReady.value).toBe(0)
    effect.dispose()
  })
  it.each([THREE.WebGLCoordinateSystem, THREE.WebGPUCoordinateSystem])('clips below-road geometry in coordinate system %s', coordinateSystem => {
    const f = fixture(), effect = new WetReflections()
    f.camera.coordinateSystem = coordinateSystem; f.camera.updateProjectionMatrix()
    effect.update(f.renderer as unknown as AnyRenderer, f.scene, f.track, f.camera, new THREE.Vector3(), 1, .016)
    const project = (y: number) => new THREE.Vector4(0, y, 0, 1)
      .applyMatrix4(effect.camera.matrixWorldInverse).applyMatrix4(effect.camera.projectionMatrix)
    const above = project(1), below = project(-1)
    const near = (p: THREE.Vector4) => p.z + (coordinateSystem === THREE.WebGLCoordinateSystem ? p.w : 0)
    expect(near(above)).toBeGreaterThan(0)
    expect(near(below)).toBeLessThan(0)
    effect.dispose()
  })
  it('disables stale reflections in dry weather and scales capture budgets', () => {
    const f = fixture(true), effect = new WetReflections()
    effect.uniforms.uWetReflectionReady.value = 1
    effect.update(f.renderer as unknown as AnyRenderer, f.scene, f.track, f.camera, new THREE.Vector3(), 0, .016)
    expect(effect.uniforms.uWetReflectionReady.value).toBe(0)
    effect.setQuality('low'); expect(effect.target.width).toBe(256)
    effect.setQuality('high'); expect(effect.target.width).toBe(768)
    effect.dispose()
  })
})
