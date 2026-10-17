import type { BuildStats } from './CarBuild'

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
  },
  {
    id: 'koenigsegg',
    name: 'Koenigsegg One:1',
    modelUrl: '/models/cars/koenigsegg/koenigsegg.glb',
    modelUrlLow: '/models/cars/koenigsegg/koenigsegg_low.glb',
    configUrl: '/models/cars/koenigsegg/vehicle-config.json',
    // A real twin-turbo V8 (Mercedes S63 AMG recording) until we have the One:1's own.
    audioUrl: '/audio/koenigsegg/',
    firingPerRev: 4,
    selectable: true,
    stats: { power: 0.98, grip: 0.8, handling: 0.76, braking: 0.84 },
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
  },
  {
    id: 'mclaren',
    name: 'McLaren',
    modelUrl: '/models/cars/mclaren/mclaren.glb',
    configUrl: '/models/cars/mclaren/vehicle-config.json',
    firingPerRev: 4,
    selectable: false,
    stats: { power: 0.5, grip: 0.5, handling: 0.5, braking: 0.5 },
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
