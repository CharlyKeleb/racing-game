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
/** Arrows sit on the inside of the bend, this far in from the paved edge, but never further out than MAX_OFFSET from the centreline. */
const EDGE_INSET = 2.2
const MAX_OFFSET = 5.5
/** Arrow footprint on the road, m: long along the road so it reads at a grazing angle. */
const ARROW_LEN = 4.6
const ARROW_WID = 3.2
/** How far (rad) the arrow turns from straight ahead toward the bend: it points into the corner. */
const POINT_IN = 0.55
const HOVER = 0.1
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
const _y = new THREE.Vector3(0, 1, 0)

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
  /** Road height under each point's arrow, measured on first use (NaN until then). */
  private readonly arrowY: Float32Array
  private readonly groundAt: (x: number, nearY: number, z: number) => number | null
  private time = 0

  /**
   * @param edges distance from each line point to the paved edge on its left / right, m.
   * @param groundAt road height at an XZ point near a height; the centreline's height
   *   isn't the road's a few meters to the side (camber, kerbs), and an arrow below
   *   the surface is invisible.
   */
  constructor(
    line: THREE.Vector3[],
    edges: { left: Float32Array; right: Float32Array },
    groundAt: (x: number, nearY: number, z: number) => number | null = () => null,
  ) {
    this.line = line
    this.groundAt = groundAt
    this.arrowY = new Float32Array(line.length).fill(NaN)
    this.bend = signedBend(line)
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
      const left = bend > 0

      const a = this.line[(i - 1 + n) % n]
      const b = this.line[(i + 1) % n]
      _fwd.set(b.x - a.x, 0, b.z - a.z).normalize()
      // Toward the inside of the bend: left of travel is (fz, 0, -fx) in glTF.
      _side.set(_fwd.z, 0, -_fwd.x)
      if (!left) _side.negate()
      _pos.copy(this.line[i]).addScaledVector(_side, this.offset[i])
      if (Number.isNaN(this.arrowY[i])) this.arrowY[i] = this.groundAt(_pos.x, _pos.y, _pos.z) ?? _pos.y
      _pos.y = this.arrowY[i] + HOVER

      // Point mostly down the road, turned in toward the corner.
      const yaw = Math.atan2(_fwd.x, _fwd.z) + (left ? POINT_IN : -POINT_IN)
      _q.setFromAxisAngle(_y, yaw)
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
