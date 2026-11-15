import { DEFAULT_LIVERY, sanitizeLivery, type LiveryDesign } from './LiveryDesign'
import type { VehicleConfig } from './VehicleConfig'
import { sanitizeSpoiler, type SpoilerId, type SpoilerFinish, type SpoilerPattern } from './SpoilerCatalog'

/**
 * Player customisation picked in the garage before a race. Visual fields are
 * applied to the model by CarLivery; performance fields scale the car's
 * VehicleConfig through applyCarBuild. Pure data, persisted by gameStore.
 */

export type PaintFinish = 'gloss' | 'metallic' | 'matte' | 'pearl'
export type Stage = 0 | 1 | 2 | 3
export type TireCompound = 'street' | 'sport' | 'race'
export type SuspensionKit = 'stock' | 'sport' | 'race'
/** Exhaust fitted in the garage: changes the sound, the pops and the flames, not the power. */
export type ExhaustKit = 'stock' | 'catback' | 'resdelete' | 'xpipe' | 'straight'
/** Turbo fitted in the garage: changes the whistle and what happens off boost, not the power. */
export type TurboKit = 'stock' | 'single' | 'twin' | 'flutter' | 'eturbo'
export const EXHAUST_KITS: readonly ExhaustKit[] = ['stock', 'catback', 'resdelete', 'xpipe', 'straight']
export const TURBO_KITS: readonly TurboKit[] = ['stock', 'single', 'twin', 'flutter', 'eturbo']

export interface CarBuild {
  spoiler: SpoilerId
  spoilerFinish: SpoilerFinish
  spoilerColor: string
  spoilerPattern: SpoilerPattern
  spoilerStripeColor: string
  spoilerStripeWidth: number
  livery: LiveryDesign
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
  exhaust: ExhaustKit
  turbo: TurboKit
}

export const DEFAULT_BUILD: CarBuild = {
  spoiler: 'stock',
  spoilerFinish: 'carbon',
  spoilerColor: '#20252b',
  spoilerPattern: 'none',
  spoilerStripeColor: '#ffd200',
  spoilerStripeWidth: .08,
  livery: DEFAULT_LIVERY,
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
  exhaust: 'stock',
  turbo: 'stock',
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
/**
 * How often the exhaust pops on the overrun and bangs on upshifts, and how big the flames are:
 * the car's own times `scale`, but at least `floor`, so a louder exhaust makes a car that doesn't
 * pop from the factory (a Porsche, a Demon) start to.
 */
type Fire = { overrun: number; upshift: number; flame: number }
const EXHAUST_FIRE: Record<ExhaustKit, { scale: Fire; floor: Fire }> = {
  stock: { scale: { overrun: 1, upshift: 1, flame: 1 }, floor: { overrun: 0, upshift: 0, flame: 0 } },
  catback: { scale: { overrun: 1.3, upshift: 1.25, flame: 1.1 }, floor: { overrun: 0.35, upshift: 0.25, flame: 0.6 } },
  resdelete: { scale: { overrun: 1.25, upshift: 1.15, flame: 1.05 }, floor: { overrun: 0.3, upshift: 0.2, flame: 0.6 } },
  xpipe: { scale: { overrun: 1.1, upshift: 1.1, flame: 1 }, floor: { overrun: 0.2, upshift: 0.15, flame: 0.6 } },
  straight: { scale: { overrun: 2, upshift: 1.9, flame: 1.4 }, floor: { overrun: 0.9, upshift: 0.7, flame: 0.9 } },
}
const fire = (base: number, kit: ExhaustKit, k: keyof Fire) => Math.max(base * EXHAUST_FIRE[kit].scale[k], EXHAUST_FIRE[kit].floor[k])

/** Returns a new config with the build's performance upgrades applied. */
export function applyCarBuild(base: VehicleConfig, build: CarBuild): VehicleConfig {
  const torque = ENGINE_TORQUE[build.engine]
  const susp = SUSPENSION[build.suspension]
  return {
    ...base,
    massKg: base.massKg * WEIGHT[build.weight],
    backfire: {
      ...base.backfire,
      overrun: fire(base.backfire.overrun, build.exhaust, 'overrun'),
      upshift: fire(base.backfire.upshift, build.exhaust, 'upshift'),
      flame: fire(base.backfire.flame, build.exhaust, 'flame'),
    },
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
    a.brakes === b.brakes &&
    a.exhaust === b.exhaust
  )
}

export interface BuildStats {
  power: number
  grip: number
  handling: number
  braking: number
}

/** Stock ratings of a mid-field car (the Porsche); each car declares its own. */
export const BASE_STATS: BuildStats = { power: 0.5, grip: 0.5, handling: 0.5, braking: 0.5 }

/**
 * 0..1 ratings for the garage stat bars: the car's stock rating, raised toward
 * 1 as upgrades are fitted (fully upgraded = 1).
 */
export function buildStats(build: CarBuild, stock: BuildStats = BASE_STATS): BuildStats {
  const scale = (v: number, max: number, base: number) => base + (1 - base) * ((v - 1) / (max - 1))
  const pw = ENGINE_TORQUE[build.engine] / WEIGHT[build.weight]
  const susp = SUSPENSION[build.suspension]
  return {
    power: scale(pw, ENGINE_TORQUE[3] / WEIGHT[2], stock.power),
    grip: scale(TIRE_GRIP[build.tires], TIRE_GRIP.race, stock.grip),
    handling: scale(susp.stiffness * TIRE_CORNERING[build.tires], SUSPENSION.race.stiffness * TIRE_CORNERING.race, stock.handling),
    braking: scale(BRAKES[build.brakes] / WEIGHT[build.weight], BRAKES[2] / WEIGHT[2], stock.braking),
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
    spoiler: sanitizeSpoiler(r.spoiler),
    spoilerFinish: pick(r.spoilerFinish, ['carbon', 'paint', 'custom'] as const, d.spoilerFinish),
    spoilerColor: hex(r.spoilerColor,d.spoilerColor),
    spoilerPattern: pick(r.spoilerPattern,['none','center','twin','edges','diagonal'] as const,d.spoilerPattern),
    spoilerStripeColor: hex(r.spoilerStripeColor,d.spoilerStripeColor),
    spoilerStripeWidth: typeof r.spoilerStripeWidth==='number'&&Number.isFinite(r.spoilerStripeWidth)?Math.max(.03,Math.min(.18,r.spoilerStripeWidth)):d.spoilerStripeWidth,
    paint: hex(r.paint, d.paint),
    finish: pick(r.finish, ['gloss', 'metallic', 'matte', 'pearl'] as const, d.finish),
    rims: hex(r.rims, d.rims),
    calipers: hex(r.calipers, d.calipers),
    tint: typeof r.tint === 'number' && r.tint >= 0 && r.tint <= 1 ? r.tint : d.tint,
    engine: pick(r.engine, [0, 1, 2, 3] as const, d.engine),
    tires: pick(r.tires, ['street', 'sport', 'race'] as const, d.tires),
    suspension: pick(r.suspension, ['stock', 'sport', 'race'] as const, d.suspension),
    weight: pick(r.weight, [0, 1, 2] as const, d.weight),
    livery: sanitizeLivery(r.livery),
    brakes: pick(r.brakes, [0, 1, 2] as const, d.brakes),
    exhaust: pick(r.exhaust, EXHAUST_KITS, d.exhaust),
    turbo: pick(r.turbo, TURBO_KITS, d.turbo),
  }
}

export type CarClass = 'D' | 'C' | 'B' | 'A' | 'S'

/** Single headline number for the garage, like a racing game's performance rank. */
export function performanceRank(build: CarBuild, stock: BuildStats = BASE_STATS): number {
  const s = buildStats(build, stock)
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
