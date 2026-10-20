import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { AnyRenderer } from '../src/engine/Renderer'
import { backend } from '../src/engine/backend'
import { SkidMarks } from '../src/effects/SkidMarks'
import { TILE_COUNT, tileSlot, skidPaint } from '../src/effects/SkidPaint'
import { DEFAULT_VEHICLE_CONFIG } from '../src/vehicles/VehicleConfig'
import type { WheelState } from '../src/vehicles/VehicleController'
import { withTrackLook } from '../src/world/TrackLook'
import { Surface } from '../src/vehicles/Surface'

function rendererStub() {
  const viewport = new THREE.Vector4(1, 2, 800, 600), scissor = new THREE.Vector4(3, 4, 500, 400)
  let target: THREE.WebGLRenderTarget | null = null, scissorTest = false, alpha = .7
  const color = new THREE.Color(.1, .2, .3)
  const draws: { stamps: number; vertices: number[]; decay?: number[] }[] = []
  let clears = 0
  const renderer = {
    autoClear: true,
    getRenderTarget: () => target, setRenderTarget: (v: THREE.WebGLRenderTarget | null) => { target = v },
    getClearAlpha: () => alpha, getClearColor: (v: THREE.Color) => v.copy(color),
    setClearColor: (v: THREE.ColorRepresentation, a: number) => { color.set(v); alpha = a },
    getScissorTest: () => scissorTest, setScissorTest: (v: boolean) => { scissorTest = v },
    getViewport: (v: THREE.Vector4) => v.copy(viewport), getScissor: (v: THREE.Vector4) => v.copy(scissor),
    setViewport: (v: THREE.Vector4) => viewport.copy(v), setScissor: (v: THREE.Vector4 | number, y: number, w: number, h: number) => typeof v === 'number' ? scissor.set(v, y, w, h) : scissor.copy(v),
    clear: () => { clears++ },
    render: (scene: THREE.Scene) => {
      const mesh = scene.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
      draws.push({ stamps: mesh.geometry.drawRange.count, vertices: Array.from(mesh.geometry.getAttribute('position').array), decay: mesh.material.uniforms.uDecay?.value.toArray() })
    },
  }
  return { renderer: renderer as unknown as AnyRenderer, draws, get clears() { return clears }, viewport, scissor, color }
}
function wheels() {
  return DEFAULT_VEHICLE_CONFIG.wheels.map(cfg => ({ cfg, grounded: true, slide: 8, surface: Surface.Asphalt, contactPoint: new THREE.Vector3() } as WheelState))
}
const focus = new THREE.Vector3()
afterEach(() => { backend.nodes = null; skidPaint.uSkidReady.value = 0 })

describe('GPU skid paint lifecycle', () => {
  it('binds native track materials made before the paint target, including after a car swap', async () => {
    const nodes = await import('../src/engine/nodes')
    backend.nodes = nodes
    const source = new THREE.MeshStandardMaterial({ name: 'asphalt' }); source.userData.layer = 'road'
    const material = withTrackLook(source) as import('three/webgpu').MeshStandardNodeMaterial
    const first = new SkidMarks()
    const textures: THREE.Texture[] = []
    const collect = () => {
      textures.length = 0
      material.colorNode!.traverse(node => { if ((node as THREE.Node & { isTextureNode?: boolean }).isTextureNode) textures.push((node as import('three/tsl').TextureNode).value) })
    }
    collect(); expect(textures).toContain(first.target.texture)
    first.dispose()
    const second = new SkidMarks()
    collect(); expect(textures).toContain(second.target.texture); expect(textures).not.toContain(first.target.texture)
    second.dispose(); material.dispose()
  })
  it('uses unique toroidal slots across negative coordinates and tile boundaries', () => {
    for (let origin = -20; origin < 20; origin++) {
      const slots = new Set<number>()
      for (let z = origin; z < origin + TILE_COUNT; z++) for (let x = origin; x < origin + TILE_COUNT; x++) slots.add(tileSlot(x, z))
      expect(slots.size).toBe(16)
    }
  })
  it('uploads only fresh contacts, preserving slopes, and draws no segments during grip or teleports', () => {
    const marks = new SkidMarks(), stub = rendererStub(), w = wheels()
    w.forEach(wheel => wheel.contactPoint.set(2, 3, 2)); marks.update(w, 0); marks.render(stub.renderer, focus)
    expect(stub.draws).toHaveLength(0)
    w.forEach(wheel => wheel.contactPoint.set(2, 3.2, 3)); marks.update(w, .016); marks.render(stub.renderer, focus)
    const stamp = stub.draws.find(d => !d.decay)!
    expect(stamp.stamps).toBe(24)
    expect(stamp.vertices[1]).toBeCloseTo(3); expect(stamp.vertices[7]).toBeCloseTo(3.2)
    const count = stub.draws.filter(d => !d.decay).length
    w.forEach(wheel => wheel.contactPoint.z = 100); marks.update(w, .016); marks.render(stub.renderer, focus)
    expect(stub.draws.filter(d => !d.decay)).toHaveLength(count)
    w.forEach(wheel => { wheel.slide = 0; wheel.contactPoint.z++ }); marks.update(w, .016); marks.render(stub.renderer, focus)
    expect(stub.draws.filter(d => !d.decay)).toHaveLength(count)
    marks.dispose()
  })
  it('preserves shared tiles, clears recycled tiles through a draw, restores render state, and resets quality', () => {
    const marks = new SkidMarks(), stub = rendererStub()
    marks.render(stub.renderer, focus)
    expect(stub.clears).toBe(1)
    marks.render(stub.renderer, new THREE.Vector3(33, 0, 0))
    // Empty history skips all GPU work, so seed active marks before moving.
    const w = wheels(); w.forEach(w => w.contactPoint.set(1, 0, 1)); marks.update(w, 0)
    w.forEach(w => w.contactPoint.z++); marks.update(w, .016); marks.render(stub.renderer, focus)
    stub.draws.length = 0
    marks.render(stub.renderer, new THREE.Vector3(33, 0, 0))
    expect(stub.draws.filter(d => d.decay?.[0] === 0)).toHaveLength(4)
    expect(stub.clears).toBe(1) // partial clear must never clear the whole WebGPU attachment
    expect(stub.viewport.toArray()).toEqual([1, 2, 800, 600]); expect(stub.scissor.toArray()).toEqual([3, 4, 500, 400])
    expect(stub.renderer.autoClear).toBe(true); expect(stub.renderer.getRenderTarget()).toBeNull()
    expect(stub.renderer.getClearAlpha()).toBe(.7)
    marks.setQuality('high'); expect(marks.target.width).toBe(2048); expect(skidPaint.uSkidReady.value).toBe(0)
    marks.render(stub.renderer, focus); expect(stub.clears).toBe(2)
    marks.clear(); expect(skidPaint.uSkidReady.value).toBe(0)
    marks.dispose()
  })
})
