/**
 * What a car's tyres and brakes sound like, from its real hardware, and how
 * loud each part is right now. Pure (numbers in, numbers out): TyreBrakeSound
 * maps the result to Web Audio nodes, for the player and every rival.
 *
 * Real tyre squeal is a stick-slip vibration of the tread: a few narrow,
 * slightly wandering tones over broadband scrub. How tonal it is depends on
 * the tyre — a road tyre's grooved, stiff-sidewalled tread sings; a slick's
 * soft, smooth rubber mostly scrubs and groans. Brakes are near-silent at
 * speed (pad hiss), squeal at walking pace, and race pads on iron discs
 * grind. ABS cars chatter at the limit; a race car without ABS locks up.
 */

export interface TyreSoundProfile {
  /** Fundamental of the squeal, Hz (the tread block's stick-slip ring). */
  squealHz: number
  /** How much of the squeal is tone rather than scrub, 0..1. */
  tonal: number
  /** Centre of the broadband scrub, Hz. */
  scrubHz: number
}

export interface BrakeSoundProfile {
  /** Centre of the pad-on-disc friction hiss, Hz. */
  hissHz: number
  /** Low-speed brake squeal, Hz; 0 for brakes that don't squeal. */
  squealHz: number
  /** Metallic grind of race pads on iron discs, 0..1. */
  grind: number
  /** Anti-lock brakes: chatter at the limit instead of locking up. */
  abs: boolean
}

export interface CarNoiseProfile {
  tyres: TyreSoundProfile
  brakes: BrakeSoundProfile
}

/** A road car on road tyres and iron brakes, for cars without their own profile. */
export const DEFAULT_NOISE_PROFILE: CarNoiseProfile = {
  tyres: { squealHz: 1150, tonal: 0.8, scrubHz: 900 },
  brakes: { hissHz: 4200, squealHz: 3300, grind: 0, abs: true },
}

export interface TyreBrakeInput {
  /** |forward speed|, m/s. */
  speed: number
  /** Brake actually applied, 0..1. */
  brake: number
  /** Highest friction-circle use over the wheels on pavement, 0..1. */
  slip: number
  /** Highest sliding speed of a contact patch on pavement, m/s. */
  slide: number
  /** Share of the wheels on asphalt or kerb (only pavement squeals), 0..1. */
  paved: number
  /** Arcade drift under way. */
  drifting: boolean
}

export interface TyreBrakeLevels {
  /** Tyre squeal level, 0..1. */
  squeal: number
  /** Pitch multiplier for the squeal: rises with slide speed, and with a lock-up. */
  squealPitch: number
  /** Broadband scrub level, 0..1. */
  scrub: number
  /** Brake pad hiss, 0..1. */
  brakeHiss: number
  /** Race pad grind, 0..1, and its rasp rate (disc passing the pad), Hz. */
  grind: number
  grindRate: number
  /** Low-speed brake squeal, 0..1. */
  brakeSqueal: number
  /** ABS chatter depth, 0..1 (the squeal pulses at ~14 Hz). */
  abs: number
}

/** Friction-circle use where a tyre starts to sing. */
const SQUEAL_ONSET = 0.82
/** Slide speed that's a full-blooded squeal, m/s. */
const FULL_SLIDE = 6
/** Hard braking near the limit: where ABS works, or a race car locks. */
const LIMIT_BRAKE = 0.7
/** Effective rolling circumference for the grind's rasp rate, m. */
const WHEEL_CIRCUMFERENCE = 2.1

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export function tyreBrakeLevels(s: TyreBrakeInput, p: CarNoiseProfile): TyreBrakeLevels {
  const moving = clamp01((s.speed - 1.5) / 4)
  // At the limit (cornering hard or trail braking), then sliding.
  const onset = clamp01((s.slip - SQUEAL_ONSET) / (1 - SQUEAL_ONSET))
  const sliding = clamp01(s.slide / FULL_SLIDE)
  let grip = Math.max(onset * 0.55, sliding, s.drifting ? 0.7 : 0) * s.paved * moving

  const atLimitBraking = s.brake > LIMIT_BRAKE && s.slip > 0.9 && s.speed > 5
  // No ABS: hard braking at the limit locks the wheels and the tyres howl.
  const lockup = atLimitBraking && !p.brakes.abs ? s.paved : 0
  // ABS: the wheels are released and re-applied ~14 times a second.
  const abs = atLimitBraking && p.brakes.abs ? s.paved * clamp01((s.brake - LIMIT_BRAKE) / (1 - LIMIT_BRAKE) + 0.4) : 0
  grip = Math.max(grip, lockup * 0.9, abs * 0.5)

  const squeal = grip * p.tyres.tonal
  // Slicks scrub where road tyres sing; all tyres scrub some when sliding.
  const scrub = clamp01(grip * (1 - p.tyres.tonal * 0.6) + sliding * 0.25 * s.paved * moving)
  const squealPitch = 1 + 0.12 * sliding + 0.18 * lockup

  const brake = s.brake * moving
  const brakeHiss = brake * clamp01(s.speed / 40) * 0.6
  const grind = p.brakes.grind * brake * clamp01(s.speed / 12)
  const grindRate = (s.speed / WHEEL_CIRCUMFERENCE) * 6 // drilled/grooved disc: several passes per turn
  // The classic squeal: light pressure at walking pace, just before stopping.
  const slow = s.speed > 0.4 && s.speed < 5 ? 1 - Math.abs(s.speed - 2.2) / 2.8 : 0
  const brakeSqueal = p.brakes.squealHz > 0 ? clamp01(slow) * clamp01(s.brake * 2.5) : 0

  return { squeal, squealPitch, scrub, brakeHiss, grind, grindRate, brakeSqueal, abs }
}
