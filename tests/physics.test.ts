import { describe, expect, it } from 'vitest'
import { Drivetrain, torqueAt } from '../src/vehicles/Drivetrain'
import { Suspension } from '../src/vehicles/Suspension'
import { computeTireForces } from '../src/vehicles/TirePhysics'
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
    expect(computeTireForces({ ...base, load: 0, vLong: 10, vLat: 1 }, cfg.tires)).toEqual({ longitudinal: 0, lateral: 0, slip: 0 })
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
