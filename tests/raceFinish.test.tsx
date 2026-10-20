import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FinishSequence, FINISH_SECONDS } from '../src/racing/FinishSequence'
import { RaceFinishCamera } from '../src/camera/RaceFinishCamera'
import { GameLoop, FIXED_DT } from '../src/engine/GameLoop'
import { RaceFinish } from '../src/ui/RaceFinish'
import { Results } from '../src/ui/Results'
import { telemetryStore, initialTelemetry } from '../src/stores/telemetryStore'
import { gameStore } from '../src/stores/gameStore'

vi.mock('../src/ui/hooks', () => ({
  useGame: (select: (s: ReturnType<typeof gameStore.getState>) => unknown) => select(gameStore.getState()),
  useTelemetry: (select: (s: ReturnType<typeof telemetryStore.getState>) => unknown) => select(telemetryStore.getState()),
}))

it('uses real time for the finish, restores normal speed and resets cleanly', () => {
  const finish = new FinishSequence()
  finish.start()
  expect(finish.timeScale).toBe(1)
  finish.update(.4)
  expect(finish.timeScale).toBeCloseTo(.28)
  for (let i = 0; i < 120; i++) finish.update(1 / 60)
  expect(finish.active).toBe(true)
  expect(finish.timeScale).toBeGreaterThan(.28)
  finish.update(FINISH_SECONDS)
  expect(finish.active).toBe(false)
  expect(finish.timeScale).toBe(1)
  finish.start(); finish.skip()
  expect(finish.progress).toBe(1)
  finish.reset()
  expect(finish.started).toBe(false)
  expect(finish.timeScale).toBe(1)
})
it('respects reduced motion without slow motion', () => {
  const finish = new FinishSequence(); finish.start(true)
  expect(finish.timeScale).toBe(1)
  finish.update(1.2)
  expect(finish.active).toBe(false)
})
it('scales the simulation accumulator without changing fixed tick duration or render time', () => {
  const ticks: number[] = [], frames: number[] = []
  const loop = new GameLoop({ fixedUpdate: dt => ticks.push(dt), render: (_, dt) => frames.push(dt) })
  loop.timeScale = .25
  for (let i = 0; i < 60; i++) loop.advance(1 / 60)
  expect(ticks.length).toBe(15)
  expect(ticks.every(dt => dt === FIXED_DT)).toBe(true)
  expect(frames.reduce((a, b) => a + b, 0)).toBeCloseTo(1)
  loop.timeScale = 1
  for (let i = 0; i < 60; i++) loop.advance(1 / 60)
  expect(ticks.length).toBe(75)
})
it('matches the crossing view exactly and moves continuously at different headings', () => {
  for (const heading of [0, 1.3, Math.PI]) {
    const camera = new THREE.PerspectiveCamera(), car = new THREE.Object3D()
    car.position.set(100, 5, -70); car.rotation.y = heading
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(car.quaternion)
    camera.position.copy(car.position).addScaledVector(forward, -6); camera.position.y += 1.6
    camera.lookAt(car.position.clone().add(new THREE.Vector3(0, .7, 0))); camera.fov = 67
    camera.rotateZ(.02)
    const start = camera.position.clone(), rotation = camera.quaternion.clone()
    const finish = new RaceFinishCamera(camera); finish.start(car)
    finish.update(0, car)
    expect(camera.position.distanceTo(start)).toBeLessThan(1e-8)
    expect(camera.quaternion.angleTo(rotation)).toBeLessThan(1e-7)
    expect(camera.fov).toBe(67)
    let previous = camera.position.clone(), previousRotation = camera.quaternion.clone(), previousFov = camera.fov
    for (let frame = 0; frame <= 252; frame++) {
      const progress = frame / 252
      finish.update(progress, car); camera.updateMatrixWorld()
      const screen = car.position.clone().add(new THREE.Vector3(0, .65, 0)).project(camera)
      expect(camera.position.toArray().every(Number.isFinite)).toBe(true)
      expect(Math.abs(screen.x)).toBeLessThan(.8)
      expect(Math.abs(screen.y)).toBeLessThan(.8)
      expect(camera.position.distanceTo(car.position)).toBeGreaterThan(4)
      expect(camera.position.distanceTo(previous)).toBeLessThan(.12)
      expect(camera.quaternion.angleTo(previousRotation)).toBeLessThan(.04)
      expect(Math.abs(camera.fov - previousFov)).toBeLessThan(.15)
      previous.copy(camera.position); previousRotation.copy(camera.quaternion); previousFov = camera.fov
    }
  }
})
describe('finish outcome presentation', () => {
  it('distinguishes victory, other places and solo runs', () => {
    gameStore.setState({ settings: { ...gameStore.getState().settings, mode: 'quick' } })
    telemetryStore.setState({ ...initialTelemetry, finishFieldSize: 4, finishPosition: 1 })
    expect(renderToStaticMarkup(<RaceFinish />)).toContain('VICTORY')
    telemetryStore.setState({ finishPosition: 2 })
    expect(renderToStaticMarkup(<RaceFinish />)).toContain('P2')
    expect(renderToStaticMarkup(<RaceFinish />)).not.toContain('VICTORY')
    telemetryStore.setState({ finishFieldSize: 1, finishPosition: 1 })
    expect(renderToStaticMarkup(<RaceFinish />)).toContain('RUN COMPLETE')
  })
  it('does not label a rival still racing as a DNF', () => {
    telemetryStore.setState({ ...initialTelemetry, standings: [{ id: 0, name: 'You', player: true, position: 1, finishMs: 5000, gapMeters: 0, gapLaps: 0, gapMs: null }, { id: 1, name: 'Raven', player: false, position: 2, finishMs: null, gapMeters: 0, gapLaps: 0, gapMs: null }] })
    const html = renderToStaticMarkup(<Results />)
    expect(html).toContain('Racing')
    expect(html).not.toContain('DNF')
  })
})
