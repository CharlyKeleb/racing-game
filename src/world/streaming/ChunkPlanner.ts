/**
 * Pure streaming decisions: which LOD each chunk should have given where the
 * car is and where it will be. No Three.js — unit tested in tests/streaming.test.ts.
 */

export interface ChunkInfo {
  /** XZ bounds of the chunk's geometry. */
  minX: number
  minZ: number
  maxX: number
  maxZ: number
  /** Number of LOD files available (LOD0 = most detailed). */
  lodCount: number
}

export interface StreamRadii {
  /** Full detail within this distance (m) of the car. */
  lod0: number
  /** Reduced detail out to this distance; nothing beyond. */
  lod1: number
  /** Extra distance before stepping down / unloading, so chunks don't flicker on a boundary. */
  hysteresis: number
}

export const NOT_LOADED = -1

/** Distance on the XZ plane from a point to an axis-aligned rectangle (0 inside). */
export function distanceToChunk(c: ChunkInfo, x: number, z: number): number {
  const dx = Math.max(c.minX - x, 0, x - c.maxX)
  const dz = Math.max(c.minZ - z, 0, z - c.maxZ)
  return Math.hypot(dx, dz)
}

/**
 * @param focus  car position (x, z)
 * @param ahead  where the car will be in ~2 s — prefetches in the direction of travel
 * @param current the LOD each chunk currently shows (NOT_LOADED if none)
 * @param out    receives the wanted LOD per chunk
 * @param dist   receives the planning distance per chunk (for load priority)
 */
export function planLods(
  chunks: readonly ChunkInfo[],
  focus: readonly [number, number],
  ahead: readonly [number, number],
  radii: StreamRadii,
  current: ArrayLike<number>,
  out: Int8Array,
  dist: Float32Array,
): void {
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    const d = Math.min(distanceToChunk(c, focus[0], focus[1]), distanceToChunk(c, ahead[0], ahead[1]))
    dist[i] = d
    const cur = current[i]
    let want: number
    if (d < radii.lod0) want = 0
    else if (d < radii.lod1) want = 1
    else want = NOT_LOADED

    // Hysteresis: keep what we have while just outside its band.
    if (cur === 0 && want !== 0 && d < radii.lod0 + radii.hysteresis) want = 0
    else if (cur !== NOT_LOADED && want === NOT_LOADED && d < radii.lod1 + radii.hysteresis) want = cur

    if (want !== NOT_LOADED) want = Math.min(want, c.lodCount - 1)
    out[i] = want
  }
}
