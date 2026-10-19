import type { MinimapRaster } from '../world/MinimapData'
import { sanitizeLivery, type LiveryDesign } from '../vehicles/LiveryDesign'
import { driftEvent, type DriftEventId } from '../racing/driftEvents'
import { createStore } from 'zustand/vanilla'
import { defaultQuality, isMobile } from '../engine/device'
import { DEFAULT_BUILD, sanitizeBuild, type CarBuild } from '../vehicles/CarBuild'
import { selectableCars } from '../vehicles/carRegistry'
import { isAiDifficulty, type AiDifficulty } from '../racing/AiProfiles'
import { isMusicTrack, MUSIC_TRACKS, type MusicTrackId } from '../audio/musicTracks'
import { isTimeOfDay, type TimeOfDay } from '../world/timeOfDay'
import type { RendererKind } from '../engine/backend'

/**
 * Low-frequency game state shared by the engine and React.
 * Vanilla store so the engine can read/write it without importing React.
 */

export type GamePhase = 'boot' | 'menu' | 'garage' | 'loading' | 'intro' | 'countdown' | 'racing' | 'paused' | 'finished'
export type QualityPreset = 'low' | 'medium' | 'high'
export type CameraMode = 'chase' | 'cockpit'
export type Weather = 'dry' | 'rain'

export interface Settings {
  mode: 'quick' | 'drift'
  driftEvent: DriftEventId
  quality: QualityPreset
  postfx: boolean
  /** WebGL, or the WebGPU trial (#50). Read once at startup: switching reloads the page. */
  renderer: RendererKind
  masterVolume: number
  /** Menu/garage soundtrack on/off. */
  menuMusic: boolean
  /** Track id from audio/musicTracks.ts. */
  musicTrack: MusicTrackId
  camera: CameraMode
  difficulty: AiDifficulty
  opponents: number
  laps: number
  /** Track id from world/tracks.ts. */
  track: string
  /** Car id from vehicles/carRegistry.ts. */
  car: string
  /** Lighting preset, see world/timeOfDay.ts. */
  timeOfDay: TimeOfDay
  /** Race weather (#37 / #53): rain brings rainfall, spray and an overcast sky. */
  weather: Weather
}

export interface GameState {
  phase: GamePhase
  /** True only while the menu soundtrack is audibly playing. */
  musicPlaying: boolean
  /** Display name of the loaded car, set by the engine. */
  carName: string
  /** True while the garage swaps cars (one drives off, the next drives in). */
  trackSwitching: boolean
  carSwitching: boolean
  /** Display name of the loaded track, set by the engine. */
  trackName: string
  /** 0..1 while a track is loading. */
  loadProgress: number
  /** Track outline for the minimap: the full centreline as [x, z] pairs, start line first. Set on track load. */
  minimap: { points: [number, number][]; gates: [number, number][]; overview?: MinimapRaster | null } | null
  error: string | null
  settings: Settings
  /** Garage customisation of the current car, applied by the engine on change. */
  build: CarBuild
  /** Every car's customisation, by car id. Each car keeps its own. */
  builds: Record<string, CarBuild>
  setPhase(phase: GamePhase): void
  setError(error: string | null): void
  updateSettings(patch: Partial<Settings>): void
  updateBuild(patch: Partial<CarBuild>): void
  resetBuild(): void
  liveryHistory: Record<string, LiveryDesign[]>
  undoLivery(): void
}

const SETTINGS_KEY = 'racing-game:settings'
/** Per-car builds, { [carId]: CarBuild }. The old single build (racing-game:build) migrates to the Porsche. */
const BUILDS_KEY = 'racing-game:builds'
const LEGACY_BUILD_KEY = 'racing-game:build'

// First run: pick quality from the device. Phones start on Low with post FX
// off; the renderer's dynamic resolution then holds 60 fps from there.
const defaultSettings: Settings = {
  mode: 'quick',
  driftEvent: 'flow',
  quality: defaultQuality(),
  postfx: !isMobile(),
  renderer: 'webgl',
  masterVolume: 0.9,
  menuMusic: true,
  musicTrack: MUSIC_TRACKS[0].id,
  camera: 'chase',
  difficulty: 'challenging',
  opponents: 3,
  laps: 3,
  track: 'nurburgring',
  car: 'porsche911',
  timeOfDay: 'noon',
  weather: 'dry',
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return defaultSettings
    const merged: Settings = { ...defaultSettings, ...JSON.parse(raw) }
    merged.driftEvent=driftEvent(merged.driftEvent).id
    if (merged.mode !== 'drift') merged.mode = 'quick'
    if (!isAiDifficulty(merged.difficulty)) merged.difficulty = 'challenging'
    merged.opponents = [0, 1, 3].includes(merged.opponents) ? merged.opponents : 3
    if (!isTimeOfDay(merged.timeOfDay)) merged.timeOfDay = defaultSettings.timeOfDay
    if (merged.weather !== 'rain') merged.weather = 'dry'
    if (merged.renderer !== 'webgpu') merged.renderer = 'webgl'
    if (typeof merged.menuMusic !== 'boolean') merged.menuMusic = defaultSettings.menuMusic
    if (!isMusicTrack(merged.musicTrack)) merged.musicTrack = defaultSettings.musicTrack
    if (!selectableCars().some((c) => c.id === merged.car)) merged.car = defaultSettings.car
    return merged
  } catch {
    return defaultSettings
  }
}

function loadBuilds(): Record<string, CarBuild> {
  try {
    const raw = localStorage.getItem(BUILDS_KEY)
    if (raw) {
      const out: Record<string, CarBuild> = {}
      for (const [id, b] of Object.entries(JSON.parse(raw) as Record<string, unknown>)) out[id] = sanitizeBuild(b)
      return out
    }
    const legacy = localStorage.getItem(LEGACY_BUILD_KEY)
    return legacy ? { porsche911: sanitizeBuild(JSON.parse(legacy)) } : {}
  } catch {
    return {}
  }
}

function saveBuilds(builds: Record<string, CarBuild>): void {
  try {
    localStorage.setItem(BUILDS_KEY, JSON.stringify(builds))
  } catch {
    // storage unavailable — the builds just won't persist
  }
}

const initialSettings = loadSettings()
const initialBuilds = loadBuilds()

export const gameStore = createStore<GameState>()((set, get) => ({
  phase: 'boot',
  musicPlaying: false,
  carName: '',
  trackSwitching: false,
  carSwitching: false,
  trackName: '',
  loadProgress: 0,
  minimap: null,
  error: null,
  settings: initialSettings,
  builds: initialBuilds,
  liveryHistory: {},
  build: initialBuilds[initialSettings.car] ?? DEFAULT_BUILD,
  setPhase: (phase) => set({ phase }),
  setError: (error) => set({ error }),
  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch }
    // Switching car brings up that car's own build.
    if (settings.car !== get().settings.car) set({ settings, build: get().builds[settings.car] ?? DEFAULT_BUILD })
    else set({ settings })
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      // storage unavailable (private mode) — settings just won't persist
    }
  },
  updateBuild: (patch) => {
    const previous = get().build.livery
    const build = { ...get().build, ...patch, livery: patch.livery ? sanitizeLivery(patch.livery) : previous }
    if (patch.livery && JSON.stringify(previous) !== JSON.stringify(build.livery)) {
      const car = get().settings.car
      set({ liveryHistory: { ...get().liveryHistory, [car]: [...(get().liveryHistory[car] ?? []), previous].slice(-30) } })
    }
    const builds = { ...get().builds, [get().settings.car]: build }
    set({ build, builds })
    saveBuilds(builds)
  },
  undoLivery: () => {
    const car = get().settings.car
    const history = get().liveryHistory[car] ?? []
    const previous = history.at(-1)
    if (!previous) return
    const build = { ...get().build, livery: previous }
    const builds = { ...get().builds, [car]: build }
    set({ build, builds, liveryHistory: { ...get().liveryHistory, [car]: history.slice(0, -1) } })
    saveBuilds(builds)
  },
  resetBuild: () => {
    const builds = { ...get().builds, [get().settings.car]: DEFAULT_BUILD }
    set({ build: DEFAULT_BUILD, builds })
    saveBuilds(builds)
  },
}))
