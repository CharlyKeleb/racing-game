import { buildMinimapRaster, type MinimapRaster } from './MinimapData'
import { Surface } from '../vehicles/Surface'

/** Grid metadata as written to track.json by scripts/track/derive-from-chunks.mjs. */
export interface SurfaceGridInfo {
  url: string
  /** World XZ of cell (0, 0)'s corner, meters. */
  x0: number
  z0: number
  /** Cell size, meters. */
  res: number
  width: number
  height: number
}

/**
 * Decodes the pipeline's run-length encoding: repeated [code byte, run length
 * as an unsigned LEB128 varint], row-major. Pure, so it's unit tested.
 */
export function decodeSurfaceRle(bytes: Uint8Array, cellCount: number): Uint8Array {
  const out = new Uint8Array(cellCount)
  let o = 0
  let i = 0
  while (i < bytes.length && o < cellCount) {
    const code = bytes[i++]
    let run = 0
    let shift = 0
    for (;;) {
      const b = bytes[i++]
      run |= (b & 0x7f) << shift
      if (!(b & 0x80)) break
      shift += 7
    }
    out.fill(code, o, Math.min(cellCount, o + run))
    o += run
  }
  return out
}

/** Surface type per grid cell; anything off the grid is open terrain (Surface.None). */
export class SurfaceMap {
  private overviewCache?: MinimapRaster
  private readonly cells: Uint8Array
  private readonly info: SurfaceGridInfo

  constructor(info: SurfaceGridInfo, cells: Uint8Array) {
    this.info = info
    this.cells = cells
  }

  overview(): MinimapRaster {
    return this.overviewCache ??= buildMinimapRaster(this.info, this.cells)
  }

  at(x: number, z: number): Surface {
    const { x0, z0, res, width, height } = this.info
    const cx = Math.floor((x - x0) / res)
    const cz = Math.floor((z - z0) / res)
    if (cx < 0 || cz < 0 || cx >= width || cz >= height) return Surface.None
    return this.cells[cz * width + cx] as Surface
  }

  /**
   * A flat ribbon road: asphalt within `halfWidth` of the closed `line`, kerbs
   * for `kerb` meters beyond, grass elsewhere. For procedural tracks.
   */
  static fromRibbon(line: readonly { x: number; z: number }[], halfWidth: number, kerb: number, res = 1): SurfaceMap {
    const reach = halfWidth + kerb
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
    for (const p of line) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z)
    }
    const x0 = Math.floor(minX - reach - 2)
    const z0 = Math.floor(minZ - reach - 2)
    const width = Math.ceil((maxX + reach + 2 - x0) / res)
    const height = Math.ceil((maxZ + reach + 2 - z0) / res)
    const dist = new Float32Array(width * height).fill(Infinity)
    const n = line.length
    for (let i = 0; i < n; i++) {
      const a = line[i]
      const b = line[(i + 1) % n]
      const abx = b.x - a.x
      const abz = b.z - a.z
      const len2 = abx * abx + abz * abz || 1
      const cx0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach - x0) / res))
      const cx1 = Math.min(width - 1, Math.ceil((Math.max(a.x, b.x) + reach - x0) / res))
      const cz0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - reach - z0) / res))
      const cz1 = Math.min(height - 1, Math.ceil((Math.max(a.z, b.z) + reach - z0) / res))
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const px = x0 + (cx + 0.5) * res - a.x
          const pz = z0 + (cz + 0.5) * res - a.z
          const t = Math.max(0, Math.min(1, (px * abx + pz * abz) / len2))
          const d = Math.hypot(px - abx * t, pz - abz * t)
          const o = cz * width + cx
          if (d < dist[o]) dist[o] = d
        }
      }
    }
    const cells = new Uint8Array(width * height)
    for (let o = 0; o < cells.length; o++) {
      cells[o] = dist[o] <= halfWidth ? Surface.Asphalt : dist[o] <= reach ? Surface.Kerb : Surface.Grass
    }
    return new SurfaceMap({ url: '', x0, z0, res, width, height }, cells)
  }
}

/** Paved: where the road (incl. kerbs) ends and run-off begins. */
export function isPaved(s: Surface): boolean {
  return s === Surface.Asphalt || s === Surface.Kerb
}

/**
 * Distance from each centreline point to the edge of the paved surface on its
 * left (+X side of travel, glTF) and right, meters. Marches outward in 0.5 m
 * steps; stops at `max`. Run once at load, used to stand signs at the roadside.
 */
export function measureRoadEdges(
  line: readonly { x: number; z: number }[],
  surfaceAt: (x: number, z: number) => Surface,
  max = 30,
): { left: Float32Array; right: Float32Array } {
  const n = line.length
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  const STEP = 0.5
  for (let i = 0; i < n; i++) {
    const a = line[(i - 1 + n) % n]
    const b = line[(i + 1) % n]
    let tx = b.x - a.x
    let tz = b.z - a.z
    const l = Math.hypot(tx, tz) || 1
    tx /= l
    tz /= l
    // Left of travel: forward (0, 1) in XZ → left (1, 0), so left = (tz, -tx).
    const lx = tz
    const lz = -tx
    const p = line[i]
    for (const [out, sign] of [[left, 1], [right, -1]] as const) {
      let d = 0
      // Allow a short unpaved gap (painted lines, drains) before calling it the edge.
      let gap = 0
      while (d < max) {
        d += STEP
        if (isPaved(surfaceAt(p.x + lx * d * sign, p.z + lz * d * sign))) gap = 0
        else if ((gap += STEP) > 1) break
      }
      out[i] = Math.max(2, d - gap)
    }
  }
  return { left, right }
}
