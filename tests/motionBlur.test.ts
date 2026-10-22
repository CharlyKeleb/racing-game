import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { motionExposure } from '../src/effects/MotionBlur'
import { MotionVectors } from '../src/effects/MotionVectors'
import type { AnyRenderer } from '../src/engine/Renderer'

describe('motion exposure', () => {
  it('uses the same shutter duration at different refresh rates', () => {
    expect(motionExposure(160, 1, 1 / 60) / 60).toBeCloseTo(motionExposure(160, 1, 1 / 144) / 144)
    expect(motionExposure(0, 1, 1 / 60)).toBe(0)
    expect(motionExposure(100, 0, 1 / 60)).toBe(0)
    expect(motionExposure(160, 1, .2)).toBe(0)
    expect(motionExposure(160, NaN, 1 / 60)).toBe(0)
  })
})

function fixture() {
  const scene = new THREE.Scene()
  const player = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
  const wheel = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
  player.add(body)
  scene.add(player, wheel)
  const camera = new THREE.PerspectiveCamera()
  camera.position.z = 10
  const color = new THREE.Color(0x123456)
  const originalTarget = new THREE.WebGLRenderTarget()
  let target = originalTarget
  let alpha = .4
  let during = () => {}
  const renderer = {
    autoClear: false, shadowMap: { autoUpdate: true },
    getRenderTarget: () => target,
    setRenderTarget: (t: THREE.WebGLRenderTarget) => { target = t },
    getClearAlpha: () => alpha,
    getClearColor: (out: THREE.Color) => out.copy(color),
    setClearColor: (c: THREE.ColorRepresentation, a: number) => { color.set(c); alpha = a },
    clear() {}, render: () => during(),
  }
  return { scene, player, body, wheel, camera, renderer, originalTarget, setDuring: (fn: () => void) => { during = fn } }
}

describe('motion-vector history', () => {
  it('protects the player body while retaining wheel transform history', () => {
    const f = fixture()
    const vectors = new MotionVectors()
    const original = f.wheel.material
    let first = true
    f.setDuring(() => {
      const body = f.body.material as THREE.ShaderMaterial
      const wheel = f.wheel.material as THREE.ShaderMaterial
      expect(body.uniforms.sharp.value).toBe(1)
      expect(wheel.uniforms.sharp.value).toBe(0)
      if (!first) expect(wheel.uniforms.previous.value.elements).not.toEqual(f.wheel.matrixWorld.elements)
    })
    expect(vectors.capture(f.renderer as unknown as AnyRenderer, f.scene, f.camera, f.player)).toBe(false)
    first = false
    f.wheel.rotation.x = .3
    expect(vectors.capture(f.renderer as unknown as AnyRenderer, f.scene, f.camera, f.player)).toBe(true)
    expect(f.wheel.material).toBe(original)
    first = true
    f.camera.position.x += 50
    expect(vectors.capture(f.renderer as unknown as AnyRenderer, f.scene, f.camera, f.player)).toBe(false)
    vectors.reset()
    first = true
    expect(vectors.capture(f.renderer as unknown as AnyRenderer, f.scene, f.camera, f.player)).toBe(false)
    vectors.dispose()
  })

  it('restores materials, layers, background, shadows and render target after failure', () => {
    const f = fixture()
    const vectors = new MotionVectors()
    const material = f.body.material
    const background = new THREE.Color('red')
    f.scene.background = background
    f.body.layers.enable(4)
    const layers = f.body.layers.mask
    f.setDuring(() => { throw new Error('device failure') })
    expect(() => vectors.capture(f.renderer as unknown as AnyRenderer, f.scene, f.camera, f.player)).toThrow('device failure')
    expect(f.body.material).toBe(material)
    expect(f.body.layers.mask).toBe(layers)
    expect(f.camera.layers.mask).toBe(1)
    expect(f.scene.background).toBe(background)
    expect(f.renderer.getRenderTarget()).toBe(f.originalTarget)
    expect(f.renderer.shadowMap.autoUpdate).toBe(true)
    expect(f.renderer.autoClear).toBe(false)
    expect(f.renderer.getClearAlpha()).toBe(.4)
    vectors.dispose()
  })
})
