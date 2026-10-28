import { MAX_PREDICTION_LEAD_TICKS, PredictionReconciler } from './PredictionReconciler'
import type { ConnectionLatencySample } from './ConnectionLatency'
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
import { FINISH_WINDOW_TICKS, RACE_PROTOCOL, type LobbySnapshot, type RaceSnapshot, type RaceVehicleState } from '../../server/src/protocol'
import { SIMULATION_VERSION } from '../simulation/HeadlessSimulation'
import { SnapshotBuffer, emptyVehicleState } from './SnapshotBuffer'
import { onlineRaceStore, RELEASED_ONLINE_INPUT } from './onlineRaceStore'
import { MISSED_GATE_METRES, RaceStandings, type RaceEntry } from '../racing/RaceStandings'
import { TrackProgress } from '../racing/TrackProgress'
import { telemetryStore } from '../stores/telemetryStore'

interface SceneContext { renderer: Renderer; assets: AssetManager; environment: Environment; track: RaceTrack; audio: AudioManager; settings: Settings }
interface VisualCar { model: CarModel; config: VehicleConfig; state: RaceVehicleState; spin: number; entry: RaceEntry; progress: TrackProgress | null }
/** Correction error larger than this (m) is a real divergence: snap instead of sliding the car across. */
const MAX_BLEND_METRES = 5
/** Time constants (s) for blending a correction's position and rotation error away. */
const POSITION_BLEND = .18
const ROTATION_BLEND = .12
const GO_TICKS = 54
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
  /** Own car's last drawn position; a jump beyond normal motion (a reset or a snapped correction) snaps the camera. */
  private readonly drawnPosition = new THREE.Vector3()
  private drawn = false
  private readonly sound: CarSoundState = { rpm: 900, gear: 1, throttle: 0, nitro: 0, nitroActive: false, nitroPerfect: false }
  private publishedAt = -Infinity
  private prediction: PredictionReconciler | null = null
  private predictionWorld: PredictionWorld | null = null
  private readonly predicted = emptyVehicleState('')
  private readonly previousPredictionPosition = new THREE.Vector3()
  private readonly previousPredictionRotation = new THREE.Quaternion()
  private readonly predictionQuaternion = new THREE.Quaternion()
  private readonly predictionOffset = new THREE.Vector3()
  /** Predicted motion of one fixed tick, used to keep clock nudges from showing as a skip or a stall. */
  private readonly tickDisplacement = new THREE.Vector3()
  /** Rotation error left by the last corrections, applied on top of the predicted pose and eased to identity. */
  private readonly rotationOffset = new THREE.Quaternion()
  private readonly beforeCorrection = emptyVehicleState('')
  private readonly correctionDelta = new THREE.Quaternion()
  private readonly scratchQuaternion = new THREE.Quaternion()
  private readonly identity = new THREE.Quaternion()
  private predictedThrottle = 0
  private readonly standings: RaceStandings | null
  private readonly laps: number
  private stopCorrections?: () => void
  private predictionEpoch = -1
  private predictionDisabled = false
  private correctionsStartedAt = -Infinity
  private predictionRetryAt = -Infinity
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
    this.laps = Math.max(1, lobby.laps ?? 1)
    const line = context.track.line, checkpoints = context.track.checkpoints
    this.standings = line?.length && checkpoints?.length ? new RaceStandings(line, checkpoints) : null
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
      const racer = lobby.racers.find(r => r.id === car.id)
      this.cars.push({ model, config: car.config, state: emptyVehicleState(car.id), spin: 0,
        entry: { id: this.cars.length, name: racer?.displayName ?? 'Racer', player: car.id === playerId, lap: 1, checkpoint: 0, index: 0, finishMs: null },
        progress: this.standings ? new TrackProgress(context.track.line) : null })
      const reflections = context.environment.carEnvironment
      applyCarReflections(model.root, reflections.map, reflections.intensity)
      this.group.add(model.root)
    }
    this.playerCar = this.cars.find(car => car.state.id === playerId)!
    const latency = lobbyStore.getState().connectionLatency
    if (latency) this.ensurePrediction(latency)
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

  private ensurePrediction(latency: ConnectionLatencySample): boolean {
    if (this.predictionDisabled || import.meta.env.VITE_ONLINE_PREDICTION === '0' || this.race.scheduledInputVersion !== 1
      || this.race.correctionVersion !== 1 || !this.context.track.createPredictionWorld) return false
    // variationMs is the max-min range of eight samples (one loading hitch inflates it), so half of it
    // covers typical jitter. A rare late input only costs a smoothed correction; giving up on prediction
    // puts a full round trip on every control, so only an RTT beyond the server's input window disables it.
    if (!Number.isFinite(latency.rttMs) || !Number.isFinite(latency.variationMs)
      || Math.ceil(latency.rttMs * .06) + 2 > MAX_PREDICTION_LEAD_TICKS) return false
    const required = Math.min(MAX_PREDICTION_LEAD_TICKS, Math.max(6, Math.ceil((latency.rttMs + latency.variationMs / 2) * .06) + 4))
    if (!this.predictionWorld) {
      let world: ReturnType<NonNullable<RaceTrack['createPredictionWorld']>> | undefined
      try {
        world = this.context.track.createPredictionWorld()
        this.predictionWorld = new PredictionWorld(world, this.playerCar.config, (x, z) => this.context.track.surfaceAt(x, z))
      } catch { world?.free(); this.predictionDisabled = true; return false }
    }
    // Reserve a little RTT headroom rather than disabling local controls on the next sample.
    const lead = Math.min(MAX_PREDICTION_LEAD_TICKS, required + 3)
    if (!this.prediction) this.prediction = new PredictionReconciler(this.predictionWorld, (tick, input) => sendScheduledRaceInput(tick, input) !== null, lead)
    // Retarget in place when ping moves: the predicted clock drifts to the new lead without a reboot.
    else if (required > this.prediction.leadTicks || this.prediction.leadTicks - lead > 3) this.prediction.setLeadTicks(lead)
    return true
  }

  private snapPrediction(): void {
    const p = this.predicted.position, q = this.predicted.rotation
    this.previousPredictionPosition.set(p.x, p.y, p.z)
    this.previousPredictionRotation.set(q.x, q.y, q.z, q.w)
    this.predictionOffset.set(0, 0, 0); this.rotationOffset.identity()
  }

  private get predicting(): boolean {
    const phase = this.buffer.latest?.phase
    return !!this.prediction?.ready && !!this.predictionWorld && (phase === 'racing' || phase === 'countdown')
  }

  push(snapshot: RaceSnapshot, now: number): void { this.buffer.push(snapshot, now) }

  /** Read-only development fixture diagnostics; not used by the player HUD or physics loop. */
  debugPrediction() {
    return { enabled: !!this.prediction, ready: this.prediction?.ready ?? false, disabled: this.predictionDisabled,
      tick: this.prediction?.predictedTick ?? null, leadTicks: this.prediction?.leadTicks ?? null,
      streamOpen: !!this.stopCorrections, x: this.playerCar.model.root.position.x, z: this.playerCar.model.root.position.z,
      steer: this.playerCar.state.steer, speed: this.playerCar.state.speed }
  }

  resetPrediction(): void {
    this.stopCorrections?.(); this.stopCorrections = undefined
    this.prediction?.suspend(); this.predictionOffset.set(0, 0, 0); this.rotationOffset.identity()
    if (this.prediction) restoreMailboxControls()
  }

  /** Own-car controls run locally; remote cars stay in the snapshot presentation buffer. */
  fixedUpdate(input: InputState, now: number): boolean {
    const lobby = lobbyStore.getState(), online = onlineRaceStore.getState(), latency = lobby.connectionLatency
    if (lobby.status !== 'connected' || !latency || online.menuOpen || online.finished || online.resultsOpen || this.buffer.delayed(now)
      || !['countdown', 'racing'].includes(lobby.snapshot?.phase ?? '')) {
      this.resetPrediction(); return false
    }
    if (now < this.predictionRetryAt || !this.ensurePrediction(latency) || !this.prediction || !this.predictionWorld) { this.resetPrediction(); return false }
    if (this.predictionEpoch !== lobby.connectionEpoch) { this.resetPrediction(); this.predictionEpoch = lobby.connectionEpoch }
    if (!this.stopCorrections) {
      this.correctionsStartedAt = now
      this.stopCorrections = openCorrectionStream(this.race, this.playerCarId, this.playerCar.config, state => {
        if (!this.prediction || !this.predictionWorld) return
        const wasReady = this.prediction.ready
        if (wasReady) this.predictionWorld.read(this.beforeCorrection)
        if (!this.prediction.accept(state, performance.now())) return
        this.predictionWorld.read(this.predicted)
        const p = this.predicted.position, q = this.predicted.rotation, before = this.beforeCorrection.position
        if (wasReady && this.playerCar.model.root.visible) {
          // Keep the drawn car where it was: shift the interpolation base by the correction, carry the
          // difference as an offset and ease it away over a few frames instead of snapping 10 times a second.
          const dx = before.x - p.x, dy = before.y - p.y, dz = before.z - p.z
          this.predictionOffset.x += dx; this.predictionOffset.y += dy; this.predictionOffset.z += dz
          this.previousPredictionPosition.x -= dx; this.previousPredictionPosition.y -= dy; this.previousPredictionPosition.z -= dz
          const r = this.beforeCorrection.rotation
          this.correctionDelta.set(r.x, r.y, r.z, r.w).multiply(this.scratchQuaternion.set(q.x, q.y, q.z, q.w).invert())
          this.rotationOffset.multiply(this.correctionDelta)
          this.previousPredictionRotation.premultiply(this.correctionDelta.invert())
          if (this.predictionOffset.lengthSq() > MAX_BLEND_METRES * MAX_BLEND_METRES) this.snapPrediction()
        } else this.snapPrediction()
      })
    }
    if (!this.prediction.ready) {
      if (now - this.correctionsStartedAt > 1000) { this.resetPrediction(); this.predictionRetryAt = now + 1000; return false }
      return true // Wait for a validated base; never launch physics from a rendered pose.
    }
    this.predictionWorld.read(this.predicted)
    this.previousPredictionPosition.set(this.predicted.position.x, this.predicted.position.y, this.predicted.position.z)
    this.previousPredictionRotation.set(this.predicted.rotation.x, this.predicted.rotation.y, this.predicted.rotation.z, this.predicted.rotation.w)
    const controls = this.buffer.latest?.phase === 'racing' ? input : RELEASED_ONLINE_INPUT
    this.predictedThrottle = controls.throttle
    if (this.prediction.advance(controls, now)) {
      this.predictionWorld.read(this.predicted)
      const p = this.predicted.position, base = this.previousPredictionPosition, steps = this.prediction.lastSteps
      if (steps === 1) this.tickDisplacement.set(p.x - base.x, p.y - base.y, p.z - base.z)
      else if (this.playerCar.model.root.visible) {
        // A clock nudge stepped 0 or 2+ ticks: draw one tick of motion and ease the remainder in like a correction.
        if (steps > 1) this.tickDisplacement.set((p.x - base.x) / steps, (p.y - base.y) / steps, (p.z - base.z) / steps)
        const d = this.tickDisplacement
        this.predictionOffset.x += base.x + d.x - p.x; this.predictionOffset.y += base.y + d.y - p.y; this.predictionOffset.z += base.z + d.z - p.z
        base.set(p.x - d.x, p.y - d.y, p.z - d.z)
        if (this.predictionOffset.lengthSq() > MAX_BLEND_METRES * MAX_BLEND_METRES) this.snapPrediction()
      }
      return true
    }
    restoreMailboxControls(); return false
  }

  render(now: number, dt: number, lookBack: boolean, alpha = 1): void {
    const h = Math.min(.1, Math.max(0, dt))
    for (let index = 0; index < this.cars.length; index++) {
      const car = this.cars[index]
      if (car === this.playerCar && this.predicting) {
        this.predictionWorld!.read(car.state)
        const a = Math.max(0, Math.min(1, alpha))
        this.predictionOffset.multiplyScalar(Math.exp(-h / POSITION_BLEND))
        this.rotationOffset.slerp(this.identity, 1 - Math.exp(-h / ROTATION_BLEND))
        car.state.position.x = this.previousPredictionPosition.x + (car.state.position.x - this.previousPredictionPosition.x) * a + this.predictionOffset.x
        car.state.position.y = this.previousPredictionPosition.y + (car.state.position.y - this.previousPredictionPosition.y) * a + this.predictionOffset.y
        car.state.position.z = this.previousPredictionPosition.z + (car.state.position.z - this.previousPredictionPosition.z) * a + this.predictionOffset.z
        this.predictionQuaternion.set(car.state.rotation.x, car.state.rotation.y, car.state.rotation.z, car.state.rotation.w)
          .slerp(this.previousPredictionRotation, 1 - a).premultiply(this.rotationOffset)
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
      const jump = MAX_BLEND_METRES + Math.abs(state.speed) * h * 2
      if (this.drawn && this.drawnPosition.distanceToSquared(player.model.root.position) > jump * jump) this.camera.snap()
      this.drawnPosition.copy(player.model.root.position); this.drawn = true
      this.camera.lookBack = lookBack
      this.camera.update(player.model.root, Math.abs(state.speed) * 3.6, h, state.nitroIntensity ?? 0)
      this.velocity.set(state.velocity.x, state.velocity.y, state.velocity.z)
      this.context.track.update(player.model.root.position, this.velocity, h)
      this.context.environment.follow(player.model.root.position)
      this.sound.rpm = state.rpm; this.sound.gear = state.gear
      this.sound.throttle = this.predicting ? this.predictedThrottle : state.rpm > player.config.engine.idleRpm + 500 ? .6 : 0
      this.sound.nitro = state.nitroIntensity ?? 0; this.sound.nitroActive = this.sound.nitro > .01
      this.context.audio.update(this.sound)
      this.context.audio.setRaceMusicActive(this.buffer.latest?.phase === 'racing')
      if (now - this.publishedAt >= 50) {
        this.publishedAt = now
        this.publish(now)
      }
    }
    this.context.renderer.render()
  }

  /** HUD state at 20 Hz, in the same shape the offline HUD reads, from server timing and drawn poses. */
  private publish(now: number): void {
    const latest = this.buffer.latest, state = this.playerCar.state, config = this.playerCar.config
    const progress = latest?.progress?.find(p => p.id === state.id)
    const racingTicks = latest ? Math.max(0, latest.tick - this.race.countdownTicks) : 0
    const lapTicks = progress?.lapTicks ?? []
    let standings = onlineRaceStore.getState().standings
    if (this.standings && latest?.progress) {
      const count = this.context.track.checkpoints.length
      for (const car of this.cars) {
        const p = latest.progress.find(row => row.id === car.state.id), entry = car.entry
        if (!p || !car.progress) continue
        entry.x = car.model.root.position.x; entry.z = car.model.root.position.z
        entry.index = car.progress.update(entry.x, entry.z)
        entry.lap = Math.min(this.laps, p.completedLaps + 1)
        entry.checkpoint = ((p.nextCheckpoint - 1) % count + count) % count
        entry.finishMs = p.finishTicks !== null ? p.finishTicks * 1000 / 60 : null
      }
      standings = this.standings.snapshot(this.cars.map(car => car.entry))
      const self = this.playerCar.entry, rival = this.cars.filter(car => car !== this.playerCar)
      const forward = this.playerCar.model.root.quaternion
      telemetryStore.setState({
        carX: self.x ?? 0, carZ: self.z ?? 0, heading: Math.atan2(2 * (forward.w * forward.y + forward.x * forward.z), 1 - 2 * (forward.y * forward.y + forward.x * forward.x)),
        trackIndex: self.index, distanceLeft: self.finishMs !== null ? 0 : Math.max(0, this.laps * this.standings.lapLength - this.standings.distance(self)),
        opponents: rival.filter(car => car.model.root.visible).map(car => ({ id: car.entry.id, x: car.model.root.position.x, z: car.model.root.position.z })),
        // The server only counts ordered gates: without this a cut gate silently stops lap progress.
        missedCheckpoint: latest.phase === 'racing' && self.finishMs === null && this.standings.overrun(self) > MISSED_GATE_METRES,
      })
    }
    const finished = latest?.phase === 'finished'
    let firstFinish = Infinity
    for (const row of latest?.progress ?? []) if (row.finishTicks !== null) firstFinish = Math.min(firstFinish, row.finishTicks)
    const finishWindowMs = latest?.phase === 'racing' && progress?.finishTicks == null && Number.isFinite(firstFinish)
      ? Math.max(0, firstFinish + FINISH_WINDOW_TICKS - racingTicks) * 1000 / 60 : null
    onlineRaceStore.setState({ resultsOpen: finished, finished: finished || progress?.finishTicks != null, loaded: true, delayed: this.buffer.delayed(now), speedKmh: Math.abs(state.speed) * 3.6,
      rpm: state.rpm, redlineRpm: config.engine.redlineRpm, gear: state.gear, nitro: state.nitro, nitroActive: (state.nitroIntensity ?? 0) > .01,
      countdown: latest?.phase === 'countdown' ? latest.countdownTicks / 60 : null,
      go: latest?.phase === 'racing' && racingTicks < GO_TICKS,
      lap: Math.min(this.laps, (progress?.completedLaps ?? 0) + 1), totalLaps: this.laps,
      currentLapMs: (progress?.finishTicks != null ? lapTicks.at(-1) ?? 0 : racingTicks - lapTicks.reduce((a, b) => a + b, 0)) * 1000 / 60,
      bestLapMs: lapTicks.length ? Math.min(...lapTicks) * 1000 / 60 : null, standings, finishWindowMs })
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
