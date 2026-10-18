import { afterEach, expect, it } from 'vitest'
import { hudCoversPoint, hudLayoutStore, measureHudPanels } from '../src/stores/hudLayoutStore'

afterEach(() => hudLayoutStore.setState({ panels: [] }))

function layout(width: number, height: number, panel: { left: number; top: number; right: number; bottom: number }) {
  return {
    getBoundingClientRect: () => ({ left: 20, top: 30, width, height }),
    querySelectorAll: () => [{ getBoundingClientRect: () => ({ ...panel, width: panel.right - panel.left, height: panel.bottom - panel.top }) }],
  } as unknown as HTMLElement
}

it('uses measured desktop bounds rather than the old broad exclusion zone', () => {
  hudLayoutStore.setState({ panels: measureHudPanels(layout(1000, 500, { left: 820, top: 50, right: 1000, bottom: 150 })) })
  expect(hudCoversPoint(85, 15)).toBe(true)
  expect(hudCoversPoint(73, 25)).toBe(false)
  expect(hudCoversPoint(80, 4)).toBe(true)
})

it('tracks a smaller mobile panel moved below touch controls', () => {
  hudLayoutStore.setState({ panels: measureHudPanels(layout(400, 800, { left: 270, top: 190, right: 410, bottom: 270 })) })
  expect(hudCoversPoint(80, 25)).toBe(true)
  expect(hudCoversPoint(80, 10)).toBe(false)
  expect(hudCoversPoint(60, 25)).toBe(false)
})

it('clears exclusions when the HUD is absent or has no layout', () => {
  expect(measureHudPanels(layout(0, 0, { left: 0, top: 0, right: 0, bottom: 0 }))).toEqual([])
  expect(hudCoversPoint(90, 10)).toBe(false)
})
