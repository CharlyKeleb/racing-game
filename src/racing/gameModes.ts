/**
 * Game modes shown on the main menu. Only Quick Race is wired up so far; the
 * others are shown as "Soon" until they're built.
 */
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
  { id: 'timeTrial', name: 'Time Trial', blurb: 'Chase your best lap', available: false },
  { id: 'drift', name: 'Drift Challenge', blurb: 'Score the most drift points in a lap', available: false },
  { id: 'freeRoam', name: 'Free Roam', blurb: 'No timer, just drive', available: false },
]

/** The mode Race starts. */
export const CURRENT_MODE: GameModeId = 'quick'
