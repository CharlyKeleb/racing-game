import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  postfx: vi.fn(), dispose: vi.fn(), setSize: vi.fn(),
  setPixelRatio: vi.fn(), rendererSize: vi.fn(), directRender: vi.fn(),
}))
vi.mock('../src/effects/PostFX', () => ({ PostFX: class {
  constructor() { mocks.postfx() }
  dispose = mocks.dispose
  setSize = mocks.setSize
  setWhipBlur() {}
  render() {}
} }))
vi.mock('three', async importOriginal => {
  const three = await importOriginal<typeof import('three')>()
  return { ...three, WebGLRenderer: class {
    domElement = { remove: vi.fn() }
    shadowMap = { enabled: false, type: 0 }
    info = { autoReset: true }
    setPixelRatio = mocks.setPixelRatio
    setSize = mocks.rendererSize
    render = mocks.directRender
    dispose() {}
  } }
})
import { Renderer } from '../src/engine/Renderer'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', { devicePixelRatio: 2 })
  vi.stubGlobal('document', { hidden: false })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => vi.unstubAllGlobals())
function makeRenderer() {
  return new Renderer({ appendChild() {}, clientWidth: 1280, clientHeight: 720 } as unknown as HTMLElement)
}

describe('renderer quality lifecycle', () => {
  it('never creates post targets while effects are off', () => {
    const renderer = makeRenderer()
    renderer.applyQuality('low', false)
    renderer.render()
    expect(mocks.postfx).not.toHaveBeenCalled()
    expect(mocks.setSize).not.toHaveBeenCalled()
    expect(mocks.directRender).toHaveBeenCalledOnce()
    expect(renderer.renderer.autoClear).toBe(true)
  })
  it('releases effects on disable and restores direct-frame clearing', () => {
    const renderer = makeRenderer()
    renderer.applyQuality('high', true)
    expect(renderer.renderer.autoClear).toBe(false)
    renderer.applyQuality('high', false)
    expect(mocks.dispose).toHaveBeenCalledOnce()
    expect(renderer.renderer.autoClear).toBe(true)
    renderer.applyQuality('high', true)
    expect(mocks.postfx).toHaveBeenCalledTimes(2)
    renderer.dispose()
    expect(mocks.dispose).toHaveBeenCalledTimes(2)
  })
  it('preserves adapted DPR and targets across unrelated settings and FX toggles', () => {
    const renderer = makeRenderer()
    renderer.applyQuality('high', true)
    for (let i = 0; i < 150; i++) renderer.adapt(1 / 30)
    const adapted = renderer.pixelRatio
    expect(adapted).toBeLessThan(1)
    const resizes = mocks.setPixelRatio.mock.calls.length
    renderer.applyQuality('high', true)
    renderer.applyQuality('high', false)
    renderer.applyQuality('high', true)
    expect(renderer.pixelRatio).toBe(adapted)
    expect(mocks.setPixelRatio).toHaveBeenCalledTimes(resizes)
  })
  it('rebuilds post effects only when their quality profile changes', () => {
    const renderer = makeRenderer()
    renderer.applyQuality('high', true)
    renderer.applyQuality('medium', true)
    renderer.applyQuality('medium', true)
    expect(mocks.postfx).toHaveBeenCalledTimes(2)
    expect(mocks.dispose).toHaveBeenCalledOnce()
  })
  it('resizes post targets when display DPR changes with the same preset', () => {
    const renderer = makeRenderer()
    renderer.applyQuality('high', true)
    mocks.setSize.mockClear()
    window.devicePixelRatio = .75
    renderer.applyQuality('high', true)
    expect(renderer.pixelRatio).toBe(.75)
    expect(mocks.setSize).toHaveBeenCalledWith(1280, 720)
  })
})
