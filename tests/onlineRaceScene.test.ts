import { expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { OnlineRaceScene } from '../src/multiplayer/OnlineRaceScene'
import { buildPlaceholderCar } from '../src/vehicles/CarModel'
import { DEFAULT_VEHICLE_CONFIG } from '../src/vehicles/VehicleConfig'
import { emptyVehicleState } from '../src/multiplayer/SnapshotBuffer'
import { RACE_PROTOCOL } from '../server/src/protocol'
const fingerprint = 'a'.repeat(64)
function fixture() {
  const track = new THREE.Group(), environment = new THREE.Group(), offlineCar = new THREE.Group()
  const renderer = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), render: vi.fn(), setHaze: vi.fn(), setMotionBlur: vi.fn(), setBoostBlur: vi.fn() }
  renderer.scene.add(track, environment, offlineCar)
  const manifest = { fingerprint, protocol: RACE_PROTOCOL, simulationVersion: 1, track: 'nurburgring', cars: ['porsche911'] }
  const assets = { loadJson: vi.fn(async (url: string) => url.includes('manifest') ? manifest : DEFAULT_VEHICLE_CONFIG), loadModel: vi.fn(async () => buildPlaceholderCar(DEFAULT_VEHICLE_CONFIG)) }
  const context = { renderer, assets, track: { id: 'nurburgring', group: track, update: vi.fn() }, environment: { group: environment, follow: vi.fn(), carEnvironment: { map: null, intensity: 1 } },
    settings: { quality: 'low', cameraMotion: false, fovEffects: false }, audio: { setCarAudio: vi.fn(), setScene: vi.fn(), setMenuEngine: vi.fn(), resume: vi.fn(), update: vi.fn(), setRaceMusicActive: vi.fn() } }
  const lobby = { race: { id: 'race', protocol: RACE_PROTOCOL, fingerprint, simulationVersion: 1 }, racers: [{ id: 'one', carId: 'porsche911' }, { id: 'two', carId: 'porsche911' }] }
  return { context, lobby, manifest, offlineCar, renderer, assets }
}
it('rejects an incompatible asset package before loading cars or altering the offline scene', async () => {
  const f = fixture(); f.manifest.fingerprint = 'wrong'
  await expect(OnlineRaceScene.load(f.context as never, f.lobby as never, 'one')).rejects.toThrow('version')
  expect(f.assets.loadModel).not.toHaveBeenCalled()
  expect(f.offlineCar.visible).toBe(true)
})
it('draws both cars using only network poses, then restores the offline scene on disposal', async () => {
  const f = fixture()
  const scene = await OnlineRaceScene.load(f.context as never, f.lobby as never, 'one')
  expect(f.offlineCar.visible).toBe(false)
  scene.push({ raceId: 'race', tick: 180, phase: 'racing', countdownTicks: 0, vehicles: [
    { ...emptyVehicleState('one'), position: { x: 20, y: 1, z: 10 }, acknowledgedSequence: 0 },
    { ...emptyVehicleState('two'), position: { x: 25, y: 1, z: 30 }, acknowledgedSequence: -1 },
  ] }, 1000)
  scene.render(1000, 1 / 60, false)
  expect(f.context.track.update).toHaveBeenCalledWith(expect.objectContaining({ x: 20, z: 10 }), expect.anything(), expect.anything())
  expect(f.renderer.render).toHaveBeenCalledTimes(1)
  const renderedCars: THREE.Object3D[] = []
  f.renderer.scene.traverse(o => { if (o.name === DEFAULT_VEHICLE_CONFIG.id) renderedCars.push(o) })
  expect(renderedCars).toHaveLength(2)
  expect(renderedCars.map(o => o.position.x)).toEqual([20, 25])
  scene.dispose()
  expect(f.offlineCar.visible).toBe(true)
  expect(f.renderer.scene.children).toHaveLength(3)
})
