import { OnlineRaceScene } from '../multiplayer/OnlineRaceScene'
import { onlineRaceStore, RELEASED_ONLINE_INPUT } from '../multiplayer/onlineRaceStore'
import { lobbyStore, acknowledgeRaceLoaded, leaveLobby, sendRaceInput } from '../multiplayer/LobbyClient'
import { CockpitRig } from '../vehicles/CockpitRig'
import { AwarenessRoute, ProximityRadar, type AwarenessCar } from '../racing/ProximityRadar'
import { proximityStore } from '../stores/proximityStore'
import { clearProximityLine } from './ProximityQuery'
import { CarSpoiler } from '../vehicles/CarSpoiler'
import { SPOILER_FIT } from '../vehicles/SpoilerCatalog'
import { DEFAULT_COCKPIT_ADJUSTMENT } from '../vehicles/CockpitConfig'
import { setTrackLook } from '../world/TrackLook'
import { BRAKE_AT, FINISH_SECONDS, FinishSequence, finishDrive, shotAt, type FinishShot } from '../racing/FinishSequence'
import { RaceFinishCamera } from '../camera/RaceFinishCamera'
import { WetReflections } from '../effects/WetReflections'
import { CarRain } from '../effects/CarRain'
import { RainSurface } from '../effects/RainSurface'
import { RainImpacts } from '../effects/RainImpacts'
import { WetRoads } from '../effects/WetRoads'
import { motionExposure } from '../effects/MotionBlur'
import { WhipStreaks } from '../effects/WhipStreaks'
import { NitroRush } from '../effects/NitroRush'
import { boostBlurTarget, stepBoostBlur } from '../effects/BoostBlur'
import { applyCarReflections } from '../world/CarReflections'
import { DrivingLine } from '../effects/DrivingLine'
import { BrakingGuide } from '../racing/BrakingGuide'
import { performanceCapture } from './PerformanceCapture'
import { hudCoversPoint } from '../stores/hudLayoutStore'
import { driftEvent, readDriftRecord, saveDriftRecord } from '../racing/driftEvents'
import { DriftZones } from '../effects/DriftZones'
import { CheckpointGates } from '../effects/CheckpointGates'
import { TimeTrialSession, readTrialRecord, saveTrialRecord, trialBuildKey } from '../racing/TimeTrial'
import { isSoloMode } from '../racing/gameModes'
import { DriftChallenge } from '../racing/DriftChallenge'
import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { AudioManager, type CarSoundState } from '../audio/AudioManager'
import type { RivalSoundState } from '../audio/OpponentAudio'
import type { TyreBrakeInput } from '../audio/TyreBrakeModel'
import { curbStrength, impactStrength, scrapeLevel } from '../audio/ImpactModel'
import { StagingRevs } from '../audio/StagingRevs'
import { RaceIntroCamera, RACE_INTRO_SECONDS, INTRO_CUTS, WHIP_SECONDS, introShot } from '../camera/RaceIntroCamera'
import { startingGrid } from '../racing/StartingGrid'
import { ChaseCamera, type ShowroomFraming } from '../camera/ChaseCamera'
import { DirectionGuide } from '../effects/DirectionGuide'
import { NitroFlames, type ExhaustPop } from '../effects/NitroFlames'
import { Sparks, type SparkContact } from '../effects/Sparks'
import { HeatHaze } from '../effects/HeatHaze'
import { LensDrops } from '../effects/LensDrops'
import { Rain } from '../effects/Rain'
import { RainSpray } from '../effects/RainSpray'
import { Benchmark } from './Benchmark'
import { backend } from './backend'
import { DrivingEffects } from '../effects/DrivingEffects'
import { Headlights } from '../effects/Headlights'
import { TrackProgress } from '../racing/TrackProgress'
import { InputManager, type InputState } from '../input/InputManager'
import { LaunchControl } from '../racing/LaunchControl'
import { RaceCallouts } from '../racing/RaceCallouts'
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
import { resolveVehicleConfig, type VehicleConfig, type WheelId } from '../vehicles/VehicleConfig'
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
import { CloudSave } from '../cloud/CloudSave'

const TELEMETRY_HZ = 20
/** Opacity of a tag sitting behind a nearer car's tag. */
const CROWDED_TAG_OPACITY = 0.3

/** A rival tag plus how visible the engine wants it this frame, before smoothing. */
interface StackedTag extends RivalTag {
  target: number
}
// Handbrake, not brake: brake at standstill would engage reverse.
export type ShowroomFocus = 'car' | 'wheel' | `wheel-${WheelId}` | 'plate-front' | 'plate-rear' | 'spoiler'

/** How long the PERFECT / GOOD launch call stays up, seconds. */
const LAUNCH_FLASH_SEC = 1.6
const LOCKED_INPUT: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: true, nitro: false }
/** Past the flag: brake to a stop in a straight line while the rivals finish. */
const FINISH_COAST_INPUT: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false }
const FINISH_GENTLE_INPUT: InputState = { throttle: 0, brake: .18, steer: 0, handbrake: false, nitro: false }
/** The scripted finish slide: handbrake on, so the rear lets go and the tyres smoke as it swings round. */
const FINISH_SLIDE_INPUT: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: true, nitro: false }
const FINISH_BRAKE_INPUT: InputState = { throttle: 0, brake: 1, steer: 0, handbrake: false, nitro: false }
const FINISHED_INPUT: InputState = { throttle: 0, brake: 0.5, steer: 0, handbrake: false, nitro: false }
const _velocity = new THREE.Vector3()
const _forward = new THREE.Vector3()
/** A rival's backfire, copied out for its exhaust flames (no per-frame allocation). */
const _rivalPop: ExhaustPop = { flash: 0, kind: 0, strength: 0, count: 0 }
const _listenerPosition = new THREE.Vector3()
const _listenerRight = new THREE.Vector3()
const _rivalOffset = new THREE.Vector3()
const newAwarenessCar=():AwarenessCar=>({id:0,x:0,y:0,z:0,fx:0,fz:1,vx:0,vz:0,halfWidth:1,halfLength:2.2,route:0})
const _listenerUp = new THREE.Vector3()
const _listenerBack = new THREE.Vector3()
const _relativeVelocity = new THREE.Vector3()
const _finishRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
const _sparkPoint = new THREE.Vector3()
const _sparkNormal = new THREE.Vector3()
const _sparkOrigin = new THREE.Vector3()
const _sparkQuat = new THREE.Quaternion()
/** Chassis contacts closer than this (m; negative = penetrating) are touching, not just predicted. */
const SPARK_CONTACT_DIST = 0.02

interface CarHits {
  car: number
  wall: number
  ground: number
  /** Pressed against a wall at some point since the last audio frame (the scrape). */
  touching: boolean
}

/** A car's tyres and brakes for the sound model: only wheels on pavement squeal. */
function readTyres(ctrl: Vehicle['controller'], out: TyreBrakeInput): TyreBrakeInput {
  let slip = 0, slide = 0, paved = 0, grounded = 0, kerb = 0
  for (const w of ctrl.wheels) {
    if (!w.grounded) continue
    grounded++
    if (w.surface === Surface.Kerb) kerb++
    if (w.surface !== Surface.Asphalt && w.surface !== Surface.Kerb) continue
    paved++
    slip = Math.max(slip, w.slip)
    slide = Math.max(slide, w.slide)
  }
  out.speed = Math.abs(ctrl.forwardSpeed)
  out.brake = ctrl.braking
  out.slip = slip
  out.slide = slide
  out.paved = grounded ? paved / grounded : 0
  out.drifting = ctrl.drift.active
  out.kerb = ctrl.wheels.length ? kerb / ctrl.wheels.length : 0
  return out
}
/** Seconds of driving against the race direction before the HUD says so. */
const WRONG_WAY_DELAY = 1.2
/** Metres past an uncrossed gate before the HUD says the checkpoint was missed. */
const MISSED_GATE_METRES = 40
/** How long a Time Trial split / lap call stays on screen, ms of session time. */
const TRIAL_SPLIT_SHOW_MS = 3000
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
  private readonly whipStreaks = new WhipStreaks()
  /** Nitro speed streaks bursting out of the frame (behind the Speed Lines setting). */
  private readonly nitroRush = new NitroRush()
  /** Nitro zoom blur strength, eased (effects/BoostBlur.ts). */
  private boostBlur = 0
  private readonly renderer: Renderer
  private readonly assets = new AssetManager()
  private readonly input = new InputManager()
  private readonly audio = new AudioManager()
  /** Player account and cloud save (docs/ACCOUNTS.md). */
  private readonly cloud = new CloudSave()
  /** Reused every frame for the audio update. */
  private readonly soundState: CarSoundState = { rpm: 0, throttle: 0, gear: 1, nitro: 0, nitroActive: false, nitroPerfect: false }
  private readonly tyreSound: TyreBrakeInput = { speed: 0, brake: 0, slip: 0, slide: 0, paved: 0, drifting: false, kerb: 0 }
  /** Per car (0 = player, 1.. = rivals): the hardest hit of each kind since the last audio frame, as a change in speed, m/s. */
  private readonly carHits: CarHits[] = []
  private readonly rivalTyreSound: TyreBrakeInput = { speed: 0, brake: 0, slip: 0, slide: 0, paved: 0, drifting: false, kerb: 0 }
  private readonly rivalSound: Omit<RivalSoundState, 'tyres'> = { rpm: 0, throttle: 0, x: 0, y: 0, z: 0, recession: 0, passSpeed: 0, active: false }
  private readonly loop: GameLoop
  private physics!: PhysicsWorld
  private track!: RaceTrack
  private environment!: Environment
  private vehicle!: Vehicle
  private blurCamera = ''
  private blurLookBack = false
  private camera!: ChaseCamera
  private driftZones?: DriftZones
  /** Time Trial (#31): checkpoint arches, splits and personal bests. */
  private checkpointGates?: CheckpointGates
  private readonly trial = new TimeTrialSession()
  /** Circuit, car and build the session's personal best is stored under. */
  private trialRecord = { track: '', car: '', build: '' }
  /** Session clock (race totalMs) at the last split, for the HUD flash. */
  private trialSplitAtMs = -Infinity
  private trialEnded = false
  private driftPersonalBest = 0
  private driftNewBest = false
  private driftLastX = 0
  private driftLastZ = 0
  private readonly driftChallenge = new DriftChallenge()
  private race!: RaceManager
  private opponents: Opponent[] = []
  /** Frames until the cars' reflection maps are re-checked (new cars, livery swaps, time of day). */
  private carReflectionsIn = 0
  private readonly opponentFlames = new Map<number, NitroFlames>()
  private opponentToken = 0
  private roadEdges!: { left: Float32Array; right: Float32Array }
  private standings!: RaceStandings
  private readonly recovery = new RecoveryMonitor()
  private safetyWalls: RAPIER.RigidBody | null = null
  private readonly recoverSpawn = (entry: RaceEntry): SpawnPoint => this.recoverySpawn(entry)
  private readonly playerPose: TrafficCar = { id: 0, x: 0, z: 0, heading: 0, speed: 0 }
  private readonly finish = new FinishSequence()
  private readonly finishCamera: RaceFinishCamera
  private finishPosition = 1
  private finishFieldSize = 1
  /** The finish slide: which way (+1 the car's left), its heading at the line and the speed braking began from. */
  private finishSide: 1 | -1 = 1
  private readonly finishTravel = new THREE.Vector3()
  private finishBrakeFrom: number | null = null
  private lastFinishShot: FinishShot | null = null
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
  private spoiler!: CarSpoiler
  private showroom!: Showroom
  private effects!: DrivingEffects
  /** Wall-scrape, crash and bottoming-out sparks for every car (#52). Built in init(), once the renderer is known. */
  private sparks!: Sparks
  /** Exhaust heat haze for every car (#56). Built in init(), once the renderer is known. */
  private haze!: HeatHaze
  private readonly hazeCars: Vehicle[] = []
  /** Rain (#53): streaks around the camera, spray off every car, drops on the lens in cockpit view. Built in init(). */
  private rainSurface!: RainSurface
  private carRain!: CarRain
  private rainImpacts!: RainImpacts
  private wetRoads!: WetRoads
  private wetReflections!: WetReflections
  private rain!: Rain
  private rainSpray!: RainSpray
  private lensDrops!: LensDrops
  /** `?bench=1`: autopiloted WebGL vs WebGPU frame-time comparison (#50). */
  private benchmark: Benchmark | null = null
  private readonly sparkContact: SparkContact = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, vx: 0, vy: 0, vz: 0, dv: 0, groundY: 0 }
  /** Change in speed per car from contact forces this tick (the spark burst size). */
  private readonly tickHit = new Float32Array(16)
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
  /** Skill launch at lights-out, graded in fixedUpdate (#91). */
  private readonly launch = new LaunchControl()
  /** Quick Race callouts (#90) and the time gap to the nearest car at the player's finish. */
  private readonly callouts = new RaceCallouts()
  private finishGapMs: number | null = null
  /** Optional braking guide on the road (#93), rebuilt when the car, build, weather or track changes. */
  private drivingLine?: DrivingLine
  private brakingGuide: BrakingGuide | null = null
  private brakingGuideFor: { config: unknown; wet: boolean; line: unknown } = { config: null, wet: false, line: null }
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
  private wheelFocusId: WheelId = 'FL'
  private wheelYaw = 0
  private readonly carFraming: ShowroomFraming = { focus: new THREE.Vector3(0, 0.55, 0), distance: SHOWROOM_DISTANCE, height: 1.5, shift: 0, fov: SHOWROOM_FOV }
  private readonly plateFraming: ShowroomFraming = { focus: new THREE.Vector3(), distance: 2.1, height: .18, shift: .45, fov: 34 }
  private readonly spoilerFraming: ShowroomFraming = { focus: new THREE.Vector3(), distance: 3.5, height: .9, shift: .65, fov: 42 }
  private readonly wheelFraming: ShowroomFraming = { focus: new THREE.Vector3(), distance: 2.9, height: 0.45, shift: 0.55, fov: 38 }

  private standingsPublishedAt = -Infinity
  private telemetryTimer = 0
  private readonly awareness=new ProximityRadar()
  private awarenessRoute:AwarenessRoute|null=null
  private readonly awarenessPlayer=newAwarenessCar()
  private awarenessCars:AwarenessCar[]=[]
  private awarenessFrame=0
  private readonly awarenessRay=new RAPIER.Ray({x:0,y:0,z:0},{x:0,y:0,z:1})
  private readonly awarenessConnected=(a:AwarenessCar,b:AwarenessCar):boolean=>clearProximityLine(this.physics.world,this.awarenessRay,a,b)
  private fpsFrames = 0
  private fpsTimer = 0
  private fps = 0
  private disposed = false
  private readonly unsubscribe: () => void
  private readonly unsubscribeLobby: () => void
  private onlineScene: OnlineRaceScene | null = null
  private onlineRaceId: string | null = null
  private onlineConnectionEpoch = 0
  private onlineToken = 0
  private onlinePreparing: Promise<void> | null = null
  private onlineEnding = false
  private onlineOriginalBuild: CarBuild | null = null

  constructor(container: HTMLElement) {
    this.renderer = new Renderer(container, gameStore.getState().settings.renderer)
    this.introCamera = new RaceIntroCamera(this.renderer.camera)
    NitroFlames.camera = this.renderer.camera
    this.renderer.scene.add(this.whipStreaks.mesh)
    this.renderer.scene.add(this.nitroRush.mesh)
    this.finishCamera = new RaceFinishCamera(this.renderer.camera)
    this.loop = new GameLoop({
      fixedUpdate: (dt) => this.fixedUpdate(dt),
      render: (alpha, dt) => this.renderFrame(alpha, dt),
    })
    performanceCapture.setContext(() => ({ phase: gameStore.getState().phase, settings: gameStore.getState().settings }))
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    this.audio.onMenuMusicState = (playing) => {
      if (gameStore.getState().musicPlaying !== playing) gameStore.setState({ musicPlaying: playing })
    }
    this.audio.onRaceMusicTrack = (track) => {
      const raceTrack = track && { title: track.title, artist: track.artist, license: track.license }
      if (gameStore.getState().raceTrack?.title !== raceTrack?.title) gameStore.setState({ raceTrack })
    }
    this.unsubscribe = gameStore.subscribe((s, prev) => {
      if (!this.onlineRaceId && !this.onlineEnding) {
        if (s.settings.car !== prev.settings.car && this.vehicle) void this.switchCar(s.settings.car)
        if (s.settings.track !== prev.settings.track && this.track) void this.switchTrack(s.settings.track)
        else if (s.settings !== prev.settings) this.applySettings(s.settings)
        // A car switch swaps in that car's build too; installCar applies it to the new car.
        if (s.build !== prev.build && s.settings.car === prev.settings.car) this.applyBuild(s.build, prev.build)
      }
      if (s.phase !== prev.phase) {
        this.clearAwareness()
        this.updateShowroom(s.phase)
        performanceCapture.event('phase', 0, { phase: s.phase, settings: s.settings })
      }
      if(s.settings.proximityRadar!==prev.settings.proximityRadar||s.settings.spotterVisual!==prev.settings.spotterVisual||s.settings.spotterAudio!==prev.settings.spotterAudio)this.clearAwareness()
    })
    this.unsubscribeLobby = lobbyStore.subscribe(() => this.syncOnlineLobby())
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
    // WebGPU: device + node module. Before anything builds materials (they pick by backend).
    await this.renderer.init()
    if (this.disposed) return
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
    this.environment.setRain(settings.weather === 'rain')
    this.environment.setTimeOfDay(settings.timeOfDay)
    scene.add(this.environment.group)
    this.environment.apply(scene)

    this.track = await this.loadTrackCore(settings.track)
    if (this.disposed) return
    scene.add(this.track.group)
    performance.measure('boot:track', 'boot:start')
    progress(0.3)

    const { config: base, model } = await carLoad
    if (this.disposed) { model.cockpit?.dispose(); return }
    performance.measure('boot:car', 'boot:start')
    progress(0.6)
    const entry = getCar(carId)
    this.carId = entry.id
    this.audio.setCarAudio(entry.audioUrl, entry.firingPerRev, entry.noise, entry.voice)
    const build = gameStore.getState().build
    this.baseConfig = base
    gameStore.setState({ carName: base.name })
    const config = applyCarBuild(base, build)
    this.vehicle = new Vehicle(config, model, this.physics.world, this.track.spawn)
    this.vehicle.controller.surfaceAt = (x, z) => this.track.surfaceAt(x, z)
    this.livery = new CarLivery(model)
    this.livery.apply(build)
    this.spoiler = new CarSpoiler(model, this.assets, (spoilerLoading,spoilerError)=>gameStore.setState({spoilerLoading,spoilerError}))
    void this.spoiler.apply(build)
    scene.add(model.root)
    this.headlights = new Headlights(model, config)
    this.effects = new DrivingEffects(this.vehicle)
    this.effects.setQuality(gameStore.getState().settings.quality)
    scene.add(this.effects.group)
    this.sparks = new Sparks()
    scene.add(this.sparks.mesh)
    this.haze = new HeatHaze()
    this.renderer.setHaze(this.haze)
    this.rainSurface = new RainSurface()
    this.rainImpacts = new RainImpacts(this.rainSurface.uniforms)
    this.wetReflections = new WetReflections()
    this.wetReflections.setQuality(settings.quality)
    this.wetRoads = new WetRoads(this.rainSurface.uniforms, this.wetReflections.uniforms)
    scene.add(this.rainImpacts.mesh)
    this.rainSurface.setQuality(settings.quality)
    this.rainImpacts.setQuality(settings.quality)
    this.carRain = new CarRain(model, this.rainSurface.uniforms)
    this.carRain.setQuality(settings.quality)
    scene.add(this.carRain.impacts.mesh)
    this.rain = new Rain(this.rainSurface.uniforms)
    scene.add(this.rain.mesh)
    this.rainSpray = new RainSpray()
    scene.add(...this.rainSpray.meshes)
    // Lens drops refract through the haze buffer: they live in its scene.
    this.lensDrops = new LensDrops()
    this.haze.scene.add(this.lensDrops.mesh)

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
    if (!document.hidden) this.loop.start()
    setPhase('menu')
    this.syncOnlineLobby()
    if (new URLSearchParams(location.search).get('bench') === '1') this.startBenchmark()
    performance.measure('boot:menu', 'boot:start')
    if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = this

    const bootToken = this.trackLoadToken
    // Behind the menu: the track's visuals first (Race needs them), then the
    // sharp garage textures. Other cars load only when selected or used as rivals.
    void this.loadTrackVisuals()
      .then(async () => {
        if (this.disposed || this.trackLoadToken !== bootToken) return
        performance.measure('boot:trackVisuals', 'boot:start')
        await this.showroom.upgrade(this.assets)
        performance.measure('boot:garageHigh', 'boot:start')
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
  debugStep(frames = 60): { msPerFrame: number; calls: number; triangles: number; pixelRatio: number; backend: string; track: unknown; car: number[] } {
    // WebGL: read a pixel to wait for the GPU. WebGPU timing is CPU submit time only.
    const gl = backend.kind === 'webgl' ? (this.renderer.renderer as THREE.WebGLRenderer).getContext() : null
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
      gl?.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px) // wait for the GPU
    }
    info.autoReset = true
    const p = this.vehicle.position
    return {
      msPerFrame: (performance.now() - t0) / frames,
      calls: this.renderer.drawCalls,
      triangles: info.render.triangles,
      pixelRatio: this.renderer.pixelRatio,
      backend: this.renderer.backendName,
      track: (this.track as Partial<StreamedTrack>).stats,
      car: [p.x, p.y, p.z].map((v) => Math.round(v)),
    }
  }

  /** Dev-only: hold inputs for debugStep runs. */
  debugInput(state: Partial<InputState>): void {
    this.input.setTouch(state)
  }

  /** Development fixture only: prime ordered gates, then physically drive over the finish. */
  debugFinishRace(): void {
    if (!import.meta.env.DEV || gameStore.getState().phase !== 'racing') return
    this.race.totalLaps = this.race.lap
    for (let i = this.race.lastCheckpoint + 1; i < this.track.checkpoints.length; i++) {
      const gate = this.track.checkpoints[i]
      this.racePosition.copy(gate.position).addScaledVector(gate.tangent, -2)
      this.race.update(1, this.racePosition)
      this.racePosition.copy(gate.position).addScaledVector(gate.tangent, 2)
      this.race.update(1 / 60, this.racePosition)
    }
    const gate = this.track.checkpoints[0]
    const heading = Math.atan2(gate.tangent.x, gate.tangent.z)
    this.racePosition.copy(gate.position).addScaledVector(gate.tangent, -3)
    this.racePosition.y += .6
    this.vehicle.respawn({ position: this.racePosition, heading })
    this.race.update(1 / 60, this.racePosition)
    this.vehicle.body.setLinvel({ x: gate.tangent.x * 34, y: 0, z: gate.tangent.z * 34 }, true)
    this.progress.reset()
    this.camera.snap()
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
      onLap: (_lap, timeMs) => {
        if (gameStore.getState().settings.mode === 'timeTrial') this.completeTrialLap(timeMs)
        this.publishTelemetry()
      },
      onCheckpoint: (index, lapMs) => {
        if (gameStore.getState().settings.mode !== 'timeTrial') return
        const delta = this.trial.checkpoint(index, lapMs)
        this.trialSplitAtMs = this.race.timer.totalMs
        this.audio.playDriftCue(delta !== null && delta > 0 ? 'bust' : 'link')
      },
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
    this.checkpointGates?.dispose()
    this.checkpointGates = new CheckpointGates(this.track.checkpoints.map((cp) => {
      const line = this.track.line, n = line.length
      let i = 0, best = Infinity
      for (let k = 0; k < n; k++) {
        const d = (line[k].x - cp.position.x) ** 2 + (line[k].z - cp.position.z) ** 2
        if (d < best) { best = d; i = k }
      }
      const a = line[(i - 1 + n) % n], b = line[(i + 1) % n]
      return { index: cp.index, position: line[i].clone(), heading: Math.atan2(b.x - a.x, b.z - a.z), left: edges.left[i], right: edges.right[i] }
    }))
    this.renderer.scene.add(this.checkpointGates.group)
    this.standingsPublishedAt = -Infinity
    this.standings = new RaceStandings(this.track.line, this.track.checkpoints)
    const track = this.track
    this.guide = new DirectionGuide(this.track.line, edges, {
      // Road colliders only: the terrain mesh is simplified to ~1.5 m and can sit
      // above the asphalt, which left arrows hovering in the air.
      roadHeight: (x, y, z) => this.physics.groundHeight(x, y, z, (c) => track.isRoadCollider(c)),
      groundHeight: (x, y, z) => this.physics.groundHeight(x, y, z),
      paved: (x, z) => {
        const s = track.surfaceAt(x, z)
        return s === Surface.Asphalt || s === Surface.Kerb
      },
    })
    this.progress = new TrackProgress(this.track.line)
    this.awarenessRoute=new AwarenessRoute(this.track.line)
    this.renderer.scene.add(this.guide.group)
    this.drivingLine?.dispose()
    this.drivingLine = new DrivingLine(this.track.line, (x, y, z) => this.physics.groundHeight(x, y, z, (c) => track.isRoadCollider(c)))
    this.drivingLine.setQuality(gameStore.getState().settings.quality)
    this.renderer.scene.add(this.drivingLine.mesh)
    this.brakingGuide = null
    const line = this.track.line
    // Every point: the minimap is zoomed in and highlights the route from the car's index.
    gameStore.setState({
      minimap: {
        overview: this.track.mapOverview?.() ?? null,
        points: line.map((p) => [p.x, p.z]),
        gates: this.track.checkpoints.map((c) => [c.position.x, c.position.z]),
      },
    })
  }

  /** Invisible walls where the track's collision floor ends, so a car can't drop off the world (see SafetyWalls). */
  private buildSafetyWalls(): void {
    this.removeSafetyWalls()
    const walls = planSafetyWalls(this.track.line, (x, y, z) => this.physics.floorHeight(x, y, z))
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
    this.sparks.clear()
    this.rainSpray?.clear()
    this.lensDrops?.clear()
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
    if (!document.hidden) this.loop.start()
  }

  /** Loads the GLB + config from the pipeline, falling back to the placeholder car. */
  private async loadCar(carId: string) {
    const entry = getCar(carId)
    // Config and geometry are independent downloads: start both immediately.
    const low = gameStore.getState().settings.quality === 'low' && entry.modelUrlLow
    const url = low ? entry.modelUrlLow! : entry.modelUrl
    const [json, loaded] = await Promise.all([
      this.assets.loadJson<Partial<VehicleConfig>>(entry.configUrl),
      this.assets.loadModel(url).catch((err: unknown) => {
        console.warn(`[Game] failed to load ${url}, using placeholder`, err)
        return null
      }),
    ])
    const config = resolveVehicleConfig(json ?? undefined)
    let scene = loaded
    scene ??= buildPlaceholderCar(config)
    const model = rigCarModel(scene, config)
    model.cockpit = new CockpitRig(model)
    return { config, model }
  }

  // ── Commands (called by React) ─────────────────────────────────────────

  startRace(): void {
    if (this.onlineRaceId || this.onlineEnding) return
    if (lobbyStore.getState().status === 'connected') void leaveLobby()
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
    this.clearAwareness()
    this.awarenessCars=[]
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
    this.standingsPublishedAt = -Infinity
  }

  private async launchRace(): Promise<void> {
    this.clearOpponents()
    if (!this.safetyWalls) this.buildSafetyWalls()
    const token = this.opponentToken
    const { settings } = gameStore.getState()
    const opponentCount = isSoloMode(settings.mode) ? 0 : settings.opponents
    this.callouts.reset()
    this.finishGapMs = null
    this.trialEnded = false
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
      this.sparks.clear()
      this.rainSpray?.clear()
      this.lensDrops?.clear()
      this.standings?.reset()
      this.playerEntry.finishMs = null
      this.playerEntry.lap = 0
      this.playerEntry.checkpoint = 0
      this.playerEntry.index = 0
      const grid = startingGrid(this.track.line,this.track.spawn.position,opponentCount+1,this.roadEdges)
      const playerSlot = grid[grid.length-1]
      const position = new THREE.Vector3(playerSlot.x,playerSlot.y+0.6,playerSlot.z)
      const road = this.physics.floorHeight(position.x,position.y,position.z,c=>this.track.isRoadCollider(c))
      if (road !== null) position.y = road+0.6
      this.vehicle.respawn({position,heading:playerSlot.heading})
      this.driftLastX=position.x;this.driftLastZ=position.z
      this.progress.reset(); this.progress.update(position.x,position.z)
      this.camera.snap()
      this.playerEntry.x = position.x; this.playerEntry.z = position.z
      for (let id = 1; id <= opponentCount; id++) {
        const slot = grid[id-1]
        const position = new THREE.Vector3(slot.x,slot.y+0.6,slot.z)
        const ground = this.physics.floorHeight(position.x,position.y,position.z,c=>this.track.isRoadCollider(c))
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
      this.awarenessCars=this.opponents.map(o=>{const car=newAwarenessCar();car.id=o.id;return car})
      this.audio.setOpponentCars(rivals)
      this.audio.playStart()
      this.prepareRaceIntro()
      if (settings.mode === 'freeRoam') {
        // No intro, lights or laps: straight out onto the circuit.
        this.race.startFreeRoam()
        this.camera.snap()
      } else if (settings.mode === 'timeTrial') {
        // Straight to the lights (a quick restart shouldn't sit through the cinematic), then laps until you leave.
        const build = gameStore.getState().build
        this.trialRecord = { track: settings.track, car: this.carId, build: trialBuildKey(build) }
        this.trial.start(readTrialRecord(this.trialRecord.track, this.trialRecord.car, this.trialRecord.build))
        this.trialSplitAtMs = -Infinity
        this.race.timer.bestLapMs = null
        this.race.start(Infinity, 0)
      } else {
        this.race.start(settings.mode === 'drift' ? driftEvent(settings.driftEvent).laps : settings.laps,RACE_INTRO_SECONDS)
      }
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
    this.finish.reset(); this.loop.timeScale = 1; this.audio.setFinishMix(false)
    this.playerRevs.reset(this.vehicle.config.engine.idleRpm)
    this.launch.setConfig(this.vehicle.config.launch)
    this.launch.reset()
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
    if (this.showroomFocus !== 'car') {
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
    if (this.showroomFocus !== 'car') return
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

  /** Garage detail tabs glide to the selected part using the same camera damping. */
  setShowroomFocus(focus: ShowroomFocus): void {
    if (focus === this.showroomFocus) return
    this.showroomFocus = focus
    if (focus.startsWith('wheel-')) this.wheelFocusId = focus.slice(6) as WheelId
    else if (focus === 'wheel') this.wheelFocusId = 'FL'
    this.orbitVelocity = 0
    this.orbitCoasting = false
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

  /** Account dialog: redirects to Google and back. */
  signInWithGoogle(): Promise<void> {
    return this.cloud.signInWithGoogle()
  }

  /** Account dialog: emails a one-time sign-in link. */
  sendSignInLink(email: string): Promise<void> {
    return this.cloud.sendSignInLink(email)
  }

  saveRacerProfile(handle: string, displayName: string): Promise<void> {
    return this.cloud.saveRacerProfile(handle, displayName)
  }

  multiplayerToken(): Promise<string | null> {
    return this.cloud.multiplayerToken()
  }

  loadPracticeHistory(more = false): Promise<void> { return this.cloud.loadPracticeHistory(more) }

  loadRacerProfile(): Promise<void> {
    return this.cloud.loadProfile()
  }

  signOut(): Promise<void> {
    return this.cloud.signOut()
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
    if (token !== this.carSwapToken || this.disposed) { model.cockpit?.dispose(); return }
    this.installCar(entry, config, model)
    if (showroom) await new Promise<void>((done) => (this.showroomDrive = { mode: 'in', t: 0, spin: 0, done }))
    if (token !== this.carSwapToken) return
    gameStore.setState({ carSwitching: false })
  }

  /** Swap the player car for a freshly loaded one, rebuilding everything tied to it. */
  private installCar(entry: CarEntry, base: VehicleConfig, model: CarModel): void {
    this.clearAwareness()
    const scene = this.renderer.scene
    const old = this.vehicle
    this.carRain.dispose()
    this.effects.dispose()
    this.headlights.dispose()
    this.spoiler.dispose()
    this.livery.dispose()
    old.model.cockpit?.dispose()
    old.disposeMaterials()
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
    this.spoiler = new CarSpoiler(model, this.assets, (spoilerLoading,spoilerError)=>gameStore.setState({spoilerLoading,spoilerError}))
    void this.spoiler.apply(build)
    scene.add(model.root)
    this.carRain = new CarRain(model, this.rainSurface.uniforms)
    this.carRain.setQuality(gameStore.getState().settings.quality)
    scene.add(this.carRain.impacts.mesh)
    this.headlights = new Headlights(model, config)
    this.headlights.setOn(this.environment.current.headlights)
    this.effects = new DrivingEffects(this.vehicle)
    this.effects.setQuality(gameStore.getState().settings.quality)
    scene.add(this.effects.group)
    const phase = gameStore.getState().phase
    const inShowroom = phase === 'menu' || phase === 'garage'
    this.effects.group.visible = !inShowroom
    if (inShowroom) this.setShowroomPad(true)
    this.audio.setCarAudio(entry.audioUrl, entry.firingPerRev, entry.noise, entry.voice)
    gameStore.setState({ carName: base.name })
    telemetryStore.setState({ redlineRpm: config.engine.redlineRpm })
    this.camera.cockpitCar = entry.id
    this.camera.cockpitAdjustment = gameStore.getState().settings.cockpits[entry.id] ?? DEFAULT_COCKPIT_ADJUSTMENT
    this.camera.snap()
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

  skipRaceFinish(): void {
    if (gameStore.getState().phase !== 'finished') return
    this.finish.skip(); this.loop.timeScale = 1
    this.publishTelemetry()
  }

  skipRaceIntro(): void {
    if (gameStore.getState().phase !== 'intro') return
    for (const opponent of this.opponents) opponent.race.skipIntro()
    this.race.skipIntro()
    this.camera.snap()
    this.publishTelemetry()
  }

  /** A hidden race stays paused on return; the player explicitly resumes it. */
  private onVisibilityChange = (): void => {
    if (this.disposed || !this.race) return
    if (this.onlineRaceId || this.onlineEnding) {
      this.input.setTouch(RELEASED_ONLINE_INPUT)
      if (document.hidden) {
        sendRaceInput(RELEASED_ONLINE_INPUT)
        this.audio.suspend(); this.loop.stop()
      } else {
        this.onlineScene?.buffer.resync()
        this.audio.resume(); this.loop.start()
      }
      return
    }
    if (document.hidden) {
      const phase = gameStore.getState().phase
      if (phase === 'racing' || phase === 'countdown' || phase === 'intro') this.togglePause()
      this.audio.suspend()
      this.loop.stop()
    } else {
      this.loop.start()
      if (gameStore.getState().phase !== 'paused') this.audio.resume()
    }
  }

  togglePause(): void {
    if (this.onlineRaceId) { onlineRaceStore.setState(s => ({ menuOpen: !s.menuOpen })); return }
    const { phase, setPhase } = gameStore.getState()
    if (phase === 'paused') {
      setPhase(this.race.state === 'intro' ? 'intro' : this.race.state === 'countdown' ? 'countdown' : 'racing')
      this.audio.resume()
    } else if (phase === 'racing' || phase === 'countdown' || phase === 'intro') {
      setPhase('paused')
      this.launch.interrupt()
      this.audio.suspend()
    }
  }

  quitToMenu(): void {
    if (this.onlineRaceId) { void leaveLobby(); return }
    this.finish.reset(); this.loop.timeScale = 1; this.audio.setFinishMix(false)
    this.clearOpponents()
    this.race.state = 'idle'
    // Back in the garage: room tone on, engine quiet (updateShowroom sets the scene).
    this.audio.resume()
    this.resetCar()
    this.effects.clear()
    this.sparks.clear()
    this.rainSpray?.clear()
    this.lensDrops?.clear()
    gameStore.getState().setPhase('menu')
  }

  resetCar(): void {
    this.clearAwareness()
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
    this.clearAwareness()
    this.driftChallenge.bust()
    this.trial.invalidate('reset')
    this.callouts.quiet(this.race.timer.totalMs)
    this.playerEntry.checkpoint = this.race.lastCheckpoint
    this.playerEntry.index = this.progress.index
    // Free Roam goes anywhere, so put the car on the nearest gate rather than the last one passed.
    const spawn = this.race.freeRoam ? this.track.respawnAt(this.nearestCheckpoint()) : this.recoverySpawn(this.playerEntry)
    this.vehicle.respawn(spawn)
    this.camera.snap()
    this.recovery.reset()
    this.driftLastX=spawn.position.x; this.driftLastZ=spawn.position.z
    this.progress.reset()
    this.progress.update(spawn.position.x, spawn.position.z)
  }

  /** Online presentation has its own commands/clock; offline race rules never run here. */
  private syncOnlineLobby(): void {
    if (this.disposed || !this.vehicle || !this.track) return
    const { snapshot, sessionId, raceSnapshot, connectionEpoch } = lobbyStore.getState()
    if (!snapshot?.race || snapshot.phase === 'lobby') {
      if (this.onlineRaceId) this.endOnlineRace()
      return
    }
    if (this.onlineEnding) return
    if (snapshot.race.id === this.onlineRaceId) {
      if (this.onlineConnectionEpoch !== connectionEpoch) {
        this.onlineConnectionEpoch = connectionEpoch
        this.onlineScene?.buffer.resync()
        if (this.onlineScene && snapshot.phase === 'loading') acknowledgeRaceLoaded(snapshot.race)
      }
      if (raceSnapshot) this.onlineScene?.push(raceSnapshot, performance.now())
      return
    }
    // A rematch is a new lifecycle: dispose the previous scene before loading it.
    if (this.onlineRaceId) { this.endOnlineRace(); return }
    const self = snapshot.racers.find(r => r.sessionId === sessionId)
    if (!self || gameStore.getState().carSwitching || gameStore.getState().trackSwitching || !['menu', 'garage'].includes(gameStore.getState().phase)) {
      void leaveLobby()
      return
    }
    const token = ++this.onlineToken
    this.onlineRaceId = snapshot.race.id
    this.onlineConnectionEpoch = connectionEpoch
    this.onlineOriginalBuild = gameStore.getState().build
    this.input.setTouch(RELEASED_ONLINE_INPUT)
    onlineRaceStore.setState({ resultsOpen: false, finished: false, active: true, loaded: false, menuOpen: false, delayed: false, speedKmh: 0, countdown: null })
    gameStore.getState().setPhase('online')
    this.onlinePreparing = (async () => {
      if (this.track.id !== snapshot.track) await this.switchTrack(snapshot.track)
      if (this.disposed || token !== this.onlineToken) return
      await this.loadTrackVisuals()
      if (this.disposed || token !== this.onlineToken) return
      this.environment.setRain(false)
      this.environment.setTimeOfDay('noon')
      this.environment.apply(this.renderer.scene)
      const scene = await OnlineRaceScene.load({ renderer: this.renderer, assets: this.assets, environment: this.environment,
        track: this.track, audio: this.audio, settings: gameStore.getState().settings }, snapshot, self.id)
      if (this.disposed || token !== this.onlineToken) { scene.dispose(); return }
      this.onlineScene = scene
      const frame = lobbyStore.getState().raceSnapshot
      if (frame) scene.push(frame, performance.now())
      acknowledgeRaceLoaded(snapshot.race!)
    })().catch((error: unknown) => {
      if (this.disposed || token !== this.onlineToken) return
      lobbyStore.setState({ error: error instanceof Error ? error.message : 'The online grid could not load. Rejoin to try again.' })
      void leaveLobby()
    })
  }

  private endOnlineRace(): void {
    ++this.onlineToken
    this.onlineRaceId = null
    this.onlineEnding = true
    onlineRaceStore.setState({ loaded: false, menuOpen: false, delayed: false })
    this.input.setTouch(RELEASED_ONLINE_INPUT)
    void (this.onlinePreparing ?? Promise.resolve()).then(async () => {
      if (this.disposed) return
      this.onlineScene?.dispose()
      this.onlineScene = null
      const settings = gameStore.getState().settings
      if (this.track.id !== settings.track) await this.switchTrack(settings.track)
      if (this.disposed) return
      if (this.carId !== settings.car) await this.switchCar(settings.car)
      else if (this.onlineOriginalBuild && this.onlineOriginalBuild !== gameStore.getState().build) this.applyBuild(gameStore.getState().build, this.onlineOriginalBuild)
      this.onlineOriginalBuild = null
      if (this.disposed) return
      this.renderer.setHaze(this.haze)
      this.applySettings(settings)
      const entry = getCar(this.carId)
      this.audio.setCarAudio(entry.audioUrl, entry.firingPerRev, entry.noise, entry.voice)
      this.audio.resume()
      this.race.state = 'idle'
      this.resetCar()
      this.onlineEnding = false
      onlineRaceStore.setState({ resultsOpen: false, finished: false, active: false, loaded: false, menuOpen: false })
      gameStore.getState().setPhase('menu')
      this.syncOnlineLobby()
    }).catch((error: unknown) => {
      if (!this.disposed) gameStore.getState().setError(error instanceof Error ? error.message : 'Could not return to the menu.')
    })
  }

  private nearestCheckpoint(): number {
    const p = this.vehicle.body.translation()
    let best = 0, bestD = Infinity
    for (const cp of this.track.checkpoints) {
      const d = (cp.position.x - p.x) ** 2 + (cp.position.z - p.z) ** 2
      if (d < bestD) { bestD = d; best = cp.index }
    }
    return best
  }

  /** Free Roam: back to the start line. */
  resetToStart(): void {
    if (!this.race.freeRoam) return
    this.clearAwareness()
    this.vehicle.respawn(this.track.spawn)
    this.camera.snap()
    this.recovery.reset()
    this.progress.reset()
    this.progress.update(this.track.spawn.position.x, this.track.spawn.position.z)
  }

  /** T / pad Back / pause menu: Time Trial starts a fresh run, Free Roam goes back to the start. */
  restartSession(): void {
    const { phase, settings } = gameStore.getState()
    if (settings.mode === 'freeRoam') {
      if (phase === 'paused') this.togglePause()
      this.resetToStart()
    } else if (phase === 'racing' || phase === 'countdown' || phase === 'paused' || phase === 'finished') {
      this.startRace()
    }
  }

  /** Time Trial: leave the session for its results. */
  endTrialSession(): void {
    if (gameStore.getState().settings.mode !== 'timeTrial' || this.race.state === 'idle' || this.trialEnded) return
    this.trialEnded = true
    this.race.timer.running = false
    // Mark the finish as handled so the line cinematic doesn't start: the car just brakes.
    this.playerEntry.finishMs = this.race.timer.totalMs
    this.race.state = 'finished'
    this.finishPosition = 1
    this.finishFieldSize = 1
    gameStore.getState().setPhase('finished')
    this.audio.resume()
    this.publishTelemetry()
  }

  private completeTrialLap(lapMs: number): void {
    const result = this.trial.completeLap(lapMs)
    this.trialSplitAtMs = this.race.timer.totalMs
    if (result.personalBest && this.trial.personalBest) {
      const r = this.trialRecord
      saveTrialRecord(r.track, r.car, r.build, this.trial.personalBest)
    }
    this.audio.playDriftCue(result.valid && result.sessionBest ? 'bank' : result.valid ? 'link' : 'bust')
  }

  /** At the player's finish: time to the nearest car, ms (finished ones by finish time, the rest by distance at the player's speed). */
  private nearestFinishGap(): number | null {
    const mine = this.playerEntry.finishMs
    if (mine === null || this.opponents.length === 0) return null
    const speed = Math.max(5, Math.abs(this.vehicle.controller.forwardSpeed))
    const at = this.standings.distance(this.playerEntry)
    let gap = Infinity
    for (const o of this.opponents) {
      const e = o.entry
      gap = Math.min(gap, e.finishMs !== null ? Math.abs(mine - e.finishMs) : (Math.abs(at - this.standings.distance(e)) / speed) * 1000)
    }
    return Number.isFinite(gap) ? gap : null
  }

  /** Where a car in `entry`'s place goes back on the road: centreline, road height, facing the race direction. */
  private recoverySpawn(entry: RaceEntry): SpawnPoint {
    if (!this.standings) return this.track.respawnAt(entry.checkpoint)
    const line = this.track.line, n = line.length
    const i = this.standings.recoveryIndex(entry)
    const p = line[i], a = line[(i - 1 + n) % n], b = line[(i + 1) % n]
    const road = this.physics.floorHeight(p.x, p.y, p.z, (c) => this.track.isRoadCollider(c))
    return {
      position: new THREE.Vector3(p.x, (road ?? p.y) + 0.8, p.z),
      heading: Math.atan2(b.x - a.x, b.z - a.z),
    }
  }

  /** Drive a race on autopilot and report frame times for this renderer (`?bench=1`). */
  private startBenchmark(): void {
    this.benchmark = new Benchmark({
      racing: () => this.race.state === 'racing',
      position: () => this.vehicle.position,
      quaternion: () => this.vehicle.quaternion,
      speedKmh: () => this.vehicle.speedKmh,
      lineAhead: (ahead) => {
        const line = this.track.line
        return line[(this.progress.index + ahead) % line.length]
      },
      setInput: (state) => this.input.setTouch(state),
      startRace: () => this.startRace(),
      drawCalls: () => this.renderer.frameStats.calls,
      triangles: () => this.renderer.frameStats.triangles,
      environment: () => this.benchmarkEnvironment(),
    })
    this.benchmark.start()
  }

  /** Renderer, GPU, display and settings, so two benchmark runs can be compared. */
  private async benchmarkEnvironment(): Promise<Record<string, unknown>> {
    const { quality, postfx, track, opponents, timeOfDay, renderer } = gameStore.getState().settings
    let gpu: unknown = null
    try {
      if (backend.kind === 'webgpu') {
        const adapter = await (navigator as { gpu?: { requestAdapter(): Promise<{ info?: Record<string, string> } | null> } }).gpu?.requestAdapter()
        gpu = adapter?.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description } : null
      } else {
        const gl = (this.renderer.renderer as THREE.WebGLRenderer).getContext()
        const ext = gl.getExtension('WEBGL_debug_renderer_info')
        gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
      }
    } catch { /* GPU name is optional */ }
    return {
      backend: this.renderer.backendName, gpu, userAgent: navigator.userAgent,
      viewport: [innerWidth, innerHeight], devicePixelRatio, renderPixelRatio: this.renderer.pixelRatio,
      settings: { renderer, quality, postfx, track, opponents, timeOfDay },
    }
  }

  /** Feed from the on-screen touch controls. */
  setTouchInput(state: Partial<InputState>): void {
    this.input.setTouch(state)
  }

  /** Touch buttons for actions the keyboard maps to keys. */
  triggerAction(action: 'pause' | 'reset' | 'camera' | 'shiftUp' | 'shiftDown'): void {
    this.input.trigger(action)
  }

  // ── Loop ───────────────────────────────────────────────────────────────

  private fixedUpdate(dt: number): void {
    if (this.onlineRaceId || this.onlineEnding) {
      this.input.poll(onlineRaceStore.getState().menuOpen || onlineRaceStore.getState().resultsOpen)
      if (this.input.consume('pause')) this.togglePause()
      for (const action of ['camera', 'reset', 'restart', 'shiftUp', 'shiftDown', 'skip'] as const) this.input.consume(action)
      const active = this.onlineScene && !onlineRaceStore.getState().finished && !onlineRaceStore.getState().menuOpen && !document.hidden && !this.onlineScene.buffer.delayed(performance.now())
      sendRaceInput(active ? this.input.state : RELEASED_ONLINE_INPUT)
      return
    }
    const inputPhase = gameStore.getState().phase
    this.input.poll(['menu', 'garage', 'paused', 'finished', 'loading', 'boot'].includes(inputPhase))
    if (this.input.consume('pause')) {
      if (inputPhase === 'finished' && this.finish.active) this.skipRaceFinish()
      else this.togglePause()
    }
    // Camera toggle (C / gamepad Y / touch button) only while driving: a stray
    // key press in a menu used to flip every later race into the cockpit view.
    if (this.input.consume('camera')) {
      const s = gameStore.getState()
      if (s.phase === 'racing' || s.phase === 'countdown') s.updateSettings({ camera: s.settings.camera === 'chase' ? 'cockpit' : 'chase' })
    }

    const skip = this.input.consume('skip')
    if (skip) {
      if (gameStore.getState().phase === 'finished') this.skipRaceFinish()
      else this.skipRaceIntro()
    }
    const phase = gameStore.getState().phase
    if (phase === 'paused') return
    const racing = phase === 'racing' && this.race.state === 'racing'
    if (this.input.consume('reset') && racing) this.resetToCheckpoint()
    if (this.input.consume('restart') && isSoloMode(gameStore.getState().settings.mode) && gameStore.getState().settings.mode !== 'drift' && (phase === 'racing' || phase === 'countdown')) this.restartSession()

    const inMenu = phase === 'menu' || phase === 'garage' || phase === 'loading'
    const controls = this.race.controlsEnabled && !inMenu
    // Manual gearbox: the player's car only (AI keeps its automatic box). Presses
    // outside driving are dropped so a stray key in a menu can't shift later.
    const drivetrain = this.vehicle.controller.drivetrain
    drivetrain.manual = gameStore.getState().settings.transmission === 'manual'
    const up = this.input.consume('shiftUp'), down = this.input.consume('shiftDown')
    if (drivetrain.manual && controls && phase === 'racing') {
      if (up) drivetrain.requestShift(1)
      else if (down) drivetrain.requestShift(-1)
    }
    const p = this.vehicle.body.translation(), q = this.vehicle.body.rotation()
    this.playerPose.x = p.x; this.playerPose.z = p.z
    this.playerPose.heading = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x))
    this.playerPose.speed = this.vehicle.controller.forwardSpeed
    for (const opponent of this.opponents) opponent.readPose()
    this.vehicle.controller.drafting = controls ? draftingStrength(this.playerPose, this.traffic, 0) : 0
    // The finish cinematic scripts the stop (see finishDrive); the reduced-motion
    // version, and the car after the sequence, just brake gently.
    const scripted = phase === 'finished' && this.finish.active && !this.finish.reducedMotion
    if (scripted && this.finishBrakeFrom === null && this.finish.elapsed >= BRAKE_AT) this.finishBrakeFrom = Math.abs(this.vehicle.controller.forwardSpeed)
    const drive = scripted ? finishDrive(this.finish.elapsed, this.finishBrakeFrom ?? Math.abs(this.vehicle.controller.forwardSpeed)) : null
    const finishInput = drive
      ? drive.mode === 'coast' ? FINISH_COAST_INPUT : drive.mode === 'parked' ? LOCKED_INPUT : drive.yawRate > 0 ? FINISH_SLIDE_INPUT : FINISH_BRAKE_INPUT
      : Math.abs(this.vehicle.controller.forwardSpeed) <= 1.2 ? LOCKED_INPUT
      : this.finish.active ? (this.finish.elapsed < 1.5 ? FINISH_COAST_INPUT : FINISH_GENTLE_INPUT) : FINISHED_INPUT
    this.vehicle.controller.launchPush = controls && phase === 'racing' ? this.launch.push : 0
    this.vehicle.fixedUpdate(phase === 'finished' ? finishInput : controls ? this.input.state : LOCKED_INPUT, dt)
    if (drive && drive.mode !== 'coast') this.applyFinishDrive(drive.mode === 'parked' ? 0 : drive.speed, drive.mode === 'parked' ? 0 : drive.yawRate, drive.drift)
    const playerDistance = this.standings.distance(this.playerEntry)
    for (const opponent of this.opponents) {
      const i = opponent.driver.progress.index
      const laneLimit = Math.max(0, Math.min(this.roadEdges.left[i], this.roadEdges.right[i]) - 2)
      const gap = playerDistance - this.standings.distance(opponent.entry)
      if (!inMenu) opponent.drive(dt, this.traffic, gap, laneLimit)
    }
    this.physics.step(dt)
    this.collectHits(dt)
    if (!inMenu) this.exhaustPops()
    this.emitSparks(dt)
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
        // A held burnout is pedals-down and not moving on purpose: not "stuck".
        pedal: this.vehicle.controller.burnout.holding ? 0 : Math.max(input.throttle, input.brake),
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
        grounded:ctrl.wheels.reduce((count, w) => count + (w.grounded ? 1 : 0), 0)>=3,
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
    // Grid revs tick here, not in render, so the launch grade can't depend on frame rate.
    const engine = this.vehicle.config.engine
    if (this.race.state === 'intro' || this.race.state === 'countdown') {
      this.playerRevs.update(dt, engine.idleRpm, engine.redlineRpm, 0, this.race.state === 'countdown' ? this.input.state.throttle : -1)
    }
    this.race.update(dt, this.racePosition)
    const input = this.input.state
    this.launch.update(dt, {
      phase: this.race.state === 'countdown' ? 'staging' : this.race.state === 'racing' ? 'go' : 'other',
      revs: (this.playerRevs.rpm - engine.idleRpm) / (engine.redlineRpm - engine.idleRpm),
      throttle: input.throttle,
      hold: input.handbrake || input.brake > 0.5,
      assist: gameStore.getState().settings.launchAssist,
    })
    this.playerEntry.lap = this.race.lap
    this.playerEntry.checkpoint = this.race.lastCheckpoint
    this.playerEntry.index = this.progress.update(position.x, position.z)
    this.playerEntry.x = position.x
    this.playerEntry.z = position.z
    // Time Trial: driving past a gate without going through it voids the lap.
    if (racing && this.trial.valid && gameStore.getState().settings.mode === 'timeTrial' && this.standings.overrun(this.playerEntry) > MISSED_GATE_METRES) this.trial.invalidate('missed')
    if (this.race.state === 'finished' && this.playerEntry.finishMs === null) {
      this.playerEntry.finishMs = this.race.timer.totalMs
      const standings = this.standings.snapshot(this.entries)
      this.finishPosition = standings.find(row => row.player)?.position ?? 1
      this.finishFieldSize = this.entries.length
      this.finishGapMs = this.nearestFinishGap()
      this.finish.start(matchMedia('(prefers-reduced-motion: reduce)').matches)
      // Slide toward whichever side has more room before a wall (a paved pit
      // lane behind a pit wall reads as wide road, so measure, don't guess).
      this.finishTravel.set(0, 0, 1).applyQuaternion(this.vehicle.model.root.quaternion).setY(0).normalize()
      const roomLeft = this.clearance(1), roomRight = this.clearance(-1)
      this.finishSide = roomLeft >= roomRight ? 1 : -1
      this.finishBrakeFrom = null
      this.lastFinishShot = null
      this.finishCamera.start(this.vehicle.model.root, { side: this.finishSide, speed: Math.abs(this.vehicle.controller.forwardSpeed), room: Math.max(roomLeft, roomRight) })
      this.loop.timeScale = this.finish.timeScale
      this.audio.setFinishMix(true)
      this.audio.playFinish(this.finishPosition === 1 && this.finishFieldSize > 1)
      this.publishTelemetry()
    }
  }

  /** Metres of open space beside the car toward its left (+1) or right (−1), up to 25, at wheel height. */
  private clearance(side: 1 | -1): number {
    const p = this.vehicle.body.translation()
    const dx = this.finishTravel.z * side, dz = -this.finishTravel.x * side
    _finishRay.origin = { x: p.x, y: p.y + 0.4, z: p.z }
    _finishRay.dir = { x: dx, y: 0, z: dz }
    const hit = this.physics.world.castRay(_finishRay, 25, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC)
    return hit ? hit.timeOfImpact : 25
  }

  /**
   * Frames the finish cinematic's current shot (false = the chase camera
   * carries on, at the line itself). After the sequence, or a skip, the last
   * shot keeps following the car behind the results.
   */
  private finishCinematic(): boolean {
    const seconds = this.finish.active ? this.finish.elapsed : FINISH_SECONDS
    const shot = shotAt(seconds).shot
    if (this.finish.active && this.lastFinishShot === 'line' && shot === 'pass') this.audio.playWhoosh(0.18)
    this.lastFinishShot = shot
    return this.finishCamera.update(seconds, this.vehicle.model.root, this.physics.world, !this.finish.active)
  }

  /**
   * Overrides the car's motion for the scripted finish (after the tyre forces,
   * before the physics step): along its heading at the line, turning toward the
   * slide side as it goes, swinging round at `yawRate`. Physics still resolves
   * anything it runs into, and the tyres smoke and squeal because it slides.
   */
  private applyFinishDrive(speed: number, yawRate: number, drift: number): void {
    const body = this.vehicle.body
    const lx = this.finishTravel.z * this.finishSide, lz = -this.finishTravel.x * this.finishSide
    let dx = this.finishTravel.x * (1 - drift) + lx * drift, dz = this.finishTravel.z * (1 - drift) + lz * drift
    const len = Math.hypot(dx, dz) || 1
    dx /= len
    dz /= len
    const v = body.linvel()
    body.setLinvel({ x: dx * speed, y: v.y, z: dz * speed }, true)
    // + yaw about +Y turns toward +X, the car's left (glTF).
    body.setAngvel({ x: 0, y: this.finishSide * yawRate, z: 0 }, true)
  }

  private renderFrame(alpha: number, dt: number): void {
    if (this.onlineRaceId || this.onlineEnding) {
      this.onlineScene?.render(performance.now(), dt, !!this.input.state.lookBack)
      return
    }
    const frameDt = dt
    const phase = gameStore.getState().phase
    if (phase === 'finished') {
      this.finish.update(dt)
      this.audio.setFinishMix(this.finish.active)
      this.loop.timeScale = this.finish.timeScale
      dt *= this.loop.timeScale
    }
    // The radio comes on at lights out and plays through the results; a restart's grid is quiet again.
    this.audio.setRaceMusicActive(phase === 'racing' || phase === 'finished' || phase === 'paused')
    if (phase === 'loading' && this.raceTransition) return
    this.camera.lookBack=(phase==='racing'||phase==='countdown')&&!!this.input.state.lookBack
    for (const opponent of this.opponents) {
      opponent.vehicle.render(phase === 'paused' ? 1 : alpha, phase === 'paused' ? 0 : dt)
      const b = opponent.vehicle.controller.backfire
      _rivalPop.flash = b.flash; _rivalPop.kind = b.flashKind; _rivalPop.strength = b.strength; _rivalPop.count = b.count
      this.opponentFlames.get(opponent.id)?.update(opponent.vehicle.controller.nitro.intensity, phase === 'paused' ? 0 : dt, _rivalPop)
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
      const wheel = phase === 'garage' && (this.showroomFocus === 'wheel' || this.showroomFocus.startsWith('wheel-'))
      const plateFocus = phase === 'garage' && (this.showroomFocus === 'plate-front' || this.showroomFocus === 'plate-rear')
      if (phase === 'garage' && this.showroomFocus === 'spoiler') {
        const fit = SPOILER_FIT[this.carId] ?? SPOILER_FIT.porsche911
        this.spoilerFraming.focus.fromArray(fit.position)
        this.spoilerFraming.focus.y += .1
        this.camera.showroom(this.showroomAnchor, Math.PI - .5 + this.wheelYaw, dt, this.spoilerFraming)
      } else if (plateFocus) {
        const front = this.showroomFocus === 'plate-front'
        const plate = this.vehicle.model.body.getObjectByName(front ? 'CustomPlate_front' : 'CustomPlate_rear')
        if (plate) this.plateFraming.focus.copy(plate.position)
        else this.plateFraming.focus.set(0, .5, front ? 2.2 : -2.2)
        this.camera.showroom(this.showroomAnchor, (front ? 0 : Math.PI) + this.wheelYaw, dt, this.plateFraming)
      } else if (wheel) {
        let selected = this.vehicle.config.wheels[0]
        for (const wheel of this.vehicle.config.wheels) {
          if (wheel.id === this.wheelFocusId) { selected = wheel; break }
        }
        // Follow the rendered hub, including suspension height, instead of assuming
        // the axle sits one radius above the body origin on every car.
        this.wheelFraming.focus.copy(this.vehicle.model.wheels[selected.id].pivot.position)
        this.wheelFraming.distance = Math.max(1.7, selected.radius * 6)
        this.wheelFraming.height = selected.radius * .65
        const side = selected.position[0] >= 0 ? 1 : -1
        const quarter = selected.position[2] >= 0 ? -.35 : .35
        this.camera.showroom(this.showroomAnchor, side * (Math.PI / 2 + quarter) + this.wheelYaw, dt, this.wheelFraming)
      } else {
        if (this.showroomPadStale) {
          this.setShowroomPad(false)
          this.setShowroomPad(true)
        }
        this.idleShowroomCamera(dt)
        // Slide the car right of the garage's workshop panel (the hub's left rail).
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
    } else if (phase === 'finished' && !this.finish.reducedMotion && this.finishCinematic()) {
      this.effects.update(this.vehicle, dt)
      this.sparks.update(dt)
    } else if (phase !== 'paused') {
      // Creep in on the car as the lights build, then settle into the race camera after the start.
      const lightsT = Math.min(1, (COUNTDOWN_SEC - this.race.countdown) / COUNTDOWN_SEC)
      const gridFraming = this.camera.mode === 'cockpit' ? 0 : phase === 'countdown' ? 1 - 0.5 * lightsT * lightsT * (3 - 2 * lightsT) : this.camera.mode === 'chase' ? 0.5 * Math.max(0,1-this.race.timer.totalMs/1200) : 0
      this.camera.driftFraming = gameStore.getState().settings.mode === 'drift' ? .82 : .55
      const burnout = this.vehicle.controller.burnout
      this.camera.burnoutHold = burnout.holding ? burnout.intensity : 0
      this.camera.update(this.vehicle.model.root, this.vehicle.speedKmh, dt, this.vehicle.controller.nitro.intensity, this.vehicle.motion,gridFraming,this.vehicle.model.body)
      this.effects.update(this.vehicle, dt)
      this.sparks.update(dt)
      const settings = gameStore.getState().settings
      this.guide.group.visible = settings.mode !== 'freeRoam' || settings.roamGuide
      this.updateGuide(dt)
    }
    this.updateDrivingLine(phase)
    this.checkpointGates?.update(gameStore.getState().settings.mode === 'timeTrial' && (phase === 'racing' || phase === 'countdown' || phase === 'paused'), (this.race.lastCheckpoint + 1) % this.track.checkpoints.length, phase === 'paused' ? 0 : dt)
    if (this.rivalTags.length > 0) this.updateRivalTags(phase === 'countdown' || phase === 'racing', dt)
    this.benchmark?.frame()
    // Every car, for the haze and the spray.
    this.hazeCars.length = 0
    this.hazeCars.push(this.vehicle)
    for (const opponent of this.opponents) this.hazeCars.push(opponent.vehicle)
    // Rain outdoors only: not in the garage.
    const { postfx, weather, camera: cameraMode } = gameStore.getState().settings
    const wet = weather === 'rain' && phase !== 'menu' && phase !== 'garage' ? 1 : 0
    const camera = this.renderer.camera
    this.effects.renderMarks(this.renderer.renderer, this.vehicle.model.root.position)
    this.rainSurface.update(this.renderer.renderer, this.renderer.scene, this.track.group, camera, wet, dt)
    this.wetRoads.update(this.track.group, wet, dt)
    this.vehicle.model.root.getWorldPosition(this.racePosition)
    this.wetReflections.update(this.renderer.renderer, this.renderer.scene, this.track.group, camera, this.racePosition, wet, dt)
    this.rainImpacts.mesh.visible = wet > 0 && this.rainSurface.uniforms.uRainReady.value > 0
    this.carRain.update(this.vehicle.model, wet, dt)
    this.rain.update(camera, wet, dt)
    this.rainSpray.update(this.hazeCars, camera.position, wet, dt)
    // Exhaust heat haze and lens drops share the distortion buffer (post FX only).
    if (postfx) {
      const speed = Math.abs(this.vehicle.controller.forwardSpeed)
      this.lensDrops.update(camera, cameraMode === 'cockpit' ? wet : 0, speed, dt)
      this.haze.update(this.hazeCars, camera, dt, this.lensDrops.active)
    }
    const blurAmount = gameStore.getState().settings.motionBlur
    let exposure = phase === 'racing' ? motionExposure(this.vehicle.speedKmh, blurAmount, dt)
      : phase === 'intro' ? motionExposure(160, blurAmount * this.introCamera.whip, dt)
      : phase === 'finished' && this.finish.active && !this.finish.reducedMotion ? motionExposure(this.vehicle.speedKmh, blurAmount * (1 - .7 * THREE.MathUtils.smoothstep(this.finish.progress, 0, .1)), dt) : 0
    if (this.blurCamera !== cameraMode || this.blurLookBack !== this.camera.lookBack) { exposure = 0; this.blurCamera = cameraMode; this.blurLookBack = this.camera.lookBack }
    this.renderer.setMotionBlur(exposure, this.vehicle.model.body)
    // Without post FX (Low) the whip has no motion blur: streak overlay instead (#46).
    const streaks = phase === 'intro' && !this.renderer.postfxActive && blurAmount > 0 ? this.introCamera.whip * Math.min(1, blurAmount / 0.5) : 0
    this.whipStreaks.update(camera, streaks, this.introCamera.whipDirection, frameDt)
    const nitro = this.vehicle.controller.nitro
    const rushing = phase === 'racing' && !this.camera.lookBack
    this.nitroRush.update(camera, rushing ? nitro.intensity : 0, nitro.perfect, gameStore.getState().settings.speedLines, phase === 'paused' ? 0 : frameDt)
    // Cockpit gets it too: the dash sits low in the sharp middle of the frame.
    const boostTarget = rushing ? boostBlurTarget(nitro.intensity, this.vehicle.speedKmh, blurAmount) : 0
    if (phase !== 'paused') this.boostBlur = stepBoostBlur(this.boostBlur, boostTarget, frameDt)
    this.renderer.setBoostBlur(this.boostBlur)
    const staging = phase === 'intro' || phase === 'countdown'
    if (staging) this.updateStaging(phase, dt)
    else if (phase === 'racing' && this.lightsShown > 0) {
      this.lightsShown = 0
      this.audio.playStartLight(true)
    }
    this.driftZones?.update(this.vehicle.position.x,this.vehicle.position.z,gameStore.getState().settings.mode === 'drift' && ['racing','countdown','intro','paused'].includes(phase),(this.race.lastCheckpoint+1)%this.track.checkpoints.length)
    this.environment.follow(this.vehicle.position)
    if (--this.carReflectionsIn <= 0) this.syncCarReflections(phase)
    const v = this.vehicle.body.linvel()
    this.track.update(this.vehicle.position, _velocity.set(v.x, v.y, v.z), dt)
    this.renderer.adapt(dt)

    const outdoors = phase === 'intro' || phase === 'countdown' || phase === 'racing' || phase === 'finished' || phase === 'paused'
    this.track.atmosphere?.update(camera.position, phase === 'paused' ? 0 : frameDt, outdoors)
    this.audio.updateTrackside(this.track.atmosphere?.sources, camera, outdoors, gameStore.getState().settings.tracksideVolume)
    this.updateOpponentAudio(phase, staging)
    this.updateHitAudio(phase)
    const ctrl = this.vehicle.controller
    const sound = this.soundState
    sound.rpm = this.showroomRev?.rpm ?? (revAudible ? this.revRpm : staging ? this.playerRevs.rpm : ctrl.drivetrain.rpm)
    sound.throttle = this.showroomRev?.throttle ?? (revAudible ? (this.revHeld ? 1 : 0) : staging ? this.playerRevs.throttle : ctrl.throttlePedal)
    sound.gear = ctrl.drivetrain.gear
    sound.nitro = ctrl.nitro.intensity
    sound.nitroActive = ctrl.nitro.active
    sound.nitroPerfect = ctrl.nitro.perfect
    this.vehicle.model.cockpit?.updateInstruments(sound.rpm, this.vehicle.speedKmh, ctrl.drivetrain.gear, this.vehicle.config.engine.redlineRpm, phase === 'paused' ? 0 : frameDt)
    this.audio.update(sound, readTyres(ctrl, this.tyreSound))
    this.audio.updateDriving(this.tyreSound.speed, this.tyreSound.paved, this.vehicle.motion.grounded,
      this.vehicle.motion.roadRoughness, cameraMode === 'cockpit', phase === 'racing' || phase === 'finished')
    this.renderer.setViewOpacity(phase === 'racing' || phase === 'countdown' ? this.camera.viewOpacity : 1)
    this.renderer.render()

    this.fpsFrames++
    this.fpsTimer += frameDt
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTimer)
      this.fpsFrames = 0
      this.fpsTimer = 0
    }
    this.telemetryTimer += frameDt
    if (this.telemetryTimer >= 1 / TELEMETRY_HZ) {
      this.updateAwareness(this.telemetryTimer)
      this.telemetryTimer = 0
      this.publishTelemetry()
    }
  }

  private clearAwareness():void {
    this.awareness.reset();this.audio.clearSpotter()
    proximityStore.setState({radar:null,frame:++this.awarenessFrame})
  }
  private readAwareness(car:AwarenessCar,vehicle:Vehicle,index:number):void {
    const p=vehicle.model.root.position,q=vehicle.model.root.quaternion,c=vehicle.config.chassisCenter
    let fx=2*(q.x*q.z+q.w*q.y),fz=1-2*(q.x*q.x+q.y*q.y)
    const length=Math.hypot(fx,fz)
    if(length>.001){fx/=length;fz/=length}else{fx=car.fx;fz=car.fz}
    car.fx=fx;car.fz=fz;car.x=p.x+fx*c[2]+fz*c[0];car.z=p.z+fz*c[2]-fx*c[0];car.y=p.y+c[1]
    car.vx=vehicle.motion.velocity.x;car.vz=vehicle.motion.velocity.z
    car.halfWidth=vehicle.config.chassisHalfExtents[0];car.halfLength=vehicle.config.chassisHalfExtents[2]
    car.route=this.awarenessRoute!.project(car.x,car.z,index)
  }
  private updateAwareness(dt:number):void {
    const s=gameStore.getState()
    if(s.phase!=='racing'||!this.awarenessRoute||!this.awarenessCars.length||!(s.settings.proximityRadar||s.settings.spotterVisual||s.settings.spotterAudio))return
    this.readAwareness(this.awarenessPlayer,this.vehicle,this.progress.index)
    for(let i=0;i<this.awarenessCars.length;i++)this.readAwareness(this.awarenessCars[i],this.opponents[i].vehicle,this.opponents[i].driver.progress.index)
    this.awareness.update(this.awarenessPlayer,this.awarenessCars,this.awarenessRoute.length,dt,this.awarenessConnected)
    if(this.awareness.cue&&s.settings.spotterAudio)this.audio.playSpotter(this.awareness.cue)
    proximityStore.setState({radar:this.awareness,frame:++this.awarenessFrame})
  }

  /**
   * Contact forces on the car bodies this physics step, as hits per car: a
   * change in speed (force × dt / mass), sorted by what was hit — another
   * car, the ground when bottoming out or landing (a mostly vertical push),
   * or a wall.
   */
  private collectHits(dt: number): void {
    const cars = this.opponents.length + 1
    while (this.carHits.length < cars) this.carHits.push({ car: 0, wall: 0, ground: 0, touching: false })
    this.tickHit.fill(0)
    this.physics.drainContactForces((a, b, force, _dx, dy) => {
      const sa = this.carSlot(a), sb = this.carSlot(b)
      if (sa >= 0) this.recordHit(sa, sb >= 0, force, dy, dt)
      if (sb >= 0) this.recordHit(sb, sa >= 0, force, dy, dt)
    })
  }

  /**
   * Sparks where a car's chassis touches a wall, another car or the road
   * (bottoming out), from Rapier's contact manifolds: world-space solver
   * points, the normal and the impulse. Plus the underside striking the road
   * when a wheel's suspension slams into its bump stop at speed.
   */
  private emitSparks(dt: number): void {
    const world = this.physics.world
    const camera = this.renderer.camera.position
    for (let slot = 0; slot <= this.opponents.length; slot++) {
      const vehicle = slot === 0 ? this.vehicle : this.opponents[slot - 1].vehicle
      if (vehicle.quietTicks > 0) continue
      const p = vehicle.body.translation()
      // Nobody sees sparks from a rival a long way off.
      if (slot > 0 && (p.x - camera.x) ** 2 + (p.z - camera.z) ** 2 > 150 * 150) continue
      const v = vehicle.body.linvel()
      const c = this.sparkContact
      c.vx = v.x; c.vy = v.y; c.vz = v.z
      const chassis = vehicle.chassis
      const ct = chassis.translation(), cq = chassis.rotation()
      let hit = slot < this.tickHit.length ? this.tickHit[slot] : 0
      world.contactPairsWith(chassis, other => {
        world.contactPair(chassis, other, (manifold, flipped) => {
          // The deepest touching point, on the chassis side (the manifold's
          // "1" side unless flipped), in the chassis collider's frame.
          let best = -1, depth = SPARK_CONTACT_DIST
          for (let i = 0; i < manifold.numContacts(); i++) {
            const d = manifold.contactDist(i)
            if (d < depth) { depth = d; best = i }
          }
          if (best < 0) return
          const lp = flipped ? manifold.localContactPoint2(best) : manifold.localContactPoint1(best)
          const ln = flipped ? manifold.localNormal2() : manifold.localNormal1()
          if (!lp || !ln) return
          _sparkPoint.set(lp.x, lp.y, lp.z).applyQuaternion(_sparkQuat.set(cq.x, cq.y, cq.z, cq.w)).add(_sparkOrigin.set(ct.x, ct.y, ct.z))
          // The chassis's outward normal, flipped: out of what was hit, toward the car.
          _sparkNormal.set(-ln.x, -ln.y, -ln.z).applyQuaternion(_sparkQuat)
          c.x = _sparkPoint.x; c.y = _sparkPoint.y; c.z = _sparkPoint.z
          c.nx = _sparkNormal.x; c.ny = _sparkNormal.y; c.nz = _sparkNormal.z
          // The tick's hit throws one burst, from the first contact.
          c.dv = hit
          hit = 0
          c.groundY = c.ny > 0.75 ? c.y : p.y - 0.45
          this.sparks.emit(c, dt, slot)
        })
      })
      // Bottoming out: a suspension at the end of its travel, still compressing hard.
      const speed = Math.hypot(v.x, v.z)
      if (speed < 10) continue
      for (const w of vehicle.controller.wheels) {
        const s = w.suspension
        if (!w.grounded || s.compression < vehicle.config.suspension.travel * 0.97 || s.velocity < 0.6) continue
        // Under the floor, inboard of the tyre.
        c.x = w.contactPoint.x + (p.x - w.contactPoint.x) * 0.4
        c.y = w.contactPoint.y + 0.03
        c.z = w.contactPoint.z + (p.z - w.contactPoint.z) * 0.4
        c.nx = 0; c.ny = 1; c.nz = 0
        c.dv = s.velocity * 0.9
        c.groundY = w.contactPoint.y
        this.sparks.emit(c, dt, slot)
      }
    }
  }

  /** 0 for the player's chassis collider, i + 1 for rival i's, -1 for anything else. */
  private carSlot(handle: number): number {
    if (this.vehicle.chassis.handle === handle) return 0
    for (let i = 0; i < this.opponents.length; i++) if (this.opponents[i].vehicle.chassis.handle === handle) return i + 1
    return -1
  }

  private recordHit(slot: number, otherIsCar: boolean, force: number, dirY: number, dt: number): void {
    const vehicle = slot === 0 ? this.vehicle : this.opponents[slot - 1].vehicle
    if (vehicle.quietTicks > 0) return
    const dv = (force * dt) / vehicle.massKg
    if (slot < this.tickHit.length) this.tickHit[slot] = Math.max(this.tickHit[slot], dv)
    const h = this.carHits[slot]
    if (otherIsCar) h.car = Math.max(h.car, dv)
    else if (Math.abs(dirY) > 0.75) h.ground = Math.max(h.ground, dv)
    else {
      h.wall = Math.max(h.wall, dv)
      h.touching = true
    }
  }

  /**
   * Exhaust pops this tick, heard per car (a pop lasts one tick, so this runs
   * in fixedUpdate, not per frame). Nitro lighting also kicks the camera.
   */
  private exhaustPops(): void {
    const ctrl = this.vehicle.controller
    if (ctrl.backfire.popped) this.audio.backfire(-1, ctrl.backfire.popped, ctrl.backfire.strength)
    if (ctrl.nitro.ignited) {
      this.camera.jolt(0.55)
      this.camera.ignite()
      this.nitroRush.ignite()
    }
    for (let i = 0; i < this.opponents.length; i++) {
      const b = this.opponents[i].vehicle.controller.backfire
      if (b.popped) this.audio.backfire(i, b.popped, b.strength)
    }
  }

    /** Crashes, wall scrapes and curb strikes for every car, then clear for the next frame. */
  private updateHitAudio(phase: GamePhase): void {
    const live = phase === 'racing' || phase === 'finished' || phase === 'countdown'
    for (let slot = 0; slot <= this.opponents.length; slot++) {
      const vehicle = slot === 0 ? this.vehicle : this.opponents[slot - 1].vehicle
      const car = slot - 1
      const lv = vehicle.body.linvel()
      const speed = Math.hypot(lv.x, lv.z)
      let peak = 0
      for (const w of vehicle.controller.wheels) peak = Math.max(peak, w.suspension.takePeak())
      const h = this.carHits[slot]
      if (live) {
        if (h) {
          const hit = Math.max(h.car, h.wall, h.ground)
          if (hit > 0) {
            const strength = impactStrength(hit)
            this.audio.impact(car, hit === h.car ? 'car' : hit === h.wall ? 'wall' : 'ground', strength)
            if (slot === 0 && strength > 0) this.camera.jolt(strength)
          }
          this.audio.scrape(car, scrapeLevel(h.touching, speed), speed)
        }
        const curb = vehicle.quietTicks > 0 ? 0 : curbStrength(peak, speed)
        if (curb > 0) {
          this.audio.impact(car, 'curb', curb)
          if (slot === 0) this.camera.jolt(curb, true)
        }
      } else {
        this.audio.scrape(car, 0, 0)
      }
      if (h) {
        h.car = h.wall = h.ground = 0
        h.touching = false
      }
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
    _listenerUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
    _listenerBack.setFromMatrixColumn(camera.matrixWorld, 2).normalize()
    // The camera rides with the player's car: its velocity is the listener's.
    const lv = this.vehicle.body.linvel()
    const active = phase === 'racing' || phase === 'countdown' || phase === 'intro' || phase === 'finished'
    const out = this.rivalSound
    for (let i = 0; i < this.opponents.length; i++) {
      const rival = this.opponents[i].vehicle
      _rivalOffset.subVectors(rival.position, _listenerPosition)
      const distance = _rivalOffset.length() || 1
      // In the camera's frame (+x right, +y up, +z behind), for the 3D panner.
      out.x = _rivalOffset.dot(_listenerRight)
      out.y = _rivalOffset.dot(_listenerUp)
      out.z = _rivalOffset.dot(_listenerBack)
      const rv = rival.body.linvel()
      _relativeVelocity.set(rv.x - lv.x, rv.y - lv.y, rv.z - lv.z)
      out.recession = _relativeVelocity.dot(_rivalOffset) / distance
      out.passSpeed = _relativeVelocity.length()
      const revs = staging ? this.rivalRevs[i] : undefined
      out.rpm = revs?.rpm ?? rival.controller.drivetrain.rpm
      out.throttle = revs?.throttle ?? rival.controller.throttlePedal
      out.active = active
      this.audio.updateOpponent(i, out, readTyres(rival.controller, this.rivalTyreSound))
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
    for (let i = 0; i < this.rivalRevs.length; i++) {
      const config = this.opponents[i]?.vehicle.config.engine
      if (config) this.rivalRevs[i].update(dt, config.idleRpm, config.redlineRpm, hold)
    }
  }

  /** The braking guide, while actually driving: never in menus, the intro, pause, results or Drift. */
  private updateDrivingLine(phase: GamePhase): void {
    const line = this.drivingLine
    if (!line) return
    const settings = gameStore.getState().settings
    const show = settings.drivingLine !== 'off' && phase === 'racing' && settings.mode !== 'drift' && !this.camera.lookBack
    line.mesh.visible = show
    if (!show) return
    const wet = settings.weather === 'rain', config = this.vehicle.config
    const built = this.brakingGuideFor
    if (!this.brakingGuide || built.config !== config || built.wet !== wet || built.line !== this.track.line) {
      this.brakingGuide = new BrakingGuide(this.track.line, {
        grip: config.tires.grip,
        downforcePerKg: config.downforceCoefficient / config.massKg,
        brakeDecel: config.brakeForce / config.massKg,
      }, wet)
      this.brakingGuideFor = { config, wet, line: this.track.line }
    }
    line.update(this.brakingGuide, this.progress.index, Math.abs(this.vehicle.controller.forwardSpeed), settings.drivingLine === 'corners')
  }

  private updateGuide(dt: number): void {
    const p = this.vehicle.position
    this.progress.update(p.x, p.z)
    this.guide.update(this.progress, dt)
    // Wrong way: heading against the centreline while actually moving.
    const t = this.progress.tangent()
    _forward.set(0, 0, 1).applyQuaternion(this.vehicle.quaternion)
    const against = _forward.x * t.x + _forward.z * t.z < -0.4 && this.vehicle.speedKmh > 12
    this.wrongWayTime = against && !this.vehicle.controller.drift.active && gameStore.getState().phase === 'racing' && !this.race.freeRoam ? this.wrongWayTime + dt : 0
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
    const now = performance.now()
    const previousStandings = telemetryStore.getState().standings
    const refreshStandings = now - this.standingsPublishedAt >= 200 ||
      previousStandings.length !== this.entries.length ||
      this.entries.some(entry => previousStandings.find(row => row.id === entry.id)?.finishMs !== entry.finishMs)
    const standings = refreshStandings ? this.standings?.snapshot(this.entries) ?? [] : previousStandings
    this.updateCallouts(standings)
    if (refreshStandings) this.standingsPublishedAt = now
    const previousLabels = telemetryStore.getState().rivalLabels
    const labelsUnchanged = previousLabels.length === this.opponents.length && this.opponents.every((o, i) => {
      const previous = previousLabels[i]
      return previous.id === o.id && previous.name === o.driver.profile.name &&
        previous.style === o.driver.profile.style && previous.position === (standings.find(s => s.id === o.id)?.position ?? o.id)
    })
    const rivalLabels = labelsUnchanged ? previousLabels : this.opponents.map(o => ({ id: o.id, name: o.driver.profile.name, style: o.driver.profile.style, position: standings.find(s => s.id === o.id)?.position ?? o.id }))
    telemetryStore.setState({
      finishProgress: this.finish.progress,
      finishSeconds: this.finish.elapsed,
      finishReduced: this.finish.reducedMotion,
      finishPosition: this.finishPosition,
      finishFieldSize: this.finishFieldSize,
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
      launchRevs: (this.playerRevs.rpm - this.vehicle.config.engine.idleRpm) / (this.vehicle.config.engine.redlineRpm - this.vehicle.config.engine.idleRpm),
      launchBandLow: this.vehicle.config.launch.bandLow,
      launchBandHigh: this.vehicle.config.launch.bandHigh,
      launchArmed: this.launch.armed,
      launchGrade: this.launch.grade,
      launchFlash: this.launch.sinceGrade < LAUNCH_FLASH_SEC,
      fps: this.fps,
      carX: this.vehicle.position.x,
      carZ: this.vehicle.position.z,
      heading: Math.atan2(_forward.x, _forward.z),
      trackIndex: this.progress.index,
      distanceLeft: this.distanceLeft(),
      wrongWay: this.wrongWayTime > WRONG_WAY_DELAY,
      missedCheckpoint: this.race.state === 'racing' && !this.race.freeRoam && !!this.standings && this.standings.overrun(this.playerEntry) > MISSED_GATE_METRES,
      freeRoam: this.race.freeRoam,
      trialLap: this.trial.laps.length + 1,
      trialLaps: this.trial.laps.length,
      trialValidLaps: this.trial.validLaps,
      trialValid: this.trial.valid,
      trialInvalidReason: this.trial.invalidReason,
      trialSessionBestMs: this.trial.sessionBest?.lapMs ?? null,
      trialPersonalBestMs: this.trial.personalBest?.lapMs ?? null,
      trialSplitIndex: this.trial.lastSplitIndex,
      trialSplitMs: this.trial.lastSplitMs,
      trialDeltaMs: this.trial.lastDeltaMs,
      trialSplitShow: this.race.timer.totalMs - this.trialSplitAtMs < TRIAL_SPLIT_SHOW_MS,
      trialLastLap: this.trial.lastLap,
      trialNextGate: (this.race.lastCheckpoint + 1) % this.track.checkpoints.length,
      trialGateCount: this.track.checkpoints.length,
      trialEnded: this.trialEnded,
      standings,
      callout: this.callouts.current,
      opponents: this.opponents.map(o => ({ id: o.id, x: o.vehicle.position.x, z: o.vehicle.position.z })),
    })
  }

  /** Quick Race only, while racing or just finished; never over the countdown or the finish sting. */
  private updateCallouts(standings: readonly { player: boolean; position: number }[]): void {
    const { settings, phase } = gameStore.getState()
    if (settings.mode !== 'quick' || !settings.callouts || (this.race.state !== 'racing' && this.race.state !== 'finished')) {
      this.callouts.current = null
      return
    }
    const shown = this.callouts.update({
      timeMs: this.race.timer.totalMs,
      position: standings.find((row) => row.player)?.position ?? 1,
      fieldSize: standings.length,
      lap: this.race.lap,
      totalLaps: this.race.totalLaps,
      finished: this.playerEntry.finishMs !== null,
      finishGapMs: this.finishGapMs,
    })
    if (shown && shown.kind !== 'finish' && phase === 'racing') this.audio.playCallout(shown.kind, settings.calloutVolume)
  }

  /** Meters to the finish: the rest of this lap plus every lap after it. */
  /** Metres to the finish, from the same centreline measure as the standings gaps. */
  private distanceLeft(): number {
    if (!this.standings || this.race.state === 'finished' || this.race.freeRoam) return 0
    const lap = this.standings.lapLength
    // Time Trial has no lap target: what's left of this lap.
    if (!Number.isFinite(this.race.totalLaps)) return Math.max(0, lap - (this.standings.distance(this.playerEntry) % lap))
    return Math.max(0, this.race.totalLaps * lap - this.standings.distance(this.playerEntry))
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
      // floorHeight: a canopy over the grid (Station District) is not the floor.
      const h = this.physics.floorHeight(wx, spawn.position.y, wz, (c) => c !== this.showroomPad)
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

  /** Cars reflect the skyline bake on track; the showroom's own room in the garage. */
  private syncCarReflections(phase: GamePhase): void {
    this.carReflectionsIn = 30
    if (!this.vehicle || !this.environment) return
    const env = this.environment.carEnvironment
    const map = phase === 'menu' || phase === 'garage' ? null : env.map
    applyCarReflections(this.vehicle.model.root, map, env.intensity)
    for (const opponent of this.opponents) applyCarReflections(opponent.vehicle.model.root, map, env.intensity)
  }

  private updateShowroom(phase: GamePhase): void {
    if (phase === 'loading' && this.raceTransition) return
    if (!this.showroom) return
    const inShowroom = phase === 'menu' || phase === 'garage'
    this.showroom.setActive(this.renderer.scene, inShowroom, [this.track.group, this.environment.group, this.effects.group, this.guide.group])
    this.setShowroomPad(inShowroom)
    this.audio.setScene(inShowroom ? 'menu' : 'race')
    this.syncCarReflections(phase)
    // Re-assert the time of day: it may have changed while the showroom had the scene.
    if (!inShowroom) this.environment.apply(this.renderer.scene)
  }

  private applyBuild(build: CarBuild, prev: CarBuild): void {
    if (!this.vehicle) return
    this.livery.apply(build)
    void this.spoiler.apply(build)
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
    setTrackLook(s.trackLook)
    this.renderer.applyQuality(s.quality, s.postfx)
    this.effects?.setQuality(s.quality)
    this.environment?.setShadowMapSize(s.quality === 'high' ? 2048 : 1024)
    if (this.track) {
      void this.track.setQuality(s.quality)
      const view = this.track.viewDistance(s.quality)
      this.environment.setViewDistance(view.fogNear, view.fogFar)
      this.renderer.setViewDistance(view.fogFar * 1.05)
    }
    this.audio.setVolume(s.masterVolume)
    this.audio.setMenuMusic(s.musicTrack, s.menuMusic)
    this.audio.setRaceMusic(s.raceMusic, s.raceMusicVolume)
    if (this.camera) {
      this.camera.mode = s.camera
      this.camera.cameraMotion = s.cameraMotion
      this.camera.fovEffects = s.fovEffects
      this.camera.cockpitCar = this.carId
      this.camera.cockpitAdjustment = s.cockpits[this.carId] ?? DEFAULT_COCKPIT_ADJUSTMENT
    }
    this.rain?.setQuality(s.quality)
    this.drivingLine?.setQuality(s.quality)
    this.rainSurface?.setQuality(s.quality)
    this.wetReflections?.setQuality(s.quality)
    this.rainImpacts?.setQuality(s.quality)
    this.carRain?.setQuality(s.quality)
    // Before the time of day: rain re-bakes the environment, applyTimeOfDay pushes it to the scene.
    this.environment?.setRain(s.weather === 'rain')
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
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    this.clearRaceLoading()
    this.loop.stop()
    this.unsubscribe()
    this.unsubscribeLobby()
    ++this.onlineToken
    this.onlineScene?.dispose()
    if (this.onlineRaceId) void leaveLobby()
    this.onlineRaceId = null
    onlineRaceStore.setState({ resultsOpen: false, finished: false, active: false, loaded: false, menuOpen: false })
    this.clearOpponents()
    this.input.dispose()
    this.audio.dispose()
    this.cloud.dispose()
    this.audio.onMenuMusicState = null
    this.audio.onRaceMusicTrack = null
    this.spoiler?.dispose()
    this.whipStreaks.dispose()
    this.nitroRush.dispose()
    this.livery?.dispose()
    this.effects?.dispose()
    this.sparks?.dispose()
    this.haze?.dispose()
    this.wetRoads?.dispose()
    this.wetReflections?.dispose()
    this.carRain?.dispose()
    this.rainImpacts?.dispose()
    this.rainSurface?.dispose()
    this.rain?.dispose()
    this.rainSpray?.dispose()
    this.lensDrops?.dispose()
    this.guide?.dispose()
    this.drivingLine?.dispose()
    this.driftZones?.dispose()
    this.checkpointGates?.dispose()
    this.showroom?.dispose()
    this.track?.dispose()
    this.headlights?.dispose()
    this.environment?.dispose()
    this.vehicle?.model.cockpit?.dispose()
    this.vehicle?.disposeMaterials()
    this.physics?.dispose()
    this.assets.dispose()
    this.renderer.dispose()
  }
}
