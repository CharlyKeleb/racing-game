import { createStore } from 'zustand/vanilla'

/** Panel bounds in the same HUD-relative percentages as projected rival tags. */
export interface HudPanelRect { left: number; top: number; right: number; bottom: number }
export const hudLayoutStore = createStore<{ panels: HudPanelRect[] }>(() => ({ panels: [] }))

export function hudCoversPoint(x: number, y: number): boolean {
  return hudLayoutStore.getState().panels.some(r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
}

/** Read transformed CSS geometry, including touch scaling and safe-area offsets. */
export function measureHudPanels(root: HTMLElement): HudPanelRect[] {
  const bounds = root.getBoundingClientRect()
  if (bounds.width <= 0 || bounds.height <= 0) return []
  return Array.from(root.querySelectorAll<HTMLElement>('[data-tag-exclusion] > *')).flatMap(panel => {
    const r = panel.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return []
    return [{ left: (r.left - bounds.left) / bounds.width * 100,
      top: (r.top - bounds.top) / bounds.height * 100,
      right: (r.right - bounds.left) / bounds.width * 100,
      bottom: (r.bottom - bounds.top) / bounds.height * 100 }]
  })
}
