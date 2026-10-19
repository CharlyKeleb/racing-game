/** Small secondary droplets ejected by a rain impact; world units are metres and seconds. */
export const SPLASH_GRAVITY = 9.81
export const SPLASH_LIFT_MIN = .9
export const SPLASH_LIFT_RANGE = .8
export const SPLASH_AIR_DRAG = .8

/** Height relative to the hit point; negative means the droplet has landed. */
export function splashHeight(lift: number, seconds: number): number {
  return lift * seconds - .5 * SPLASH_GRAVITY * seconds * seconds
}
