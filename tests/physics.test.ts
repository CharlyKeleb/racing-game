import { describe, expect, it } from 'vitest'
import { Drivetrain, torqueAt } from '../src/vehicles/Drivetrain'
import { Suspension } from '../src/vehicles/Suspension'
import { Surface, SURFACE_PROPS } from '../src/vehicles/Surface'
import { computeTireForces, peakSlipAngle } from '../src/vehicles/TirePhysics'
import { DEFAULT_VEHICLE_CONFIG as cfg } from '../src/vehicles/VehicleConfig'

describe('torqueAt', () => {
  it('interpolates the curve and clamps the ends', () => {
    expect(torqueAt(0, cfg.engine.torqueCurve)).toBe(380)
    expect(torqueAt(2000, cfg.engine.torqueCurve)).toBeCloseTo(500)
    expect(torqueAt(99999, cfg.engine.torqueCurve)).toBe(600)
  })
})

describe('Drivetrain', () => {
  it('pushes forward in first gear with throttle', () => {
    const d = new Drivetrain(cfg.engine)
    expect(d.update(0, 0.36, 1, 0, 1 / 60)).toBeGreaterThan(0)
  })

  it('engages reverse at standstill and pushes backward', () => {
    const d = new Drivetrain(cfg.engine)
    d.update(0, 0.36, 1, -1, 1 / 60)
    expect(d.gear).toBe(-1)
    expect(d.update(0, 0.36, 1, -1, 1)).toBeLessThan(0)
  })

  it('goes back to first from reverse when asked, even with no drive pedal', () => {
    // In reverse the brake pedal drives, so pressing throttle sends throttle 0 here.
    const d = new Drivetrain(cfg.engine)
    d.update(0, 0.36, 1, -1, 1 / 60)
    d.update(-0.5, 0.36, 0, 1, 1 / 60)
    expect(d.gear).toBe(1)
    expect(d.update(0, 0.36, 1, 0, 1)).toBeGreaterThan(0)
  })

  it('stays in reverse while still rolling backward', () => {
    const d = new Drivetrain(cfg.engine)
    d.update(0, 0.36, 1, -1, 1 / 60)
    d.update(-3, 0.36, 0, 1, 1 / 60)
    expect(d.gear).toBe(-1)
  })

  it('upshifts past the shift point', () => {
    const d = new Drivetrain(cfg.engine)
    // ~25 m/s in first is well past 7700 rpm
    d.update(25, 0.36, 1, 0, 1 / 60)
    expect(d.gear).toBe(2)
  })
})

describe('Suspension', () => {
  it('produces no force in the air and positive force when compressed', () => {
    const s = new Suspension(cfg.suspension)
    expect(s.update(null, 0.34, 1 / 60)).toBe(0)
    expect(s.update(0.5, 0.34, 1 / 60)).toBeGreaterThan(0)
  })

  it('clamps compression to travel', () => {
    const s = new Suspension(cfg.suspension)
    s.update(0, 0.34, 1 / 60)
    expect(s.compression).toBe(cfg.suspension.travel)
  })
})

describe('computeTireForces', () => {
  const base = { load: 3500, longitudinalForce: 0, handbrake: false, massShare: 355, dt: 1 / 60 }

  it('opposes lateral slip', () => {
    const out = computeTireForces({ ...base, vLong: 30, vLat: 2 }, cfg.tires)
    expect(out.lateral).toBeLessThan(0)
  })

  it('respects the friction circle', () => {
    const out = computeTireForces({ ...base, vLong: 30, vLat: 10, longitudinalForce: 20000 }, cfg.tires)
    expect(Math.hypot(out.longitudinal, out.lateral)).toBeLessThanOrEqual(base.load * cfg.tires.grip + 1e-6)
  })

  it('handbrake reduces available grip', () => {
    const normal = computeTireForces({ ...base, vLong: 30, vLat: 5 }, cfg.tires)
    const hb = computeTireForces({ ...base, vLong: 30, vLat: 5, handbrake: true }, cfg.tires)
    expect(Math.abs(hb.lateral)).toBeLessThan(Math.abs(normal.lateral))
  })

  it('is inert with no load', () => {
    expect(computeTireForces({ ...base, load: 0, vLong: 10, vLat: 1 }, cfg.tires)).toEqual({ longitudinal: 0, lateral: 0, slip: 0, slide: 0 })
  })
})

describe('tire slide (skid marks / smoke)', () => {
  const base = { load: 3500, longitudinalForce: 0, handbrake: false, massShare: 355, dt: 1 / 60 }
  const peak = peakSlipAngle(cfg.tires)

  it('is zero in ordinary grippy cornering below the peak slip angle', () => {
    const vLat = 30 * Math.tan(peak * 0.8)
    const out = computeTireForces({ ...base, vLong: 30, vLat }, cfg.tires)
    expect(out.slip).toBeGreaterThan(0.6) // working hard...
    expect(out.slide).toBe(0) // ...but not sliding
  })

  it('grows once the tire is past the peak', () => {
    const out = computeTireForces({ ...base, vLong: 30, vLat: 30 * Math.tan(peak * 2.5) }, cfg.tires)
    expect(out.slide).toBeGreaterThan(5)
  })

  it('stays zero under hard (ABS) braking in a straight line', () => {
    const out = computeTireForces({ ...base, vLong: 30, vLat: 0, longitudinalForce: -20000 }, cfg.tires)
    expect(out.slide).toBe(0)
  })

  it('is the full skid speed with the wheel locked by the handbrake', () => {
    const out = computeTireForces({ ...base, vLong: 20, vLat: 3, handbrake: true }, cfg.tires)
    expect(out.slide).toBeCloseTo(Math.hypot(20, 3))
  })

  it('shows wheelspin when drive force exceeds grip', () => {
    const out = computeTireForces({ ...base, vLong: 2, vLat: 0, longitudinalForce: 12000 }, cfg.tires)
    expect(out.slide).toBeGreaterThan(2)
  })
})

describe('surfaces', () => {
  const base = { load: 3500, longitudinalForce: 0, handbrake: false, massShare: 355, dt: 1 / 60 }

  it('sand has less grip than asphalt', () => {
    const vLat = 4
    const road = computeTireForces({ ...base, vLong: 30, vLat }, cfg.tires)
    const sand = SURFACE_PROPS[Surface.Sand]
    const trap = computeTireForces({ ...base, vLong: 30, vLat, surfaceGrip: sand.grip, surfaceDrag: sand.drag }, cfg.tires)
    expect(Math.abs(trap.lateral)).toBeLessThan(Math.abs(road.lateral) * 0.6)
  })

  it('sand drags a rolling car to a stop but never pushes it backward', () => {
    const sand = SURFACE_PROPS[Surface.Sand]
    const rolling = computeTireForces({ ...base, vLong: 20, vLat: 0, surfaceGrip: sand.grip, surfaceDrag: sand.drag }, cfg.tires)
    expect(rolling.longitudinal).toBeLessThan(-0.25 * base.load)
    const creeping = computeTireForces({ ...base, vLong: 0.01, vLat: 0, surfaceGrip: sand.grip, surfaceDrag: sand.drag }, cfg.tires)
    // Never more than it takes to stop the wheel's share of mass this tick.
    expect(Math.abs(creeping.longitudinal)).toBeLessThanOrEqual((0.01 * base.massShare) / base.dt + 1e-9)
  })
})

describe('traction control', () => {
  const input = { vLong: 30, vLat: 3, load: 3500, longitudinalForce: 9000, handbrake: false, massShare: 355, dt: 1 / 60 }

  it('keeps more cornering force under full throttle than the plain friction circle', () => {
    const tc = computeTireForces(input, { ...cfg.tires, tractionControl: true })
    const raw = computeTireForces(input, { ...cfg.tires, tractionControl: false })
    expect(Math.abs(tc.lateral)).toBeGreaterThan(Math.abs(raw.lateral))
    expect(Math.hypot(tc.longitudinal, tc.lateral)).toBeLessThanOrEqual(input.load * cfg.tires.grip + 1e-6)
  })
})

describe('Drivetrain: braking downshifts', () => {
  const brakeRpm = cfg.engine.shiftUpRpm - 500
  const radius = 0.36
  const speedFor = (gear: number, rpm: number) => (rpm / ((cfg.engine.gearRatios[gear] * cfg.engine.finalDrive * 60) / (2 * Math.PI))) * radius

  it('drops a gear early under braking, landing below the brake-downshift rpm', () => {
    const d = new Drivetrain(cfg.engine)
    d.gear = 4
    // 4th at 4500 rpm: a coasting box would hold it (above shiftDownRpm)…
    const v = speedFor(4, 4500)
    d.update(v, radius, 0, 0, 1 / 60, 0)
    expect(d.gear).toBe(4)
    // …but on the brakes it drops to 3rd straight away, revs still in range.
    d.update(v, radius, 0, 0, 1 / 60, 1)
    expect(d.gear).toBe(3)
    d.update(v, radius, 0, 0, 1 / 60, 1)
    expect(d.rpm).toBeLessThan(brakeRpm + 1)
  })

  it('never over-revs a braking downshift and waits for the shift time between gears', () => {
    const d = new Drivetrain(cfg.engine)
    d.gear = 3
    const fast = speedFor(3, 7000) // 2nd would be way past the brake-downshift point
    d.update(fast, radius, 0, 0, 1 / 60, 1)
    expect(d.gear).toBe(3)
    const v = speedFor(3, 3000)
    d.update(v, radius, 0, 0, 1 / 60, 1)
    expect(d.gear).toBe(2)
    d.update(v, radius, 0, 0, 1 / 60, 1) // still inside the shift time
    expect(d.gear).toBe(2)
  })

  it('braking with the throttle held (left-foot braking) keeps the normal shift points', () => {
    const d = new Drivetrain(cfg.engine)
    d.gear = 4
    d.update(speedFor(4, 4500), radius, 1, 0, 1 / 60, 1)
    expect(d.gear).toBe(4)
  })
})
