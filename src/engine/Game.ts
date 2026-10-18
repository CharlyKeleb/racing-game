import { hudCoversPoint } from '../stores/hudLayoutStore'
import { driftEvent, readDriftRecord, saveDriftRecord } from '../racing/driftEvents'
import { DriftZones } from '../effects/DriftZones'
import { DriftChallenge } from '../racing/DriftChallenge'
import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { AudioManager, type CarSoundState } from '../audio/AudioManager'
import { StagingRevs } from '../audio/StagingRevs'
import { RaceIntroCamera, RACE_INTRO_SECONDS, INTRO_CUTS, WHIP_SECONDS, introShot } from '../camera/RaceIntroCamera'
import { startingGrid } from '../racing/StartingGrid'
import { ChaseCamera, type ShowroomFraming } from '../camera/ChaseCamera'
import { DirectionGuide } from '../effects/DirectionGuide'
import { NitroFlames } from '../effects/NitroFlames'
import { DrivingEffects } from '../effects/DrivingEffects'
import { Headlights } from '../effects/Headlights'
import { TrackProgress } from '../racing/TrackProgress'
import { InputManager, type InputState } from '../input/InputManager'
import { COUNTDOWN_SEC, RaceManager, START_LIGHTS, startLightsLit } from '../racing/RaceManager'
import { draftingStrength } from '../racing/Drafting'
import { Opponent } from '../racing/Opponent'
import { RaceStandings, type RaceEntry } from '../racing/RaceStandings'
import { RecoveryMonitor } from '../racing/RecoveryMonitor'
import type { TrafficCar } from '../racing/AiDriver'
import { gameStore, type GamePhase, type Settings } from '../stores/gameStore'
import { telemetryStore } from '../stores/telemetryStore'
import { rivalTagStore, type RivalTag } from '../stores/rivalTagStore'
import { applyCarBuild, samePerformance, type CarBuild } from '../vehicles/CarBuild'
import { CarLivery } from '../vehicles/CarLivery'
import { buildPlaceholderCar, rigCarModel, type CarModel } from '../vehicles/CarModel'
import { getCar, selectableCars, stepCar, type CarEntry } from '../vehicles/carRegistry'
import { Vehicle, type SpawnPoint } from '../vehicles/Vehicle'
import { resolveVehicleConfig, type VehicleConfig } from '../vehicles/VehicleConfig'
import { Environment } from '../world/Environment'
import type { RaceTrack } from '../world/RaceTrack'
import { Surface } from '../vehicles/Surface'
import { measureRoadEdges } from '../world/SurfaceMap'
import { planSafetyWalls } from '../world/SafetyWalls'
import { Showroom } from '../world/Showroom'
import { StreamedTrack } from '../world/StreamedTrack'
import { Track } from '../world/Track'
import { getTrack } from '../world/tracks'
import { AssetManager } from './AssetManager'
import { GameLoop } from './GameLoop'
import { initRapier, PhysicsWorld } from './PhysicsWorld'
import { Renderer } from './Renderer'

const TELEMETRY_HZ = 20
/** Opacity of a tag sitting behind a nearer car's tag. */
const CROWDED_TAG_OPACITY = 0.3

/** A rival tag plus how visible the engine wants it this frame, before smoothing. */
interface StackedTag extends RivalTag {
  target: number
}
// Handbrake, not brake: brake at standstill would engage reverse.
export type ShowroomFocus = 'car' | 'wheel'

const LOCKED_INPUT: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: true, nitro: false }
/** Past the flag: brake to a stop in a straight line while the rivals finish. */
const FINISHED_INPUT: InputState = { throttle: 0, brake: 0.5, steer: 0, handbrake: false, nitro: false }
const _velocity = new THREE.Vector3()
const _forward = new THREE.Vector3()
const _listenerPosition = new THREE.Vector3()
const _listenerRight = new THREE.Vector3()
const _rivalOffset = new THREE.Vector3()
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
  private readonly introCamera: RaceIntroCamera
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
  private driftZones?: DriftZones
  private driftPersonalBest = 0
  private driftNewBest = false
  private driftLastX = 0
  private driftLastZ = 0
  private readonly driftChallenge = new DriftChallenge()
  private race!: RaceManager
  private opponents: Opponent[] = []
  private readonly opponentFlames = new Map<number, NitroFlames>()
  private opponentToken = 0
  private roadEdges!: { left: Float32Array; right: Float32Array }
  private standings!: RaceStandings
  private readonly recovery = new RecoveryMonitor()
  private safetyWalls: RAPIER.RigidBody | null = null
  private readonly recoverSpawn = (entry: RaceEntry): SpawnPoint => this.recoverySpawn(entry)
  private readonly playerPose: TrafficCar = { id: 0, x: 0, z: 0, heading: 0, speed: 0 }
  private readonly playerEntry: RaceEntry = { id: 0, name: 'You', player: true, lap: 0, checkpoint: 0, index: 0, finishMs: null }
  private traffic: TrafficCar[] = [this.playerPose]
  private entries: RaceEntry[] = [this.playerEntry]
  private readonly labelPoint = new THREE.Vector3()
  private readonly labelDirection = new THREE.Vector3()
  private readonly labelRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })
  /** One screen tag per rival, mutated each frame (see rivalTagStore). */
  private rivalTags: StackedTag[] = []
  private rivalTagFrame = 0
  private readonly racePosition = new THREE.Vector3()
  private livery!: CarLivery
  private showroom!: Showroom
  private effects!: DrivingEffects
  private headlights!: Headlights
  private guide!: DirectionGuide
  private progress!: TrackProgress
  private wrongWayTime = 0
  /** Centreline length, meters (one lap). */
  /** The car as shipped, before garage upgrades. */
  private baseConfig!: VehicleConfig
  private carId = ''
  /** The current track's visuals load (see init); Race waits on it if pressed early. */
  private trackVisuals: Promise<void> | null = null
  private trackVisualsDone = false
  private trackProgress = 0
  private trackLoadToken = 0
  private raceTransition = false
  private raceQueued = false
  private raceLoadingTick: ReturnType<typeof setInterval> | null = null
  /** Bumped per car switch, so a slow load can't install over a newer pick. */
  private carSwapToken = 0
  /** Garage car swap in progress: the car drives off ('out') or arrives ('in'), drawn only — physics stays parked. */
  private showroomDrive: { mode: 'out' | 'in'; t: number; spin: number; done: () => void } | null = null
  /** Where the car is parked. The garage camera frames this, so it holds still while a car drives off. */
  private readonly showroomAnchor = new THREE.Object3D()
  /** Engine sound override during a garage swap (the parked car's physics idles). */
  private revHeld = false
  private revRpm = 0
  private showroomRev: { rpm: number; throttle: number } | null = null
  /** Grid revs before lights out (sound and tach only), player and per rival. */
  private readonly playerRevs = new StagingRevs(0)
  private rivalRevs: StagingRevs[] = []
  /** Intro seconds as of the last frame, so each cut's sound cue fires once. */
  private introCueAt = 0
  /** Start lights already announced this countdown. */
  private lightsShown = 0
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
    this.introCamera = new RaceIntroCamera(this.renderer.camera)
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

    const bootToken = this.trackLoadToken
    // Behind the menu: the track's visuals first (Race needs them), then the
    // sharp garage textures, then the other cars.
    void this.loadTrackVisuals()
      .then(async () => {
        if (this.disposed || this.trackLoadToken !== bootToken) return
        performance.measure('boot:trackVisuals', 'boot:start')
        await this.showroom.upgrade(this.assets)
        performance.measure('boot:garageHigh', 'boot:start')
        await this.preloadCars()
      })
      .catch((err: unknown) => {
        if (!this.disposed && this.trackLoadToken === bootToken) {
          gameStore.getState().setError(err instanceof Error ? err.message : String(err))
        }
      })
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
          intro: 'intro',
          countdown: 'countdown',
          racing: 'racing',
          finished: 'finished',
        }
        // The intro's last shot is framed like the grid chase camera, so start it fresh there.
        if (state === 'countdown') this.camera.snap()
        if (state === 'finished' && gameStore.getState().settings.mode === 'drift') this.finishDriftRun()
        gameStore.getState().setPhase(phase[state])
      },
      onLap: () => this.publishTelemetry(),
    })
  }

  /** Roadside corner boards + progress tracking + minimap outline for the current track. */
  private attachGuide(): void {
    this.guide?.dispose()
    this.driftZones?.dispose()
    this.driftZones = new DriftZones(this.track.line,this.track.checkpoints)
    this.driftZones.group.visible = false
    this.renderer.scene.add(this.driftZones.group)
    // Built at the next race start: colliders only answer ray queries after a
    // physics step, and at boot/track load none has run yet.
    this.removeSafetyWalls()
    const edges = measureRoadEdges(this.track.line, (x, z) => this.track.surfaceAt(x, z))
    this.roadEdges = edges
    this.standings = new RaceStandings(this.track.line, this.track.checkpoints)
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
    // Every point: the minimap is zoomed in and highlights the route from the car's index.
    gameStore.setState({
      minimap: {
        points: line.map((p) => [p.x, p.z]),
        gates: this.track.checkpoints.map((c) => [c.position.x, c.position.z]),
      },
    })
  }

  /** Invisible walls where the track's collision floor ends, so a car can't drop off the world (see SafetyWalls). */
  private buildSafetyWalls(): void {
    this.removeSafetyWalls()
    const walls = planSafetyWalls(this.track.line, (x, y, z) => this.physics.groundHeight(x, y, z))
    if (walls.segments === 0) return
    const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    this.physics.world.createCollider(RAPIER.ColliderDesc.trimesh(walls.vertices, walls.indices).setFriction(0.2).setRestitution(0.1), body)
    this.safetyWalls = body
  }

  private removeSafetyWalls(): void {
    if (this.safetyWalls) this.physics.world.removeRigidBody(this.safetyWalls)
    this.safetyWalls = null
  }

  /** A track ready to race and see (track switching): core, then visuals. */
  private async loadTrack(id: string): Promise<RaceTrack> {
    gameStore.setState({ loadProgress: 0 })
    const track = await this.loadTrackCore(id)
    try {
      await track.loadVisuals?.((p) => gameStore.setState({ loadProgress: p }))
    } catch (err) {
      track.dispose()
      throw err
    }
    this.trackVisuals = Promise.resolve()
    this.trackVisualsDone = true
    gameStore.setState({ loadProgress: 1 })
    return track
  }

  /** What the race logic needs: physics, spawn, checkpoints, surfaces. */
  private async loadTrackCore(id: string): Promise<RaceTrack> {
    const def = getTrack(id)
    this.trackLoadToken++
    gameStore.setState({ trackName: def.name })
    this.trackVisuals = null
    this.trackVisualsDone = false
    this.trackProgress = 0
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
    const token = this.trackLoadToken
    const track = this.track
    this.trackVisuals ??= (track.loadVisuals?.((p) => {
      if (!this.disposed && this.trackLoadToken === token) this.trackProgress = p
    }) ?? Promise.resolve()).then(() => {
      if (this.disposed || this.trackLoadToken !== token) return
      this.trackVisualsDone = true
      this.trackProgress = 1
    })
    return this.trackVisuals
  }

  /** Menu track picker: tear down the current track and stream in the next. */
  private async switchTrack(id: string): Promise<void> {
    if (getTrack(id).id === this.track.id || gameStore.getState().trackSwitching) return
    const oldAnchor = this.showroomAnchor.clone()
    gameStore.setState({ trackSwitching: true, loadProgress: 0 })
    // Keep the last garage frame visible while physics and track assets are replaced.
    this.loop.stop()
    this.clearRaceLoading()
    this.clearOpponents()
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
    this.setShowroomPad(false)
    this.setShowroomPad(true)
    this.vehicle.render(1)
    this.showroomAnchor.position.copy(this.vehicle.model.root.position)
    this.showroomAnchor.quaternion.copy(this.vehicle.model.root.quaternion)
    this.camera.relocateShowroom(oldAnchor, this.showroomAnchor)
    this.applySettings(gameStore.getState().settings)
    // The showroom is already active, so it won't re-hide the new track/guide itself.
    this.track.group.visible = false
    this.guide.group.visible = false
    gameStore.setState({ trackSwitching: false })
    this.loop.start()
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
    if (this.disposed || carSwitching || gameStore.getState().trackSwitching || this.raceQueued) return
    if (!this.trackReady) {
      // Pressed before the track's visuals finished loading behind the menu:
      // show the loading screen, then start. Audio unlocks now, while this is
      // still a user gesture.
      this.audio.unlock(settings.masterVolume)
      this.raceQueued = true
      this.raceTransition = true
      gameStore.getState().setPhase('loading')
      const token = this.trackLoadToken
      gameStore.setState({ loadProgress: this.trackProgress })
      this.raceLoadingTick = setInterval(() => gameStore.setState({ loadProgress: this.trackProgress }), 100)
      void this.loadTrackVisuals().then(() => {
        if (this.disposed || this.trackLoadToken !== token) return
        this.clearRaceLoading()
        gameStore.getState().setPhase('menu')
        this.startRace()
      }).catch((err: unknown) => {
        if (!this.disposed && this.trackLoadToken === token) {
          this.clearRaceLoading()
          gameStore.getState().setError(err instanceof Error ? err.message : String(err))
        }
      })
      return
    }
    void this.launchRace()
  }

  private clearOpponents(): void {
    this.raceTransition = false
    this.audio.clearOpponents()
    this.rivalRevs = []
    this.rivalTags = []
    rivalTagStore.setState({ tags: this.rivalTags })
    this.opponentToken++
    for (const flames of this.opponentFlames.values()) flames.dispose()
    this.opponentFlames.clear()
    for (const opponent of this.opponents) opponent.dispose()
    this.opponents = []
    this.traffic = [this.playerPose]
    this.entries = [this.playerEntry]
  }

  private async launchRace(): Promise<void> {
    this.clearOpponents()
    if (!this.safetyWalls) this.buildSafetyWalls()
    const token = this.opponentToken
    const { settings } = gameStore.getState()
    const opponentCount = settings.mode === 'drift' ? 0 : settings.opponents
    this.driftChallenge.reset(driftEvent(settings.driftEvent))
    this.driftNewBest = false
    this.driftPersonalBest = readDriftRecord(settings.track,settings.driftEvent).score
    this.vehicle.controller.setDriftMode(settings.mode === 'drift')
    this.raceQueued = true
    this.raceTransition = true
    this.race.state = 'idle'
    this.audio.unlock(settings.masterVolume)
    gameStore.getState().setPhase('loading')
    try {
      const choices = selectableCars().filter(car => car.id !== this.carId)
      const rivals = Array.from({ length: opponentCount }, (_, i) => choices[i % choices.length])
      const loaded = await Promise.all(rivals.map(async car => {
        const [scene, json] = await Promise.all([
          this.assets.loadModel(car.modelUrlLow ?? car.modelUrl),
          this.assets.loadJson<Partial<VehicleConfig>>(car.configUrl),
        ])
        return { car, scene, config: resolveVehicleConfig(json ?? undefined) }
      }))
      if (this.disposed || token !== this.opponentToken) return
      this.resetCar()
      this.effects.clear()
      this.playerEntry.finishMs = null
      this.playerEntry.lap = 0
      this.playerEntry.checkpoint = 0
      this.playerEntry.index = 0
      const grid = startingGrid(this.track.line,this.track.spawn.position,opponentCount+1,this.roadEdges)
      const playerSlot = grid[grid.length-1]
      const position = new THREE.Vector3(playerSlot.x,playerSlot.y+0.6,playerSlot.z)
      const road = this.physics.groundHeight(position.x,position.y,position.z,c=>this.track.isRoadCollider(c))
      if (road !== null) position.y = road+0.6
      this.vehicle.respawn({position,heading:playerSlot.heading})
      this.driftLastX=position.x;this.driftLastZ=position.z
      this.progress.reset(); this.progress.update(position.x,position.z)
      this.camera.snap()
      this.playerEntry.x = position.x; this.playerEntry.z = position.z
      for (let id = 1; id <= opponentCount; id++) {
        const slot = grid[id-1]
        const position = new THREE.Vector3(slot.x,slot.y+0.6,slot.z)
        const ground = this.physics.groundHeight(position.x,position.y,position.z,c=>this.track.isRoadCollider(c))
        if (ground !== null) position.y = ground+0.6
        const rival = loaded[id - 1]
        const opponent = new Opponent(id, rival.scene, rival.config, this.physics.world, this.track, { position, heading: slot.heading }, settings.difficulty)
        opponent.vehicle.lightsOn = this.environment.current.headlights
        opponent.entry.name += ` · ${rival.car.name}`
        const flames = new NitroFlames(rival.config)
        opponent.vehicle.model.body.add(flames.group)
        this.opponentFlames.set(id, flames)
        this.opponents.push(opponent)
        this.renderer.scene.add(opponent.vehicle.model.root)
        this.traffic.push(opponent.pose)
        this.entries.push(opponent.entry)
        opponent.start(settings.laps,RACE_INTRO_SECONDS)
        this.rivalTags.push({ id, x: 50, y: 50, scale: 1, opacity: 0, distance: 0, target: 0 })
        const revs = new StagingRevs(id)
        revs.reset(rival.config.engine.idleRpm)
        this.rivalRevs.push(revs)
      }

      rivalTagStore.setState({ tags: this.rivalTags })
      this.audio.setOpponentCars(rivals)
      this.audio.playStart()
      this.prepareRaceIntro()
      this.race.start(settings.mode === 'drift' ? driftEvent(settings.driftEvent).laps : settings.laps,RACE_INTRO_SECONDS)
      this.publishTelemetry()
    } catch (err) {
      this.clearOpponents()
      gameStore.getState().setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (token === this.opponentToken) this.raceTransition = false
      this.raceQueued = false
    }
  }

  /** Paint the cinematic before React reveals it; never expose the grid camera. */
  private prepareRaceIntro(): void {
    this.playerRevs.reset(this.vehicle.config.engine.idleRpm)
    this.introCueAt = 0
    this.lightsShown = 0
    this.updateShowroom('intro')
    this.vehicle.render(1)
    for (const opponent of this.opponents) opponent.vehicle.render(1)
    this.environment.follow(this.vehicle.position)
    this.introCamera.update(0,this.vehicle.model.root,this.opponents[0]?.vehicle.model.root ?? this.vehicle.model.root,this.physics.world)
    this.renderer.render()
  }

  private clearRaceLoading(): void {
    this.raceTransition = false
    if (this.raceLoadingTick !== null) clearInterval(this.raceLoadingTick)
    this.raceLoadingTick = null
    this.raceQueued = false
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
    if (gameStore.getState().carSwitching) return
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
  /** Audition the current engine without moving the parked car. */
  revEngine(held: boolean): void {
    if (!held) { this.revHeld = false; return }
    const s = gameStore.getState()
    if (this.disposed || s.carSwitching || (s.phase !== 'menu' && s.phase !== 'garage')) return
    this.audio.unlock(s.settings.masterVolume)
    this.revHeld = true
  }

  unlockAudio(): void {
    this.audio.unlock(gameStore.getState().settings.masterVolume)
  }

  /** Garage chevrons: step through the cars. The current one drives off and the next drives in. */
  cycleCar(step: 1 | -1): void {
    const s = gameStore.getState()
    if (s.carSwitching || s.trackSwitching || (s.phase !== 'garage' && s.phase !== 'menu')) return
    s.updateSettings({ car: stepCar(this.carId, step).id })
  }

  private async switchCar(id: string): Promise<void> {
    const entry = getCar(id)
    if (entry.id === this.carId) return
    this.carId = entry.id
    this.revHeld = false
    this.revRpm = 0
    const token = ++this.carSwapToken
    gameStore.setState({ carSwitching: true })
    const phase = gameStore.getState().phase
    const showroom = phase === 'menu' || phase === 'garage'
    const loading = this.loadCar(entry.id)
    if (showroom) {
      // Keep the current view while cars leave and arrive, including after a flick.
      this.orbitVelocity = 0
      this.orbitCoasting = false
      // The chevron click is a user gesture, so the engines can be heard leaving and arriving.
      this.audio.unlock(gameStore.getState().settings.masterVolume)
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

  skipRaceIntro(): void {
    if (gameStore.getState().phase !== 'intro') return
    for (const opponent of this.opponents) opponent.race.skipIntro()
    this.race.skipIntro()
    this.camera.snap()
    this.publishTelemetry()
  }

  togglePause(): void {
    const { phase, setPhase } = gameStore.getState()
    if (phase === 'paused') {
      setPhase(this.race.state === 'intro' ? 'intro' : this.race.state === 'countdown' ? 'countdown' : 'racing')
      this.audio.resume()
    } else if (phase === 'racing' || phase === 'countdown' || phase === 'intro') {
      setPhase('paused')
      this.audio.suspend()
    }
  }

  quitToMenu(): void {
    this.clearOpponents()
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
    this.progress?.update(this.track.spawn.position.x, this.track.spawn.position.z)
  }

  /**
   * Mid-race reset (R / touch button / fallen off, flipped or stuck): back on
   * the centreline a few metres behind the car, inside the sector it has
   * validated, so a reset never skips a gate.
   */
  resetToCheckpoint(): void {
    this.driftChallenge.bust()
    this.playerEntry.checkpoint = this.race.lastCheckpoint
    this.playerEntry.index = this.progress.index
    const spawn = this.recoverySpawn(this.playerEntry)
    this.vehicle.respawn(spawn)
    this.camera.snap()
    this.recovery.reset()
    this.driftLastX=spawn.position.x; this.driftLastZ=spawn.position.z
    this.progress.reset()
    this.progress.update(spawn.position.x, spawn.position.z)
  }

  /** Where a car in `entry`'s place goes back on the road: centreline, road height, facing the race direction. */
  private recoverySpawn(entry: RaceEntry): SpawnPoint {
    if (!this.standings) return this.track.respawnAt(entry.checkpoint)
    const line = this.track.line, n = line.length
    const i = this.standings.recoveryIndex(entry)
    const p = line[i], a = line[(i - 1 + n) % n], b = line[(i + 1) % n]
    const road = this.physics.groundHeight(p.x, p.y, p.z, (c) => this.track.isRoadCollider(c))
    return {
      position: new THREE.Vector3(p.x, (road ?? p.y) + 0.8, p.z),
      heading: Math.atan2(b.x - a.x, b.z - a.z),
    }
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

    const skip = this.input.consume('skip')
    if (skip) this.skipRaceIntro()
    const phase = gameStore.getState().phase
    if (phase === 'paused') return
    const racing = phase === 'racing' && this.race.state === 'racing'
    if (this.input.consume('reset') && racing) this.resetToCheckpoint()

    const inMenu = phase === 'menu' || phase === 'garage' || phase === 'loading'
    const controls = this.race.controlsEnabled && !inMenu
    const p = this.vehicle.body.translation(), q = this.vehicle.body.rotation()
    this.playerPose.x = p.x; this.playerPose.z = p.z
    this.playerPose.heading = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x))
    this.playerPose.speed = this.vehicle.controller.forwardSpeed
    for (const opponent of this.opponents) opponent.readPose()
    this.vehicle.controller.drafting = controls ? draftingStrength(this.playerPose, this.traffic, 0) : 0
    this.vehicle.fixedUpdate(phase === 'finished' ? FINISHED_INPUT : controls ? this.input.state : LOCKED_INPUT, dt)
    for (const opponent of this.opponents) {
      const i = opponent.driver.progress.index
      const laneLimit = Math.max(0, Math.min(this.roadEdges.left[i], this.roadEdges.right[i]) - 2)
      const gap = this.standings.distance(this.playerEntry) - this.standings.distance(opponent.entry)
      if (!inMenu) opponent.drive(dt, this.traffic, gap, laneLimit)
    }
    this.physics.step(dt)
    this.vehicle.capture()
    for (const opponent of this.opponents) {
      if (!inMenu) opponent.capture(dt, this.traffic, this.recoverSpawn)
    }
    // Physics position, not the render-interpolated one (that lags a tick).
    const body = this.vehicle.body.translation(), rotation = this.vehicle.body.rotation()
    if (body.y < this.track.killY) {
      if (racing) this.resetToCheckpoint()
      else this.resetCar()
    } else if (racing) {
      const centre = this.track.line[this.progress.update(body.x, body.z)]
      const input = this.input.state
      const reason = this.recovery.update(dt, {
        drop: body.y - centre.y,
        upY: 1 - 2 * (rotation.x * rotation.x + rotation.z * rotation.z),
        speed: Math.abs(this.vehicle.controller.forwardSpeed),
        pedal: Math.max(input.throttle, input.brake),
        offLine: gameStore.getState().settings.mode === 'drift' ? 0 : Math.hypot(body.x - centre.x, body.z - centre.z),
      })
      if (reason) this.resetToCheckpoint()
    }
    if (racing && gameStore.getState().settings.mode === 'drift') {
      const ctrl = this.vehicle.controller
      const velocity = this.vehicle.body.linvel()
      const q = this.vehicle.body.rotation()
      _forward.set(2*(q.x*q.z+q.w*q.y),2*(q.y*q.z-q.w*q.x),1-2*(q.x*q.x+q.y*q.y))
      const forward = velocity.x*_forward.x+velocity.z*_forward.z
      const sideways = velocity.x*_forward.z-velocity.z*_forward.x
      const surface = this.track.surfaceAt(body.x,body.z)
      let impact = false
      const collider = this.vehicle.body.collider(0)
      this.physics.world.contactPairsWith(collider,other=>{
        this.physics.world.contactPair(collider,other,manifold=>{
          if (Math.abs(manifold.normal().y)>.65) return
          let impulse=0
          for(let i=0;i<manifold.numContacts();i++)impulse+=manifold.contactImpulse(i)
          if(impulse/this.vehicle.config.massKg>1.6)impact=true
        })
      })
      const beforeBanks=this.driftChallenge.banks, beforeTransitions=this.driftChallenge.transitions, beforeBusts=this.driftChallenge.busts
      this.driftChallenge.sample(dt,{
        speed:Math.max(0,forward)*3.6,
        angle:Math.atan2(Math.abs(sideways),forward)*180/Math.PI,
        direction:Math.sign(sideways),
        distance:Math.hypot(body.x-this.driftLastX,body.z-this.driftLastZ),
        grounded:ctrl.wheels.filter(w=>w.grounded).length>=3,
        paved:surface===Surface.Asphalt || surface===Surface.Kerb,
        active:ctrl.drift.active,
        zone:!!this.driftZones?.at(body.x,body.z), impact,
      })
      if(this.driftChallenge.busts>beforeBusts)this.audio.playDriftCue('bust')
      else if(this.driftChallenge.banks>beforeBanks)this.audio.playDriftCue('bank')
      else if(this.driftChallenge.transitions>beforeTransitions)this.audio.playDriftCue('link')
    }
    this.driftLastX=body.x; this.driftLastZ=body.z
    const position = this.vehicle.body.translation()
    this.racePosition.set(position.x, position.y, position.z)
    this.race.update(dt, this.racePosition)
    this.playerEntry.lap = this.race.lap
    this.playerEntry.checkpoint = this.race.lastCheckpoint
    this.playerEntry.index = this.progress.update(position.x, position.z)
    this.playerEntry.x = position.x
    this.playerEntry.z = position.z
    if (this.race.state === 'finished' && this.playerEntry.finishMs === null) {
      this.playerEntry.finishMs = this.race.timer.totalMs
      this.publishTelemetry()
    }
  }

  private renderFrame(alpha: number, dt: number): void {
    const phase = gameStore.getState().phase
    if (phase === 'loading' && this.raceTransition) return
    for (const opponent of this.opponents) {
      opponent.vehicle.render(phase === 'paused' ? 1 : alpha, phase === 'paused' ? 0 : dt)
      this.opponentFlames.get(opponent.id)?.update(opponent.vehicle.controller.nitro.intensity, phase === 'paused' ? 0 : dt)
      opponent.vehicle.model.root.visible = opponent.vehicle.position.distanceToSquared(this.vehicle.position) < 300 * 300
    }
    this.vehicle.render(phase === 'paused' ? 1 : alpha, phase === 'paused' ? 0 : dt)
    if (!gameStore.getState().carSwitching) {
      this.showroomAnchor.position.copy(this.vehicle.model.root.position)
      this.showroomAnchor.quaternion.copy(this.vehicle.model.root.quaternion)
    }
    if (this.showroomDrive) this.animateShowroomDrive(dt)
    const audition = (phase === 'menu' || phase === 'garage') && !gameStore.getState().carSwitching
    if (!audition) { this.revHeld = false; this.revRpm = 0 }
    const idle = this.vehicle.config.engine.idleRpm
    const target = this.revHeld ? this.vehicle.config.engine.redlineRpm * 0.92 : idle
    this.revRpm = THREE.MathUtils.damp(Math.max(idle, this.revRpm), target, this.revHeld ? 3 : 4, dt)
    const revAudible = audition && (this.revHeld || this.revRpm > idle + 50)
    this.audio.setMenuEngine(this.showroomRev !== null || revAudible)
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
    } else if (phase === 'intro') {
      this.introCamera.update(1-this.race.introRemaining/this.race.introDuration,this.vehicle.model.root,this.opponents[0]?.vehicle.model.root ?? this.vehicle.model.root,this.physics.world)
    } else if (phase !== 'paused') {
      // Creep in on the car as the lights build, then settle into the race camera after the start.
      const lightsT = Math.min(1, (COUNTDOWN_SEC - this.race.countdown) / COUNTDOWN_SEC)
      const gridFraming = phase === 'countdown' ? 1 - 0.5 * lightsT * lightsT * (3 - 2 * lightsT) : this.camera.mode === 'chase' ? 0.5 * Math.max(0,1-this.race.timer.totalMs/1200) : 0
      this.camera.driftFraming = gameStore.getState().settings.mode === 'drift' ? .82 : .55
      this.camera.update(this.vehicle.model.root, this.vehicle.speedKmh, dt, this.vehicle.controller.nitro.intensity, this.vehicle.motion,gridFraming)
      this.effects.update(this.vehicle, dt)
      this.updateGuide(dt)
    }
    if (this.rivalTags.length > 0) this.updateRivalTags(phase === 'countdown' || phase === 'racing', dt)
    this.renderer.setWhipBlur(phase === 'intro' ? this.introCamera.whip * 0.05 : 0)
    const staging = phase === 'intro' || phase === 'countdown'
    if (staging) this.updateStaging(phase, dt)
    else if (phase === 'racing' && this.lightsShown > 0) {
      this.lightsShown = 0
      this.audio.playStartLight(true)
    }
    this.driftZones?.update(this.vehicle.position.x,this.vehicle.position.z,gameStore.getState().settings.mode === 'drift' && ['racing','countdown','intro','paused'].includes(phase),(this.race.lastCheckpoint+1)%this.track.checkpoints.length)
    this.environment.follow(this.vehicle.position)
    const v = this.vehicle.body.linvel()
    this.track.update(this.vehicle.position, _velocity.set(v.x, v.y, v.z), dt)
    this.renderer.adapt(dt)

    this.updateOpponentAudio(phase, staging)
    const ctrl = this.vehicle.controller
    const sound = this.soundState
    let slip = 0
    for (const w of ctrl.wheels) slip = Math.max(slip, w.slip)
    sound.rpm = this.showroomRev?.rpm ?? (revAudible ? this.revRpm : staging ? this.playerRevs.rpm : ctrl.drivetrain.rpm)
    sound.throttle = this.showroomRev?.throttle ?? (revAudible ? (this.revHeld ? 1 : 0) : staging ? this.playerRevs.throttle : ctrl.throttlePedal)
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

  /** The active camera is the listener, including during cinematic shots. */
  private updateOpponentAudio(phase: GamePhase, staging: boolean): void {
    if (this.opponents.length === 0) return
    const camera = this.renderer.camera
    // The renderer hasn't run yet: refresh the transform after camera motion.
    camera.updateWorldMatrix(true, false)
    _listenerPosition.setFromMatrixPosition(camera.matrixWorld)
    _listenerRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
    const active = phase === 'racing' || phase === 'countdown' || phase === 'intro'
    for (let i = 0; i < this.opponents.length; i++) {
      const rival = this.opponents[i].vehicle
      _rivalOffset.subVectors(rival.position, _listenerPosition)
      // OpponentAudio expects positive-left offset; camera local +X is right.
      const lateral = -_rivalOffset.dot(_listenerRight)
      const revs = staging ? this.rivalRevs[i] : undefined
      this.audio.updateOpponent(i, revs?.rpm ?? rival.controller.drivetrain.rpm, revs?.throttle ?? rival.controller.throttlePedal, _rivalOffset.length(), lateral, active)
    }
  }

  /**
   * Glue each rival's tag above its roof: project it every frame, shrink it with
   * distance, and fade it (never pop it) behind walls, off screen, too far or too close.
   */
  private updateRivalTags(show: boolean, dt: number): void {
    const camera = this.renderer.camera
    camera.updateMatrixWorld()
    const fade = 1 - Math.exp(-12 * dt)
    for (let i = 0; i < this.rivalTags.length; i++) {
      const tag = this.rivalTags[i]
      const opponent = this.opponents[i]
      let target = 0
      if (show && opponent) {
        const position = opponent.vehicle.position
        tag.distance = position.distanceTo(this.vehicle.position)
        this.labelPoint.copy(position); this.labelPoint.y += 1.25
        this.labelDirection.subVectors(this.labelPoint, camera.position)
        const range = this.labelDirection.length()
        if (tag.distance < 160 && range > 3) {
          this.labelDirection.divideScalar(range)
          this.labelRay.origin = camera.position
          this.labelRay.dir = this.labelDirection
          const obstruction = this.physics.world.castRay(this.labelRay, range, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC)
          this.labelPoint.project(camera)
          const onScreen = this.labelPoint.z > -1 && this.labelPoint.z < 1 && Math.abs(this.labelPoint.x) < 0.95 && Math.abs(this.labelPoint.y) < 0.9
          if (onScreen) {
            // Keep following the car even while it fades out behind a wall.
            tag.x = (this.labelPoint.x + 1) * 50
            tag.y = (1 - this.labelPoint.y) * 50
            tag.scale = Math.max(0.6, Math.min(1, 16 / range))
          }
          if (onScreen && !(obstruction && obstruction.timeOfImpact < range - 1)) {
            // Full strength from 6 m to 70 m; fade out up close (the car fills the screen) and toward 160 m.
            target = Math.min(1, (range - 3) / 3) * Math.min(1, (160 - tag.distance) / 90)
            // Stay out from under the standings and lap panels.
            if (hudCoversPoint(tag.x, tag.y)) target *= 0.25
          }
        }
      }
      tag.target = target
    }
    // Tags never move off their car. Where two collide, the nearer one draws on top
    // (the HUD orders them by distance) and the one behind it dims.
    for (const far of this.rivalTags) {
      if (far.target === 0) continue
      for (const near of this.rivalTags) {
        if (near === far || near.target === 0 || near.distance >= far.distance) continue
        const width = 9 * (near.scale + far.scale), height = 4.5 * (near.scale + far.scale)
        if (Math.abs(far.x - near.x) < width && Math.abs(far.y - near.y) < height) {
          far.target = Math.min(far.target, CROWDED_TAG_OPACITY)
          break
        }
      }
    }
    for (const tag of this.rivalTags) {
      tag.opacity += (tag.target - tag.opacity) * fade
      if (tag.opacity < 0.01) tag.opacity = 0
    }
    rivalTagStore.setState({ frame: ++this.rivalTagFrame })
  }

  /** Grid build-up: whooshes and thumps on the intro cuts, engines revving, the start-light beeps. */
  private updateStaging(phase: 'intro' | 'countdown', dt: number): void {
    if (phase === 'intro') {
      const seconds = this.race.introDuration - this.race.introRemaining
      for (let i = 0; i < INTRO_CUTS.length; i++) {
        const cut = INTRO_CUTS[i]
        if (this.introCueAt < cut - WHIP_SECONDS && seconds >= cut - WHIP_SECONDS) this.audio.playWhoosh(WHIP_SECONDS)
        if (this.introCueAt < cut && seconds >= cut) {
          this.audio.playImpact(i === 0 ? 0.8 : 1)
          // Cut to the hero shot of your car: the driver blips it. Cut to the field: they answer.
          if (i === 0) this.playerRevs.kick(0.8, 0.45)
          else for (const revs of this.rivalRevs) revs.kick(0.55 + 0.2 * Math.random(), 0.3)
        }
      }
      this.introCueAt = seconds
    }
    const lit = phase === 'countdown' ? startLightsLit(this.race.countdown) : 0
    if (lit > this.lightsShown) this.audio.playStartLight(false)
    this.lightsShown = lit
    // Rivals hold more revs with every light; your revs are yours on the throttle.
    const hold = phase === 'countdown' ? 0.12 + 0.3 * (COUNTDOWN_SEC - this.race.countdown) / COUNTDOWN_SEC : 0
    const engine = this.vehicle.config.engine
    this.playerRevs.update(dt, engine.idleRpm, engine.redlineRpm, 0, phase === 'countdown' ? this.input.state.throttle : -1)
    for (let i = 0; i < this.rivalRevs.length; i++) {
      const config = this.opponents[i]?.vehicle.config.engine
      if (config) this.rivalRevs[i].update(dt, config.idleRpm, config.redlineRpm, hold)
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
    this.wrongWayTime = against && !this.vehicle.controller.drift.active && gameStore.getState().phase === 'racing' ? this.wrongWayTime + dt : 0
  }

  private finishDriftRun(): void {
    this.driftChallenge.bank()
    const {track,driftEvent:event}=gameStore.getState().settings
    const previous=readDriftRecord(track,event)
    this.driftNewBest=this.driftChallenge.total>previous.score
    saveDriftRecord(track,{score:Math.max(previous.score,this.driftChallenge.total),chain:Math.max(previous.chain,this.driftChallenge.bestChain)},event)
  }

  private publishTelemetry(): void {
    const q = this.vehicle.quaternion
    _forward.set(0, 0, 1).applyQuaternion(q)
    const ctrl = this.vehicle.controller
    const t = this.race.timer
    const standings = this.standings?.snapshot(this.entries) ?? []
    const rivalLabels = this.opponents.map(o => ({ id: o.id, name: o.driver.profile.name, style: o.driver.profile.style, position: standings.find(s => s.id === o.id)?.position ?? o.id }))
    telemetryStore.setState({
      rivalLabels,
      introShot: introShot(this.race.introDuration > 0 ? 1-this.race.introRemaining/this.race.introDuration : 0),
      introProgress: this.race.introDuration > 0 ? 1-this.race.introRemaining/this.race.introDuration : 0,
      speedKmh: this.vehicle.speedKmh,
      rpm: this.race.state === 'intro' || this.race.state === 'countdown' ? this.playerRevs.rpm : ctrl.drivetrain.rpm,
      gear: ctrl.drivetrain.gear,
      nitro: ctrl.nitro.charge,
      drafting: ctrl.drafting,
      nitroActive: ctrl.nitro.active,
      nitroReady: ctrl.nitro.charge >= this.vehicle.config.nitro.minCharge,
      driftAngle: this.driftChallenge.angle,
      driftScoring: this.driftChallenge.scoring,
      driftZone: this.driftChallenge.zone,
      driftLink: this.driftChallenge.linkRemaining,
      driftComboProgress: this.driftChallenge.comboProgress,
      driftMessage: this.driftChallenge.messageTime>0 ? this.driftChallenge.message : '',
      driftBestChain: this.driftChallenge.bestChain,
      driftLongest: this.driftChallenge.longestDrift,
      driftTransitions: this.driftChallenge.transitions,
      driftZoneSeconds: this.driftChallenge.zoneSeconds,
      driftPeakCombo: this.driftChallenge.peakMultiplier,
      driftBusts: this.driftChallenge.busts,
      driftPersonalBest: this.driftPersonalBest,
      driftNewBest: this.driftNewBest,
      driftTotal: this.driftChallenge.total,
      driftChain: Math.round(this.driftChallenge.chain),
      driftCombo: this.driftChallenge.multiplier,
      driftGate: this.race.state === 'finished' ? this.track.checkpoints.length : this.race.lastCheckpoint,
      driftGateCount: this.track.checkpoints.length,
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
      startLights: this.race.state === 'countdown' ? startLightsLit(this.race.countdown) : 0,
      startLightCount: START_LIGHTS,
      fps: this.fps,
      carX: this.vehicle.position.x,
      carZ: this.vehicle.position.z,
      heading: Math.atan2(_forward.x, _forward.z),
      trackIndex: this.progress.index,
      distanceLeft: this.distanceLeft(),
      wrongWay: this.wrongWayTime > WRONG_WAY_DELAY,
      standings,
      opponents: this.opponents.map(o => ({ id: o.id, x: o.vehicle.position.x, z: o.vehicle.position.z })),
    })
  }

  /** Meters to the finish: the rest of this lap plus every lap after it. */
  /** Metres to the finish, from the same centreline measure as the standings gaps. */
  private distanceLeft(): number {
    if (!this.standings || this.race.state === 'finished') return 0
    return Math.max(0, this.race.totalLaps * this.standings.lapLength - this.standings.distance(this.playerEntry))
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
    if (phase === 'loading' && this.raceTransition) return
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
    this.clearRaceLoading()
    this.loop.stop()
    this.unsubscribe()
    this.clearOpponents()
    this.input.dispose()
    this.audio.dispose()
    this.livery?.dispose()
    this.effects?.dispose()
    this.guide?.dispose()
    this.driftZones?.dispose()
    this.showroom?.dispose()
    this.track?.dispose()
    this.headlights?.dispose()
    this.environment?.dispose()
    this.physics?.dispose()
    this.renderer.dispose()
  }
}
