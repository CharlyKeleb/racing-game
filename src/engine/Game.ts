import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { AudioManager, type CarSoundState } from '../audio/AudioManager'
import { ChaseCamera, type ShowroomFraming } from '../camera/ChaseCamera'
import { DirectionGuide } from '../effects/DirectionGuide'
import { DrivingEffects } from '../effects/DrivingEffects'
import { Headlights } from '../effects/Headlights'
import { TrackProgress } from '../racing/TrackProgress'
import { InputManager, type InputState } from '../input/InputManager'
import { RaceManager } from '../racing/RaceManager'
import { gameStore, type GamePhase, type Settings } from '../stores/gameStore'
import { telemetryStore } from '../stores/telemetryStore'
import { applyCarBuild, samePerformance, type CarBuild } from '../vehicles/CarBuild'
import { CarLivery } from '../vehicles/CarLivery'
import { buildPlaceholderCar, rigCarModel, type CarModel } from '../vehicles/CarModel'
import { getCar, selectableCars, stepCar, type CarEntry } from '../vehicles/carRegistry'
import { Vehicle } from '../vehicles/Vehicle'
import { resolveVehicleConfig, type VehicleConfig } from '../vehicles/VehicleConfig'
import { Environment } from '../world/Environment'
import type { RaceTrack } from '../world/RaceTrack'
import { Surface } from '../vehicles/Surface'
import { measureRoadEdges } from '../world/SurfaceMap'
import { Showroom } from '../world/Showroom'
import { StreamedTrack } from '../world/StreamedTrack'
import { Track } from '../world/Track'
import { getTrack } from '../world/tracks'
import { AssetManager } from './AssetManager'
import { GameLoop } from './GameLoop'
import { initRapier, PhysicsWorld } from './PhysicsWorld'
import { Renderer } from './Renderer'

const TELEMETRY_HZ = 20
// Handbrake, not brake: brake at standstill would engage reverse.
export type ShowroomFocus = 'car' | 'wheel'

const LOCKED_INPUT: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: true, nitro: false }
const _velocity = new THREE.Vector3()
const _forward = new THREE.Vector3()
/** Seconds of driving against the race direction before the HUD says so. */
const WRONG_WAY_DELAY = 1.2
/** Garage turntable camera: distance (m) and lens (deg) when there's room. */
const SHOWROOM_DISTANCE = 7.5
const SHOWROOM_FOV = 42
/** Free orbit: camera height range and rest (m above the car's focus), zoom range. */
const ORBIT_HEIGHT: [number, number] = [-0.15, 3.2]
const ORBIT_REST_HEIGHT = 1.5
const ORBIT_ZOOM: [number, number] = [0.55, 1.3]
const ORBIT_MAX_FLICK = 3
/** Garage car swap: the parked car launches out of shot, the next one rolls in and brakes to a stop. Seconds, meters. */
const DRIVE_OUT_SEC = 0.45
const DRIVE_OUT_DIST = 16
const DRIVE_IN_SEC = 0.6
const DRIVE_IN_DIST = 12

/**
 * Composition root for one play session. React creates exactly one Game,
 * calls its command methods, and observes it only through the stores.
 *
 *   input.poll → race rules → vehicle forces → physics.step → capture
 *   (fixed 60 Hz)                      … then once per frame:
 *   interpolate vehicle → camera → audio → render → publish telemetry
 */
export class Game {
  private readonly renderer: Renderer
  private readonly assets = new AssetManager()
  private readonly input = new InputManager()
  private readonly audio = new AudioManager()
  /** Reused every frame for the audio update. */
  private readonly soundState: CarSoundState = { rpm: 0, throttle: 0, gear: 1, slip: 0, nitro: 0, nitroActive: false, nitroPerfect: false }
  private readonly loop: GameLoop
  private physics!: PhysicsWorld
  private track!: RaceTrack
  private environment!: Environment
  private vehicle!: Vehicle
  private camera!: ChaseCamera
  private race!: RaceManager
  private livery!: CarLivery
  private showroom!: Showroom
  private effects!: DrivingEffects
  private headlights!: Headlights
  private guide!: DirectionGuide
  private progress!: TrackProgress
  private wrongWayTime = 0
  /** Centreline length, meters (one lap). */
  private lapLength = 0
  /** The car as shipped, before garage upgrades. */
  private baseConfig!: VehicleConfig
  private carId = ''
  /** The current track's visuals load (see init); Race waits on it if pressed early. */
  private trackVisuals: Promise<void> | null = null
  private trackVisualsDone = false
  private trackProgress = 0
  private raceQueued = false
  /** Bumped per car switch, so a slow load can't install over a newer pick. */
  private carSwapToken = 0
  /** Garage car swap in progress: the car drives off ('out') or arrives ('in'), drawn only — physics stays parked. */
  private showroomDrive: { mode: 'out' | 'in'; t: number; spin: number; done: () => void } | null = null
  /** Where the car is parked. The garage camera frames this, so it holds still while a car drives off. */
  private readonly showroomAnchor = new THREE.Object3D()
  /** Engine sound override during a garage swap (the parked car's physics idles). */
  private showroomRev: { rpm: number; throttle: number } | null = null
  private showroomYaw = 0.9
  /** Orbit state: camera height above the car's focus, zoom factor, flick momentum. */
  private showroomHeight = ORBIT_REST_HEIGHT
  private showroomZoom = 1
  private orbitVelocity = 0
  private orbitCoasting = false
  private lastOrbitAt = 0
  /** Flat pad the car stands on in the garage (the track under the spawn has camber). */
  private showroomPad: RAPIER.Collider | null = null
  private showroomPadStale = false
  /** What the garage camera frames; the Wheels tab zooms onto the front-left wheel. */
  private showroomFocus: ShowroomFocus = 'car'
  private wheelYaw = 0
  private readonly carFraming: ShowroomFraming = { focus: new THREE.Vector3(0, 0.55, 0), distance: SHOWROOM_DISTANCE, height: 1.5, shift: 0, fov: SHOWROOM_FOV }
  private readonly wheelFraming: ShowroomFraming = { focus: new THREE.Vector3(), distance: 2.9, height: 0.45, shift: 0.55, fov: 38 }

  private telemetryTimer = 0
  private fpsFrames = 0
  private fpsTimer = 0
  private fps = 0
  private disposed = false
  private readonly unsubscribe: () => void

  constructor(container: HTMLElement) {
    this.renderer = new Renderer(container)
    this.loop = new GameLoop({
      fixedUpdate: (dt) => this.fixedUpdate(dt),
      render: (alpha, dt) => this.renderFrame(alpha, dt),
    })
    this.unsubscribe = gameStore.subscribe((s, prev) => {
      if (s.settings.car !== prev.settings.car && this.vehicle) void this.switchCar(s.settings.car)
      if (s.settings.track !== prev.settings.track && this.track) void this.switchTrack(s.settings.track)
      else if (s.settings !== prev.settings) this.applySettings(s.settings)
      // A car switch swaps in that car's build too; installCar applies it to the new car.
      if (s.build !== prev.build && s.settings.car === prev.settings.car) this.applyBuild(s.build, prev.build)
      if (s.phase !== prev.phase) this.updateShowroom(s.phase)
    })
  }

  /**
   * Boot. The menu only shows the garage and the car, so that's all it waits
   * for: the car and garage downloads start at once, alongside Rapier and the
   * track's physics core (manifest, collision, surfaces: ~0.5 MB). The track's
   * visuals (materials, scenery, chunks) load behind the menu; Race waits for
   * them only if it's pressed first. Other cars preload after that.
   */
  async init(carId = gameStore.getState().settings.car): Promise<void> {
    const { setPhase } = gameStore.getState()
    setPhase('loading')
    performance.mark('boot:start')
    const settings = gameStore.getState().settings
    const progress = (p: number) => gameStore.setState({ loadProgress: p })
    gameStore.setState({ trackName: getTrack(settings.track).name })
    progress(0.05)

    // Downloads that don't need physics start now, in parallel.
    const carLoad = this.loadCar(carId)
    this.showroom = new Showroom(this.renderer.renderer)
    const garageLoad = this.showroom.load(this.assets, settings.quality)

    await initRapier()
    performance.measure('boot:rapier', 'boot:start')
    if (this.disposed) return
    this.physics = new PhysicsWorld()
    const scene = this.renderer.scene

    this.environment = new Environment(this.renderer.renderer)
    this.environment.setTimeOfDay(settings.timeOfDay)
    scene.add(this.environment.group)
    this.environment.apply(scene)

    this.track = await this.loadTrackCore(settings.track)
    if (this.disposed) return
    scene.add(this.track.group)
    performance.measure('boot:track', 'boot:start')
    progress(0.3)

    const { config: base, model } = await carLoad
    if (this.disposed) return
    performance.measure('boot:car', 'boot:start')
    progress(0.6)
    const entry = getCar(carId)
    this.carId = entry.id
    this.audio.setCarAudio(entry.audioUrl, entry.firingPerRev)
    const build = gameStore.getState().build
    this.baseConfig = base
    gameStore.setState({ carName: base.name })
    const config = applyCarBuild(base, build)
    this.vehicle = new Vehicle(config, model, this.physics.world, this.track.spawn)
    this.vehicle.controller.surfaceAt = (x, z) => this.track.surfaceAt(x, z)
    this.livery = new CarLivery(model)
    this.livery.apply(build)
    scene.add(model.root)
    this.headlights = new Headlights(model, config)
    this.effects = new DrivingEffects(this.vehicle)
    scene.add(this.effects.group)

    const spawn = this.track.spawn
    this.showroom.placeAt(spawn.position, spawn.heading)
    scene.add(this.showroom.group)
    await garageLoad
    if (this.disposed) return
    performance.measure('boot:garage', 'boot:start')
    progress(0.9)

    this.camera = new ChaseCamera(this.renderer.camera)
    this.race = this.createRace()
    this.attachGuide()

    this.applySettings(gameStore.getState().settings)
    telemetryStore.setState({ redlineRpm: config.engine.redlineRpm })
    this.vehicle.render(1)
    this.loop.start()
    setPhase('menu')
    performance.measure('boot:menu', 'boot:start')
    if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = this

    // Behind the menu: the track's visuals first (Race needs them), then the
    // sharp garage textures, then the other cars.
    void this.loadTrackVisuals()
      .then(async () => {
        performance.measure('boot:trackVisuals', 'boot:start')
        await this.showroom.upgrade(this.assets)
        performance.measure('boot:garageHigh', 'boot:start')
        await this.preloadCars()
      })
      .catch((err: unknown) => gameStore.getState().setError(err instanceof Error ? err.message : String(err)))
  }

  /**
   * Dev-only (window.__game): step frames by hand and read render cost —
   * works even when the tab is hidden and rAF is throttled.
   */
  debugStep(frames = 60): { msPerFrame: number; calls: number; triangles: number; pixelRatio: number; track: unknown; car: number[] } {
    const gl = this.renderer.renderer.getContext()
    const px = new Uint8Array(4)
    const info = this.renderer.renderer.info
    const t0 = performance.now()
    for (let i = 0; i < frames; i++) {
      // Count every pass of the last frame (post FX would otherwise report only its final quad).
      if (i === frames - 1) {
        info.autoReset = false
        info.reset()
      }
      this.loop.advance(1 / 60)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px) // wait for the GPU
    }
    info.autoReset = true
    const p = this.vehicle.position
    return {
      msPerFrame: (performance.now() - t0) / frames,
      calls: info.render.calls,
      triangles: info.render.triangles,
      pixelRatio: this.renderer.pixelRatio,
      track: (this.track as Partial<StreamedTrack>).stats,
      car: [p.x, p.y, p.z].map((v) => Math.round(v)),
    }
  }

  /** Dev-only: hold inputs for debugStep runs. */
  debugInput(state: Partial<InputState>): void {
    this.input.setTouch(state)
  }

  private createRace(): RaceManager {
    return new RaceManager(this.track.checkpoints, gameStore.getState().settings.laps, {
      onStateChange: (state) => {
        const phase: Record<typeof state, GamePhase> = {
          idle: 'menu',
          countdown: 'countdown',
          racing: 'racing',
          finished: 'finished',
        }
        gameStore.getState().setPhase(phase[state])
      },
      onLap: () => this.publishTelemetry(),
    })
  }

  /** Roadside corner boards + progress tracking + minimap outline for the current track. */
  private attachGuide(): void {
    this.guide?.dispose()
    const edges = measureRoadEdges(this.track.line, (x, z) => this.track.surfaceAt(x, z))
    const track = this.track
    this.guide = new DirectionGuide(this.track.line, edges, {
      // Road colliders only: the terrain mesh is simplified to ~1.5 m and can sit
      // above the asphalt, which left arrows hovering in the air.
      roadHeight: (x, y, z) => this.physics.groundHeight(x, y, z, (c) => track.isRoadCollider(c)),
      paved: (x, z) => {
        const s = track.surfaceAt(x, z)
        return s === Surface.Asphalt || s === Surface.Kerb
      },
    })
    this.progress = new TrackProgress(this.track.line)
    this.renderer.scene.add(this.guide.group)
    const line = this.track.line
    this.lapLength = 0
    for (let i = 0; i < line.length; i++) this.lapLength += line[i].distanceTo(line[(i + 1) % line.length])
    // Every point: the minimap is zoomed in and highlights the route from the car's index.
    gameStore.setState({
      minimap: {
        points: line.map((p) => [p.x, p.z]),
        gates: this.track.checkpoints.map((c) => [c.position.x, c.position.z]),
      },
    })
  }

  /** Procedural tracks build instantly; streamed ones load collision + nearby chunks first. */
  /** A track ready to race and see (track switching): core, then visuals. */
  private async loadTrack(id: string): Promise<RaceTrack> {
    gameStore.setState({ loadProgress: 0 })
    const track = await this.loadTrackCore(id)
    await track.loadVisuals?.((p) => gameStore.setState({ loadProgress: p }))
    this.trackVisuals = Promise.resolve()
    this.trackVisualsDone = true
    gameStore.setState({ loadProgress: 1 })
    return track
  }

  /** What the race logic needs: physics, spawn, checkpoints, surfaces. */
  private async loadTrackCore(id: string): Promise<RaceTrack> {
    const def = getTrack(id)
    gameStore.setState({ trackName: def.name })
    this.trackVisuals = null
    this.trackVisualsDone = false
    if (def.kind === 'procedural') return new Track(def, this.physics.world)
    return StreamedTrack.load(def.manifestUrl, {
      assets: this.assets,
      renderer: this.renderer.renderer,
      camera: this.renderer.camera,
      scene: this.renderer.scene,
      world: this.physics.world,
      quality: gameStore.getState().settings.quality,
    })
  }

  /** The current track's visuals, loaded once; resolves straight away for complete tracks. */
  private loadTrackVisuals(): Promise<void> {
    this.trackVisuals ??= (this.track.loadVisuals?.((p) => (this.trackProgress = p)) ?? Promise.resolve()).then(() => {
      this.trackVisualsDone = true
      this.trackProgress = 1
    })
    return this.trackVisuals
  }

  /** Menu track picker: tear down the current track and stream in the next. */
  private async switchTrack(id: string): Promise<void> {
    if (getTrack(id).id === this.track.id) return
    const { setPhase } = gameStore.getState()
    setPhase('loading')
    this.race.state = 'idle'
    this.track.dispose()
    this.effects.clear()
    try {
      this.track = await this.loadTrack(id)
    } catch (err) {
      gameStore.getState().setError(err instanceof Error ? err.message : String(err))
      return
    }
    if (this.disposed) return this.track.dispose()
    this.renderer.scene.add(this.track.group)
    this.race = this.createRace()
    this.attachGuide()
    this.showroom.placeAt(this.track.spawn.position, this.track.spawn.heading)
    this.resetCar()
    this.applySettings(gameStore.getState().settings)
    // The showroom is already active, so it won't re-hide the new track/guide itself.
    this.track.group.visible = false
    this.guide.group.visible = false
    setPhase('menu')
  }

  /**
   * Warm the asset cache with every other car in the picker, one at a time in
   * the background, so a garage swap never waits on a download.
   */
  private async preloadCars(): Promise<void> {
    const low = gameStore.getState().settings.quality === 'low'
    for (const car of selectableCars()) {
      if (car.id === this.carId || this.disposed) continue
      try {
        await this.assets.loadJson(car.configUrl)
        const url = low && car.modelUrlLow ? car.modelUrlLow : car.modelUrl
        if (await this.assets.exists(url)) await this.assets.loadModel(url)
      } catch {
        // Preloading is best effort; switchCar loads (and reports) on demand.
      }
    }
  }

  /** Loads the GLB + config from the pipeline, falling back to the placeholder car. */
  private async loadCar(carId: string) {
    const entry = getCar(carId)
    const json = await this.assets.loadJson<Partial<VehicleConfig>>(entry.configUrl)
    const config = resolveVehicleConfig(json ?? undefined)
    // Phones on Low get the simplified car: it's the single heaviest mesh on screen.
    const low = gameStore.getState().settings.quality === 'low' && entry.modelUrlLow
    const url = low ? entry.modelUrlLow! : entry.modelUrl
    let scene
    if (await this.assets.exists(url)) {
      try {
        scene = await this.assets.loadModel(url)
      } catch (err) {
        console.warn(`[Game] failed to load ${url}, using placeholder`, err)
      }
    }
    scene ??= buildPlaceholderCar(config)
    return { config, model: rigCarModel(scene, config) }
  }

  // ── Commands (called by React) ─────────────────────────────────────────

  startRace(): void {
    const { settings, carSwitching } = gameStore.getState()
    if (carSwitching || this.raceQueued) return
    if (!this.trackReady) {
      // Pressed before the track's visuals finished loading behind the menu:
      // show the loading screen, then start. Audio unlocks now, while this is
      // still a user gesture.
      this.audio.unlock(settings.masterVolume)
      this.raceQueued = true
      gameStore.getState().setPhase('loading')
      const tick = setInterval(() => gameStore.setState({ loadProgress: this.trackProgress }), 100)
      void this.loadTrackVisuals().then(() => {
        clearInterval(tick)
        this.raceQueued = false
        if (this.disposed) return
        gameStore.getState().setPhase('menu')
        this.startRace()
      })
      return
    }
    this.audio.unlock(settings.masterVolume)
    this.audio.playStart()
    this.resetCar()
    this.effects.clear()
    this.race.start(settings.laps)
  }

  openGarage(): void {
    if (gameStore.getState().phase !== 'menu') return
    this.showroomFocus = 'car'
    this.resetCar()
    gameStore.getState().setPhase('garage')
  }

  closeGarage(): void {
    if (gameStore.getState().phase !== 'garage') return
    gameStore.getState().setPhase('menu')
  }

  /**
   * Orbit the showroom camera (drag / swipe): full 360° around the car, up and
   * down within the room. Remembers the drag speed so a flick keeps spinning.
   */
  rotateShowroom(deltaYaw: number, deltaHeight = 0): void {
    if (this.showroomFocus === 'wheel') {
      this.wheelYaw = THREE.MathUtils.clamp(this.wheelYaw + deltaYaw, -0.7, 0.7)
      return
    }
    const now = performance.now()
    const dt = Math.max(0.008, Math.min(0.1, (now - this.lastOrbitAt) / 1000))
    this.lastOrbitAt = now
    this.showroomYaw += deltaYaw
    // Capped so a quick swipe spins the car briskly, not dizzyingly.
    this.orbitVelocity = THREE.MathUtils.clamp(deltaYaw / dt, -ORBIT_MAX_FLICK, ORBIT_MAX_FLICK)
    this.showroomHeight = THREE.MathUtils.clamp(this.showroomHeight + deltaHeight, ORBIT_HEIGHT[0], ORBIT_HEIGHT[1])
  }

  /** Pinch / scroll: <1 zooms in, >1 out. */
  zoomShowroom(factor: number): void {
    if (this.showroomFocus === 'wheel') return
    this.showroomZoom = THREE.MathUtils.clamp(this.showroomZoom * factor, ORBIT_ZOOM[0], ORBIT_ZOOM[1])
  }

  /** Finger lifted: let a flick carry on with momentum (dropped if the pointer paused before release). */
  releaseShowroom(): void {
    if (performance.now() - this.lastOrbitAt > 80) this.orbitVelocity = 0
    this.orbitCoasting = true
  }

  /**
   * When nobody's dragging, a flick coasts and slows to a stop. The camera then
   * stays where it was left: no auto-rotation.
   */
  private idleShowroomCamera(dt: number): void {
    if (this.orbitCoasting && Math.abs(this.orbitVelocity) > 0.05) {
      this.showroomYaw += this.orbitVelocity * dt
      this.orbitVelocity *= Math.exp(-2.2 * dt)
      return
    }
    this.orbitCoasting = false
  }

  /** Garage tabs call this: 'wheel' glides the camera to the front-left wheel. */
  setShowroomFocus(focus: ShowroomFocus): void {
    if (focus === this.showroomFocus) return
    this.showroomFocus = focus
    this.wheelYaw = 0
  }

  /** True once the current track's visuals are in (always, for complete tracks). */
  private get trackReady(): boolean {
    return this.track.loadVisuals === undefined || this.trackVisualsDone
  }

  /**
   * First click or tap in the menu: start audio (browsers only allow it from a
   * user gesture) so the garage has its room tone before any race.
   */
  unlockAudio(): void {
    this.audio.unlock(gameStore.getState().settings.masterVolume)
  }

  /** Garage chevrons: step through the cars. The current one drives off and the next drives in. */
  cycleCar(step: 1 | -1): void {
    const s = gameStore.getState()
    if (s.carSwitching || (s.phase !== 'garage' && s.phase !== 'menu')) return
    s.updateSettings({ car: stepCar(this.carId, step).id })
  }

  private async switchCar(id: string): Promise<void> {
    const entry = getCar(id)
    if (entry.id === this.carId) return
    this.carId = entry.id
    const token = ++this.carSwapToken
    gameStore.setState({ carSwitching: true })
    const phase = gameStore.getState().phase
    const showroom = phase === 'menu' || phase === 'garage'
    const loading = this.loadCar(entry.id)
    if (showroom) {
      // The chevron click is a user gesture, so the engines can be heard leaving and arriving.
      this.audio.unlock(gameStore.getState().settings.masterVolume)
      // Swing the camera round to a fresh angle for the new car; the showroom
      // camera's damping turns this into a slow glide over the swap.
      this.showroomYaw += (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5)
      this.showroomHeight = THREE.MathUtils.clamp(ORBIT_REST_HEIGHT + (Math.random() - 0.4) * 0.8, ORBIT_HEIGHT[0], ORBIT_HEIGHT[1])
      await new Promise<void>((done) => (this.showroomDrive = { mode: 'out', t: 0, spin: 0, done }))
      this.vehicle.model.root.visible = false
    }
    const { config, model } = await loading
    if (token !== this.carSwapToken || this.disposed) return
    this.installCar(entry, config, model)
    if (showroom) await new Promise<void>((done) => (this.showroomDrive = { mode: 'in', t: 0, spin: 0, done }))
    if (token !== this.carSwapToken) return
    gameStore.setState({ carSwitching: false })
  }

  /** Swap the player car for a freshly loaded one, rebuilding everything tied to it. */
  private installCar(entry: CarEntry, base: VehicleConfig, model: CarModel): void {
    const scene = this.renderer.scene
    const old = this.vehicle
    this.effects.dispose()
    this.headlights.dispose()
    this.livery.dispose()
    scene.remove(old.model.root)
    this.physics.world.removeRigidBody(old.body)
    this.setShowroomPad(false)

    const build = gameStore.getState().build
    this.baseConfig = base
    const config = applyCarBuild(base, build)
    this.vehicle = new Vehicle(config, model, this.physics.world, this.track.spawn)
    this.vehicle.controller.surfaceAt = (x, z) => this.track.surfaceAt(x, z)
    this.vehicle.lightsOn = this.environment.current.headlights
    this.livery = new CarLivery(model)
    this.livery.apply(build)
    scene.add(model.root)
    this.headlights = new Headlights(model, config)
    this.headlights.setOn(this.environment.current.headlights)
    this.effects = new DrivingEffects(this.vehicle)
    scene.add(this.effects.group)
    const phase = gameStore.getState().phase
    const inShowroom = phase === 'menu' || phase === 'garage'
    this.effects.group.visible = !inShowroom
    if (inShowroom) this.setShowroomPad(true)
    this.audio.setCarAudio(entry.audioUrl, entry.firingPerRev)
    gameStore.setState({ carName: base.name })
    telemetryStore.setState({ redlineRpm: config.engine.redlineRpm })
    this.vehicle.render(1)
  }

  /**
   * Draws the garage swap: the parked car launches forward out of shot, or the
   * new one arrives from behind and brakes to its spot. Render-only: the body
   * stays parked on the pad, the wheels spin to match the distance covered.
   */
  private animateShowroomDrive(dt: number): void {
    const d = this.showroomDrive!
    const out = d.mode === 'out'
    const duration = out ? DRIVE_OUT_SEC : DRIVE_IN_SEC
    d.t = Math.min(d.t + dt, duration)
    const u = d.t / duration
    const dist = out ? DRIVE_OUT_DIST * u * u : -DRIVE_IN_DIST * (1 - u) * (1 - u)
    const speed = out ? (2 * DRIVE_OUT_DIST * u) / duration : (2 * DRIVE_IN_DIST * (1 - u)) / duration
    const root = this.vehicle.model.root
    _forward.set(0, 0, 1).applyQuaternion(root.quaternion)
    root.position.addScaledVector(_forward, dist)
    d.spin += speed * dt
    for (const w of this.vehicle.controller.wheels) this.vehicle.model.wheels[w.cfg.id].spinner.rotation.x += d.spin / w.cfg.radius
    // Rev up as it launches; coast down as it arrives (overrun crackle).
    this.showroomRev = out ? { rpm: 2500 + 5000 * Math.min(1, u * 1.6), throttle: 1 } : { rpm: 1000 + 3500 * (1 - u), throttle: 0 }
    if (u >= 1) {
      this.showroomDrive = null
      this.showroomRev = null
      d.done()
    }
  }

  togglePause(): void {
    const { phase, setPhase } = gameStore.getState()
    if (phase === 'paused') {
      setPhase(this.race.state === 'countdown' ? 'countdown' : 'racing')
      this.audio.resume()
    } else if (phase === 'racing' || phase === 'countdown') {
      setPhase('paused')
      this.audio.suspend()
    }
  }

  quitToMenu(): void {
    this.race.state = 'idle'
    // Back in the garage: room tone on, engine quiet (updateShowroom sets the scene).
    this.audio.resume()
    this.resetCar()
    this.effects.clear()
    gameStore.getState().setPhase('menu')
  }

  resetCar(): void {
    this.vehicle.respawn(this.track.spawn)
    this.camera.snap()
    this.progress?.reset()
  }

  /** Mid-race reset (R / touch button / falling off the world): back to the last checkpoint. */
  resetToCheckpoint(): void {
    this.vehicle.respawn(this.track.respawnAt(this.race.lastCheckpoint))
    this.camera.snap()
    this.progress.reset()
  }

  /** Feed from the on-screen touch controls. */
  setTouchInput(state: Partial<InputState>): void {
    this.input.setTouch(state)
  }

  /** Touch buttons for actions the keyboard maps to keys. */
  triggerAction(action: 'pause' | 'reset' | 'camera'): void {
    this.input.trigger(action)
  }

  // ── Loop ───────────────────────────────────────────────────────────────

  private fixedUpdate(dt: number): void {
    this.input.poll()
    if (this.input.consume('pause')) this.togglePause()
    // Camera toggle (C / gamepad Y / touch button) only while driving: a stray
    // key press in a menu used to flip every later race into the cockpit view.
    if (this.input.consume('camera')) {
      const s = gameStore.getState()
      if (s.phase === 'racing' || s.phase === 'countdown') s.updateSettings({ camera: s.settings.camera === 'chase' ? 'cockpit' : 'chase' })
    }

    const phase = gameStore.getState().phase
    if (phase === 'paused') return
    if (this.input.consume('reset') && phase === 'racing') this.resetToCheckpoint()

    const inMenu = phase === 'menu' || phase === 'garage' || phase === 'loading'
    const controls = this.race.controlsEnabled && !inMenu && phase !== 'finished'
    this.vehicle.fixedUpdate(controls ? this.input.state : LOCKED_INPUT, dt)
    this.physics.step(dt)
    this.vehicle.capture()
    // Physics position, not the render-interpolated one (that lags a tick).
    if (this.vehicle.body.translation().y < this.track.killY) {
      if (phase === 'racing') this.resetToCheckpoint()
      else this.resetCar()
    }
    this.race.update(dt, this.vehicle.position)
  }

  private renderFrame(alpha: number, dt: number): void {
    const phase = gameStore.getState().phase
    this.vehicle.render(phase === 'paused' ? 1 : alpha, phase === 'paused' ? 0 : dt)
    this.showroomAnchor.position.copy(this.vehicle.model.root.position)
    this.showroomAnchor.quaternion.copy(this.vehicle.model.root.quaternion)
    if (this.showroomDrive) this.animateShowroomDrive(dt)
    this.audio.setMenuEngine(this.showroomRev !== null)
    if (phase === 'menu' || phase === 'garage') {
      const wheel = phase === 'garage' && this.showroomFocus === 'wheel'
      if (wheel) {
        // Front-left wheel axle in car space (+X is the car's left), seen from a low front three-quarter.
        const fl = this.vehicle.config.wheels.find((w) => w.id === 'FL') ?? this.vehicle.config.wheels[0]
        this.wheelFraming.focus.set(fl.position[0], fl.radius, fl.position[2])
        this.camera.showroom(this.showroomAnchor, Math.PI / 2 - 0.55 + this.wheelYaw, dt, this.wheelFraming)
      } else {
        if (this.showroomPadStale) {
          this.setShowroomPad(false)
          this.setShowroomPad(true)
        }
        this.idleShowroomCamera(dt)
        // Slide the car right of the garage's left-hand panel. (On landscape phones the
        // menu's car card turns compact instead — see index.css — so the car stays centred.)
        this.carFraming.shift = phase === 'garage' ? 1.2 : 0
        // Pull in before a wall or pillar would come between camera and car, and
        // widen the lens to match so the car stays the same size on screen.
        const wanted = SHOWROOM_DISTANCE * this.showroomZoom
        const room = this.showroom.cameraClearance(this.showroomYaw)
        this.carFraming.distance = Math.max(3.2, Math.min(wanted, room))
        this.carFraming.fov = Math.min(64, (SHOWROOM_FOV * wanted) / this.carFraming.distance)
        this.carFraming.height = this.showroomHeight
        this.camera.showroom(this.showroomAnchor, this.showroomYaw, dt, this.carFraming)
      }
    } else if (phase !== 'paused') {
      this.camera.update(this.vehicle.model.root, this.vehicle.speedKmh, dt, this.vehicle.controller.nitro.intensity, this.vehicle.motion)
      this.effects.update(this.vehicle, dt)
      this.updateGuide(dt)
    }
    this.environment.follow(this.vehicle.position)
    this.showroom.update(dt)
    const v = this.vehicle.body.linvel()
    this.track.update(this.vehicle.position, _velocity.set(v.x, v.y, v.z), dt)
    this.renderer.adapt(dt)

    const ctrl = this.vehicle.controller
    const sound = this.soundState
    let slip = 0
    for (const w of ctrl.wheels) slip = Math.max(slip, w.slip)
    sound.rpm = this.showroomRev?.rpm ?? ctrl.drivetrain.rpm
    sound.throttle = this.showroomRev?.throttle ?? ctrl.throttlePedal
    sound.gear = ctrl.drivetrain.gear
    sound.slip = slip
    sound.nitro = ctrl.nitro.intensity
    sound.nitroActive = ctrl.nitro.active
    sound.nitroPerfect = ctrl.nitro.perfect
    this.audio.update(sound)
    this.renderer.render()

    this.fpsFrames++
    this.fpsTimer += dt
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTimer)
      this.fpsFrames = 0
      this.fpsTimer = 0
    }
    this.telemetryTimer += dt
    if (this.telemetryTimer >= 1 / TELEMETRY_HZ) {
      this.telemetryTimer = 0
      this.publishTelemetry()
    }
  }

  private updateGuide(dt: number): void {
    const p = this.vehicle.position
    this.progress.update(p.x, p.z)
    this.guide.update(this.progress, dt)
    // Wrong way: heading against the centreline while actually moving.
    const t = this.progress.tangent()
    _forward.set(0, 0, 1).applyQuaternion(this.vehicle.quaternion)
    const against = _forward.x * t.x + _forward.z * t.z < -0.4 && this.vehicle.speedKmh > 12
    this.wrongWayTime = against && gameStore.getState().phase === 'racing' ? this.wrongWayTime + dt : 0
  }

  private publishTelemetry(): void {
    const q = this.vehicle.quaternion
    _forward.set(0, 0, 1).applyQuaternion(q)
    const ctrl = this.vehicle.controller
    const t = this.race.timer
    telemetryStore.setState({
      speedKmh: this.vehicle.speedKmh,
      rpm: ctrl.drivetrain.rpm,
      gear: ctrl.drivetrain.gear,
      nitro: ctrl.nitro.charge,
      nitroActive: ctrl.nitro.active,
      nitroReady: ctrl.nitro.charge >= this.vehicle.config.nitro.minCharge,
      driftActive: ctrl.drift.active,
      driftScore: Math.round(ctrl.drift.score),
      driftBanked: ctrl.drift.sinceEnd < 1.6 ? ctrl.drift.lastScore : 0,
      nitroCue: ctrl.nitro.windowCue,
      nitroWindow: ctrl.nitro.windowOpen,
      nitroPerfect: ctrl.nitro.perfect,
      nitroMissed: ctrl.nitro.active && ctrl.nitro.missed && ctrl.nitro.burnTime - ctrl.nitro.missedAt < 0.8,
      lap: this.race.lap,
      totalLaps: this.race.totalLaps,
      currentLapMs: t.currentLapMs,
      lastLapMs: t.lastLapMs,
      bestLapMs: t.bestLapMs,
      totalMs: t.totalMs,
      countdown: this.race.countdown,
      fps: this.fps,
      carX: this.vehicle.position.x,
      carZ: this.vehicle.position.z,
      heading: Math.atan2(_forward.x, _forward.z),
      trackIndex: this.progress.index,
      distanceLeft: this.distanceLeft(),
      wrongWay: this.wrongWayTime > WRONG_WAY_DELAY,
    })
  }

  /** Meters to the finish: the rest of this lap plus every lap after it. */
  private distanceLeft(): number {
    const n = this.track.line.length
    if (!n) return 0
    const spacing = this.lapLength / n
    const i = this.progress.index
    let lap = ((n - i) % n) * spacing
    // Still behind the start line on the grid: the whole lap is ahead too.
    if (this.race.lastCheckpoint === 0 && i > n / 2) lap += this.lapLength
    const lapsAfter = Math.max(0, this.race.totalLaps - Math.max(1, this.race.lap))
    return this.race.state === 'finished' ? 0 : lap + lapsAfter * this.lapLength
  }

  /** Menu and garage show the car in the showroom; racing shows the track. */
  /**
   * In the garage the car stands on a flat pad just above the track under the
   * spawn (which has camber, so the car would sit tilted and the tyres would
   * float over the garage floor). The garage floor is seated at the pad's top.
   */
  private setShowroomPad(on: boolean): void {
    const world = this.physics.world
    if (!on) {
      if (this.showroomPad) world.removeCollider(this.showroomPad, true)
      this.showroomPad = null
      return
    }
    if (this.showroomPad) return
    const spawn = this.track.spawn
    const cos = Math.cos(spawn.heading)
    const sin = Math.sin(spawn.heading)
    // Colliders aren't queryable until the first physics step: if the road
    // didn't answer, use the spawn height for now and rebuild next frame.
    let top = spawn.position.y - 0.6
    this.showroomPadStale = false
    for (const w of this.vehicle.config.wheels) {
      const [x, , z] = w.position
      const wx = spawn.position.x + x * cos + z * sin
      const wz = spawn.position.z - x * sin + z * cos
      const h = this.physics.groundHeight(wx, spawn.position.y, wz, (c) => c !== this.showroomPad)
      if (h === null) this.showroomPadStale = true
      else top = Math.max(top, h)
    }
    top += 0.01
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spawn.heading)
    this.showroomPad = world.createCollider(
      RAPIER.ColliderDesc.cuboid(6, 0.05, 6).setTranslation(spawn.position.x, top - 0.05, spawn.position.z).setRotation(q).setFriction(1.2),
    )
    this.showroom.setFloorHeight(top)
    this.showroom.setCarFootprint(this.vehicle.config.wheels)
  }

  private updateShowroom(phase: GamePhase): void {
    if (!this.showroom) return
    const inShowroom = phase === 'menu' || phase === 'garage'
    this.showroom.setActive(this.renderer.scene, inShowroom, [this.track.group, this.environment.group, this.effects.group, this.guide.group])
    this.setShowroomPad(inShowroom)
    this.audio.setScene(inShowroom ? 'menu' : 'race')
    // Re-assert the time of day: it may have changed while the showroom had the scene.
    if (!inShowroom) this.environment.apply(this.renderer.scene)
  }

  private applyBuild(build: CarBuild, prev: CarBuild): void {
    if (!this.vehicle) return
    this.livery.apply(build)
    if (samePerformance(build, prev)) return
    // Upgrades change mass, springs and engine, so rebuild the physics car in place.
    const model = this.vehicle.model
    this.physics.world.removeRigidBody(this.vehicle.body)
    const config = applyCarBuild(this.baseConfig, build)
    this.vehicle = new Vehicle(config, model, this.physics.world, this.track.spawn)
    this.vehicle.controller.surfaceAt = (x, z) => this.track.surfaceAt(x, z)
    this.vehicle.lightsOn = this.environment.current.headlights
    telemetryStore.setState({ redlineRpm: config.engine.redlineRpm })
    this.vehicle.render(1)
  }

  private applySettings(s: Settings): void {
    this.renderer.applyQuality(s.quality, s.postfx)
    this.environment?.setShadowMapSize(s.quality === 'high' ? 2048 : 1024)
    if (this.track) {
      void this.track.setQuality(s.quality)
      const view = this.track.viewDistance(s.quality)
      this.environment.setViewDistance(view.fogNear, view.fogFar)
      this.renderer.setViewDistance(view.fogFar * 1.05)
    }
    this.audio.setVolume(s.masterVolume)
    if (this.camera) this.camera.mode = s.camera
    this.applyTimeOfDay(s.timeOfDay)
  }

  /** Sky, lights, fog and reflections for the chosen time of day; headlights at night. */
  private applyTimeOfDay(id: Settings['timeOfDay']): void {
    if (!this.environment) return
    const before = this.environment.current
    this.environment.setTimeOfDay(id)
    const preset = this.environment.current
    // The garage showroom owns the scene's fog/environment while it's up; it
    // gets ours back in updateShowroom() when it closes.
    const phase = gameStore.getState().phase
    if (phase !== 'menu' && phase !== 'garage') this.environment.apply(this.renderer.scene)
    if (this.vehicle) {
      this.vehicle.lightsOn = preset.headlights
      this.headlights.setOn(preset.headlights)
    }
    // Adding/removing the headlight beams changes every lit shader: compile now, in the menu, not on the grid.
    if (before !== preset && this.vehicle) void this.renderer.renderer.compileAsync(this.renderer.scene, this.renderer.camera)
  }

  dispose(): void {
    this.disposed = true
    this.loop.stop()
    this.unsubscribe()
    this.input.dispose()
    this.audio.dispose()
    this.livery?.dispose()
    this.effects?.dispose()
    this.guide?.dispose()
    this.showroom?.dispose()
    this.track?.dispose()
    this.headlights?.dispose()
    this.environment?.dispose()
    this.physics?.dispose()
    this.renderer.dispose()
  }
}
