import { Surface } from '../vehicles/Surface'
import type { MinimapRaster } from './MinimapData'

/** Topology-preserving thinning: convert broad paved footprints into a quiet road network. */
export function minimapRoadLines(data: MinimapRaster): Uint8Array {
  const pitch = data.width + 2
  const mask = new Uint8Array(pitch * (data.height + 2))
  const candidates: number[] = []
  for (let y = 0; y < data.height; y++) for (let x = 0; x < data.width; x++) {
    const code = data.cells[y * data.width + x]
    if (code !== Surface.Asphalt && code !== Surface.Kerb) continue
    const index = (y + 1) * pitch + x + 1
    mask[index] = 1; candidates.push(index)
  }
  const remove = new Uint8Array(candidates.length)
  for (let iteration = 0; iteration < 96; iteration++) {
    let changed = false
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < candidates.length; k++) {
        const i = candidates[k]
        remove[k] = 0
        if (!mask[i]) continue
        const n = mask[i - pitch], ne = mask[i - pitch + 1], e = mask[i + 1], se = mask[i + pitch + 1]
        const s = mask[i + pitch], sw = mask[i + pitch - 1], w = mask[i - 1], nw = mask[i - pitch - 1]
        const count = n + ne + e + se + s + sw + w + nw
        if (count < 2 || count > 6) continue
        const changes = (1 - n) * ne + (1 - ne) * e + (1 - e) * se + (1 - se) * s
          + (1 - s) * sw + (1 - sw) * w + (1 - w) * nw + (1 - nw) * n
        if (changes !== 1) continue
        if (pass === 0 ? n * e * s || e * s * w : n * e * w || n * s * w) continue
        remove[k] = 1
      }
      for (let k = 0; k < candidates.length; k++) if (remove[k]) { mask[candidates[k]] = 0; changed = true }
    }
    if (!changed) break
  }
  const lines = new Uint8Array(data.width * data.height)
  for (let y = 0; y < data.height; y++) for (let x = 0; x < data.width; x++) lines[y * data.width + x] = mask[(y + 1) * pitch + x + 1]
  return lines
}

const paths = new WeakMap<MinimapRaster, string>()
/** Trace the thinned network as smooth vectors so zooming never reveals pixel stairs. */
export function minimapRoadPath(data: MinimapRaster): string {
  const cached = paths.get(data)
  if (cached !== undefined) return cached
  const lines = minimapRoadLines(data), width = data.width
  const visited = new Uint8Array(lines.length)
  const dx = [0, 1, 1, 1, 0, -1, -1, -1], dy = [-1, -1, 0, 1, 1, 1, 0, -1]
  const neighbor = (i: number, direction: number): number => {
    const x = i % width, y = Math.floor(i / width), nx = x + dx[direction], ny = y + dy[direction]
    if (nx < 0 || nx >= width || ny < 0 || ny >= data.height) return -1
    const n = ny * width + nx
    if (!lines[n]) return -1
    // Avoid triangular graph shortcuts at a one-pixel right-angle turn.
    if (dx[direction] && dy[direction] && (lines[y * width + nx] || lines[ny * width + x])) return -1
    return n
  }
  const degree = new Uint8Array(lines.length)
  for (let i = 0; i < lines.length; i++) if (lines[i]) for (let d = 0; d < 8; d++) if (neighbor(i, d) >= 0) degree[i]++
  const trace = (start: number, direction: number): number[] => {
    const points = [start]
    let i = start, d = direction
    for (;;) {
      const next = neighbor(i, d)
      if (next < 0 || (visited[i] & (1 << d))) break
      visited[i] |= 1 << d; visited[next] |= 1 << ((d + 4) % 8)
      points.push(next); i = next
      if (i === start || degree[i] !== 2) break
      d = -1
      for (let k = 0; k < 8; k++) if (neighbor(i, k) >= 0 && !(visited[i] & (1 << k))) { d = k; break }
      if (d < 0) break
    }
    return points
  }
  const simplify = (line: number[]): number[] => {
    const keep = new Uint8Array(line.length); keep[0] = keep[line.length - 1] = 1
    const stack = [[0, line.length - 1]]
    while (stack.length) {
      const [a, b] = stack.pop()!
      const ax = line[a] % width, ay = Math.floor(line[a] / width), bx = line[b] % width, by = Math.floor(line[b] / width)
      const vx = bx - ax, vy = by - ay, length = vx * vx + vy * vy
      let farthest = -1, best = 1.2 * 1.2
      for (let k = a + 1; k < b; k++) {
        const x = line[k] % width - ax, y = Math.floor(line[k] / width) - ay
        const t = length ? Math.max(0, Math.min(1, (x * vx + y * vy) / length)) : 0
        const distance = (x - t * vx) ** 2 + (y - t * vy) ** 2
        if (distance > best) { best = distance; farthest = k }
      }
      if (farthest >= 0) { keep[farthest] = 1; stack.push([a, farthest], [farthest, b]) }
    }
    return line.filter((_, i) => keep[i])
  }
  let path = ''
  const append = (line: number[]) => {
    if (line.length < 2) return
    const p = simplify(line).map(i => [data.x + (i % width + .5) * data.cellSize, data.z + (Math.floor(i / width) + .5) * data.cellSize])
    path += `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`
    for (let i = 1; i < p.length - 1; i++) path += `Q${p[i][0].toFixed(1)},${p[i][1].toFixed(1)} ${((p[i][0] + p[i + 1][0]) / 2).toFixed(1)},${((p[i][1] + p[i + 1][1]) / 2).toFixed(1)}`
    path += `L${p.at(-1)![0].toFixed(1)},${p.at(-1)![1].toFixed(1)}`
  }
  for (const junctions of [true, false]) for (let i = 0; i < lines.length; i++) {
    if (!lines[i] || (junctions && degree[i] === 2)) continue
    for (let d = 0; d < 8; d++) if (neighbor(i, d) >= 0 && !(visited[i] & (1 << d))) append(trace(i, d))
  }
  paths.set(data, path)
  return path
}
