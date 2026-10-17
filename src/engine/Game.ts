import { AudioManager } from '../audio/AudioManager'
import { ChaseCamera } from '../camera/ChaseCamera'
import { InputManager, type InputState } from '../input/InputManager'
import { RaceManager } from '../racing/RaceManager'
import { gameStore, type GamePhase, type Settings } from '../stores/gameStore'
import { telemetryStore } from '../stores/telemetryStore'
import { buildPlaceholderCar, rigCarModel } from '../vehicles/CarModel'
import { getCar } from '../vehicles/carRegistry'
import { Vehicle } from '../vehicles/Vehicle'
import { resolveVehicleConfig, type VehicleConfig } from '../vehicles/VehicleConfig'
import { Environment } from '../world/Environment'
import { Track } from '../world/Track'
import { TEST_CIRCUIT } from '../world/tracks'
import { AssetManager } from './AssetManager'
import { GameLoop } from './GameLoop'
import { initRapier, PhysicsWorld } from './PhysicsWorld'
import { Renderer } from './Renderer'

const TELEMETRY_HZ = 20
// Handbrake, not brake: brake at standstill would engage reverse.
const LOCKED_INPUT: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: true }

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
  private readonly loop: GameLoop
  private physics!: PhysicsWorld
  private track!: Track
  private environment!: Environment
  private vehicle!: Vehicle
  private camera!: ChaseCamera
  private race!: RaceManager

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
      if (s.settings !== prev.settings) this.applySettings(s.settings)
    })
  }

  async init(carId = 'mclaren'): Promise<void> {
    gameStore.getState().setPhase('loading')
    await initRapier()
    if (this.disposed) return

    this.physics = new PhysicsWorld()
    const scene = this.renderer.scene

    this.environment = new Environment(scene)
    scene.add(this.environment.group)

    this.track = new Track(TEST_CIRCUIT, this.physics.world)
    scene.add(this.track.group)

    const { config, model } = await this.loadCar(carId)
    if (this.disposed) return
    this.vehicle = new Vehicle(config, model, this.physics.world, this.track.spawn)
    scene.add(model.root)

    this.camera = new ChaseCamera(this.renderer.camera)
    this.race = new RaceManager(this.track.checkpoints, gameStore.getState().settings.laps, {
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

    this.applySettings(gameStore.getState().settings)
    telemetryStore.setState({ redlineRpm: config.engine.redlineRpm })
    this.vehicle.render(1)
    this.loop.start()
    gameStore.getState().setPhase('menu')
  }

  /** Loads the GLB + config from the pipeline, falling back to the placeholder car. */
  private async loadCar(carId: string) {
    const entry = getCar(carId)
    const json = await this.assets.loadJson<Partial<VehicleConfig>>(entry.configUrl)
    const config = resolveVehicleConfig(json ?? undefined)
    let scene
    if (await this.assets.exists(entry.modelUrl)) {
      try {
        scene = await this.assets.loadModel(entry.modelUrl)
      } catch (err) {
        console.warn(`[Game] failed to load ${entry.modelUrl}, using placeholder`, err)
      }
    }
    scene ??= buildPlaceholderCar(config)
    return { config, model: rigCarModel(scene, config) }
  }

  // ── Commands (called by React) ─────────────────────────────────────────

  startRace(): void {
    const { settings } = gameStore.getState()
    this.audio.unlock(settings.masterVolume)
    this.resetCar()
    this.race.start(settings.laps)
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
    this.audio.suspend()
    this.resetCar()
    gameStore.getState().setPhase('menu')
  }

  resetCar(): void {
    this.vehicle.respawn(this.track.spawn)
    this.camera.snap()
  }

  // ── Loop ───────────────────────────────────────────────────────────────

  private fixedUpdate(dt: number): void {
    this.input.poll()
    if (this.input.consume('pause')) this.togglePause()
    if (this.input.consume('camera')) {
      const s = gameStore.getState()
      s.updateSettings({ camera: s.settings.camera === 'chase' ? 'cockpit' : 'chase' })
    }

    const phase = gameStore.getState().phase
    if (phase === 'paused') return
    if (this.input.consume('reset') && phase === 'racing') this.resetCar()

    const inMenu = phase === 'menu' || phase === 'loading'
    const controls = this.race.controlsEnabled && !inMenu && phase !== 'finished'
    this.vehicle.fixedUpdate(controls ? this.input.state : LOCKED_INPUT, dt)
    this.physics.step(dt)
    this.vehicle.capture()
    this.race.update(dt, this.vehicle.position)
  }

  private renderFrame(alpha: number, dt: number): void {
    const paused = gameStore.getState().phase === 'paused'
    this.vehicle.render(paused ? 1 : alpha)
    this.camera.update(this.vehicle.model.root, this.vehicle.speedKmh, dt)
    this.environment.follow(this.vehicle.position)

    const ctrl = this.vehicle.controller
    const slip = Math.max(...ctrl.wheels.map((w) => w.slip))
    this.audio.update(ctrl.drivetrain.rpm, this.input.state.throttle, slip)
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

  private publishTelemetry(): void {
    const ctrl = this.vehicle.controller
    const t = this.race.timer
    telemetryStore.setState({
      speedKmh: this.vehicle.speedKmh,
      rpm: ctrl.drivetrain.rpm,
      gear: ctrl.drivetrain.gear,
      lap: this.race.lap,
      totalLaps: this.race.totalLaps,
      currentLapMs: t.currentLapMs,
      lastLapMs: t.lastLapMs,
      bestLapMs: t.bestLapMs,
      totalMs: t.totalMs,
      countdown: this.race.countdown,
      fps: this.fps,
    })
  }

  private applySettings(s: Settings): void {
    this.renderer.applyQuality(s.quality, s.postfx)
    this.audio.setVolume(s.masterVolume)
    if (this.camera) this.camera.mode = s.camera
  }

  dispose(): void {
    this.disposed = true
    this.loop.stop()
    this.unsubscribe()
    this.input.dispose()
    this.audio.dispose()
    this.track?.dispose()
    this.environment?.dispose()
    this.physics?.dispose()
    this.renderer.dispose()
  }
}
