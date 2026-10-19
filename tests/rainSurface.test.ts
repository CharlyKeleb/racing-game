import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { RainSurface } from '../src/effects/RainSurface'
import { RainImpacts, IMPACT_COUNTS } from '../src/effects/RainImpacts'
import { WetRoads } from '../src/effects/WetRoads'
import type { AnyRenderer } from '../src/engine/Renderer'

function rendererStub(fail = false) {
  let target: THREE.RenderTarget | null = null
  const color = new THREE.Color('#123456')
  let alpha = .6
  return {
    autoClear: false,
    getRenderTarget: () => target,
    setRenderTarget: (value: THREE.RenderTarget | null) => { target = value },
    getClearColor: (out: THREE.Color) => out.copy(color),
    getClearAlpha: () => alpha,
    setClearColor: (value: THREE.ColorRepresentation, opacity: number) => { color.set(value); alpha = opacity },
    clear: () => {},
    render: () => { if (fail) throw new Error('capture failed') },
  }
}

describe('rain surface capture', () => {
  it('captures roofs/roads on an isolated layer and restores scene/renderer state', () => {
    const field = new RainSurface(), renderer = rendererStub()
    const scene = new THREE.Scene(), track = new THREE.Group()
    const roof = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
    track.add(roof); scene.add(track)
    const background = new THREE.Color('#ffeedd'); scene.background = background
    const camera = new THREE.PerspectiveCamera(); camera.position.set(12, 4, 8)
    field.update(renderer as unknown as AnyRenderer, scene, track, camera, 1, 1 / 60)
    expect(field.uniforms.uRainReady.value).toBe(1)
    expect(roof.layers.isEnabled(0)).toBe(true)
    expect(roof.layers.isEnabled(31)).toBe(true)
    expect(scene.overrideMaterial).toBeNull()
    expect(scene.background).toBe(background)
    expect(renderer.autoClear).toBe(false)
    expect(renderer.getRenderTarget()).toBeNull()
    expect(renderer.getClearColor(new THREE.Color()).getHexString()).toBe('123456')
    expect(renderer.getClearAlpha()).toBe(.6)
    field.dispose()
  })
  it('restores rendering state even if the capture fails', () => {
    const field = new RainSurface(), renderer = rendererStub(true)
    const scene = new THREE.Scene(), track = new THREE.Group(), camera = new THREE.Camera()
    expect(() => field.update(renderer as unknown as AnyRenderer, scene, track, camera, 1, .016)).toThrow('capture failed')
    expect(renderer.getRenderTarget()).toBeNull()
    expect(scene.overrideMaterial).toBeNull()
    expect(field.uniforms.uRainReady.value).toBe(0)
    field.dispose()
  })
  it('does no capture when dry and invalidates old heights when quality changes', () => {
    const field = new RainSurface(), renderer = rendererStub(true)
    field.update(renderer as unknown as AnyRenderer, new THREE.Scene(), new THREE.Group(), new THREE.Camera(), 0, .016)
    field.uniforms.uRainReady.value = 1
    field.setQuality('low')
    expect(field.target.width).toBe(128)
    expect(field.uniforms.uRainReady.value).toBe(0)
    field.dispose()
  })
})

it('scales ground splash counts with quality', () => {
  const field = new RainSurface(), impacts = new RainImpacts(field.uniforms)
  impacts.setQuality('low')
  expect((impacts.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(IMPACT_COUNTS.low)
  impacts.dispose(); field.dispose()
})

it('keeps weather changes off props and restores owned road shader hooks on disposal', () => {
  const field = new RainSurface(), wet = new WetRoads(field.uniforms), track = new THREE.Group()
  const road = new THREE.MeshStandardMaterial(); road.userData.layer = 'road'
  const prop = new THREE.MeshStandardMaterial()
  const roadHook = road.onBeforeCompile, propHook = prop.onBeforeCompile
  track.add(new THREE.Mesh(new THREE.PlaneGeometry(), road), new THREE.Mesh(new THREE.BoxGeometry(), prop))
  wet.update(track, 1, .016)
  expect(road.onBeforeCompile).not.toBe(roadHook)
  expect(prop.onBeforeCompile).toBe(propHook)
  // A track switch must release the old shader hooks and material references.
  wet.update(new THREE.Group(), 1, .3)
  expect(road.onBeforeCompile).toBe(roadHook)
  wet.dispose()
  expect(road.onBeforeCompile).toBe(roadHook)
  field.dispose()
})
