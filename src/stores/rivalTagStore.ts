import { createStore } from 'zustand/vanilla'

/** Where a rival's name tag sits on screen this frame. x/y in % of the viewport. */
export interface RivalTag {
  id: number
  x: number
  y: number
  scale: number
  opacity: number
  /** Meters from the player's car. */
  distance: number
}

/**
 * Rival tags are re-projected every render frame so they stay glued to the cars.
 * The engine mutates `tags` in place and bumps `frame`; the HUD applies them
 * through `subscribe` straight to the DOM instead of re-rendering React.
 */
export interface RivalTagState {
  tags: RivalTag[]
  frame: number
}

export const rivalTagStore = createStore<RivalTagState>(() => ({ tags: [], frame: 0 }))
