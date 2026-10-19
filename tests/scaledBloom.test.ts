import { expect, it } from 'vitest'
import { ScaledBloomEffect } from '../src/effects/ScaledBloomEffect'

it('scales both bloom luminance and the mipmap pyramid once per resize', () => {
  const bloom = new ScaledBloomEffect({ mipmapBlur: true, levels: 3 })
  bloom.renderScale = .5
  bloom.setSize(1280, 720)
  expect(bloom.luminancePass.renderTarget.width).toBe(640)
  expect(bloom.luminancePass.renderTarget.height).toBe(360)
  expect(bloom.mipmapBlurPass.texture.image.width).toBe(320)
  bloom.setSize(1280, 720)
  expect(bloom.luminancePass.renderTarget.width).toBe(640)
  bloom.renderScale = .25
  bloom.setSize(1280, 720)
  expect(bloom.luminancePass.renderTarget.width).toBe(320)
  expect(bloom.mipmapBlurPass.texture.image.width).toBe(160)
  bloom.renderScale = 1
  bloom.setSize(1280, 720)
  expect(bloom.luminancePass.renderTarget.width).toBe(1280)
  expect(bloom.mipmapBlurPass.texture.image.width).toBe(640)
  bloom.dispose()
})
