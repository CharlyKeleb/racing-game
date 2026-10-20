/** Visual calibration in glTF metres (+X left, +Y up, +Z forward). Never handling data. */
export interface CockpitAdjustment { height: number; distance: number; fov: number; yaw: number; pitch: number }
export interface CockpitProfile {
  eye: readonly [number, number, number]
  wheel: readonly [number, number, number]
  display: readonly [number, number, number]
  displaySize: readonly [number, number]
  fov: number
  tilt: number
  steeringRatio: number
  extraction: 'none' | 'bmw' | 'koenigsegg'
  maxHeight: number
}
const PROFILES: Record<string, CockpitProfile> = {
  porsche911: { eye: [.34, 1.065, -.26], wheel: [.34, .75, .55], display: [.34, .82, .74], displaySize: [.27, .075], fov: 68, tilt: .35, steeringRatio: 12, extraction: 'none', maxHeight: .035 },
  koenigsegg: { eye: [.318, .865, .06], wheel: [.318, .67, .485], display: [.318, .728, .565], displaySize: [.245, .065], fov: 72, tilt: .3, steeringRatio: 10, extraction: 'koenigsegg', maxHeight: .025 },
  bmw: { eye: [.387, 1.0, -.32], wheel: [.387, .743, .145], display: [.387, .86, .30], displaySize: [.27, .075], fov: 70, tilt: .5, steeringRatio: 12, extraction: 'bmw', maxHeight: .045 },
}
export const DEFAULT_COCKPIT_ADJUSTMENT: Readonly<CockpitAdjustment> = { height: 0, distance: 0, fov: 0, yaw: 0, pitch: 0 }
export const cockpitProfile = (id: string): CockpitProfile => PROFILES[id] ?? PROFILES.porsche911
export function sanitizeCockpit(value: unknown, id: string): CockpitAdjustment {
  const v = value && typeof value === 'object' ? value as Partial<CockpitAdjustment> : {}
  const clamp = (x: unknown, min: number, max: number) => typeof x === 'number' && Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : 0
  return { height: clamp(v.height, -.04, cockpitProfile(id).maxHeight), distance: clamp(v.distance, -.10, .08), fov: clamp(v.fov, -10, 12), yaw: clamp(v.yaw, -25, 25), pitch: clamp(v.pitch, -8, 4) }
}
