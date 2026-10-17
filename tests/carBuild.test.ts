import { describe, expect, it } from 'vitest'
import { applyCarBuild, buildStats, carClass, DEFAULT_BUILD, performanceRank, samePerformance, sanitizeBuild } from '../src/vehicles/CarBuild'
import { DEFAULT_VEHICLE_CONFIG as cfg } from '../src/vehicles/VehicleConfig'

describe('applyCarBuild', () => {
  it('leaves the stock build identical to the base config', () => {
    const out = applyCarBuild(cfg, DEFAULT_BUILD)
    expect(out.massKg).toBe(cfg.massKg)
    expect(out.engine.torqueCurve).toEqual(cfg.engine.torqueCurve)
    expect(out.suspension).toEqual(cfg.suspension)
    expect(out.tires).toEqual(cfg.tires)
  })

  it('scales torque, grip, mass and ride height with upgrades', () => {
    const out = applyCarBuild(cfg, { ...DEFAULT_BUILD, engine: 3, tires: 'race', weight: 2, suspension: 'race', brakes: 2 })
    expect(out.engine.torqueCurve[2][1]).toBeCloseTo(cfg.engine.torqueCurve[2][1] * 1.35)
    expect(out.tires.grip).toBeGreaterThan(cfg.tires.grip)
    expect(out.massKg).toBeCloseTo(cfg.massKg * 0.9)
    expect(out.suspension.restLength).toBeLessThan(cfg.suspension.restLength)
    expect(out.brakeForce).toBeGreaterThan(cfg.brakeForce)
  })

  it('does not mutate the base config', () => {
    const before = JSON.stringify(cfg)
    applyCarBuild(cfg, { ...DEFAULT_BUILD, engine: 2 })
    expect(JSON.stringify(cfg)).toBe(before)
  })
})

describe('build helpers', () => {
  it('treats paint changes as cosmetic', () => {
    expect(samePerformance(DEFAULT_BUILD, { ...DEFAULT_BUILD, paint: '#000000', finish: 'matte' })).toBe(true)
    expect(samePerformance(DEFAULT_BUILD, { ...DEFAULT_BUILD, tires: 'race' })).toBe(false)
  })

  it('rates stock at 0.5 and a full build at 1', () => {
    expect(buildStats(DEFAULT_BUILD).power).toBeCloseTo(0.5)
    const full = buildStats({ ...DEFAULT_BUILD, engine: 3, tires: 'race', suspension: 'race', weight: 2, brakes: 2 })
    expect(full).toEqual({ power: 1, grip: 1, handling: 1, braking: 1 })
  })

  it('sanitizes persisted junk back to defaults', () => {
    expect(sanitizeBuild(null)).toEqual(DEFAULT_BUILD)
    const b = sanitizeBuild({ paint: 'red', engine: 9, tires: 'race', tint: 2 })
    expect(b.paint).toBe(DEFAULT_BUILD.paint)
    expect(b.engine).toBe(0)
    expect(b.tires).toBe('race')
    expect(b.tint).toBe(DEFAULT_BUILD.tint)
  })
})

describe('performanceRank', () => {
  it('puts stock in class A and a full build in class S', () => {
    expect(carClass(performanceRank(DEFAULT_BUILD))).toBe('A')
    expect(carClass(performanceRank({ ...DEFAULT_BUILD, engine: 3, tires: 'race', suspension: 'race', weight: 2, brakes: 2 }))).toBe('S')
  })
})
