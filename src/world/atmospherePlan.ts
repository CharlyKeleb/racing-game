/** Small, authored event areas for the flat Papaya circuit. No random road-side placement. */
export interface TracksideEmitter { x: number; y: number; z: number; pit: boolean }
export interface EventSite extends TracksideEmitter { heading: number; label: string }
interface Point { x: number; y: number; z: number }

export const ATMOSPHERE_AREAS = [
  { progress: .015, side: 1, label: 'START / FINISH', pit: true },
  { progress: .32, side: -1, label: 'EAST FLAGS', pit: false },
  { progress: .68, side: 1, label: 'CORNER FLAGS', pit: false },
] as const

/** Refuse areas near another piece of road. Footprint includes flags, fence and pit furniture. */
export function planEventSites(line: readonly Point[], roadWidth: number): EventSite[] {
  if (line.length < 3) return []
  const result: EventSite[] = []
  for (const area of ATMOSPHERE_AREAS) {
    const i = Math.floor(area.progress * line.length), p = line[i]
    const a = line[(i + line.length - 1) % line.length], b = line[(i + 1) % line.length]
    const length = Math.hypot(b.x - a.x, b.z - a.z)
    if (length < .001) continue
    const fx = (b.x - a.x) / length, fz = (b.z - a.z) / length
    const lx = fz * area.side, lz = -fx * area.side
    const x = p.x + lx * (roadWidth / 2 + 13), z = p.z + lz * (roadWidth / 2 + 13)
    // Project every segment into the rectangular site's frame. Sampling every
    // metre prevents a segment passing between just the footprint corners.
    let safe = true
    for (let j = 0; j < line.length && safe; j++) {
      const v = line[j], w = line[(j + 1) % line.length]
      const steps = Math.max(1, Math.ceil(Math.hypot(w.x - v.x, w.z - v.z)))
      for (let k = 0; k <= steps; k++) {
        const dx = v.x + (w.x - v.x) * k / steps - x, dz = v.z + (w.z - v.z) * k / steps - z
        const along = Math.max(0, Math.abs(dx * fx + dz * fz) - 10.5)
        const across = Math.max(0, Math.abs(dx * lx + dz * lz) - 5)
        if (Math.hypot(along, across) < roadWidth / 2 + 3) { safe = false; break }
      }
    }
    // Local +Z points out from the road, local X lies along the front fence.
    if (safe) result.push({ x, y: p.y, z, heading: Math.atan2(lx, lz), label: area.label, pit: area.pit })
  }
  return result
}

/** Same camera-relative panning/attenuation for trackside ambience. */
export function tracksideGain(distance: number): number {
  const fade = Math.max(0, Math.min(1, (150 - distance) / 45))
  return fade * fade / (1 + (Math.max(0, distance - 8) / 28) ** 2)
}
