/** Game modes shown on the main menu. A mode with `available: false` shows as "Soon". */
export type GameModeId = 'quick' | 'timeTrial' | 'drift' | 'freeRoam'

export interface GameMode {
  id: GameModeId
  name: string
  /** One line for the menu. */
  blurb: string
  /** False while the mode is a placeholder (shown, locked, tagged "Soon"). */
  available: boolean
}

export const GAME_MODES: GameMode[] = [
  { id: 'quick', name: 'Quick Race', blurb: 'Race for the podium', available: true },
  { id: 'timeTrial', name: 'Time Trial', blurb: 'Chase your best lap', available: true },
  { id: 'drift', name: 'Drift Challenge', blurb: 'Link slides. Chase the gold.', available: true },
  { id: 'freeRoam', name: 'Free Roam', blurb: 'No timer, just drive', available: true },
]

export function gameMode(id: GameModeId): GameMode {
  return GAME_MODES.find((m) => m.id === id) ?? GAME_MODES[0]
}

/** Solo modes: no AI on the grid. */
export function isSoloMode(mode: GameModeId): boolean {
  return mode !== 'quick'
}
