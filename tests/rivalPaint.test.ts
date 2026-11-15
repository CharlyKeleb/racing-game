import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { paintKind, rivalMaterial } from '../src/vehicles/RivalPaint'

describe('rival paint', () => {
  it('finds paint by the garage rule: plain `paint`, or the car\'s texture-livery aliases', () => {
    expect(paintKind('paint', 'porsche911')).toBe('plain')
    expect(paintKind('Paint.001', 'koenigsegg')).toBe('plain')
    expect(paintKind('Mat.3', 'bmw')).toBe('livery')
    expect(paintKind('Mat.3', 'porsche911')).toBeNull()
    expect(paintKind('glass', 'bmw')).toBeNull()
  })
  it('gives plain paint a clearcoat in the team colour, dropping the stock base-colour maps', () => {
    const stock = new THREE.MeshStandardMaterial({ name: 'paint', map: new THREE.Texture(), roughnessMap: new THREE.Texture(), metalness: 1, roughness: 1 })
    const paint = rivalMaterial(stock, 'koenigsegg', 0xffd447) as THREE.MeshPhysicalMaterial
    expect(paint).toBeInstanceOf(THREE.MeshPhysicalMaterial)
    expect(paint).not.toBe(stock)
    expect(paint.clearcoat).toBe(1)
    expect(paint.map).toBeNull()
    expect(paint.roughnessMap).toBeNull()
    expect(paint.roughness).toBeLessThan(0.5)
    expect(paint.color.getHex()).toBe(0xffd447)
  })
  it('keeps a texture livery under the clearcoat, uncoloured', () => {
    const map = new THREE.Texture()
    const livery = new THREE.MeshPhysicalMaterial({ name: 'Mat.3', map, color: 0xffffff })
    const paint = rivalMaterial(livery, 'bmw', 0x27b8eb) as THREE.MeshPhysicalMaterial
    expect(paint.map).toBe(map)
    expect(paint.color.getHex()).toBe(0xffffff)
    expect(paint.clearcoat).toBe(1)
  })
  it('clones everything else, recolouring only old "body color" materials', () => {
    const glass = new THREE.MeshStandardMaterial({ name: 'glass', color: 0x111111 })
    const own = rivalMaterial(glass, 'bmw', 0x27b8eb) as THREE.MeshStandardMaterial
    expect(own).not.toBe(glass)
    expect(own.color.getHex()).toBe(0x111111)
    const body = rivalMaterial(new THREE.MeshStandardMaterial({ name: 'Body Color' }), 'x', 0x27b8eb) as THREE.MeshStandardMaterial
    expect(body.color.getHex()).toBe(0x27b8eb)
  })
})

describe('cheap rival materials', () => {
  it('turns transmissive glass into one-pass alpha glass', () => {
    const glass = new THREE.MeshPhysicalMaterial({ name: 'window', transmission: 1, thickness: 0.2, side: THREE.DoubleSide })
    const own = rivalMaterial(glass, 'r33', 0x27b8eb) as THREE.MeshPhysicalMaterial
    expect(own.transmission).toBe(0)
    expect(own.transparent).toBe(true)
    expect(own.opacity).toBeGreaterThan(0.2)
    expect(own.opacity).toBeLessThan(1)
    expect(own.depthWrite).toBe(false)
    expect(own.forceSinglePass).toBe(true)
    expect(glass.transmission).toBe(1) // the cached source is untouched
  })
  it('draws any transparent rival part in one pass, and leaves opaque parts alone', () => {
    const lens = rivalMaterial(new THREE.MeshStandardMaterial({ name: 'redglass', transparent: true, opacity: 0.3, side: THREE.DoubleSide }), 'charger', 0)
    expect(lens.forceSinglePass).toBe(true)
    expect(lens.opacity).toBe(0.3)
    const trim = rivalMaterial(new THREE.MeshStandardMaterial({ name: 'trim' }), 'charger', 0)
    expect(trim.transparent).toBe(false)
    expect(trim.forceSinglePass).toBe(false)
  })
})
