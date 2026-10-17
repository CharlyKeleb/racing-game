import { createStore } from 'zustand/vanilla'

/**
 * Low-frequency game state shared by the engine and React.
 * Vanilla store so the engine can read/write it without importing React.
 */

export type GamePhase = 'boot' | 'menu' | 'loading' | 'countdown' | 'racing' | 'paused' | 'finished'
export type QualityPreset = 'low' | 'medium' | 'high'
export type CameraMode = 'chase' | 'cockpit'

export interface Settings {
  quality: QualityPreset
  postfx: boolean
  masterVolume: number
  camera: CameraMode
  laps: number
}

export interface GameState {
  phase: GamePhase
  error: string | null
  settings: Settings
  setPhase(phase: GamePhase): void
  setError(error: string | null): void
  updateSettings(patch: Partial<Settings>): void
}

const SETTINGS_KEY = 'racing-game:settings'

const defaultSettings: Settings = {
  quality: 'high',
  postfx: true,
  masterVolume: 0.7,
  camera: 'chase',
  laps: 3,
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings
  } catch {
    return defaultSettings
  }
}

export const gameStore = createStore<GameState>()((set, get) => ({
  phase: 'boot',
  error: null,
  settings: loadSettings(),
  setPhase: (phase) => set({ phase }),
  setError: (error) => set({ error }),
  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch }
    set({ settings })
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      // storage unavailable (private mode) — settings just won't persist
    }
  },
}))
