import type { Point3 } from './TrackProgress'

export interface GridSlot { x: number; y: number; z: number; heading: number; index: number }

/** Follow the actual road backwards from the authored pole spawn; player takes the last slot. */
export function startingGrid(line: readonly Point3[], pole: Point3, count: number, edges?: {left: Float32Array; right: Float32Array}): GridSlot[] {
  if (line.length < 3 || count < 1) throw new Error('Starting grid requires a closed route and at least one car')
  const distances = new Float64Array(line.length + 1)
  let nearest = 0, fraction = 0, best = Infinity
  for (let i = 0; i < line.length; i++) {
    const a = line[i], b = line[(i + 1) % line.length]
    const dx = b.x - a.x, dz = b.z - a.z
    const length2 = dx * dx + dz * dz
    distances[i + 1] = distances[i] + Math.sqrt(length2)
    const t = Math.max(0, Math.min(1, ((pole.x - a.x) * dx + (pole.z - a.z) * dz) / (length2 || 1)))
    const d = (pole.x - a.x - dx * t) ** 2 + (pole.z - a.z - dz * t) ** 2
    if (d < best) { best = d; nearest = i; fraction = t }
  }
  const length = distances[line.length]
  if (length < count * 6) throw new Error('Track is too short for the starting grid')
  const start = distances[nearest] + fraction * (distances[nearest + 1] - distances[nearest])
  return Array.from({length:count}, (_, slot) => {
    const distance = ((start - slot * 6) % length + length) % length
    let index = 0
    while (index < line.length - 1 && distances[index + 1] < distance) index++
    const a = line[index], b = line[(index + 1) % line.length]
    const dx = b.x - a.x, dz = b.z - a.z, segment = Math.hypot(dx,dz) || 1
    const t = (distance - distances[index]) / segment
    const width = edges ? Math.max(0, Math.min(edges.left[index],edges.right[index]) - 1.5) : 2
    const lateral = count > 1 ? (slot % 2 ? -1 : 1) * Math.min(2,width) : 0
    return {x:a.x+dx*t+dz/segment*lateral, y:a.y+(b.y-a.y)*t, z:a.z+dz*t-dx/segment*lateral, heading:Math.atan2(dx,dz), index}
  })
}
