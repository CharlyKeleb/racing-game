import { describe, expect, it } from 'vitest'
import { DEFAULT_DRIFT, Drift, type DriftConfig, type DriftInput } from '../src/vehicles/Drift'

const DT = 1 / 60
/** The technique entries (fast turn-in, brake-tap, downshift) are opt-in. */
const cfg: DriftConfig = { ...DEFAULT_DRIFT, autoEntries: true }
const cruise: DriftInput = { speed: 30, steer: 0, throttle: 0.5, brake: 0, handbrake: false, slipAngle: 0.02, downshift: false }
const run = (d: Drift, i: Partial<DriftInput>, seconds: number, c: DriftConfig = cfg) => {
  for (let k = 0; k < Math.round(seconds / DT); k++) d.update({ ...cruise, ...i }, c, DT)
}

describe('Drift entries by default: handbrake only', () => {
  it('fast full-lock turn-in on the throttle stays gripped', () => {
    const d = new Drift()
    run(d, { speed: 45, steer: 1, throttle: 1 }, 1, DEFAULT_DRIFT)
    expect(d.active).toBe(false)
  })

  it('braking, then turning in (with the downshift that comes with it) stays gripped', () => {
    const d = new Drift()
    run(d, { brake: 1, throttle: 0 }, 0.3, DEFAULT_DRIFT)
    d.update({ ...cruise, throttle: 0, downshift: true }, DEFAULT_DRIFT, DT)
    run(d, { steer: 1, throttle: 0 }, 0.5, DEFAULT_DRIFT)
    expect(d.active).toBe(false)
  })

  it('the handbrake starts a drift', () => {
    const d = new Drift()
    d.update({ ...cruise, steer: 0.8, handbrake: true }, DEFAULT_DRIFT, DT)
    expect(d.active).toBe(true)
  })
})

describe('Drift entries with autoEntries', () => {
  it('ordinary hard cornering is not a drift', () => {
    const d = new Drift()
    run(d, { steer: 1, throttle: 1, speed: 33 }, 2) // full lock at ~120 km/h
    expect(d.active).toBe(false)
  })

  it('fast turn-in: full lock at high speed on the throttle', () => {
    const d = new Drift()
    d.update({ ...cruise, speed: 45, steer: 0.9, throttle: 1 }, cfg, DT)
    expect(d.active).toBe(true)
    expect(d.entry).toBe(1)
    d.update({ ...cruise, speed: 45, steer: 0.9, throttle: 1 }, cfg, DT)
    expect(d.entry).toBe(0) // one-shot
  })

  it('brake-tap: brake, release, then turn in within the arm time', () => {
    const d = new Drift()
    run(d, { brake: 1 }, 0.2)
    expect(d.active).toBe(false) // braking alone isn't a drift
    d.update({ ...cruise }, cfg, DT) // released
    run(d, { steer: -0.7 }, 0.1)
    expect(d.active).toBe(true)
    expect(d.entry).toBe(0)
  })

  it('brake-tap expires if you wait too long to turn', () => {
    const d = new Drift()
    run(d, { brake: 1 }, 0.2)
    run(d, {}, cfg.armTime + 0.1)
    run(d, { steer: 0.8 }, 0.2)
    expect(d.active).toBe(false)
  })

  it('downshift + turn off-throttle kicks the rear out', () => {
    const d = new Drift()
    d.update({ ...cruise, throttle: 0, downshift: true }, cfg, DT)
    run(d, { throttle: 0, steer: 0.75 }, 0.1)
    expect(d.active).toBe(true)
  })

  it('no drifts at low speed', () => {
    const d = new Drift()
    run(d, { brake: 1, speed: 8 }, 0.2)
    run(d, { steer: 1, speed: 8 }, 0.3)
    d.update({ ...cruise, speed: 8, steer: 1, handbrake: true }, cfg, DT)
    expect(d.active).toBe(false)
  })
})

describe('Drift while sliding', () => {
  const sliding = () => {
    const d = new Drift()
    d.update({ ...cruise, speed: 45, steer: 0.9, throttle: 1 }, cfg, DT)
    run(d, { speed: 40, steer: -0.6, throttle: 0.8, slipAngle: 0.5 }, 0.5) // countersteering
    return d
  }

  it('eases in and holds on opposite lock', () => {
    const d = sliding()
    expect(d.active).toBe(true)
    expect(d.amount).toBeGreaterThan(0.95)
  })

  it('throttle loosens the rear: the gas pedal sets the angle', () => {
    const d = sliding()
    expect(d.rearGripScale(1, cfg)).toBeLessThan(d.rearGripScale(0, cfg))
    expect(d.rearGripScale(0, cfg)).toBeLessThan(0.7)
  })

  it('ends when the wheel is straightened, and grip comes back', () => {
    const d = sliding()
    run(d, { speed: 40, steer: 0, throttle: 0.4, slipAngle: 0.4 }, cfg.exitTime + 0.05)
    expect(d.active).toBe(false)
    run(d, { speed: 40 }, 1.5)
    expect(d.amount).toBe(0)
    expect(d.rearGripScale(0.4, cfg)).toBe(1)
  })

  it('ends when the car slows right down', () => {
    const d = sliding()
    run(d, { speed: 6, steer: -0.6, slipAngle: 0.5 }, 0.1)
    expect(d.active).toBe(false)
  })
})

describe('Arcade drift (NFS / Asphalt)', () => {
  const tapWhileTurning = (d: Drift, steer = 1) => {
    run(d, { steer }, 0.1, DEFAULT_DRIFT)
    run(d, { steer, brake: 1 }, 0.15, DEFAULT_DRIFT)
    d.update({ ...cruise, steer }, DEFAULT_DRIFT, DT) // released: the tap
  }

  it('a quick brake tap while turning starts a drift that way', () => {
    const d = new Drift()
    tapWhileTurning(d, -1)
    expect(d.active).toBe(true)
    expect(d.direction).toBe(-1)
  })

  it('a long brake while turning is just braking', () => {
    const d = new Drift()
    run(d, { steer: 1, brake: 1 }, 0.5, DEFAULT_DRIFT)
    run(d, { steer: 1 }, 0.3, DEFAULT_DRIFT)
    expect(d.active).toBe(false)
  })

  it('braking in a straight line and then turning in is just braking', () => {
    const d = new Drift()
    run(d, { brake: 1 }, 0.15, DEFAULT_DRIFT)
    run(d, { steer: 1, throttle: 0.8 }, 0.5, DEFAULT_DRIFT)
    expect(d.active).toBe(false)
  })

  it('steering into the drift deepens the angle and tightens the arc; countersteer opens it', () => {
    const d = new Drift()
    tapWhileTurning(d, 1) // a right-hand drift: clockwise about +Y, so negative
    const g = { angle: 0, pathRate: 0 }
    const grip = 1.2 // the car's full-lock grip turn, rad/s
    const into = { ...d.guide(1, 1, grip, 0, DEFAULT_DRIFT, g) }
    const centred = { ...d.guide(0, 1, grip, 0, DEFAULT_DRIFT, g) }
    const counter = { ...d.guide(-1, 1, grip, 0, DEFAULT_DRIFT, g) }
    expect(into.angle).toBeLessThan(0)
    expect(into.pathRate).toBeLessThan(0)
    expect(Math.abs(into.angle)).toBeCloseTo(DEFAULT_DRIFT.holdAngle)
    expect(Math.abs(centred.angle)).toBeCloseTo(DEFAULT_DRIFT.baseAngle)
    expect(Math.abs(counter.angle)).toBeCloseTo(DEFAULT_DRIFT.minAngle)
    expect(Math.abs(into.pathRate)).toBeGreaterThan(Math.abs(centred.pathRate))
    expect(Math.abs(centred.pathRate)).toBeGreaterThan(Math.abs(counter.pathRate))
  })

  it('a drift held into the corner turns tighter than gripping would', () => {
    const d = new Drift()
    tapWhileTurning(d, -1)
    const g = { angle: 0, pathRate: 0 }
    expect(Math.abs(d.guide(-1, 1, 1.2, 0, DEFAULT_DRIFT, g).pathRate)).toBeGreaterThan(1.2)
    // …and follows the car's grip: a slower-turning car (or more speed) drifts a wider arc.
    expect(Math.abs(d.guide(-1, 1, 0.6, 0, DEFAULT_DRIFT, g).pathRate)).toBeCloseTo(0.6 * DEFAULT_DRIFT.turnInto)
  })

  it('lifting lets the angle fall; the throttle holds it out', () => {
    const d = new Drift()
    tapWhileTurning(d, 1)
    const g = { angle: 0, pathRate: 0 }
    const lifted = Math.abs(d.guide(1, 0, 1, 0, DEFAULT_DRIFT, g).angle)
    expect(lifted).toBeLessThan(Math.abs(d.guide(1, 1, 1, 0, DEFAULT_DRIFT, g).angle))
  })

  it('a steeper angle, or lifting, scrubs more speed', () => {
    const d = new Drift()
    expect(d.scrubRate(0.6, 1, DEFAULT_DRIFT)).toBeGreaterThan(d.scrubRate(0.3, 1, DEFAULT_DRIFT))
    expect(d.scrubRate(0.4, 0, DEFAULT_DRIFT)).toBeGreaterThan(d.scrubRate(0.4, 1, DEFAULT_DRIFT))
  })

  it('after it ends, guidance holds on and unwinds the angle before grip takes over', () => {
    const d = new Drift()
    tapWhileTurning(d, 1)
    run(d, { steer: 1, slipAngle: 0.5 }, 1, DEFAULT_DRIFT)
    run(d, { steer: 0, slipAngle: 0.5 }, DEFAULT_DRIFT.exitTime + 0.05, DEFAULT_DRIFT)
    expect(d.active).toBe(false)
    expect(d.exiting).toBe(true)
    expect(d.amount).toBeGreaterThan(0.95)
    // Unwinding: the body swings back toward the line (target angle 0), and the
    // line turns a little toward the nose (same sign as the leftover angle).
    const g = d.guide(0, 1, 1, -0.4, DEFAULT_DRIFT, { angle: 0, pathRate: 0 })
    expect(g.angle).toBe(0)
    expect(g.pathRate).toBeLessThan(0)
    run(d, { steer: 0, slipAngle: 0.02 }, 0.6, DEFAULT_DRIFT)
    expect(d.exiting).toBe(false)
    expect(d.amount).toBeLessThan(0.05)
  })

  it('holding countersteer ends the drift after counterExitTime', () => {
    const d = new Drift()
    tapWhileTurning(d, 1)
    run(d, { steer: -0.6 }, DEFAULT_DRIFT.counterExitTime - 0.1, DEFAULT_DRIFT)
    expect(d.active).toBe(true)
    run(d, { steer: -0.6 }, 0.2, DEFAULT_DRIFT)
    expect(d.active).toBe(false)
  })

  it('hard countersteer on the throttle links into a drift the other way', () => {
    const d = new Drift()
    tapWhileTurning(d, 1)
    const score = () => d.score
    run(d, { steer: 1, throttle: 1, slipAngle: 0.5 }, 1, DEFAULT_DRIFT)
    const before = score()
    run(d, { steer: -1, throttle: 1, slipAngle: 0.5 }, DEFAULT_DRIFT.transitionTime - 0.05, DEFAULT_DRIFT)
    expect(d.direction).toBe(1)
    let entry = 0
    for (let k = 0; k < 6; k++) { d.update({ ...cruise, steer: -1, throttle: 1, slipAngle: 0.5 }, DEFAULT_DRIFT, DT); entry ||= d.entry }
    // Same drift, other way: kicked toward the new turn, points carried on.
    expect(d.active).toBe(true)
    expect(d.direction).toBe(-1)
    expect(entry).toBe(-1)
    expect(d.score).toBeGreaterThan(before)
    // Holding the new direction keeps it going past the old countersteer exit.
    run(d, { steer: -1, throttle: 1, slipAngle: 0.5 }, DEFAULT_DRIFT.counterExitTime + 0.2, DEFAULT_DRIFT)
    expect(d.active).toBe(true)
  })

  it('countersteer off the throttle still ends the drift instead of linking', () => {
    const d = new Drift()
    tapWhileTurning(d, 1)
    run(d, { steer: -1, throttle: 0, slipAngle: 0.5 }, DEFAULT_DRIFT.counterExitTime + 0.1, DEFAULT_DRIFT)
    expect(d.active).toBe(false)
    expect(d.direction).toBe(1)
  })

  it('eases tapped keys into a steady in-between steer for the drift to follow', () => {
    const d = new Drift()
    tapWhileTurning(d, 1)
    // A key tapped half the time, as a keyboard driver holds a line.
    const seen: number[] = []
    for (let k = 0; k < 240; k++) {
      d.update({ ...cruise, steer: k % 30 < 15 ? 1 : 0, throttle: 1, slipAngle: 0.5 }, DEFAULT_DRIFT, DT)
      if (k >= 120) seen.push(d.steer)
    }
    expect(d.active).toBe(true)
    expect(Math.min(...seen)).toBeGreaterThan(0.3)
    expect(Math.max(...seen)).toBeLessThan(0.75)
    expect(Math.max(...seen) - Math.min(...seen)).toBeLessThan(0.35)
  })

  it('scores points while drifting and banks them when it ends', () => {
    const d = new Drift()
    tapWhileTurning(d, 1)
    run(d, { steer: 1, slipAngle: 0.6, speed: 30 }, 2, DEFAULT_DRIFT)
    const live = d.score
    // km/h × degrees per second / 50: 108 km/h × 34° × 2 s / 50 ≈ 148
    expect(live).toBeGreaterThan(120)
    expect(live).toBeLessThan(180)
    run(d, { steer: 0 }, 0.5, DEFAULT_DRIFT)
    expect(d.active).toBe(false)
    expect(Math.abs(d.lastScore - live)).toBeLessThan(2) // a hair more while the wheel came straight
    expect(d.sinceEnd).toBeLessThan(0.5)
  })
})
