// Extracts the track's centreline from the road mesh, offline.
//
// 1. Rasterise the racing-surface triangles top-down (1 cell = `res` m), keeping
//    the highest and lowest surface height per cell (a bridge over the route).
// 2. Distance transform: how far each road cell is from the nearest edge.
// 3. Dijkstra between consecutive waypoints (gates + optional via points) with a
//    cost that explodes near the edges, so the path hugs the middle of the road.
// 4. Smooth and resample to even spacing; heights come from the raster, each
//    point taking whichever level carries on from the one before, so the line
//    stays on the street under a flyover instead of jumping up onto it.
//
// The result drives the minimap and the in-world direction chevrons.

/**
 * @param prims   [{ pos: Float32Array, idx: Uint32Array, mat: string }] in source world space
 * @param surface RegExp of materials that form the racing surface
 * @param waypoints [[x, z], ...] in race order; the loop closes back to the first
 * @returns {{ points: number[][], length: number }} closed polyline [x, y, z], `spacing` apart
 */
export function traceCenterline(prims, surface, waypoints, { res = 1, spacing = 4, margin = 20 } = {}) {
  const tris = prims.filter((p) => surface.test(p.mat))
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (const p of tris) for (let i = 0; i < p.pos.length; i += 3) {
    x0 = Math.min(x0, p.pos[i]); x1 = Math.max(x1, p.pos[i]); z0 = Math.min(z0, p.pos[i + 2]); z1 = Math.max(z1, p.pos[i + 2])
  }
  x0 -= margin; z0 -= margin; x1 += margin; z1 += margin
  const W = Math.ceil((x1 - x0) / res), H = Math.ceil((z1 - z0) / res)
  const road = new Uint8Array(W * H)
  const height = new Float32Array(W * H).fill(-Infinity)
  const low = new Float32Array(W * H).fill(Infinity)

  // 1. Rasterise
  for (const p of tris) {
    const { pos, idx } = p
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3
      const ax = (pos[a] - x0) / res, az = (pos[a + 2] - z0) / res
      const bx = (pos[b] - x0) / res, bz = (pos[b + 2] - z0) / res
      const cx = (pos[c] - x0) / res, cz = (pos[c + 2] - z0) / res
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
      if (d === 0) continue
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)))
      const minZ = Math.max(0, Math.floor(Math.min(az, bz, cz))), maxZ = Math.min(H - 1, Math.ceil(Math.max(az, bz, cz)))
      for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, pz = z + 0.5
        const w0 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d
        const w1 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d
        const w2 = 1 - w0 - w1
        if (w0 < -0.01 || w1 < -0.01 || w2 < -0.01) continue
        const y = w0 * pos[a + 1] + w1 * pos[b + 1] + w2 * pos[c + 1]
        const o = z * W + x
        road[o] = 1
        if (y > height[o]) height[o] = y
        if (y < low[o]) low[o] = y
      }
    }
  }

  // 2. Distance to the road edge (8-connected chamfer, two passes)
  const dist = new Float32Array(W * H)
  for (let i = 0; i < dist.length; i++) dist[i] = road[i] ? 1e9 : 0
  const D = 1, DD = Math.SQRT2
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const o = z * W + x
    if (!dist[o]) continue
    let v = dist[o]
    if (x > 0) v = Math.min(v, dist[o - 1] + D)
    if (z > 0) {
      v = Math.min(v, dist[o - W] + D)
      if (x > 0) v = Math.min(v, dist[o - W - 1] + DD)
      if (x < W - 1) v = Math.min(v, dist[o - W + 1] + DD)
    }
    dist[o] = v
  }
  for (let z = H - 1; z >= 0; z--) for (let x = W - 1; x >= 0; x--) {
    const o = z * W + x
    if (!dist[o]) continue
    let v = dist[o]
    if (x < W - 1) v = Math.min(v, dist[o + 1] + D)
    if (z < H - 1) {
      v = Math.min(v, dist[o + W] + D)
      if (x < W - 1) v = Math.min(v, dist[o + W + 1] + DD)
      if (x > 0) v = Math.min(v, dist[o + W - 1] + DD)
    }
    dist[o] = v
  }

  // 3. Centre-hugging shortest paths between waypoints
  const toCell = ([x, z]) => {
    let cx = Math.round((x - x0) / res), cz = Math.round((z - z0) / res)
    // Snap to the most central road cell nearby.
    let best = -1, bestD = 0
    for (let dz = -15; dz <= 15; dz++) for (let dx = -15; dx <= 15; dx++) {
      const o = (cz + dz) * W + (cx + dx)
      if (cx + dx < 0 || cz + dz < 0 || cx + dx >= W || cz + dz >= H || !road[o]) continue
      const score = dist[o] - Math.hypot(dx, dz) * 0.3
      if (best < 0 || score > bestD) { best = o; bestD = score }
    }
    if (best < 0) throw new Error(`waypoint ${x},${z} is not near the racing surface`)
    return best
  }
  const cellCost = (o) => 1 + 40 / (dist[o] * dist[o] + 0.5)

  const NEIGH = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, DD], [1, -1, DD], [-1, 1, DD], [-1, -1, DD]]
  const g = new Float32Array(W * H)
  const from = new Int32Array(W * H)
  const stamp = new Int32Array(W * H)
  let run = 0
  function path(start, goal) {
    run++
    // Binary heap of [cost, cell]
    const heap = []
    const push = (c, o) => {
      heap.push([c, o])
      let i = heap.length - 1
      while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p }
    }
    const pop = () => {
      const top = heap[0], last = heap.pop()
      if (heap.length) {
        heap[0] = last
        let i = 0
        for (;;) {
          const l = 2 * i + 1, r = l + 1
          let m = i
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r
          if (m === i) break
          ;[heap[m], heap[i]] = [heap[i], heap[m]]
          i = m
        }
      }
      return top
    }
    stamp[start] = run; g[start] = 0; from[start] = -1
    push(0, start)
    const gx = goal % W, gz = (goal / W) | 0
    while (heap.length) {
      const [c, o] = pop()
      if (o === goal) break
      if (c > g[o] + Math.hypot((o % W) - gx, ((o / W) | 0) - gz) + 1e-3) continue
      const x = o % W, z = (o / W) | 0
      for (const [dx, dz, len] of NEIGH) {
        const nx = x + dx, nz = z + dz
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue
        const n = nz * W + nx
        if (!road[n]) continue
        const ng = g[o] + len * cellCost(n)
        if (stamp[n] === run && ng >= g[n]) continue
        stamp[n] = run; g[n] = ng; from[n] = o
        push(ng + Math.hypot(nx - gx, nz - gz), n) // A*: straight-line heuristic (cost ≥ 1 per cell)
      }
    }
    if (stamp[goal] !== run) throw new Error('no road path between waypoints — add a via point')
    const cells = []
    for (let o = goal; o !== -1; o = from[o]) cells.push(o)
    return cells.reverse()
  }

  const ends = waypoints.map(toCell)
  let cells = []
  for (let i = 0; i < ends.length; i++) {
    const seg = path(ends[i], ends[(i + 1) % ends.length])
    cells.push(...(i === 0 ? seg : seg.slice(1)))
  }
  cells.pop() // closed loop: last == first

  // 4. Smooth (circular moving average) and resample to even spacing
  let pts = cells.map((o) => [x0 + ((o % W) + 0.5) * res, z0 + (((o / W) | 0) + 0.5) * res])
  const smooth = (arr, k) => arr.map((_, i) => {
    let sx = 0, sz = 0
    for (let j = -k; j <= k; j++) { const p = arr[(i + j + arr.length) % arr.length]; sx += p[0]; sz += p[1] }
    return [sx / (2 * k + 1), sz / (2 * k + 1)]
  })
  pts = smooth(smooth(pts, 6), 6)

  const out = []
  let carry = 0
  let total = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1])
    let t = carry
    while (t < seg) {
      const x = a[0] + ((b[0] - a[0]) * t) / seg, z = a[1] + ((b[1] - a[1]) * t) / seg
      out.push([x, z])
      t += spacing
    }
    carry = t - seg
    total += seg
  }
  const heightAt = (x, z, prev) => {
    const cx = Math.floor((x - x0) / res), cz = Math.floor((z - z0) / res)
    // nearest cell with a height (smoothing can drift a cell off the raster)
    for (let r = 0; r < 6; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const o = (cz + dz) * W + (cx + dx)
      if (height[o] > -Infinity) return prev === undefined || Math.abs(height[o] - prev) <= Math.abs(low[o] - prev) ? height[o] : low[o]
    }
    return prev ?? 0
  }
  let prev
  const points = out.map(([x, z]) => [x, (prev = heightAt(x, z, prev)), z])
  return { points, length: total, debug: { x0, z0, W, H } }
}
