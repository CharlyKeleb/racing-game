import { expect, it } from 'vitest'
import { Drivetrain } from '../src/vehicles/Drivetrain'
import { Nitro } from '../src/vehicles/Nitro'
import { Drift, DEFAULT_DRIFT } from '../src/vehicles/Drift'
import { Burnout } from '../src/vehicles/Burnout'
import { Suspension } from '../src/vehicles/Suspension'
import { Backfire } from '../src/vehicles/Backfire'
import { DEFAULT_VEHICLE_CONFIG as config } from '../src/vehicles/VehicleConfig'
const dt = 1 / 60
const json = <T>(state: T): T => JSON.parse(JSON.stringify(state)) as T

/** Replay actual future behavior, including hidden timers, rather than comparing just copied fields. */
function replay<T, S, O>(create: () => T, capture: (value: T) => S, restore: (value: T, state: S) => void,
  advance: (value: T, tick: number) => O) {
  const reference = create()
  for (let tick = 0; tick < 720; tick++) {
    if (tick % 29 === 0) {
      const saved = json(capture(reference)), branch = create()
      restore(branch, saved)
      // Reference keeps running normally. The branch must produce the same state and outputs.
      for (let ahead = 0; ahead < 29 && tick < 720; ahead++, tick++) {
        expect(advance(branch, tick)).toEqual(advance(reference, tick))
        expect(capture(branch)).toEqual(capture(reference))
      }
      tick--
    } else advance(reference, tick)
  }
}
it('replays gearbox torque through shift cuts, manual requests and direction changes', () => {
  replay(() => new Drivetrain(config.engine), d => d.captureState(), (d, state) => d.restoreState(state), (d, tick) => {
    if (tick === 100) d.manual = true
    if (tick % 41 === 0) d.requestShift(tick % 82 === 0 ? 1 : -1)
    if (tick === 300) d.manual = false
    return d.update(tick < 500 ? (tick % 170) * .4 : tick % 100 < 50 ? -.2 : .2, .35,
      tick % 100 < 70 ? .9 : 0, tick > 500 ? (tick % 100 < 50 ? -1 : 1) : 0, dt, tick % 100 > 70 ? 1 : 0)
  })
})
it('replays nitro charge, ignition, release grace, perfect-tap decisions and thrust', () => {
  replay(() => new Nitro(config.nitro), n => n.captureState(), (n, state) => n.restoreState(state), (n, tick) => {
    n.update({ speed: 35, slip: 1, grounded: tick % 80 < 60, airborne: tick % 80 >= 60, drifting: true,
      wantsBoost: tick > 200 && tick % 110 !== 40 && tick % 110 !== 41 }, dt)
    return [n.force, n.surgeForce, n.dragScale, n.windowOpen, n.windowCue]
  })
})
it('replays drift tap/downshift arms, active drift and exit counters across JSON Infinity sentinels', () => {
  replay(() => new Drift(), d => d.captureState(), (d, state) => d.restoreState(state), (d, tick) => {
    const phase = tick % 180
    d.update({ speed: phase > 150 ? 4 : 35, steer: phase < 70 ? .8 : phase < 110 ? -.7 : 0,
      throttle: phase < 90 ? .8 : .1, brake: phase < 8 ? .8 : 0, handbrake: phase === 25,
      slipAngle: phase < 110 ? .4 : .01, downshift: phase === 12 }, { ...DEFAULT_DRIFT, autoEntries: true }, dt)
    return [d.rearGripScale(.7, DEFAULT_DRIFT), d.scrubRate(.3, .5, DEFAULT_DRIFT),
      d.guide(.4, .7, 1, .2, DEFAULT_DRIFT, { angle: 0, pathRate: 0 })]
  })
})
it('replays burnout latch and wind-down', () => {
  replay(() => new Burnout(), b => b.captureState(), (b, state) => b.restoreState(state), (b, tick) => {
    b.update(dt, { throttle: .9, brake: tick % 120 < 70 ? .9 : 0, handbrake: false,
      speed: tick % 120 < 20 ? 1 : 5, forward: true, grounded: tick % 100 < 90 })
    return b.holding
  })
})
it('replays suspension forces and unconsumed peak compression through airtime and landings', () => {
  replay(() => new Suspension(config.suspension), s => s.captureState(), (s, state) => s.restoreState(state), (s, tick) => {
    const force = s.update(tick % 90 < 15 ? null : .5 + Math.sin(tick * .1) * .1, .35, dt)
    return [force, s.wheelOffset(), tick % 7 === 0 ? s.takePeak() : null]
  })
})
it('replays backfire random stream, burst timers and effects after a JSON round trip', () => {
  replay(() => new Backfire(), b => b.captureState(), (b, state) => b.restoreState(state), (b, tick) => {
    b.update(dt, { throttle: tick % 150 < 80 ? 1 : 0, revs: .9, gear: 1 + Math.floor(tick / 95) % 5,
      burnout: tick % 200 < 90 ? 1 : 0, nitroLit: tick % 170 === 0 })
    return [b.popped, b.strength, b.flash, b.flashKind, b.count]
  })
})
it('checkpoints are detached from future updates and represent unused Infinity timers as null', () => {
  const drift = new Drift(), saved = drift.captureState()
  expect(saved.sinceEnd).toBeNull()
  expect(json(saved)).toEqual(saved)
  drift.restoreState(json(saved)); expect(drift.sinceEnd).toBe(Infinity)
  const backfire = new Backfire(), idle = backfire.captureState()
  expect(idle.sinceHigh).toBeNull(); expect(idle.sincePop).toBeNull()
  for (let i = 0; i < 10; i++) backfire.update(dt, { throttle: 1, revs: 1, gear: 1, burnout: 1, nitroLit: i === 0 })
  expect(idle.count).toBe(0); expect(idle.seed).not.toBe(backfire.captureState().seed)
})
