import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { gameStore } from '../src/stores/gameStore'
import { buildStats, carClass, DEFAULT_BUILD, performanceRank } from '../src/vehicles/CarBuild'
import { getCar, selectableCars, stepCar } from '../src/vehicles/carRegistry'

describe('car picker', () => {
  it('offers only cars with a model, and steps through them wrapping around', () => {
    const ids = selectableCars().map((c) => c.id)
    expect(ids).toEqual(['porsche911', 'koenigsegg', 'bmw'])
    expect(stepCar('porsche911', 1).id).toBe('koenigsegg')
    expect(stepCar('bmw', 1).id).toBe('porsche911')
    expect(stepCar('porsche911', -1).id).toBe('bmw')
    // Unknown ids (stale saves) step from the first car.
    expect(stepCar('nope', 1).id).toBe('koenigsegg')
  })

  it('rates each car from its own stock stats', () => {
    const rank = (id: string) => performanceRank(DEFAULT_BUILD, getCar(id).stats)
    expect(carClass(rank('porsche911'))).toBe('A')
    expect(carClass(rank('koenigsegg'))).toBe('S')
    expect(rank('koenigsegg')).toBeGreaterThan(rank('bmw'))
    // Fully upgraded is the same ceiling for every car.
    const full = { ...DEFAULT_BUILD, engine: 3, tires: 'race', suspension: 'race', weight: 2, brakes: 2 } as const
    expect(buildStats(full, getCar('bmw').stats).power).toBeCloseTo(1)
  })
})

describe('per-car builds', () => {
  it('keeps each car its own customisation', () => {
    const s = () => gameStore.getState()
    s().updateSettings({ car: 'porsche911' })
    s().updateBuild({ paint: '#123456', engine: 2 })
    s().updateSettings({ car: 'koenigsegg' })
    expect(s().build.paint).not.toBe('#123456') // the Koenigsegg didn't get the Porsche's paint
    s().updateBuild({ paint: '#abcdef' })
    s().updateSettings({ car: 'porsche911' })
    expect(s().build).toMatchObject({ paint: '#123456', engine: 2 })
    s().resetBuild()
    s().updateSettings({ car: 'koenigsegg' })
    expect(s().build.paint).toBe('#abcdef') // resetting the Porsche left the Koenigsegg alone
  })
})

describe('car card specs', () => {
  it('match each selectable car\'s physics config', () => {
    for (const car of selectableCars()) {
      const cfg = JSON.parse(readFileSync(`public${car.configUrl}`, 'utf8'))
      const curve: [number, number][] = cfg.engine.torqueCurve
      // Peak power over the curve, sampled every 50 rpm: kW = Nm × rpm / 9549, hp = kW × 1.341.
      let peakKw = 0
      for (let rpm = curve[0][0]; rpm <= curve[curve.length - 1][0]; rpm += 50) {
        const i = curve.findIndex(([r]) => r >= rpm)
        const [r0, t0] = curve[Math.max(0, i - 1)]
        const [r1, t1] = curve[i]
        const t = r1 === r0 ? t1 : t0 + ((rpm - r0) / (r1 - r0)) * (t1 - t0)
        peakKw = Math.max(peakKw, (t * rpm) / 9549)
      }
      expect(Math.abs(peakKw * 1.341 - car.specs.powerHp) / car.specs.powerHp).toBeLessThan(0.03)
      expect(car.specs.torqueNm).toBe(Math.max(...curve.map(([, t]) => t)))
      expect(car.specs.weightKg).toBe(cfg.massKg)
      const drivenFront = cfg.wheels.some((w: { id: string; driven: boolean }) => w.id.startsWith('F') && w.driven)
      expect(car.specs.drivetrain).toBe(drivenFront ? 'AWD' : 'RWD')
    }
  })
})
