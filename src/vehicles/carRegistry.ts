import type { BuildStats } from './CarBuild'
import type { CarNoiseProfile } from '../audio/TyreBrakeModel'
import type { EngineVoice } from '../audio/EngineVoice'

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
  /**
   * How its engine and exhaust sound over the recording it plays (see
   * EngineVoice): every car has its own, even where two share a recording.
   */
  voice: EngineVoice
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
    // Twin-turbo 3.0 flat-six: a crisp, metallic howl with turbo whistle and a
    // tight, bright crackle on the overrun.
    voice: {
      pitch: 1, boomHz: 120, boomDb: 5, raspHz: 2600, raspDb: 4.5, drive: 1, airDb: 0.5, sub: 1, turbo: 1, burble: 0,
      whine: { ratio: 0, gain: 0 },
      pops: { pitch: 1.1, crackle: 1, bang: 0.8, thump: 0.7, toneHz: 9500 },
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
    // Twin-turbo 5.0 flat-plane V8: a hard, ripping wail, huge turbos that
    // whistle and dump, and anti-lag-style bangs.
    voice: {
      pitch: 1, boomHz: 95, boomDb: 6, raspHz: 2000, raspDb: 5.5, drive: 1.2, airDb: 1, sub: 0.9, turbo: 1.8, burble: 0.1,
      whine: { ratio: 0, gain: 0 },
      pops: { pitch: 0.95, crackle: 1.3, bang: 1.25, thump: 1, toneHz: 7500 },
    },
  },
  {
    id: 'bmw',
    name: 'BMW M3 E36 GTR',
    modelUrl: '/models/cars/bmw/bmw.glb',
    modelUrlLow: '/models/cars/bmw/bmw_low.glb',
    configUrl: '/models/cars/bmw/vehicle-config.json',
    // Stand-in until the car has its own recordings: the Porsche's real six
    // (an inline-six also fires 3 times per revolution), re-voiced (see voice).
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
    // Naturally aspirated race inline-six on individual throttle bodies: higher
    // and raspier than the 911's flat-six, intake roar, no turbos, the whine of
    // straight-cut gears, and a sharp machine-gun crackle.
    voice: {
      pitch: 1.12, boomHz: 165, boomDb: 3, raspHz: 3200, raspDb: 7, drive: 1.45, airDb: 3, sub: 0.6, turbo: 0, burble: 0,
      whine: { ratio: 18, gain: 0.035 },
      pops: { pitch: 1.35, crackle: 1.45, bang: 0.6, thump: 0.4, toneHz: 11500 },
    },
  },
  {
    id: 'diablo',
    name: 'Lamborghini Diablo GT1',
    modelUrl: '/models/cars/diablo/diablo.glb',
    modelUrlLow: '/models/cars/diablo/diablo_low.glb',
    configUrl: '/models/cars/diablo/vehicle-config.json',
    // Stand-in until it has its own recordings: the Koenigsegg's V8, re-voiced as a V12 (see voice).
    audioUrl: '/audio/koenigsegg/',
    firingPerRev: 6,
    selectable: true,
    stats: { power: 0.8, grip: 0.9, handling: 0.88, braking: 0.84 },
    specs: { powerHp: 600, torqueNm: 650, zeroToHundred: 2.9, topSpeedKmh: 330, drivetrain: 'RWD', weightKg: 1100 },
    // A 2000 Le Mans GT1 car on slicks: scrub and groan rather than squeal.
    // Race pads on iron discs, no ABS.
    noise: {
      tyres: { squealHz: 540, tonal: 0.25, scrubHz: 620 },
      brakes: { hissHz: 3200, squealHz: 0, grind: 0.8, abs: false },
    },
    // Naturally aspirated race V12: the V8 recording fired 6 times a rev, so it
    // screams an octave-and-a-half up, smooth (no lope), shrieking top end, race gears.
    voice: {
      pitch: 1.5, boomHz: 140, boomDb: 3, raspHz: 3600, raspDb: 6, drive: 1.1, airDb: 4, sub: 0.5, turbo: 0, burble: 0,
      whine: { ratio: 22, gain: 0.025 },
      pops: { pitch: 1.2, crackle: 1.1, bang: 0.9, thump: 0.6, toneHz: 10500 },
    },
  },
  {
    id: 'amg',
    name: 'Mercedes-AMG GT3',
    modelUrl: '/models/cars/amg/amg.glb',
    modelUrlLow: '/models/cars/amg/amg_low.glb',
    configUrl: '/models/cars/amg/vehicle-config.json',
    // Stand-in until it has its own recordings: the Koenigsegg's V8, re-voiced (see voice).
    audioUrl: '/audio/koenigsegg/',
    firingPerRev: 4,
    selectable: true,
    stats: { power: 0.7, grip: 0.92, handling: 0.9, braking: 0.86 },
    specs: { powerHp: 548, torqueNm: 640, zeroToHundred: 3.1, topSpeedKmh: 304, drivetrain: 'RWD', weightKg: 1285 },
    // A GT3 car on slicks: scrub rather than squeal. Race brakes, with ABS.
    noise: {
      tyres: { squealHz: 560, tonal: 0.25, scrubHz: 640 },
      brakes: { hissHz: 3600, squealHz: 0, grind: 0.6, abs: true },
    },
    // Naturally aspirated 6.2 crossplane V8: deep thunder with the lumpy
    // crossplane burble, darker than the Koenigsegg, big low bangs.
    voice: {
      pitch: 0.93, boomHz: 85, boomDb: 8, raspHz: 1800, raspDb: 3, drive: 1.3, airDb: -2, sub: 1.4, turbo: 0, burble: 0.55,
      whine: { ratio: 0, gain: 0 },
      pops: { pitch: 0.8, crackle: 1, bang: 1.4, thump: 1.5, toneHz: 5500 },
    },
  },
  {
    id: 'charger',
    name: 'Dodge Ice Charger',
    modelUrl: '/models/cars/charger/charger.glb',
    modelUrlLow: '/models/cars/charger/charger_low.glb',
    configUrl: '/models/cars/charger/vehicle-config.json',
    // Stand-in until it has its own recordings: the Koenigsegg's V8, re-voiced (see voice).
    audioUrl: '/audio/koenigsegg/',
    firingPerRev: 4,
    selectable: true,
    stats: { power: 0.86, grip: 0.62, handling: 0.55, braking: 0.62 },
    specs: { powerHp: 707, torqueNm: 880, zeroToHundred: 2.9, topSpeedKmh: 325, drivetrain: 'AWD', weightKg: 1700 },
    // Fat street tyres that howl, big Wilwood brakes with ABS.
    noise: {
      tyres: { squealHz: 900, tonal: 0.75, scrubHz: 780 },
      brakes: { hissHz: 4200, squealHz: 3000, grind: 0.1, abs: true },
    },
    // Supercharged 6.2 Hemi V8: the lowest, heaviest rumble, a strong lope, the
    // supercharger's whine over it, and deep muffled thuds.
    voice: {
      pitch: 0.85, boomHz: 70, boomDb: 9, raspHz: 1500, raspDb: 2, drive: 1.25, airDb: -3, sub: 1.6, turbo: 0, burble: 0.7,
      whine: { ratio: 9, gain: 0.05 },
      pops: { pitch: 0.7, crackle: 0.8, bang: 1.5, thump: 1.8, toneHz: 4500 },
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
    // Placeholder (not selectable): twin-turbo flat-plane V8.
    voice: {
      pitch: 1.05, boomHz: 100, boomDb: 5, raspHz: 2300, raspDb: 5, drive: 1.1, airDb: 1.5, sub: 0.9, turbo: 1.4, burble: 0,
      whine: { ratio: 0, gain: 0 },
      pops: { pitch: 1, crackle: 1.1, bang: 1, thump: 0.9, toneHz: 8500 },
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
