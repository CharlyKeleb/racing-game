import { sanitizeCockpit, type CockpitAdjustment } from '../vehicles/CockpitConfig'
import type { TrackLook } from '../world/TrackLook'
import type { MinimapRaster } from '../world/MinimapData'
import { sanitizeLivery, type LiveryDesign } from '../vehicles/LiveryDesign'
import { driftEvent, type DriftEventId } from '../racing/driftEvents'
import { createStore } from 'zustand/vanilla'
import type { GameModeId } from '../racing/gameModes'
import { defaultQuality, isMobile } from '../engine/device'
import { DEFAULT_BUILD, sanitizeBuild, type CarBuild } from '../vehicles/CarBuild'
import { addPreset, deletePreset, duplicatePreset, renamePreset, sanitizePresets, type BuildPreset } from '../vehicles/BuildPresets'
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
  mode: GameModeId
  driftEvent: DriftEventId
  trackLook: TrackLook
  quality: QualityPreset
  postfx: boolean
  /** Velocity blur amount, 0 disables both capture and blur. */
  motionBlur: number
  /** WebGL, or the WebGPU trial (#50). Read once at startup: switching reloads the page. */
  renderer: RendererKind
  masterVolume: number
  /** Trackside wind and pit ambience; independent of engine/music. */
  tracksideVolume: number
  /** Menu/garage soundtrack on/off. */
  menuMusic: boolean
  /** Track id from audio/musicTracks.ts. */
  musicTrack: MusicTrackId
  camera: CameraMode
  cameraMotion: boolean
  /** Speed and nitro FOV widening (#18). Off by default with prefers-reduced-motion. */
  fovEffects: boolean
  /** The speed-line overlay while boosting (#18). */
  speedLines: boolean
  /** Launch assist (#91): a good launch at lights-out from the throttle alone. */
  launchAssist: boolean
  /** Braking guide on the road (#93): off, corners and their braking zones, or the full lap. */
  drivingLine: 'off' | 'corners' | 'full'
  /** Gearbox (#14): automatic, or manual with E / Q and the pad D-pad. */
  transmission: 'auto' | 'manual'
  /** Free Roam (#33): speed/gear gauges and route arrows, each optional. */
  roamHud: boolean
  roamGuide: boolean
  proximityRadar: boolean
  spotterVisual: boolean
  /** Quick Race callouts (#90): text on/off, and their chime volume (0 = text only). */
  commentaryVersion: 1
  narrator: 'off' | 'duo' | 'camille' | 'alex'
  narratorVolume: number
  callouts: boolean
  calloutVolume: number
  spotterAudio: boolean
  cockpits: Record<string, CockpitAdjustment>
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
  spoilerLoading: boolean
  spoilerError: string | null
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
  /** Named garage setups per car id (#35). */
  presets: Record<string, BuildPreset[]>
  /** Save the current car's build as a new preset (no-op when its slots are full). */
  savePreset(name: string): void
  /** Replace the current car's build with a saved setup. */
  applyPreset(build: CarBuild): void
  renamePreset(id: string, name: string): void
  duplicatePreset(id: string): void
  deletePreset(id: string): void
}

const SETTINGS_KEY = 'racing-game:settings'
/** Per-car builds, { [carId]: CarBuild }. The old single build (racing-game:build) migrates to the Porsche. */
const BUILDS_KEY = 'racing-game:builds'
const LEGACY_BUILD_KEY = 'racing-game:build'
/** Named build presets, { [carId]: BuildPreset[] }. */
const PRESETS_KEY = 'racing-game:presets'

function loadPresets(): Record<string, BuildPreset[]> {
  try {
    return sanitizePresets(JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '{}'))
  } catch {
    return {}
  }
}

function savePresets(presets: Record<string, BuildPreset[]>): void {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets))
  } catch {
    // storage unavailable — presets just won't persist
  }
}

/** Replace one car's preset list and persist. Called from store actions, after the store exists. */
function setPresets(car: string, list: BuildPreset[]): void {
  const presets = { ...gameStore.getState().presets, [car]: list }
  gameStore.setState({ presets })
  savePresets(presets)
}

const presetId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

// First run: pick quality from the device. Phones start on Low with post FX
// off; the renderer's dynamic resolution then holds 60 fps from there.
const defaultSettings: Settings = {
  mode: 'quick',
  driftEvent: 'flow',
  quality: defaultQuality(),
  trackLook: 'road-focus',
  postfx: !isMobile(),
  motionBlur: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : .65,
  renderer: 'webgl',
  masterVolume: 0.9,
  tracksideVolume: .65,
  menuMusic: true,
  musicTrack: MUSIC_TRACKS[0].id,
  camera: 'chase',
  cameraMotion: !(typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches),
  fovEffects: !(typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches),
  speedLines: !(typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches),
  proximityRadar: false,
  spotterVisual: true,
  commentaryVersion: 1,
  narrator: 'duo',
  narratorVolume: .8,
  callouts: true,
  calloutVolume: .6,
  spotterAudio: false,
  cockpits: {},
  launchAssist: false,
  drivingLine: 'off',
  transmission: 'auto',
  roamHud: true,
  roamGuide: true,
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
    const saved = JSON.parse(raw)
    const merged: Settings = { ...defaultSettings, ...saved }
    // Move the earlier single-narrator setup to the requested commentary duo once.
    if (saved.commentaryVersion !== 1 && merged.narrator !== 'off') merged.narrator = 'duo'
    merged.commentaryVersion = 1
    if (merged.trackLook !== 'default' && merged.trackLook !== 'road-focus') merged.trackLook = defaultSettings.trackLook
    const savedCockpits = merged.cockpits
    merged.cockpits = {}
    for (const car of selectableCars()) if (savedCockpits && typeof savedCockpits === 'object' && Object.hasOwn(savedCockpits, car.id)) merged.cockpits[car.id] = sanitizeCockpit(savedCockpits[car.id], car.id)
    if (typeof merged.cameraMotion !== 'boolean') merged.cameraMotion = defaultSettings.cameraMotion
    if (typeof merged.fovEffects !== 'boolean') merged.fovEffects = defaultSettings.fovEffects
    if (typeof merged.speedLines !== 'boolean') merged.speedLines = defaultSettings.speedLines
    if (typeof merged.launchAssist !== 'boolean') merged.launchAssist = defaultSettings.launchAssist
    if (merged.drivingLine !== 'corners' && merged.drivingLine !== 'full') merged.drivingLine = 'off'
    if (merged.transmission !== 'manual') merged.transmission = 'auto'
    for(const key of ['proximityRadar','spotterVisual','spotterAudio'] as const)if(typeof merged[key]!=='boolean')merged[key]=defaultSettings[key]
    if (!['off', 'duo', 'camille', 'alex'].includes(merged.narrator)) merged.narrator = defaultSettings.narrator
    merged.narratorVolume = typeof merged.narratorVolume === 'number' && Number.isFinite(merged.narratorVolume) ? Math.max(0, Math.min(1, merged.narratorVolume)) : defaultSettings.narratorVolume
    if (typeof merged.callouts !== 'boolean') merged.callouts = defaultSettings.callouts
    merged.calloutVolume = typeof merged.calloutVolume === 'number' && Number.isFinite(merged.calloutVolume) ? Math.max(0, Math.min(1, merged.calloutVolume)) : defaultSettings.calloutVolume
    merged.tracksideVolume = typeof merged.tracksideVolume === 'number' && Number.isFinite(merged.tracksideVolume) ? Math.max(0, Math.min(1, merged.tracksideVolume)) : defaultSettings.tracksideVolume
    merged.driftEvent=driftEvent(merged.driftEvent).id
    if (!['drift', 'timeTrial', 'freeRoam'].includes(merged.mode)) merged.mode = 'quick'
    if (typeof merged.roamHud !== 'boolean') merged.roamHud = defaultSettings.roamHud
    if (typeof merged.roamGuide !== 'boolean') merged.roamGuide = defaultSettings.roamGuide
    if (!isAiDifficulty(merged.difficulty)) merged.difficulty = 'challenging'
    merged.opponents = [0, 1, 3].includes(merged.opponents) ? merged.opponents : 3
    if (!isTimeOfDay(merged.timeOfDay)) merged.timeOfDay = defaultSettings.timeOfDay
    if (merged.weather !== 'rain') merged.weather = 'dry'
    merged.motionBlur = typeof merged.motionBlur === 'number' && Number.isFinite(merged.motionBlur) ? Math.max(0, Math.min(1, merged.motionBlur)) : defaultSettings.motionBlur
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
  spoilerLoading: false,
  spoilerError: null,
  trackName: '',
  loadProgress: 0,
  minimap: null,
  error: null,
  settings: initialSettings,
  builds: initialBuilds,
  liveryHistory: {},
  presets: loadPresets(),
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
  savePreset: (name) => {
    const car = get().settings.car
    setPresets(car, addPreset(get().presets[car] ?? [], presetId(), name, get().build))
  },
  applyPreset: (build) => {
    const builds = { ...get().builds, [get().settings.car]: build }
    set({ build, builds })
    saveBuilds(builds)
  },
  renamePreset: (id, name) => {
    const car = get().settings.car
    setPresets(car, renamePreset(get().presets[car] ?? [], id, name))
  },
  duplicatePreset: (id) => {
    const car = get().settings.car
    setPresets(car, duplicatePreset(get().presets[car] ?? [], id, presetId()))
  },
  deletePreset: (id) => {
    const car = get().settings.car
    setPresets(car, deletePreset(get().presets[car] ?? [], id))
  },
  resetBuild: () => {
    const builds = { ...get().builds, [get().settings.car]: DEFAULT_BUILD }
    set({ build: DEFAULT_BUILD, builds })
    saveBuilds(builds)
  },
}))
