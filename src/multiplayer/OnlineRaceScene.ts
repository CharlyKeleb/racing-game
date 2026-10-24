import { PredictionReconciler } from './PredictionReconciler'
import { PredictionWorld } from '../simulation/PredictionWorld'
import { lobbyStore, openCorrectionStream, sendScheduledRaceInput, restoreMailboxControls } from './LobbyClient'
import type { InputState } from '../input/InputManager'
import * as THREE from 'three'
import { ChaseCamera } from '../camera/ChaseCamera'
import type { Renderer } from '../engine/Renderer'
import type { AssetManager } from '../engine/AssetManager'
import type { AudioManager, CarSoundState } from '../audio/AudioManager'
import type { Environment } from '../world/Environment'
import type { RaceTrack } from '../world/RaceTrack'
import { applyCarReflections } from '../world/CarReflections'
import { rigCarModel, type CarModel } from '../vehicles/CarModel'
import { getCar } from '../vehicles/carRegistry'
import { resolveVehicleConfig, type VehicleConfig } from '../vehicles/VehicleConfig'
import type { Settings } from '../stores/gameStore'
import { RACE_PROTOCOL, type LobbySnapshot, type RaceSnapshot, type RaceVehicleState } from '../../server/src/protocol'
import { SIMULATION_VERSION } from '../simulation/HeadlessSimulation'
import { SnapshotBuffer, emptyVehicleState } from './SnapshotBuffer'
import { onlineRaceStore, RELEASED_ONLINE_INPUT } from './onlineRaceStore'

interface SceneContext { renderer: Renderer; assets: AssetManager; environment: Environment; track: RaceTrack; audio: AudioManager; settings: Settings }
interface VisualCar { model: CarModel; config: VehicleConfig; state: RaceVehicleState; spin: number }
interface BrowserManifest { protocol: number; simulationVersion: number; fingerprint: string; track: string; cars: string[] }

/** Server-owned race presentation, with optional isolated own-car prediction. Never runs local race rules or results. */
export class OnlineRaceScene {
  readonly buffer: SnapshotBuffer
  private readonly context: SceneContext
  private readonly group = new THREE.Group()
  private readonly camera: ChaseCamera
  private readonly cars: VisualCar[] = []
  private readonly playerCar: VisualCar
  private readonly materials = new Set<THREE.Material>()
  private readonly visibility = new Map<THREE.Object3D, boolean>()
  private readonly velocity = new THREE.Vector3()
  private readonly sound: CarSoundState = { rpm: 900, gear: 1, throttle: 0, nitro: 0, nitroActive: false, nitroPerfect: false }
  private publishedAt = -Infinity
  private prediction: PredictionReconciler | null = null
  private predictionWorld: PredictionWorld | null = null
  private readonly predicted = emptyVehicleState('')
  private readonly previousPredictionPosition = new THREE.Vector3()
  private readonly previousPredictionRotation = new THREE.Quaternion()
  private readonly predictionQuaternion = new THREE.Quaternion()
  private readonly predictionOffset = new THREE.Vector3()
  private stopCorrections?: () => void
  private predictionEpoch = -1
  private predictionDisabled = false
  private correctionsStartedAt = -Infinity
  private readonly race: NonNullable<LobbySnapshot['race']>
  private readonly playerCarId: LobbySnapshot['racers'][number]['carId']

  static async load(context: SceneContext, lobby: LobbySnapshot, playerId: string): Promise<OnlineRaceScene> {
    const race = lobby.race
    const manifest = await context.assets.loadJson<BrowserManifest>('/multiplayer/manifest.json')
    if (!race || !manifest || race.protocol !== RACE_PROTOCOL || manifest.protocol !== RACE_PROTOCOL
      || manifest.fingerprint !== race.fingerprint || manifest.simulationVersion !== race.simulationVersion
      || race.simulationVersion !== SIMULATION_VERSION || manifest.track !== context.track.id
      || lobby.racers.length !== 2 || !lobby.racers.some(r => r.id === playerId)
      || lobby.racers.some(r => !manifest.cars.includes(r.carId))) throw new Error('Your game version does not match this race. Refresh the game and rejoin.')
    const loaded = await Promise.all(lobby.racers.map(async racer => {
      const entry = getCar(racer.carId)
      const [scene, json] = await Promise.all([
        context.assets.loadModel(context.settings.quality === 'low' && entry.modelUrlLow ? entry.modelUrlLow : entry.modelUrl),
        context.assets.loadJson<Partial<VehicleConfig>>(entry.configUrl),
      ])
      if (!json) throw new Error('Your car could not load. Rejoin the lobby to try again.')
      return { id: racer.id, scene, config: resolveVehicleConfig(json) }
    }))
    return new OnlineRaceScene(context, lobby, playerId, loaded)
  }

  private constructor(context: SceneContext, lobby: LobbySnapshot, playerId: string,
    loaded: { id: string; scene: THREE.Group; config: VehicleConfig }[]) {
    this.context = context
    this.race = { ...lobby.race! }
    this.playerCarId = lobby.racers.find(r => r.id === playerId)!.carId
    this.buffer = new SnapshotBuffer(lobby.race!.id, lobby.racers.map(r => r.id))
    this.camera = new ChaseCamera(context.renderer.camera)
    this.camera.cameraMotion = context.settings.cameraMotion
    this.camera.fovEffects = context.settings.fovEffects
    for (const car of loaded) {
      // Assets own geometry/textures. Only these material copies belong to this scene.
      car.scene.traverse(o => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        const clone = (m: THREE.Material) => { const own = m.clone(); this.materials.add(own); return own }
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material)
      })
      const model = rigCarModel(car.scene, car.config)
      model.root.visible = false
      this.cars.push({ model, config: car.config, state: emptyVehicleState(car.id), spin: 0 })
      const reflections = context.environment.carEnvironment
      applyCarReflections(model.root, reflections.map, reflections.intensity)
      this.group.add(model.root)
    }
    this.playerCar = this.cars.find(car => car.state.id === playerId)!
    const latency = lobbyStore.getState().connectionLatency
    const lead = latency ? Math.max(6, Math.ceil((latency.rttMs + latency.variationMs) * .06) + 4) : Infinity
    if (import.meta.env.VITE_ONLINE_PREDICTION === '1' && this.race.scheduledInputVersion === 1
      && this.race.correctionVersion === 1 && context.track.createPredictionWorld && lead <= 18) {
      let world: ReturnType<NonNullable<RaceTrack['createPredictionWorld']>> | undefined
      try {
        world = context.track.createPredictionWorld()
        this.predictionWorld = new PredictionWorld(world, this.playerCar.config, (x, z) => context.track.surfaceAt(x, z))
        this.prediction = new PredictionReconciler(this.predictionWorld, (tick, input) => sendScheduledRaceInput(tick, input) !== null, lead)
      } catch { world?.free(); this.predictionWorld = null; this.prediction = null }
    }
    for (const child of context.renderer.scene.children) {
      this.visibility.set(child, child.visible)
      child.visible = child === context.track.group || child === context.environment.group
    }
    context.renderer.scene.add(this.group)
    context.renderer.setMotionBlur(0, null)
    context.renderer.setBoostBlur(0)
    context.renderer.setHaze(null)
    const entry = getCar(lobby.racers.find(r => r.id === playerId)!.carId)
    context.audio.setCarAudio(entry.audioUrl, entry.firingPerRev, entry.noise, entry.voice)
    context.audio.setScene('race')
    context.audio.setMenuEngine(false)
    context.audio.resume()
  }

  push(snapshot: RaceSnapshot, now: number): void { this.buffer.push(snapshot, now) }

  /** Read-only development fixture diagnostics; not used by the player HUD or physics loop. */
  debugPrediction() {
    return { enabled: !!this.prediction, ready: this.prediction?.ready ?? false, disabled: this.predictionDisabled,
      tick: this.prediction?.predictedTick ?? null, leadTicks: this.prediction?.leadTicks ?? null,
      streamOpen: !!this.stopCorrections, x: this.playerCar.model.root.position.x, z: this.playerCar.model.root.position.z }
  }

  resetPrediction(): void {
    this.stopCorrections?.(); this.stopCorrections = undefined
    this.prediction?.suspend(); this.predictionOffset.set(0, 0, 0)
    if (this.prediction) restoreMailboxControls()
  }

  /** Optional experimental own-car physics. Remote cars always stay in the snapshot presentation buffer. */
  fixedUpdate(input: InputState, now: number): boolean {
    if (!this.prediction || !this.predictionWorld || this.predictionDisabled) return false
    const lobby = lobbyStore.getState(), online = onlineRaceStore.getState(), latency = lobby.connectionLatency
    if (lobby.status !== 'connected' || !latency || online.menuOpen || online.finished || online.resultsOpen || this.buffer.delayed(now)
      || !['countdown', 'racing'].includes(lobby.snapshot?.phase ?? '')) {
      this.resetPrediction(); return false
    }
    const requiredLead = Math.ceil((latency.rttMs + latency.variationMs) * .06) + 4
    if (requiredLead > this.prediction.leadTicks) { this.predictionDisabled = true; this.resetPrediction(); return false }
    if (this.predictionEpoch !== lobby.connectionEpoch) { this.resetPrediction(); this.predictionEpoch = lobby.connectionEpoch }
    if (!this.stopCorrections) {
      this.correctionsStartedAt = now
      this.stopCorrections = openCorrectionStream(this.race, this.playerCarId, this.playerCar.config, state => {
        if (!this.prediction || !this.predictionWorld) return
        const wasReady = this.prediction.ready
        if (!this.prediction.accept(state, performance.now())) return
        this.predictionWorld.read(this.predicted)
        this.previousPredictionPosition.set(this.predicted.position.x, this.predicted.position.y, this.predicted.position.z)
        this.previousPredictionRotation.set(this.predicted.rotation.x, this.predicted.rotation.y, this.predicted.rotation.z, this.predicted.rotation.w)
        if (wasReady && this.playerCar.model.root.visible) {
          this.predictionOffset.copy(this.playerCar.model.root.position).sub(this.previousPredictionPosition)
          if (this.predictionOffset.lengthSq() > 25) this.predictionOffset.set(0, 0, 0)
        } else this.predictionOffset.set(0, 0, 0)
      })
    }
    if (!this.prediction.ready) {
      if (now - this.correctionsStartedAt > 1000) { this.predictionDisabled = true; this.resetPrediction(); return false }
      return true // Wait for a validated base; never launch physics from a rendered pose.
    }
    this.predictionWorld.read(this.predicted)
    this.previousPredictionPosition.set(this.predicted.position.x, this.predicted.position.y, this.predicted.position.z)
    this.previousPredictionRotation.set(this.predicted.rotation.x, this.predicted.rotation.y, this.predicted.rotation.z, this.predicted.rotation.w)
    const controls = this.buffer.latest?.phase === 'racing' ? input : RELEASED_ONLINE_INPUT
    if (this.prediction.advance(controls, now)) return true
    restoreMailboxControls(); return false
  }

  render(now: number, dt: number, lookBack: boolean, alpha = 1): void {
    const h = Math.min(.1, Math.max(0, dt))
    for (let index = 0; index < this.cars.length; index++) {
      const car = this.cars[index]
      if (car === this.playerCar && this.prediction?.ready && this.predictionWorld && this.buffer.latest?.phase === 'racing') {
        this.predictionWorld.read(car.state)
        const a = Math.max(0, Math.min(1, alpha))
        this.predictionOffset.multiplyScalar(Math.exp(-h / .1))
        car.state.position.x = this.previousPredictionPosition.x + (car.state.position.x - this.previousPredictionPosition.x) * a + this.predictionOffset.x
        car.state.position.y = this.previousPredictionPosition.y + (car.state.position.y - this.previousPredictionPosition.y) * a + this.predictionOffset.y
        car.state.position.z = this.previousPredictionPosition.z + (car.state.position.z - this.previousPredictionPosition.z) * a + this.predictionOffset.z
        this.predictionQuaternion.set(car.state.rotation.x, car.state.rotation.y, car.state.rotation.z, car.state.rotation.w)
          .slerp(this.previousPredictionRotation, 1 - a)
        car.state.rotation.x = this.predictionQuaternion.x; car.state.rotation.y = this.predictionQuaternion.y
        car.state.rotation.z = this.predictionQuaternion.z; car.state.rotation.w = this.predictionQuaternion.w
      } else if (!this.buffer.sample(car.state.id, now, car.state)) continue
      const state = car.state, root = car.model.root
      root.visible = true
      root.position.set(state.position.x, state.position.y, state.position.z)
      root.quaternion.set(state.rotation.x, state.rotation.y, state.rotation.z, state.rotation.w)
      car.spin += state.speed * h
      for (let i = 0; i < car.config.wheels.length; i++) {
        const wheel = car.config.wheels[i], rig = car.model.wheels[wheel.id]
        rig.pivot.position.set(wheel.position[0], wheel.position[1] - (state.wheelOffsets?.[i] ?? car.config.suspension.restLength), wheel.position[2])
        rig.pivot.rotation.y = wheel.steered ? state.steer : 0
        rig.spinner.rotation.x = car.spin / wheel.radius
      }
    }
    const player = this.playerCar
    if (player.model.root.visible) {
      const state = player.state
      this.camera.lookBack = lookBack
      this.camera.update(player.model.root, Math.abs(state.speed) * 3.6, h, state.nitroIntensity ?? 0)
      this.velocity.set(state.velocity.x, state.velocity.y, state.velocity.z)
      this.context.track.update(player.model.root.position, this.velocity, h)
      this.context.environment.follow(player.model.root.position)
      this.sound.rpm = state.rpm; this.sound.gear = state.gear
      this.sound.throttle = state.rpm > player.config.engine.idleRpm + 500 ? .6 : 0
      this.sound.nitro = state.nitroIntensity ?? 0; this.sound.nitroActive = this.sound.nitro > .01
      this.context.audio.update(this.sound)
      this.context.audio.setRaceMusicActive(this.buffer.latest?.phase === 'racing')
      if (now - this.publishedAt >= 50) {
        this.publishedAt = now
        onlineRaceStore.setState({ resultsOpen: this.buffer.latest?.phase === 'finished', finished: this.buffer.latest?.phase === 'finished' || this.buffer.latest?.progress?.find(p => p.id === state.id)?.finishTicks != null, loaded: true, delayed: this.buffer.delayed(now), speedKmh: Math.abs(state.speed) * 3.6,
          rpm: state.rpm, gear: state.gear, nitro: state.nitro,
          countdown: this.buffer.latest?.phase === 'countdown' ? this.buffer.latest.countdownTicks / 60 : null })
      }
    }
    this.context.renderer.render()
  }

  dispose(): void {
    this.resetPrediction(); this.predictionWorld?.dispose(); this.predictionWorld = null; this.prediction = null
    this.group.removeFromParent()
    for (const material of this.materials) material.dispose()
    this.materials.clear()
    this.cars.length = 0
    for (const [child, visible] of this.visibility) child.visible = visible
    this.visibility.clear()
    this.context.audio.setRaceMusicActive(false)
  }
}
