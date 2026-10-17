import type { VehicleConfig } from './VehicleConfig'

/**
 * Player customisation picked in the garage before a race. Visual fields are
 * applied to the model by CarLivery; performance fields scale the car's
 * VehicleConfig through applyCarBuild. Pure data, persisted by gameStore.
 */

export type PaintFinish = 'gloss' | 'metallic' | 'matte' | 'pearl'
export type Stage = 0 | 1 | 2 | 3
export type TireCompound = 'street' | 'sport' | 'race'
export type SuspensionKit = 'stock' | 'sport' | 'race'

export interface CarBuild {
  paint: string
  finish: PaintFinish
  rims: string
  calipers: string
  /** Window tint, 0 = clear, 1 = limo. */
  tint: number
  engine: Stage
  tires: TireCompound
  suspension: SuspensionKit
  /** Weight reduction stage. */
  weight: 0 | 1 | 2
  brakes: 0 | 1 | 2
}

export const DEFAULT_BUILD: CarBuild = {
  paint: '#c8102e',
  finish: 'metallic',
  rims: '#c0c4c8',
  calipers: '#d01c1c',
  tint: 0.5,
  engine: 0,
  tires: 'street',
  suspension: 'stock',
  weight: 0,
  brakes: 0,
}

export const PAINT_PRESETS = [
  { name: 'Guards Red', hex: '#c8102e' },
  { name: 'Carrara White', hex: '#eceae4' },
  { name: 'Jet Black', hex: '#0d0d0f' },
  { name: 'GT Silver', hex: '#9da3a8' },
  { name: 'Racing Yellow', hex: '#f4c400' },
  { name: 'Miami Blue', hex: '#1fa3c9' },
  { name: 'Python Green', hex: '#4fa83d' },
  { name: 'Lava Orange', hex: '#ff5a00' },
  { name: 'Gentian Blue', hex: '#1b2f6b' },
  { name: 'Ruby Star', hex: '#b5005b' },
] as const

export const RIM_PRESETS = [
  { name: 'Silver', hex: '#c0c4c8' },
  { name: 'Gloss Black', hex: '#111214' },
  { name: 'Gunmetal', hex: '#4a4f55' },
  { name: 'Gold', hex: '#c9a54a' },
  { name: 'White', hex: '#f2f2f2' },
] as const

export const CALIPER_PRESETS = [
  { name: 'Red', hex: '#d01c1c' },
  { name: 'Yellow', hex: '#f2c200' },
  { name: 'Black', hex: '#141414' },
  { name: 'Blue', hex: '#1f5fd1' },
  { name: 'Green', hex: '#39b54a' },
] as const

const ENGINE_TORQUE = [1, 1.1, 1.22, 1.35] as const
const TIRE_GRIP: Record<TireCompound, number> = { street: 1, sport: 1.08, race: 1.18 }
const TIRE_CORNERING: Record<TireCompound, number> = { street: 1, sport: 1.05, race: 1.12 }
const SUSPENSION: Record<SuspensionKit, { stiffness: number; damping: number; drop: number; steer: number }> = {
  stock: { stiffness: 1, damping: 1, drop: 0, steer: 1 },
  sport: { stiffness: 1.25, damping: 1.2, drop: 0.03, steer: 1.04 },
  race: { stiffness: 1.55, damping: 1.45, drop: 0.05, steer: 1.08 },
}
const WEIGHT = [1, 0.95, 0.9] as const
const BRAKES = [1, 1.15, 1.3] as const

/** Returns a new config with the build's performance upgrades applied. */
export function applyCarBuild(base: VehicleConfig, build: CarBuild): VehicleConfig {
  const torque = ENGINE_TORQUE[build.engine]
  const susp = SUSPENSION[build.suspension]
  return {
    ...base,
    massKg: base.massKg * WEIGHT[build.weight],
    brakeForce: base.brakeForce * BRAKES[build.brakes],
    maxSteerAngle: base.maxSteerAngle * susp.steer,
    engine: {
      ...base.engine,
      torqueCurve: base.engine.torqueCurve.map(([rpm, nm]) => [rpm, nm * torque]),
    },
    tires: {
      ...base.tires,
      grip: base.tires.grip * TIRE_GRIP[build.tires],
      corneringStiffness: base.tires.corneringStiffness * TIRE_CORNERING[build.tires],
    },
    suspension: {
      ...base.suspension,
      stiffness: base.suspension.stiffness * susp.stiffness,
      damping: base.suspension.damping * susp.damping,
      restLength: base.suspension.restLength - susp.drop,
    },
  }
}

/** True when two builds differ only in looks, so physics needn't be rebuilt. */
export function samePerformance(a: CarBuild, b: CarBuild): boolean {
  return (
    a.engine === b.engine &&
    a.tires === b.tires &&
    a.suspension === b.suspension &&
    a.weight === b.weight &&
    a.brakes === b.brakes
  )
}

export interface BuildStats {
  power: number
  grip: number
  handling: number
  braking: number
}

/** 0..1 ratings for the garage stat bars; stock ≈ 0.5, fully upgraded = 1. */
export function buildStats(build: CarBuild): BuildStats {
  const scale = (v: number, max: number) => 0.5 + 0.5 * ((v - 1) / (max - 1))
  const pw = ENGINE_TORQUE[build.engine] / WEIGHT[build.weight]
  const susp = SUSPENSION[build.suspension]
  return {
    power: scale(pw, ENGINE_TORQUE[3] / WEIGHT[2]),
    grip: scale(TIRE_GRIP[build.tires], TIRE_GRIP.race),
    handling: scale(susp.stiffness * TIRE_CORNERING[build.tires], SUSPENSION.race.stiffness * TIRE_CORNERING.race),
    braking: scale(BRAKES[build.brakes] / WEIGHT[build.weight], BRAKES[2] / WEIGHT[2]),
  }
}

/** Merges persisted JSON over the defaults, dropping anything malformed. */
export function sanitizeBuild(raw: unknown): CarBuild {
  if (!raw || typeof raw !== 'object') return DEFAULT_BUILD
  const r = raw as Partial<Record<keyof CarBuild, unknown>>
  const hex = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d)
  const pick = <T,>(v: unknown, allowed: readonly T[], d: T) => (allowed.includes(v as T) ? (v as T) : d)
  const d = DEFAULT_BUILD
  return {
    paint: hex(r.paint, d.paint),
    finish: pick(r.finish, ['gloss', 'metallic', 'matte', 'pearl'] as const, d.finish),
    rims: hex(r.rims, d.rims),
    calipers: hex(r.calipers, d.calipers),
    tint: typeof r.tint === 'number' && r.tint >= 0 && r.tint <= 1 ? r.tint : d.tint,
    engine: pick(r.engine, [0, 1, 2, 3] as const, d.engine),
    tires: pick(r.tires, ['street', 'sport', 'race'] as const, d.tires),
    suspension: pick(r.suspension, ['stock', 'sport', 'race'] as const, d.suspension),
    weight: pick(r.weight, [0, 1, 2] as const, d.weight),
    brakes: pick(r.brakes, [0, 1, 2] as const, d.brakes),
  }
}

export type CarClass = 'D' | 'C' | 'B' | 'A' | 'S'

/** Single headline number for the garage, like a racing game's performance rank. */
export function performanceRank(build: CarBuild): number {
  const s = buildStats(build)
  const avg = (s.power + s.grip + s.handling + s.braking) / 4
  return Math.round(1800 + 1200 * avg)
}

export function carClass(rank: number): CarClass {
  if (rank >= 2800) return 'S'
  if (rank >= 2300) return 'A'
  if (rank >= 1900) return 'B'
  if (rank >= 1500) return 'C'
  return 'D'
}
