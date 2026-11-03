// Re-skins a game-ripped city's plain box buildings as Parisian (Haussmann) blocks, at build time.
// Each building (a connected piece of a matching primitive) is cut into horizontal bands: a
// shopfront ground floor, limestone floors with French windows and wrought-iron balconies, and a
// zinc mansard with dormers under a cornice. Walls get UVs in real metres; the three bands share one
// atlas (stacked strips, tiling across), so the blocks cost one draw call a chunk. Facades are cut
// every two floors so each piece maps into its strip without wrapping vertically. Roofs take zinc.
//
// restyleBuildings(src, prims, { match, glass, prefix }) replaces the matching prims in place and
// adds the materials to the source document, named `${prefix}stone|glass`. `glass`
// (optional) matches modern glass towers: one curtain-wall material, floor lines every 3.5 m.
import sharp from 'sharp'

/** One texture tile is three 4 m bays wide; floors are 3 m. */
const BAY = 12
const FLOOR = 3
const SHOP = 4.5
const MANSARD = 3.6
/** A glass tile: 6 m of curtain wall across, two 3.5 m floors up. */
const GLASS_W = 6
const GLASS_H = 7

export async function restyleBuildings(src, prims, { match, glass, prefix }) {
  const doc = src
  const { atlas, rows, glassPng } = await paint()
  const materials = {}
  for (const [key, png] of [['stone', atlas], ['glass', glassPng]]) {
    const tex = doc.createTexture(`${prefix}${key}`).setImage(png).setMimeType('image/png')
    materials[key] = doc.createMaterial(`${prefix}${key}`).setBaseColorTexture(tex).setRoughnessFactor(0.85).setMetallicFactor(0)
  }
  // A band's local v (0 = top of its strip, 1 = bottom) into the atlas, a texel in from each edge.
  const inRow = ({ v0, v1, pad }, t) => v0 + pad + Math.max(0, Math.min(1, t)) * (v1 - v0 - 2 * pad)
  const out = { stone: new Builder(), glass: new Builder() }
  let buildings = 0
  for (let p = prims.length - 1; p >= 0; p--) {
    const pr = prims[p]
    if (glass?.test(pr.mat)) {
      prims.splice(p, 1)
      for (let t = 0; t < pr.idx.length; t += 3) {
        const v = [0, 1, 2].map((k) => { const i = pr.idx[t + k] * 3; return [pr.pos[i], pr.pos[i + 1], pr.pos[i + 2]] })
        const n = normal(v)
        if (!n) continue
        if (Math.abs(n[1]) > 0.5) { out.glass.add(v, n, () => [0.5, 0.995]); continue }
        const hl = Math.hypot(n[0], n[2]), tx = -n[2] / hl, tz = n[0] / hl
        out.glass.add(v, n, ([x, y, z]) => [(x * tx + z * tz) / GLASS_W, 1 - y / GLASS_H])
      }
      buildings++
      continue
    }
    if (!match.test(pr.mat)) continue
    prims.splice(p, 1)
    for (const tris of components(pr)) {
      buildings++
      let lo = Infinity, hi = -Infinity
      for (const t of tris) for (let k = 0; k < 3; k++) { const y = pr.pos[pr.idx[t * 3 + k] * 3 + 1]; lo = Math.min(lo, y); hi = Math.max(hi, y) }
      const h = hi - lo
      // Bands from the street up: a short kiosk is all shopfront, a tall block gets all three.
      const shopTop = h > 6 ? lo + SHOP : hi + 1
      const mansardBase = h > 10 ? hi - MANSARD : hi + 1
      for (const t of tris) {
        const v = [0, 1, 2].map((k) => { const i = pr.idx[t * 3 + k] * 3; return [pr.pos[i], pr.pos[i + 1], pr.pos[i + 2]] })
        const n = normal(v)
        if (!n) continue
        if (Math.abs(n[1]) > 0.5) {
          // Roofs, eaves and soffits: plain zinc from the mansard strip's top-left corner.
          out.stone.add(v, n, () => [0.01, inRow(rows.mansard, 0.05)])
          continue
        }
        const hl = Math.hypot(n[0], n[2])
        const tx = -n[2] / hl, tz = n[0] / hl
        const u = (x, z) => (x * tx + z * tz) / BAY
        const tMin = Math.min(v[0][1], v[1][1], v[2][1]), tMax = Math.max(v[0][1], v[1][1], v[2][1])
        const bands = [[rows.shop, -Infinity, shopTop, lo, SHOP], [rows.mansard, mansardBase, Infinity, mansardBase, MANSARD]]
        for (let y = shopTop; y < mansardBase; y += 2 * FLOOR) {
          if (y + 2 * FLOOR < tMin || y > tMax) continue
          bands.push([rows.facade, y, Math.min(y + 2 * FLOOR, mansardBase), y, 2 * FLOOR])
        }
        for (const [row, y0, y1, base, height] of bands) {
          if (y1 < tMin || y0 > tMax) continue
          const poly = clipY(v, y0, y1)
          for (let k = 1; k + 1 < poly.length; k++) out.stone.add([poly[0], poly[k], poly[k + 1]], n, ([x, y, z]) => [u(x, z), inRow(row, 1 - (y - base) / height)])
        }
      }
    }
  }
  for (const [key, b] of Object.entries(out)) {
    if (!b.idx.length) continue
    prims.push({ mat: materials[key].getName(), layer: null, pos: Float32Array.from(b.pos), nrm: Float32Array.from(b.nrm), uv: Float32Array.from(b.uv), idx: Uint32Array.from(b.idx), srcMaterial: materials[key] })
  }
  return { buildings, tris: Object.values(out).reduce((s, b) => s + b.idx.length / 3, 0) }
}

class Builder {
  pos = []; nrm = []; uv = []; idx = []
  add(tri, n, uvOf) {
    const base = this.pos.length / 3
    for (const p of tri) { this.pos.push(...p); this.nrm.push(...n); this.uv.push(...uvOf(p)) }
    this.idx.push(base, base + 1, base + 2)
  }
}

function normal([a, b, c]) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
  const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], l = Math.hypot(...n)
  return l < 1e-9 ? null : n.map((x) => x / l)
}

/** The part of a triangle between two heights, as a convex polygon (Sutherland–Hodgman on two planes). */
function clipY(poly, y0, y1) {
  const clip = (pts, keep, edge) => {
    const res = []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], ia = keep(a[1]), ib = keep(b[1])
      if (ia) res.push(a)
      if (ia !== ib) { const t = (edge - a[1]) / (b[1] - a[1]); res.push([a[0] + (b[0] - a[0]) * t, edge, a[2] + (b[2] - a[2]) * t]) }
    }
    return res
  }
  let pts = poly
  if (y0 > -Infinity) pts = clip(pts, (y) => y >= y0, y0)
  if (pts.length && y1 < Infinity) pts = clip(pts, (y) => y <= y1, y1)
  return pts.length >= 3 ? pts : []
}

/** Triangle lists of a primitive's connected pieces (welded at 5 cm): one per building. */
function components(pr) {
  const n = pr.pos.length / 3, parent = Int32Array.from({ length: n }, (_, i) => i)
  const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a }
  const key = new Map()
  for (let v = 0; v < n; v++) {
    const id = `${Math.round(pr.pos[v * 3] * 20)},${Math.round(pr.pos[v * 3 + 1] * 20)},${Math.round(pr.pos[v * 3 + 2] * 20)}`
    const o = key.get(id)
    if (o === undefined) key.set(id, v); else parent[find(v)] = find(o)
  }
  for (let t = 0; t < pr.idx.length; t += 3) { const a = find(pr.idx[t]); parent[find(pr.idx[t + 1])] = a; parent[find(pr.idx[t + 2])] = a }
  const groups = new Map()
  for (let t = 0; t < pr.idx.length / 3; t++) {
    const r = find(pr.idx[t * 3])
    let g = groups.get(r)
    if (!g) groups.set(r, (g = []))
    g.push(t)
  }
  return [...groups.values()]
}

// ── Textures ───────────────────────────────────────────────────────────────
/** Deterministic noise in [-0.5, 0.5]. */
const noise = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296 - 0.5 }

async function paint() {
  const W = 1024
  /** px per metre across: one tile is BAY m wide. */
  const S = W / BAY
  const img = (h, fn) => {
    const buf = Buffer.alloc(W * h * 3)
    for (let y = 0; y < h; y++) for (let x = 0; x < W; x++) {
      const c = fn(x, y)
      for (let k = 0; k < 3; k++) buf[(y * W + x) * 3 + k] = Math.max(0, Math.min(255, Math.round(c[k])))
    }
    return sharp(buf, { raw: { width: W, height: h, channels: 3 } }).png().toBuffer()
  }
  const stone = (x, y, tone = 0) => {
    // Cream limestone: ashlar courses every 0.5 m, joints staggered per course, a little grain.
    const course = Math.floor(y / (S * 0.5)), cx = (x + (course % 2) * S * 0.6) % (S * 1.2)
    const joint = y % (S * 0.5) < 2 || cx < 2
    const n = noise(x >> 1, y >> 1, 1) * 10 + noise(x >> 4, y >> 4, 2) * 8 + tone
    const base = [214 + n, 200 + n, 172 + n]
    return joint ? base.map((c) => c - 26) : base
  }
  const bayOf = (x) => { const b = Math.floor(x / (S * 4)); return { b, bx: x - b * S * 4 } }

  // Two floors (6 m) of a Haussmann facade: a French window per 4 m bay, mouldings, and a
  // wrought-iron balcony (continuous on the lower floor, a balconette on the upper one).
  const facadeH = Math.round(2 * FLOOR * S)
  const facade = await img(facadeH, (x, y) => {
    const { bx } = bayOf(x)
    const fy = y % (FLOOR * S), floor = Math.floor(y / (FLOOR * S)) // 0 = upper floor of the pair
    const wx0 = S * 1.25, wx1 = S * 2.75, wy0 = S * 0.55, wy1 = S * 2.55
    const inWin = bx >= wx0 && bx < wx1 && fy >= wy0 && fy < wy1
    const frame = inWin && (bx < wx0 + 5 || bx >= wx1 - 5 || fy < wy0 + 5 || Math.abs(bx - (wx0 + wx1) / 2) < 3 || Math.abs(fy - (wy0 + S * 0.55)) < 3)
    // Railing: balcony across the whole floor (lower floor), or just the window (upper).
    const railTop = wy1 - S * 0.95, railBot = wy1
    const inRail = fy >= railTop && fy < railBot && (floor === 1 || (bx >= wx0 - 6 && bx < wx1 + 6))
    if (inRail) {
      const bar = (x % 9) < 2 || fy - railTop < 4 || railBot - fy < 5 || ((x + fy) % 22 < 2 && fy - railTop < S * 0.45)
      if (bar) return [34, 34, 36]
    }
    if (frame) return [236, 232, 222]
    if (inWin) {
      // Dark glass with a sky reflection fading down, the odd lit room.
      const lit = noise(Math.floor(x / (S * 4)), floor, 7) > 0.3
      const t = (fy - wy0) / (wy1 - wy0)
      return lit ? [196 - t * 40, 160 - t * 40, 104 - t * 30] : [70 + (1 - t) * 50, 84 + (1 - t) * 50, 98 + (1 - t) * 52]
    }
    // Moulded lintel above each window and a balcony slab at floor level.
    if (bx >= wx0 - 10 && bx < wx1 + 10 && fy >= wy0 - 14 && fy < wy0) return stone(x, y, 18)
    if (floor === 1 && fy >= railBot && fy < railBot + 8) return [178, 166, 140]
    if (fy < 5) return stone(x, y, -18)
    return stone(x, y)
  })

  // Ground floor (4.5 m): stone piers, shop windows with warm interiors, an awning and a sign.
  const shopH = Math.round(SHOP * S)
  const awnings = [[34, 78, 52], [128, 28, 34], [28, 44, 86]]
  const shop = await img(shopH, (x, y) => {
    const { b, bx } = bayOf(x)
    const pier = bx < S * 0.45 || bx >= S * 3.55
    if (pier) return stone(x, y, -6 + (y % (S * 0.3) < 2 ? -24 : 0))
    if (y < S * 0.55) return y < 4 ? [40, 34, 28] : stone(x, y, 10)
    if (y < S * 1.15) return (x % 40 < 22 && y > S * 0.75 && y < S * 0.95) ? [214, 178, 92] : [30, 32, 34]
    if (y < S * 1.75) { const a = awnings[b % 3]; const stripe = Math.floor(x / 14) % 2 ? 0.88 : 1; return a.map((c) => c * stripe) }
    const glassTop = S * 1.75, glassBot = shopH - S * 0.35
    if (y >= glassBot) return y > shopH - 6 ? [58, 54, 50] : [62, 46, 34]
    const mull = Math.abs(bx - S * 2) < 4 || bx < S * 0.45 + 5 || bx >= S * 3.55 - 5
    if (mull) return [52, 40, 30]
    const t = (y - glassTop) / (glassBot - glassTop)
    return [150 + t * 60 + noise(x >> 3, y >> 3, b) * 30, 118 + t * 40, 74 + t * 20]
  })

  // Mansard (3.6 m): a cornice at the bottom, blue-grey zinc with standing seams and a dormer per bay.
  const mansardH = Math.round(MANSARD * S)
  const mansard = await img(mansardH, (x, y) => {
    const { bx } = bayOf(x)
    const corniceTop = mansardH - S * 0.6
    if (y >= corniceTop) {
      const dy = y - corniceTop
      return dy < 6 ? [150, 140, 120] : dy < S * 0.25 ? stone(x, y, 14) : dy < S * 0.32 ? [120, 112, 96] : stone(x, y, -4)
    }
    const dx0 = S * 1.4, dx1 = S * 2.6, dy0 = S * 0.9, dy1 = corniceTop - S * 0.25
    if (bx >= dx0 - 8 && bx < dx1 + 8 && y >= dy0 - 16 && y < dy1) {
      const inGlass = bx >= dx0 + 6 && bx < dx1 - 6 && y >= dy0 + 6 && y < dy1 - 6
      if (inGlass) return Math.abs(bx - (dx0 + dx1) / 2) < 3 ? [230, 226, 216] : [64, 74, 86]
      return y < dy0 ? [196, 186, 162] : [228, 222, 208]
    }
    const seam = x % 26 < 2
    const n = noise(x >> 2, y >> 2, 9) * 8
    return seam ? [84 + n, 92 + n, 102 + n] : [104 + n, 114 + n, 126 + n]
  })
  // Curtain wall (6 × 7 m): blue-grey panes with a sky gradient, slim mullions, a spandrel per floor.
  const GW = 512, GH = Math.round(GW * GLASS_H / GLASS_W), gs = GW / GLASS_W
  const gbuf = Buffer.alloc(GW * GH * 3)
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const fy = y % (3.5 * gs), floor = Math.floor(y / (3.5 * gs))
    const mullion = x % (1.5 * gs) < 3
    const spandrel = fy > 3.5 * gs - 0.7 * gs
    const pane = Math.floor(x / (1.5 * gs)) + floor * 4
    const t = fy / (3.5 * gs), tint = noise(pane, floor, 11) * 18
    const c = mullion ? [150, 156, 162] : spandrel ? [58, 66, 76] : [92 + (1 - t) * 54 + tint, 112 + (1 - t) * 50 + tint, 132 + (1 - t) * 44 + tint]
    for (let k = 0; k < 3; k++) gbuf[(y * GW + x) * 3 + k] = Math.max(0, Math.min(255, Math.round(c[k])))
  }
  const glassPng = await sharp(gbuf, { raw: { width: GW, height: GH, channels: 3 } }).png().toBuffer()
  // Stack the strips: facade, shopfront, mansard (each spans the full width, so u tiles across).
  const strips = [['facade', facade, facadeH], ['shop', shop, shopH], ['mansard', mansard, mansardH]]
  const H = strips.reduce((s, [, , h]) => s + h, 0)
  const rows = {}
  let top = 0
  for (const [key, , h] of strips) { rows[key] = { v0: top / H, v1: (top + h) / H, pad: 2 / H }; top += h }
  const atlas = await sharp({ create: { width: W, height: H, channels: 3, background: '#000' } })
    .composite(strips.map(([, png], i) => ({ input: png, left: 0, top: Math.round(strips.slice(0, i).reduce((s, [, , h]) => s + h, 0)) })))
    .png().toBuffer()
  return { atlas, rows, glassPng }
}
