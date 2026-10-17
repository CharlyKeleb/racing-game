import * as THREE from 'three'
import { AudioManager } from '../audio/AudioManager'
import { ChaseCamera, type ShowroomFraming } from '../camera/ChaseCamera'
import { DrivingEffects } from '../effects/DrivingEffects'
import { InputManager, type InputState } from '../input/InputManager'
import { RaceManager } from '../racing/RaceManager'
import { gameStore, type GamePhase, type Settings } from '../stores/gameStore'
import { telemetryStore } from '../stores/telemetryStore'
import { applyCarBuild, samePerformance, type CarBuild } from '../vehicles/CarBuild'
import { CarLivery } from '../vehicles/CarLivery'
import { buildPlaceholderCar, rigCarModel } from '../vehicles/CarModel'
import { getCar } from '../vehicles/carRegistry'
import { Vehicle } from '../vehicles/Vehicle'
import { resolveVehicleConfig, type VehicleConfig } from '../vehicles/VehicleConfig'
import { Environment } from '../world/Environment'
import { Showroom } from '../world/Showroom'
import { Track } from '../world/Track'
import { TEST_CIRCUIT } from '../world/tracks'
import { AssetManager } from './AssetManager'
import { GameLoop } from './GameLoop'
import { initRapier, PhysicsWorld } from './PhysicsWorld'
import { Renderer } from './Renderer'

const TELEMETRY_HZ = 20
// Handbrake, not brake: brake at standstill would engage reverse.
export type ShowroomFocus = 'car' | 'wheel'

const LOCKED_INPUT: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: true, nitro: false }

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
  private livery!: CarLivery
  private showroom!: Showroom
  private effects!: DrivingEffects
  /** The car as shipped, before garage upgrades. */
  private baseConfig!: VehicleConfig
  private showroomYaw = 0.9
  private showroomIdle = 0
  /** What the garage camera frames; the Wheels tab zooms onto the front-left wheel. */
  private showroomFocus: ShowroomFocus = 'car'
  private wheelYaw = 0
  private readonly carFraming: ShowroomFraming = { focus: new THREE.Vector3(0, 0.55, 0), distance: 7.5, height: 1.5, shift: 0, fov: 42 }
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
      if (s.settings !== prev.settings) this.applySettings(s.settings)
      if (s.build !== prev.build) this.applyBuild(s.build, prev.build)
      if (s.phase !== prev.phase) this.updateShowroom(s.phase)
    })
  }

  async init(carId = 'porsche911'): Promise<void> {
    gameStore.getState().setPhase('loading')
    await initRapier()
    if (this.disposed) return

    this.physics = new PhysicsWorld()
    const scene = this.renderer.scene

    this.environment = new Environment(scene)
    scene.add(this.environment.group)

    this.track = new Track(TEST_CIRCUIT, this.physics.world)
    scene.add(this.track.group)

    const { config: base, model } = await this.loadCar(carId)
    if (this.disposed) return
    const build = gameStore.getState().build
    this.baseConfig = base
    gameStore.setState({ carName: base.name })
    const config = applyCarBuild(base, build)
    this.vehicle = new Vehicle(config, model, this.physics.world, this.track.spawn)
    this.livery = new CarLivery(model)
    this.livery.apply(build)
    scene.add(model.root)
    this.effects = new DrivingEffects(this.vehicle)
    scene.add(this.effects.group)

    const spawn = this.track.spawn
    this.showroom = new Showroom(this.renderer.renderer)
    this.showroom.placeAt(spawn.position, spawn.heading)
    scene.add(this.showroom.group)

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

  /** Drag-to-rotate in the garage; pauses the auto-turntable for a moment. */
  rotateShowroom(deltaRadians: number): void {
    if (this.showroomFocus === 'wheel') {
      this.wheelYaw = THREE.MathUtils.clamp(this.wheelYaw + deltaRadians, -0.7, 0.7)
      return
    }
    this.showroomYaw += deltaRadians
    this.showroomIdle = 2.5
  }

  /** Garage tabs call this: 'wheel' glides the camera to the front-left wheel. */
  setShowroomFocus(focus: ShowroomFocus): void {
    if (focus === this.showroomFocus) return
    this.showroomFocus = focus
    this.wheelYaw = 0
    if (focus === 'car') this.showroomIdle = 1.5
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
    this.effects.clear()
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

    const inMenu = phase === 'menu' || phase === 'garage' || phase === 'loading'
    const controls = this.race.controlsEnabled && !inMenu && phase !== 'finished'
    this.vehicle.fixedUpdate(controls ? this.input.state : LOCKED_INPUT, dt)
    this.physics.step(dt)
    this.vehicle.capture()
    this.race.update(dt, this.vehicle.position)
  }

  private renderFrame(alpha: number, dt: number): void {
    const phase = gameStore.getState().phase
    this.vehicle.render(phase === 'paused' ? 1 : alpha)
    if (phase === 'menu' || phase === 'garage') {
      const wheel = phase === 'garage' && this.showroomFocus === 'wheel'
      if (wheel) {
        // Front-left wheel axle in car space (+X is the car's left), seen from a low front three-quarter.
        const fl = this.vehicle.config.wheels.find((w) => w.id === 'FL') ?? this.vehicle.config.wheels[0]
        this.wheelFraming.focus.set(fl.position[0], fl.radius, fl.position[2])
        this.camera.showroom(this.vehicle.model.root, Math.PI / 2 - 0.55 + this.wheelYaw, dt, this.wheelFraming)
      } else {
        if (this.showroomIdle > 0) this.showroomIdle -= dt
        else this.showroomYaw += dt * 0.25
        this.carFraming.shift = phase === 'garage' ? 1.2 : 0
        this.camera.showroom(this.vehicle.model.root, this.showroomYaw, dt, this.carFraming)
      }
    } else if (phase !== 'paused') {
      this.camera.update(this.vehicle.model.root, this.vehicle.speedKmh, dt, this.vehicle.controller.nitro.intensity)
      this.effects.update(this.vehicle, dt)
    }
    this.environment.follow(this.vehicle.position)
    this.showroom.update(dt)

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
      nitro: ctrl.nitro.charge,
      nitroActive: ctrl.nitro.active,
      nitroReady: ctrl.nitro.charge >= this.vehicle.config.nitro.minCharge,
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

  /** Menu and garage show the car in the showroom; racing shows the track. */
  private updateShowroom(phase: GamePhase): void {
    if (!this.showroom) return
    const inShowroom = phase === 'menu' || phase === 'garage'
    this.showroom.setActive(this.renderer.scene, inShowroom, [this.track.group, this.environment.group, this.effects.group])
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
    telemetryStore.setState({ redlineRpm: config.engine.redlineRpm })
    this.vehicle.render(1)
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
    this.livery?.dispose()
    this.effects?.dispose()
    this.showroom?.dispose()
    this.track?.dispose()
    this.environment?.dispose()
    this.physics?.dispose()
    this.renderer.dispose()
  }
}
