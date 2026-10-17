import { createStore } from 'zustand/vanilla'
import { defaultQuality, isMobile } from '../engine/device'
import { DEFAULT_BUILD, sanitizeBuild, type CarBuild } from '../vehicles/CarBuild'
import { isTimeOfDay, type TimeOfDay } from '../world/timeOfDay'

/**
 * Low-frequency game state shared by the engine and React.
 * Vanilla store so the engine can read/write it without importing React.
 */

export type GamePhase = 'boot' | 'menu' | 'garage' | 'loading' | 'countdown' | 'racing' | 'paused' | 'finished'
export type QualityPreset = 'low' | 'medium' | 'high'
export type CameraMode = 'chase' | 'cockpit'

export interface Settings {
  quality: QualityPreset
  postfx: boolean
  masterVolume: number
  camera: CameraMode
  laps: number
  /** Track id from world/tracks.ts. */
  track: string
  /** Lighting preset, see world/timeOfDay.ts. */
  timeOfDay: TimeOfDay
}

export interface GameState {
  phase: GamePhase
  /** Display name of the loaded car, set by the engine. */
  carName: string
  /** Display name of the loaded track, set by the engine. */
  trackName: string
  /** 0..1 while a track is loading. */
  loadProgress: number
  /** Track outline for the minimap: the full centreline as [x, z] pairs, start line first. Set on track load. */
  minimap: { points: [number, number][]; gates: [number, number][] } | null
  error: string | null
  settings: Settings
  /** Garage customisation, applied by the engine on change. */
  build: CarBuild
  setPhase(phase: GamePhase): void
  setError(error: string | null): void
  updateSettings(patch: Partial<Settings>): void
  updateBuild(patch: Partial<CarBuild>): void
  resetBuild(): void
}

const SETTINGS_KEY = 'racing-game:settings'
const BUILD_KEY = 'racing-game:build'

// First run: pick quality from the device. Phones start on Low with post FX
// off; the renderer's dynamic resolution then holds 60 fps from there.
const defaultSettings: Settings = {
  quality: defaultQuality(),
  postfx: !isMobile(),
  masterVolume: 0.7,
  camera: 'chase',
  laps: 3,
  track: 'nurburgring',
  timeOfDay: 'noon',
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return defaultSettings
    const merged: Settings = { ...defaultSettings, ...JSON.parse(raw) }
    if (!isTimeOfDay(merged.timeOfDay)) merged.timeOfDay = defaultSettings.timeOfDay
    return merged
  } catch {
    return defaultSettings
  }
}

function loadBuild(): CarBuild {
  try {
    const raw = localStorage.getItem(BUILD_KEY)
    return raw ? sanitizeBuild(JSON.parse(raw)) : DEFAULT_BUILD
  } catch {
    return DEFAULT_BUILD
  }
}

function saveBuild(build: CarBuild): void {
  try {
    localStorage.setItem(BUILD_KEY, JSON.stringify(build))
  } catch {
    // storage unavailable — the build just won't persist
  }
}

export const gameStore = createStore<GameState>()((set, get) => ({
  phase: 'boot',
  carName: '',
  trackName: '',
  loadProgress: 0,
  minimap: null,
  error: null,
  settings: loadSettings(),
  build: loadBuild(),
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
  updateBuild: (patch) => {
    const build = { ...get().build, ...patch }
    set({ build })
    saveBuild(build)
  },
  resetBuild: () => {
    set({ build: DEFAULT_BUILD })
    saveBuild(DEFAULT_BUILD)
  },
}))
