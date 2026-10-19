import { describe, expect, it } from 'vitest'
import { sprayAmount } from '../src/effects/RainSpray'
import * as THREE from 'three'
import { Rain, RAIN_STREAKS, RAIN_EXPOSURE, RAIN_FALL } from '../src/effects/Rain'

describe('rain', () => {
  it('throws no spray crawling, and much more at speed', () => {
    expect(sprayAmount(0)).toBe(0)
    expect(sprayAmount(4)).toBe(0)
    const slow = sprayAmount(15), fast = sprayAmount(60)
    expect(slow).toBeGreaterThan(0)
    expect(fast).toBeGreaterThan(slow * 5)
    expect(sprayAmount(40)).toBeCloseTo(1, 5)
  })

  it('draws short streaks standing still and long ones at racing speed', () => {
    const still = Math.hypot(RAIN_FALL.x, RAIN_FALL.y, RAIN_FALL.z) * RAIN_EXPOSURE
    const at250 = Math.hypot(RAIN_FALL.x, RAIN_FALL.y, RAIN_FALL.z - 250 / 3.6) * RAIN_EXPOSURE
    expect(still).toBeGreaterThan(0.08)
    expect(still).toBeLessThan(0.25)
    expect(at250).toBeGreaterThan(still * 5)
  })
})


describe('rain lifecycle and camera motion', () => {
  it('clamps density to the selected quality and hides outside wet weather', () => {
    const rain = new Rain()
    const camera = new THREE.PerspectiveCamera()
    rain.setQuality('low')
    rain.update(camera, 4, 1 / 60)
    expect((rain.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(RAIN_STREAKS.low)
    rain.update(camera, 0, 1 / 60)
    expect(rain.mesh.visible).toBe(false)
    rain.dispose()
  })

  it('rejects a camera cut before it contaminates smoothed apparent velocity', () => {
    const rain = new Rain()
    const camera = new THREE.PerspectiveCamera()
    rain.update(camera, 1, 1 / 60)
    camera.position.x = 1
    rain.update(camera, 1, 1 / 60)
    const uniforms = (rain.mesh.material as THREE.ShaderMaterial).uniforms
    expect(uniforms.uCameraVelocity.value.x).toBeGreaterThan(0)
    camera.position.x += 20
    rain.update(camera, 1, 1 / 60)
    expect(uniforms.uCameraVelocity.value.length()).toBe(0)
    rain.dispose()
  })
})


it('keeps camera-facing rain visible when billboard orientation changes', () => {
  const rain = new Rain()
  expect((rain.mesh.material as THREE.Material).side).toBe(THREE.DoubleSide)
  rain.dispose()
})
