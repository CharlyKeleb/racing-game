import { createContext, useContext } from 'react'
import type { Game } from '../engine/Game'

export const GameContext = createContext<Game | null>(null)

/** Command handle into the engine. Null until the canvas has mounted. */
export function useGameInstance(): Game | null {
  return useContext(GameContext)
}
