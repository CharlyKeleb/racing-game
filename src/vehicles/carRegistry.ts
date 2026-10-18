import type { BuildStats } from './CarBuild'
import type { CarNoiseProfile } from '../audio/TyreBrakeModel'

/**
 * Every playable car. Adding a car = run it through the Blender MCP pipeline,
 * drop `<id>.glb` + `vehicle-config.json` in public/models/cars/<id>/, add a row.
 */
export interface CarEntry {
  id: string
  name: string
  modelUrl: string
  /** Simplified mesh for the Low preset (npm run build:car-lod). */
  modelUrlLow?: string
  configUrl: string
  /** Engine recordings folder (engine-bank.wav/.json, ignition, lift-off); procedural engine if absent. */
  audioUrl?: string
  /** Firing pulses per crank revolution: cylinders / 2 (flat-six 3, V8 4). Pitches the engine sound. */
  firingPerRev: number
  /** Offered in the garage's car picker. Placeholders without a model aren't. */
  selectable: boolean
  /** Stock 0..1 ratings for the garage card; upgrades raise them toward 1. Mid-field = 0.5. */
  stats: BuildStats
  /** Stock figures for the car card. Power matches the config's torque curve (tested); 0–100 and top speed are measured in-game. */
  specs: CarSpecs
  /** How its tyres and brakes sound, from the parts the real car runs (see TyreBrakeModel). */
  noise: CarNoiseProfile
}

export interface CarSpecs {
  powerHp: number
  torqueNm: number
  /** 0–100 km/h, seconds. */
  zeroToHundred: number
  topSpeedKmh: number
  drivetrain: 'AWD' | 'RWD' | 'FWD'
  weightKg: number
}

export const CARS: CarEntry[] = [
  {
    id: 'porsche911',
    name: 'Porsche 911 Carrera 4S',
    modelUrl: '/models/cars/porsche911/porsche911.glb',
    modelUrlLow: '/models/cars/porsche911/porsche911_low.glb',
    configUrl: '/models/cars/porsche911/vehicle-config.json',
    audioUrl: '/audio/porsche911/',
    firingPerRev: 3,
    selectable: true,
    stats: { power: 0.5, grip: 0.5, handling: 0.5, braking: 0.5 },
    specs: { powerHp: 444, torqueNm: 530, zeroToHundred: 3.5, topSpeedKmh: 308, drivetrain: 'AWD', weightKg: 1565 },
    // Road tyres (Pirelli P Zero, 245/35 R20 · 305/30 R20): a clear, high
    // squeal. Six-piston iron brakes with ABS: pad hiss, a squeal at walking pace.
    noise: {
      tyres: { squealHz: 1180, tonal: 0.85, scrubHz: 950 },
      brakes: { hissHz: 4300, squealHz: 3400, grind: 0, abs: true },
    },
  },
  {
    id: 'koenigsegg',
    name: 'Koenigsegg One:1',
    modelUrl: '/models/cars/koenigsegg/koenigsegg.glb',
    modelUrlLow: '/models/cars/koenigsegg/koenigsegg_low.glb',
    configUrl: '/models/cars/koenigsegg/vehicle-config.json',
    // Regera onboard V8 recording, used as a stand-in for the One:1 (see audio credits).
    audioUrl: '/audio/koenigsegg/',
    firingPerRev: 4,
    selectable: true,
    stats: { power: 0.98, grip: 0.8, handling: 0.76, braking: 0.84 },
    specs: { powerHp: 1341, torqueNm: 1371, zeroToHundred: 3.8, topSpeedKmh: 437, drivetrain: 'RWD', weightKg: 1360 },
    // Michelin Pilot Sport Cup 2 semi-slicks (345/30 R20 rear): a lower,
    // rougher squeal with more scrub. Carbon-ceramic brakes with ABS: a
    // brighter hiss, and the low-speed squeal carbon discs are known for.
    noise: {
      tyres: { squealHz: 860, tonal: 0.55, scrubHz: 720 },
      brakes: { hissHz: 5600, squealHz: 2650, grind: 0, abs: true },
    },
  },
  {
    id: 'bmw',
    name: 'BMW M3 E36 GTR',
    modelUrl: '/models/cars/bmw/bmw.glb',
    modelUrlLow: '/models/cars/bmw/bmw_low.glb',
    configUrl: '/models/cars/bmw/vehicle-config.json',
    // Stand-in until the car has its own recordings: the Porsche's real six
    // (an inline-six also fires 3 times per revolution).
    audioUrl: '/audio/porsche911/',
    firingPerRev: 3,
    selectable: true,
    stats: { power: 0.6, grip: 0.86, handling: 0.86, braking: 0.8 },
    specs: { powerHp: 370, torqueNm: 380, zeroToHundred: 4.4, topSpeedKmh: 271, drivetrain: 'RWD', weightKg: 1150 },
    // A GT race car on slicks: they scrub and groan rather than sing. Race
    // pads on iron discs grind, and with no ABS hard braking locks the wheels.
    noise: {
      tyres: { squealHz: 520, tonal: 0.22, scrubHz: 600 },
      brakes: { hissHz: 3000, squealHz: 0, grind: 0.85, abs: false },
    },
  },
  {
    id: 'mclaren',
    name: 'McLaren',
    modelUrl: '/models/cars/mclaren/mclaren.glb',
    configUrl: '/models/cars/mclaren/vehicle-config.json',
    firingPerRev: 4,
    selectable: false,
    stats: { power: 0.5, grip: 0.5, handling: 0.5, braking: 0.5 },
    specs: { powerHp: 710, torqueNm: 770, zeroToHundred: 2.9, topSpeedKmh: 341, drivetrain: 'RWD', weightKg: 1420 },
    // P Zero Corsa road tyres, carbon-ceramic brakes with ABS.
    noise: {
      tyres: { squealHz: 1040, tonal: 0.7, scrubHz: 850 },
      brakes: { hissHz: 5200, squealHz: 2800, grind: 0, abs: true },
    },
  },
]

export function getCar(id: string): CarEntry {
  return CARS.find((c) => c.id === id) ?? CARS[0]
}

/** Cars in the garage picker, in order. */
export function selectableCars(): CarEntry[] {
  return CARS.filter((c) => c.selectable)
}

/** The car `step` places along from `id` in the picker, wrapping around. */
export function stepCar(id: string, step: number): CarEntry {
  const list = selectableCars()
  const i = Math.max(0, list.findIndex((c) => c.id === id))
  return list[(((i + step) % list.length) + list.length) % list.length]
}
