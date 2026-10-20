/**
 * The finish-line cinematic's timeline, in real seconds from the crossing.
 * Pure: the camera (RaceFinishCamera), the car's scripted slide (Game) and
 * the overlay (RaceFinish) all read their beat from here.
 *
 * Modelled on a modern open-world racer's finish: the line in the chase
 * camera, a cut to a low trackside camera as the car blasts past and brakes,
 * a side shot at wheel height as it swings into a handbrake slide and stops
 * in its own smoke, a still low front-quarter as the result fades in, a
 * blackout, then three slow beauty shots of the parked car.
 */
export const FINISH_SECONDS = 15.5
export const REDUCED_FINISH_SECONDS = 1.1

export type FinishShot = 'line' | 'pass' | 'slide' | 'stop' | 'beauty-front' | 'beauty-rear' | 'beauty-nose'

export const FINISH_SHOTS: readonly { shot: FinishShot; start: number; end: number }[] = [
  { shot: 'line', start: 0, end: 0.55 },
  { shot: 'pass', start: 0.55, end: 1.6 },
  { shot: 'slide', start: 1.6, end: 3.4 },
  { shot: 'stop', start: 3.4, end: 7.35 },
  { shot: 'beauty-front', start: 7.35, end: 10.2 },
  { shot: 'beauty-rear', start: 10.2, end: 12.9 },
  { shot: 'beauty-nose', start: 12.9, end: FINISH_SECONDS },
]

/** The place badge (with its ring swirl) lands mid-slide; the result label once the car has stopped. */
export const BADGE_AT = 1.9
export const LABEL_AT = 3.8
/** Fade to black and back between the stop and the beauty shots. */
export const BLACKOUT = { out: 6.95, black: 7.35, in: 7.75 } as const

/** The scripted stop: coast past the camera, brake hard, then the slide. */
export const BRAKE_AT = 0.9
export const SLIDE_AT = 1.6
export const SLIDE_SECONDS = 1.8
/** Speed the slide starts from, m/s (~65 km/h: fast enough to smoke, slow enough to stop broadside). */
export const SLIDE_SPEED = 18
/** How far the car swings round in the slide, rad (a touch past broadside). */
export const SLIDE_YAW = (95 * Math.PI) / 180

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const smooth = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t) }

/** Which shot is on screen at `seconds`, and how far through it (0..1). */
export function shotAt(seconds: number): { shot: FinishShot; local: number } {
  for (const s of FINISH_SHOTS) if (seconds < s.end) return { shot: s.shot, local: clamp01((seconds - s.start) / (s.end - s.start)) }
  const last = FINISH_SHOTS[FINISH_SHOTS.length - 1]
  return { shot: last.shot, local: 1 }
}

/** 0 = clear, 1 = black: the dip between the stop and the beauty shots. */
export function blackout(seconds: number): number {
  if (seconds < BLACKOUT.out || seconds > BLACKOUT.in) return 0
  if (seconds < BLACKOUT.black) return smooth((seconds - BLACKOUT.out) / (BLACKOUT.black - BLACKOUT.out))
  return 1 - smooth((seconds - BLACKOUT.black) / (BLACKOUT.in - BLACKOUT.black))
}

export interface FinishDrive {
  /** coast: no override (the car just rolls); scripted: the game sets the car's velocity; parked: hold it still. */
  mode: 'coast' | 'scripted' | 'parked'
  /** Ground speed along the travel direction, m/s (scripted only). */
  speed: number
  /** Yaw rate, rad/s, + = toward the slide side (scripted only). */
  yawRate: number
  /** Share of the velocity turned toward the slide side, 0..1: the car drifts over as it slides. */
  drift: number
}

/**
 * What the car does `seconds` after the line, given the speed it had when
 * braking began. Scripted rather than left to the tyres so the slide is the
 * same, and clean, every time: physics still collides it with anything in
 * the way, and the tyres still smoke and squeal because it really slides.
 */
export function finishDrive(seconds: number, brakeFrom: number): FinishDrive {
  if (seconds < BRAKE_AT) return { mode: 'coast', speed: 0, yawRate: 0, drift: 0 }
  const target = Math.min(brakeFrom, SLIDE_SPEED)
  if (seconds < SLIDE_AT) {
    return { mode: 'scripted', speed: brakeFrom + (target - brakeFrom) * smooth((seconds - BRAKE_AT) / (SLIDE_AT - BRAKE_AT)), yawRate: 0, drift: 0 }
  }
  const s = (seconds - SLIDE_AT) / SLIDE_SECONDS
  if (s >= 1) return { mode: 'parked', speed: 0, yawRate: 0, drift: 0 }
  // Speed bleeds off, fastest at first; the nose swings round on an ease-out
  // (d/ds of 1 − (1 − s)³ is 3(1 − s)²), so it's settled as the car stops.
  const speed = target * (1 - s) ** 1.6
  const yawRate = (SLIDE_YAW * 3 * (1 - s) ** 2) / SLIDE_SECONDS
  return { mode: 'scripted', speed, yawRate, drift: 0.3 * smooth(s) }
}

/** Presentation clock in real seconds; race clocks remain fixed-step simulation time. */
export class FinishSequence {
  elapsed = 0
  reducedMotion = false
  started = false
  get duration(): number { return this.reducedMotion ? REDUCED_FINISH_SECONDS : FINISH_SECONDS }
  get progress(): number { return this.started ? Math.min(1, this.elapsed / this.duration) : 0 }
  get active(): boolean { return this.started && this.progress < 1 }
  /** The cinematic runs at normal speed (the reference has no slow motion); kept for GameLoop. */
  get timeScale(): number { return 1 }
  start(reducedMotion = false): void { this.elapsed = 0; this.reducedMotion = reducedMotion; this.started = true }
  update(dt: number): void { if (this.active && Number.isFinite(dt)) this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, dt)) }
  skip(): void { if (this.started) this.elapsed = this.duration }
  reset(): void { this.elapsed = 0; this.started = false }
}
