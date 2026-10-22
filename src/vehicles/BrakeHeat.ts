/**
 * Cosmetic brake-disc heat (#92), per axle: braking work heats the discs,
 * airflow cools them. Pure, numbers in and out; drives only the glow, never
 * the brakes (no fade, no physics).
 */

/** Share of braking done by the front discs. */
export const FRONT_BRAKE_SHARE = 0.62
/** Heat gained per unit of braking work (pedal × m/s, over 60 m/s). */
const HEAT_RATE = 0.45
/** Cooling per second at a standstill; airflow multiplies it by (1 + speed / AIRFLOW_MS). */
const COOL_RATE = 0.04
const AIRFLOW_MS = 25
/** Heat where the glow starts and where it's full. A short tap stays well under the start. */
const GLOW_START = 0.3
const GLOW_FULL = 0.9

export class BrakeHeat {
  /** 0..1 per axle. */
  front = 0
  rear = 0

  /**
   * @param braking brake pedal actually braking, 0..1 (VehicleController.braking)
   * @param speed |forward speed|, m/s
   */
  update(dt: number, braking: number, speed: number): void {
    if (dt <= 0) return
    const work = (Math.max(0, braking) * Math.abs(speed)) / 60
    const cool = COOL_RATE * (1 + Math.abs(speed) / AIRFLOW_MS)
    this.front = step(this.front, work * FRONT_BRAKE_SHARE, cool, dt)
    this.rear = step(this.rear, work * (1 - FRONT_BRAKE_SHARE), cool, dt)
  }

  reset(): void {
    this.front = this.rear = 0
  }
}

function step(heat: number, work: number, cool: number, dt: number): number {
  return Math.min(1, Math.max(0, heat + (HEAT_RATE * work - cool * heat) * dt))
}

/** Visible glow 0..1 for a heat value: nothing until the discs are properly hot. */
export function brakeGlow(heat: number): number {
  const t = Math.min(1, Math.max(0, (heat - GLOW_START) / (GLOW_FULL - GLOW_START)))
  return t * t * (3 - 2 * t)
}
