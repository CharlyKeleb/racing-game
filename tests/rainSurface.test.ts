import { splashHeight, SPLASH_GRAVITY } from '../src/effects/RainImpactPhysics'
import { sampleCarRain, CarRain } from '../src/effects/CarRain'
import type { CarModel } from '../src/vehicles/CarModel'
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


it('anchors car splashes to actual upper body geometry in body-local coordinates', () => {
  const root = new THREE.Group(), body = new THREE.Group()
  root.add(body)
  const material = new THREE.MeshPhysicalMaterial({ name: 'livery_paint', roughness: .7, clearcoat: 0 })
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4), material)
  chassis.position.y = .5; body.add(chassis)
  root.position.set(20, 5, -12); root.rotation.y = .7
  const model = { root, body, wheels: {} } as CarModel
  const anchors = sampleCarRain(model, 40)
  expect(anchors.positions.length).toBeGreaterThan(60)
  for (let i = 0; i < anchors.positions.length; i += 3) {
    expect(anchors.positions[i + 1]).toBeCloseTo(1)
    expect(anchors.normals[i + 1]).toBeCloseTo(1)
  }
  const field = new RainSurface(), rain = new CarRain(model, field.uniforms)
  rain.update(model, 1)
  expect(material.roughness).toBe(.18)
  expect(material.clearcoat).toBe(1)
  expect(rain.impacts.mesh.visible).toBe(true)
  // Changing the transform does not re-sample or upload the anchors.
  const attribute = rain.impacts.mesh.geometry.getAttribute('aAnchor')
  root.position.x += 100
  rain.update(model, 1)
  expect(rain.impacts.mesh.geometry.getAttribute('aAnchor')).toBe(attribute)
  rain.update(model, 0)
  expect(material.roughness).toBe(.7)
  expect(material.clearcoat).toBe(0)
  expect(rain.impacts.mesh.visible).toBe(false)
  rain.dispose(); field.dispose()
})


it('splash droplets rise, fall under gravity and land at the expected flight time', () => {
  const launch = 1.4
  const apex = launch / SPLASH_GRAVITY
  const landing = 2 * launch / SPLASH_GRAVITY
  expect(splashHeight(launch, 0)).toBe(0)
  expect(splashHeight(launch, apex)).toBeCloseTo(launch * launch / (2 * SPLASH_GRAVITY))
  expect(splashHeight(launch, apex * 1.5)).toBeLessThan(splashHeight(launch, apex))
  expect(splashHeight(launch, landing)).toBeCloseTo(0)
  expect(splashHeight(launch, landing + .01)).toBeLessThan(0)
})
