import { afterEach, expect, it, vi } from 'vitest'
import { moveControllerFocus } from '../src/input/ControllerMenu'
import { PAD } from '../src/input/gamepad'

afterEach(() => vi.unstubAllGlobals())

function menu() {
  const doc = { activeElement: null as unknown, querySelectorAll: () => ({ length: 0, item: () => null }), querySelector: () => ({ querySelectorAll: () => items }) }
  class Element {
    constructor(readonly x: number, readonly y: number, readonly disabled = false) {}
    focus = () => { doc.activeElement = this }
    scrollIntoView = vi.fn()
    getBoundingClientRect = () => ({ left: this.x, top: this.y, width: 50, height: 20 })
    getClientRects = () => [this.getBoundingClientRect()]
    matches = () => this.disabled
    closest = () => null
  }
  const items = [new Element(0, 0), new Element(100, 0), new Element(0, 100), new Element(100, 100, true)]
  vi.stubGlobal('document', doc)
  vi.stubGlobal('HTMLInputElement', class {})
  vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }))
  return { doc, items }
}

it('moves focus spatially, skips disabled controls and scrolls the selected option into view', () => {
  const { doc, items } = menu()
  moveControllerFocus(PAD.DOWN)
  expect(doc.activeElement).toBe(items[0])
  moveControllerFocus(PAD.RIGHT)
  expect(doc.activeElement).toBe(items[1])
  moveControllerFocus(PAD.DOWN)
  expect(doc.activeElement).toBe(items[2])
  expect(items[2].scrollIntoView).toHaveBeenCalled()
})
it('wraps at the end rather than stranding focus', () => {
  const { doc, items } = menu()
  doc.activeElement = items[2]
  moveControllerFocus(PAD.DOWN)
  expect(doc.activeElement).toBe(items[0])
})
it('limits focus to an open modal instead of the menu underneath', () => {
  const { doc, items } = menu()
  const modal = { querySelectorAll: () => [items[1]] }
  doc.querySelectorAll = () => ({ length: 1, item: () => modal }) as never
  moveControllerFocus(PAD.DOWN)
  expect(doc.activeElement).toBe(items[1])
})
