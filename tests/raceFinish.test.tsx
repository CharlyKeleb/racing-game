import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BLACKOUT, BRAKE_AT, FinishSequence, FINISH_SECONDS, SLIDE_AT, SLIDE_SECONDS, SLIDE_YAW, blackout, finishDrive, shotAt } from '../src/racing/FinishSequence'
import { RaceFinishCamera } from '../src/camera/RaceFinishCamera'
import { GameLoop, FIXED_DT } from '../src/engine/GameLoop'
import { RaceFinish } from '../src/ui/RaceFinish'
import { Results } from '../src/ui/Results'
import { telemetryStore, initialTelemetry } from '../src/stores/telemetryStore'
import { gameStore } from '../src/stores/gameStore'

vi.mock('../src/ui/hooks', () => ({
  useGame: (select: (s: ReturnType<typeof gameStore.getState>) => unknown) => select(gameStore.getState()),
  useTelemetry: (select: (s: ReturnType<typeof telemetryStore.getState>) => unknown) => select(telemetryStore.getState()),
  // No payout in these tests: the results screen leaves the coins panel out.
  useWallet: (select: (s: { lastPayout: null; coins: number }) => unknown) => select({ lastPayout: null, coins: 0 }),
  // Not in a career event: the ordinary race results.
  useCareer: (select: (s: { active: null; lastResult: null }) => unknown) => select({ active: null, lastResult: null }),
}))

it('runs the finish at normal speed, skips and resets cleanly', () => {
  const finish = new FinishSequence()
  finish.start()
  expect(finish.timeScale).toBe(1)
  finish.update(5)
  expect(finish.active).toBe(true)
  expect(finish.timeScale).toBe(1)
  finish.update(FINISH_SECONDS)
  expect(finish.active).toBe(false)
  finish.start(); finish.skip()
  expect(finish.progress).toBe(1)
  finish.reset()
  expect(finish.started).toBe(false)
})
it('respects reduced motion with a short outcome reveal', () => {
  const finish = new FinishSequence(); finish.start(true)
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
describe('finish shots and slide', () => {
  it('runs the shots in order with a dip to black before the beauty shots', () => {
    expect(shotAt(0.2).shot).toBe('line')
    expect(shotAt(1).shot).toBe('pass')
    expect(shotAt(2.5).shot).toBe('slide')
    expect(shotAt(5).shot).toBe('stop')
    expect(shotAt(8).shot).toBe('beauty-front')
    expect(shotAt(11).shot).toBe('beauty-rear')
    expect(shotAt(14).shot).toBe('beauty-nose')
    expect(blackout(5)).toBe(0)
    expect(blackout(BLACKOUT.black)).toBeCloseTo(1)
    expect(blackout(9)).toBe(0)
  })
  it('coasts past the camera, brakes, then slides round ~95° to a stop', () => {
    expect(finishDrive(0.5, 60).mode).toBe('coast')
    let speed = Infinity, yaw = 0
    for (let t = BRAKE_AT; t < SLIDE_AT + SLIDE_SECONDS + 0.5; t += 1 / 60) {
      const d = finishDrive(t, 60)
      if (d.mode === 'parked') break
      expect(d.speed).toBeLessThanOrEqual(speed + 1e-9) // never speeds up
      speed = d.speed
      yaw += d.yawRate / 60
    }
    expect(finishDrive(SLIDE_AT + SLIDE_SECONDS + 0.1, 60).mode).toBe('parked')
    expect(yaw).toBeCloseTo(SLIDE_YAW, 1)
    // A slow finish isn't sped up to slide.
    expect(finishDrive(SLIDE_AT, 8).speed).toBeCloseTo(8)
  })
  it('keeps the car in frame and the camera clear of it in every shot', () => {
    for (const heading of [0, 1.3, Math.PI]) for (const side of [1, -1] as const) {
      const camera = new THREE.PerspectiveCamera(50, 16 / 9), car = new THREE.Object3D()
      car.position.set(100, 5, -70); car.rotation.y = heading
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(car.quaternion)
      const finish = new RaceFinishCamera(camera); finish.start(car, { side, speed: 40, room: 25 })
      expect(finish.update(0.2, car)).toBe(false) // the line: chase camera
      for (let t = 0.6; t < FINISH_SECONDS; t += 0.05) {
        // Roughly the scripted path: rolling on, then stopped and swung round.
        if (t < 3.4) car.position.addScaledVector(forward, 0.05 * Math.max(0, 40 - t * 12))
        else car.rotation.y = heading + side * SLIDE_YAW
        car.updateMatrixWorld()
        expect(finish.update(t, car)).toBe(true)
        camera.updateMatrixWorld()
        const screen = car.position.clone().add(new THREE.Vector3(0, .55, 0)).project(camera)
        expect(camera.position.toArray().every(Number.isFinite)).toBe(true)
        expect(Math.abs(screen.x), `${shotAt(t).shot} x`).toBeLessThan(.9)
        expect(Math.abs(screen.y), `${shotAt(t).shot} y`).toBeLessThan(.9)
        expect(camera.position.distanceTo(car.position), shotAt(t).shot).toBeGreaterThan(2.5)
      }
    }
  })
})
describe('finish outcome presentation', () => {
  it('labels a podium, a lost place and a solo run, and stays quiet until the car has stopped', () => {
    gameStore.setState({ settings: { ...gameStore.getState().settings, mode: 'quick' } })
    telemetryStore.setState({ ...initialTelemetry, finishFieldSize: 4, finishPosition: 1, finishSeconds: 1, totalMs: 124051 })
    expect(renderToStaticMarkup(<RaceFinish />)).not.toContain('FINISH TOP 3')
    telemetryStore.setState({ finishSeconds: 5 })
    let html = renderToStaticMarkup(<RaceFinish />)
    expect(html).toContain('FINISH TOP 3')
    expect(html).toContain('1ST')
    expect(html).toContain('2:04.051')
    expect(html).toContain('is-done')
    telemetryStore.setState({ finishPosition: 4 })
    html = renderToStaticMarkup(<RaceFinish />)
    expect(html).toContain('4TH')
    expect(html).toContain('is-missed')
    telemetryStore.setState({ finishFieldSize: 1, finishPosition: 1 })
    expect(renderToStaticMarkup(<RaceFinish />)).toContain('SOLO RUN')
  })
  it('shows the place badge mid-slide', () => {
    telemetryStore.setState({ ...initialTelemetry, finishFieldSize: 4, finishPosition: 2, finishSeconds: 2.4 })
    const html = renderToStaticMarkup(<RaceFinish />)
    expect(html).toContain('race-finish__badge')
    expect(html).toContain('2ND')
  })
  it('does not label a rival still racing as a DNF', () => {
    telemetryStore.setState({ ...initialTelemetry, standings: [{ id: 0, name: 'You', player: true, position: 1, finishMs: 5000, gapMeters: 0, gapLaps: 0, gapMs: null }, { id: 1, name: 'Raven', player: false, position: 2, finishMs: null, gapMeters: 0, gapLaps: 0, gapMs: null }] })
    const html = renderToStaticMarkup(<Results />)
    expect(html).toContain('Racing')
    expect(html).not.toContain('DNF')
  })
})
