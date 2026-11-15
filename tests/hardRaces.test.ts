import { describe, expect, it } from 'vitest'
import { pickRivals } from '../src/racing/rivalField'
import { AI_DIFFICULTIES, CATCH_UP, isAiDifficulty } from '../src/racing/AiProfiles'
import { carPrice, STARTER_CARS } from '../src/racing/Economy'
import { selectableCars } from '../src/vehicles/carRegistry'
import { rivalPace, withLegendEdge } from '../src/racing/Opponent'
import { DEFAULT_VEHICLE_CONFIG } from '../src/vehicles/VehicleConfig'
import { RecoveryMonitor } from '../src/racing/RecoveryMonitor'

describe('rival field', () => {
  it('every other car gets a seat before any repeats', () => {
    const cars = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']
    let seed = 1
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const field = pickRivals(cars, 11, random)
    expect(new Set(field).size).toBe(11)
    expect(pickRivals(cars, 14, random).length).toBe(14)
    expect(pickRivals([], 3)).toEqual([])
  })

  it('over many races the cars beyond the first four all race', () => {
    const cars = selectableCars().map((c) => c.id)
    const seen = new Set<string>()
    for (let i = 0; i < 40; i++) for (const id of pickRivals(cars, 3)) seen.add(id)
    expect(seen.size).toBe(cars.length)
  })
})

describe('Legend difficulty', () => {
  it('is the hardest: faster, later braking, quicker hands, no easing off', () => {
    const { legend, intense } = AI_DIFFICULTIES
    expect(legend.pace).toBeGreaterThan(intense.pace)
    expect(legend.cornerGripShare).toBeGreaterThan(intense.cornerGripShare)
    expect(legend.brakeGripShare).toBeGreaterThan(intense.brakeGripShare)
    expect(legend.reaction).toBeLessThan(intense.reaction)
    expect(CATCH_UP.legend.easeOff).toBe(0)
    expect(CATCH_UP.legend.catchUp).toBeGreaterThan(CATCH_UP.intense.catchUp)
    expect(isAiDifficulty('legend')).toBe(true)
  })

  it('every Legend rival is a front-runner with a stronger car', () => {
    for (let id = 1; id <= 7; id++) expect(rivalPace(id, 'legend')).toBeGreaterThanOrEqual(1)
    expect(rivalPace(1, 'challenging')).toBeCloseTo(0.965)
    const edged = withLegendEdge(DEFAULT_VEHICLE_CONFIG)
    expect(edged.tires.grip).toBeGreaterThan(DEFAULT_VEHICLE_CONFIG.tires.grip)
    expect(edged.engine.torqueCurve[0][1]).toBeGreaterThan(DEFAULT_VEHICLE_CONFIG.engine.torqueCurve[0][1])
  })
})

describe('car unlocks', () => {
  it('every car is free except the Ice Charger and the Koenigsegg', () => {
    for (const car of selectableCars()) {
      const locked = car.id === 'charger' || car.id === 'koenigsegg'
      expect(carPrice(car.id) > 0, car.id).toBe(locked)
      expect(STARTER_CARS.includes(car.id), car.id).toBe(!locked || carPrice(car.id) === 0)
    }
  })
})

describe('free roam recovery', () => {
  it('far from the route or below it never resets when the game passes zeros (free roam)', () => {
    const m = new RecoveryMonitor()
    for (let i = 0; i < 600; i++) expect(m.update(1 / 60, { drop: 0, upY: 1, speed: 20, pedal: 1, offLine: 0 })).toBeNull()
  })
})
