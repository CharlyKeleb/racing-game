import * as THREE from 'three'
import type { TrackProgress } from '../racing/TrackProgress'

/** Most arrows shown at once. */
const COUNT = 24
/** An arrow every this many centreline points (~4 m spacing → every 8 m). */
const STEP = 2
/** Arrows are anchored to the track; they appear this far ahead (~200 m)… */
const AHEAD = 50
/** …and stay this many points behind, so they slide out under the car instead of vanishing. */
const BEHIND = 3
/** Heading change (rad) over ±SPAN points that makes a corner worth marking. */
const MIN_BEND = 0.25
const SPAN = 5
/** Arrows start this many points (~32 m) before a corner, on the approach, like NFS. */
const LEAD_IN = 8
/** Arrows sit on the inside of the bend, this far in from the paved edge, but never further out than MAX_OFFSET from the centreline. */
const EDGE_INSET = 2.2
const MAX_OFFSET = 5.5
/** Arrow footprint on the road, m: long along the road so it reads at a grazing angle. */
const ARROW_LEN = 6.5
const ARROW_WID = 4.2
/** How far (rad) the arrow turns from straight ahead toward the bend: it points into the corner. */
const POINT_IN = 0.32
/** Above the measured road plane; polygon offset handles the rest. */
const HOVER = 0.04
/** Lateral offsets tried, as fractions of the preferred one, until the whole arrow is on asphalt. */
const PULL_IN = [1, 0.7, 0.4, 0]
/** Far arrows fade in over this many points instead of popping. */
const FADE = 10
const CYAN = new THREE.Color(0.25, 0.86, 1)

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _fwd = new THREE.Vector3()
const _side = new THREE.Vector3()
const _pos = new THREE.Vector3()
const _scale = new THREE.Vector3()
const _c = new THREE.Color()
const _af = new THREE.Vector3()
const _al = new THREE.Vector3()
const _t = new THREE.Vector3()
const _b = new THREE.Vector3()
const _n = new THREE.Vector3()
const _x = new THREE.Vector3()
const _basis = new THREE.Matrix4()

/** How the guide asks about the road under an arrow. */
export interface RoadQuery {
  /** Height of the paved road surface under (x, z), searching near `nearY`; null if there's none. */
  roadHeight(x: number, nearY: number, z: number): number | null
  /** Is (x, z) asphalt or kerb (not grass, sand, gravel)? */
  paved(x: number, z: number): boolean
}

/**
 * Need for Speed-style route arrows: glowing cyan chevrons painted on the
 * asphalt on the inside of each corner ahead, pointing into the turn. A pulse
 * of light runs along them toward the corner, and the far ones fade in.
 * One InstancedMesh with a glow texture and additive blending (bloom picks it
 * up), so it's a single draw call.
 */
export class DirectionGuide {
  readonly group = new THREE.Group()
  private readonly mesh: THREE.InstancedMesh
  private readonly texture: THREE.CanvasTexture
  private readonly line: THREE.Vector3[]
  /** Signed heading change per point: + = left-hand bend (glTF +X is left). */
  private readonly bend: Float32Array
  /** Lateral offset from the centreline for each point's arrow, m. */
  private readonly offset: Float32Array
  /**
   * Arrow pose per centreline point, solved on first use: 0 = not yet,
   * 1 = placed (posePos/poseQuat valid), 2 = no room on the asphalt, skip.
   */
  private readonly poseState: Uint8Array
  private readonly posePos: Float32Array
  private readonly poseQuat: Float32Array
  private readonly road: RoadQuery
  private time = 0

  /**
   * @param edges distance from each line point to the paved edge on its left / right, m.
   * @param road  road surface queries. Each arrow is laid on the measured road plane
   *   (the Nürburgring has steep grades and camber; a flat arrow there floats at
   *   one end and sinks at the other) and kept entirely on asphalt.
   */
  constructor(line: THREE.Vector3[], edges: { left: Float32Array; right: Float32Array }, road: RoadQuery) {
    this.line = line
    this.road = road
    this.poseState = new Uint8Array(line.length)
    this.posePos = new Float32Array(line.length * 3)
    this.poseQuat = new Float32Array(line.length * 4)
    this.bend = leadIn(signedBend(line), LEAD_IN)
    this.offset = new Float32Array(line.length)
    for (let i = 0; i < line.length; i++) {
      // Inside of a left bend is the left side, and vice versa.
      const edge = this.bend[i] > 0 ? edges.left[i] : edges.right[i]
      this.offset[i] = Math.max(1.5, Math.min(edge - EDGE_INSET, MAX_OFFSET))
    }

    this.texture = chevronTexture()
    const geo = new THREE.PlaneGeometry(ARROW_WID, ARROW_LEN)
    geo.rotateX(-Math.PI / 2) // lie flat; texture "up" now points along +Z (forward)
    geo.rotateY(Math.PI)
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    })
    this.mesh = new THREE.InstancedMesh(geo, mat, COUNT)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3)
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false // instances move with the car; bounds would go stale
    this.mesh.renderOrder = 1
    this.mesh.count = 0
    this.group.add(this.mesh)
    this.group.name = 'direction-guide'
  }

  update(progress: TrackProgress, dt: number): void {
    const n = this.line.length
    if (n < 4) return
    this.time += dt
    let k = 0
    // Start on a multiple of STEP so each arrow keeps its spot as the car moves.
    const start = Math.ceil((progress.index - BEHIND) / STEP) * STEP
    for (let j = start; j <= progress.index + AHEAD && k < COUNT; j += STEP) {
      const i = ((j % n) + n) % n
      const bend = this.bend[i]
      if (Math.abs(bend) < MIN_BEND) continue
      if (this.poseState[i] === 0) this.poseState[i] = this.solvePose(i) ? 1 : 2
      if (this.poseState[i] === 2) continue
      _pos.fromArray(this.posePos, i * 3)
      _q.fromArray(this.poseQuat, i * 4)
      const fade = Math.min(1, (progress.index + AHEAD - j) / FADE)
      _m.compose(_pos, _q, _scale.set(1, 1, 1))
      this.mesh.setMatrixAt(k, _m)

      // A pulse of light runs along the arrows toward the corner.
      const pulse = 0.55 + 0.6 * Math.max(0, Math.sin(this.time * 8 - (j / STEP) * 0.7))
      _c.copy(CYAN).multiplyScalar(pulse * fade)
      this.mesh.setColorAt(k, _c)
      k++
    }
    this.mesh.count = k
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor!.needsUpdate = true
  }

  /**
   * Places point i's arrow: on the inside of the bend, turned into it, pulled
   * toward the centreline until all four corners are on asphalt, then tilted
   * to the plane through the measured road heights at its tip, tail and sides.
   */
  private solvePose(i: number): boolean {
    const n = this.line.length
    const p = this.line[i]
    const a = this.line[(i - 1 + n) % n]
    const b = this.line[(i + 1) % n]
    const left = this.bend[i] > 0
    _fwd.set(b.x - a.x, 0, b.z - a.z).normalize()
    // Toward the inside of the bend: left of travel is (fz, 0, -fx) in glTF.
    _side.set(_fwd.z, 0, -_fwd.x)
    if (!left) _side.negate()
    // Arrow axes on the ground: forward (turned into the corner) and its left.
    const yaw = Math.atan2(_fwd.x, _fwd.z) + (left ? POINT_IN : -POINT_IN)
    _af.set(Math.sin(yaw), 0, Math.cos(yaw))
    _al.set(_af.z, 0, -_af.x)
    const hl = ARROW_LEN / 2
    const hw = ARROW_WID / 2

    for (const k of PULL_IN) {
      const off = this.offset[i] * k
      const cx = p.x + _side.x * off
      const cz = p.z + _side.z * off
      // Whole footprint on the paved surface, or try closer to the centreline.
      let onRoad = true
      for (const [f, l] of CORNERS) {
        if (!this.road.paved(cx + _af.x * hl * f + _al.x * hw * l, cz + _af.z * hl * f + _al.z * hw * l)) {
          onRoad = false
          break
        }
      }
      if (!onRoad) continue
      const hF = this.road.roadHeight(cx + _af.x * hl, p.y, cz + _af.z * hl)
      const hB = this.road.roadHeight(cx - _af.x * hl, p.y, cz - _af.z * hl)
      const hL = this.road.roadHeight(cx + _al.x * hw, p.y, cz + _al.z * hw)
      const hR = this.road.roadHeight(cx - _al.x * hw, p.y, cz - _al.z * hw)
      if (hF === null || hB === null || hL === null || hR === null) continue

      // Surface frame: tangent along the arrow, bitangent across it, normal up.
      _t.set(_af.x * ARROW_LEN, hF - hB, _af.z * ARROW_LEN).normalize()
      _b.set(_al.x * ARROW_WID, hL - hR, _al.z * ARROW_WID).normalize()
      _n.crossVectors(_t, _b).normalize()
      _x.crossVectors(_n, _t).normalize() // arrow's left, re-orthogonalised
      _basis.makeBasis(_x, _n, _t)
      _q.setFromRotationMatrix(_basis)
      _pos.set(cx, (hF + hB + hL + hR) / 4, cz).addScaledVector(_n, HOVER)
      _pos.toArray(this.posePos, i * 3)
      _q.toArray(this.poseQuat, i * 4)
      return true
    }
    return false
  }

  set visible(v: boolean) {
    this.group.visible = v
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.texture.dispose()
    this.group.removeFromParent()
  }
}

/** Footprint corners as (along, across) signs. */
const CORNERS: readonly [number, number][] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

/** For each point, the sharpest bend within the next `lead` points (keeping its sign), so arrows show on the approach. */
function leadIn(bend: Float32Array, lead: number): Float32Array {
  const n = bend.length
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let best = 0
    for (let k = 0; k <= lead; k++) {
      const b = bend[(i + k) % n]
      if (Math.abs(b) > Math.abs(best)) best = b
    }
    out[i] = best
  }
  return out
}

/** Heading change over ±SPAN points (±20 m), signed: + turns left. */
function signedBend(line: THREE.Vector3[]): Float32Array {
  const n = line.length
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = line[(i - SPAN + n) % n]
    const b = line[i]
    const c = line[(i + SPAN) % n]
    const h1 = Math.atan2(b.x - a.x, b.z - a.z)
    const h2 = Math.atan2(c.x - b.x, c.z - b.z)
    let d = h2 - h1
    if (d > Math.PI) d -= 2 * Math.PI
    if (d < -Math.PI) d += 2 * Math.PI
    // Heading atan2(x, z) grows turning from +Z toward +X, i.e. to the left.
    out[i] = d
  }
  return out
}

/** A bold chevron pointing "up" the texture, white core over a soft glow, on transparent black (additive). */
function chevronTexture(): THREE.CanvasTexture {
  const w = 128
  const h = 192
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)
  const chevron = () => {
    ctx.beginPath()
    ctx.moveTo(w / 2, 22)
    ctx.lineTo(w - 16, 104)
    ctx.lineTo(w - 16, 150)
    ctx.lineTo(w / 2, 82)
    ctx.lineTo(16, 150)
    ctx.lineTo(16, 104)
    ctx.closePath()
    ctx.fill()
  }
  // Glow pass, then the solid core.
  ctx.shadowColor = '#fff'
  ctx.shadowBlur = 18
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  chevron()
  ctx.shadowBlur = 0
  ctx.fillStyle = '#fff'
  chevron()
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}
