import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { CarLivery } from '../src/vehicles/CarLivery'
import { DEFAULT_BUILD } from '../src/vehicles/CarBuild'
import { paintFinishUniforms, patchPaintFinish } from '../src/vehicles/PaintFinish'
import type { CarModel } from '../src/vehicles/CarModel'

vi.mock('../src/vehicles/LicensePlate', () => ({ LicensePlate: class { apply() {} dispose() {} } }))

describe('premium paint ownership and finish switching', () => {
  it('keeps cached source materials intact and restores them on disposal', () => {
    const source = new THREE.MeshPhysicalMaterial({ name: 'paint', color: '#123456' })
    const geometry = new THREE.BoxGeometry()
    const body = new THREE.Mesh(geometry, source), root = new THREE.Group()
    root.add(body)
    const model = { root, body, wheels: {} } as CarModel
    const livery = new CarLivery(model)
    const paint = body.material as THREE.MeshPhysicalMaterial
    livery.apply({ ...DEFAULT_BUILD, finish: 'pearl' })
    expect(paint.iridescence).toBe(1)
    livery.apply({ ...DEFAULT_BUILD, finish: 'matte' })
    expect(paint.clearcoat).toBe(0)
    expect(paint.iridescence).toBe(0)
    livery.apply({ ...DEFAULT_BUILD, finish: 'metallic' })
    expect(paint.clearcoat).toBe(1)
    expect(paint.roughness).toBe(.3)
    expect(source.color.getHexString()).toBe('123456')
    livery.dispose()
    expect(body.material).toBe(source)
    expect(body.geometry).toBe(geometry)
  })
  it('composes with projected livery shader hooks without replacing them', () => {
    const material = new THREE.MeshPhysicalMaterial()
    material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n// existing livery')
    }
    const uniforms = paintFinishUniforms()
    patchPaintFinish(material, uniforms)
    const shader = {
      uniforms: {}, vertexShader: '#include <begin_vertex>',
      fragmentShader: '#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>',
    }
    material.onBeforeCompile(shader as unknown as Parameters<typeof material.onBeforeCompile>[0], {} as THREE.WebGLRenderer)
    expect(shader.fragmentShader).toContain('// existing livery')
    expect(shader.fragmentShader.indexOf('pearlTint')).toBeLessThan(shader.fragmentShader.indexOf('// existing livery'))
    expect(shader.uniforms).toMatchObject(uniforms)
  })
})
