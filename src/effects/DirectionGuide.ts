import * as THREE from 'three'
import type { TrackProgress } from '../racing/TrackProgress'

/** Most boards shown at once. */
const COUNT = 28
/** A board every this many centreline points (~4 m spacing → every 12 m), like real corner markers. */
const STEP = 3
/** Boards are anchored to the track; they appear this many points ahead (~280 m)… */
const AHEAD = 70
/** …and linger this many behind, so they leave the frame instead of vanishing in it. */
const BEHIND = 4
/** Heading change (rad) over ±SPAN points that makes a corner worth signing. */
const MIN_BEND = 0.28
const SPAN = 5
/** Clearance from the paved edge to the board, and the furthest it stands from the centreline, m. */
const EDGE_GAP = 1.6
const MAX_OFFSET = 15
/** Board size and the height of its centre above the road, m. */
const BOARD_W = 1.5
const BOARD_H = 1.0
const BOARD_Y = 1.25
/** Boards turn this far (rad) from square-on toward the road, so they read from the approach. */
const TOE_IN = 0.3
/** Far boards grow in over this many points instead of popping. */
const FADE = 12
const AMBER = new THREE.Color(1, 0.72, 0.1)
const TIGHT = new THREE.Color(1, 0.28, 0.05)

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _fwd = new THREE.Vector3()
const _out = new THREE.Vector3()
const _pos = new THREE.Vector3()
const _scale = new THREE.Vector3()
const _c = new THREE.Color()
const _y = new THREE.Vector3(0, 1, 0)

/**
 * Corner warning boards at the roadside, like the chevron signs on a real
 * circuit: they stand just off the outside edge of each corner ahead, face
 * the approaching car and point the way it bends. Tighter corners glow
 * redder, and a light runs along each run of boards in the turn direction.
 * Two InstancedMeshes (boards + posts), two draw calls.
 */
export class DirectionGuide {
  readonly group = new THREE.Group()
  private readonly boards: THREE.InstancedMesh
  private readonly posts: THREE.InstancedMesh
  private readonly texture: THREE.CanvasTexture
  private readonly line: THREE.Vector3[]
  /** Signed heading change per point: + = left-hand bend (glTF +X is left). */
  private readonly bend: Float32Array
  /** Board position (XZ offset from the line point) for each point; 0 where no board. */
  private readonly offset: Float32Array
  private time = 0

  /**
   * @param edges distance from each line point to the paved edge on its left / right, m.
   */
  constructor(line: THREE.Vector3[], edges: { left: Float32Array; right: Float32Array }) {
    this.line = line
    this.bend = signedBend(line)
    this.offset = new Float32Array(line.length)
    for (let i = 0; i < line.length; i++) {
      // Outside of a left bend is the right side, and vice versa.
      const edge = this.bend[i] > 0 ? edges.right[i] : edges.left[i]
      this.offset[i] = Math.min(edge + EDGE_GAP, MAX_OFFSET)
    }

    this.texture = chevronTexture()
    const boardGeo = new THREE.PlaneGeometry(BOARD_W, BOARD_H)
    const boardMat = new THREE.MeshBasicMaterial({ map: this.texture, side: THREE.DoubleSide, toneMapped: false })
    this.boards = new THREE.InstancedMesh(boardGeo, boardMat, COUNT)
    this.boards.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3)
    // Post runs from well below the road (embankments drop away) up to the board.
    const postGeo = new THREE.BoxGeometry(0.08, 4, 0.08)
    postGeo.translate(0, BOARD_Y - 2, 0)
    const postMat = new THREE.MeshLambertMaterial({ color: 0x9a9da3 })
    this.posts = new THREE.InstancedMesh(postGeo, postMat, COUNT)
    for (const mesh of [this.boards, this.posts]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.frustumCulled = false // instances move with the car; bounds would go stale
      mesh.count = 0
      this.group.add(mesh)
    }
    this.boards.instanceColor.setUsage(THREE.DynamicDrawUsage)
    this.group.name = 'direction-guide'
  }

  update(progress: TrackProgress, dt: number): void {
    const n = this.line.length
    if (n < 4) return
    this.time += dt
    let k = 0
    const first = progress.index - BEHIND
    // Start on a multiple of STEP so each board keeps its spot as the car moves.
    const start = Math.ceil(first / STEP) * STEP
    for (let j = start; j <= progress.index + AHEAD && k < COUNT; j += STEP) {
      const i = ((j % n) + n) % n
      const bend = this.bend[i]
      if (Math.abs(bend) < MIN_BEND) continue
      const left = bend > 0

      const a = this.line[(i - 1 + n) % n]
      const b = this.line[(i + 1) % n]
      _fwd.set(b.x - a.x, 0, b.z - a.z).normalize()
      // Outward: right of travel for a left bend (right = fwd × up), left for a right bend.
      _out.crossVectors(_fwd, _y)
      if (!left) _out.negate()
      _pos.copy(this.line[i]).addScaledVector(_out, this.offset[i])

      // Face back down the road (plane +Z toward the driver), toed in toward the track.
      const yaw = Math.atan2(-_fwd.x, -_fwd.z) + (left ? -TOE_IN : TOE_IN)
      _q.setFromAxisAngle(_y, yaw)
      const grow = Math.min(1, (progress.index + AHEAD - j) / FADE)
      // Mirror the right-pointing chevron for left bends.
      _scale.set(left ? -grow : grow, grow, grow)
      _m.compose(_pos, _q, _scale)
      this.posts.setMatrixAt(k, _m)
      _m.compose(_pos.setY(_pos.y + BOARD_Y * grow), _q, _scale)
      this.boards.setMatrixAt(k, _m)

      // A light runs along the boards toward the corner, like sequential LED chevrons.
      const tight = Math.min(1, (Math.abs(bend) - MIN_BEND) / 0.9)
      const chase = 0.75 + 0.45 * Math.max(0, Math.sin(this.time * 7 - (j / STEP) * 0.9))
      _c.copy(AMBER).lerp(TIGHT, tight).multiplyScalar(chase)
      this.boards.setColorAt(k, _c)
      k++
    }
    this.boards.count = this.posts.count = k
    this.boards.instanceMatrix.needsUpdate = true
    this.posts.instanceMatrix.needsUpdate = true
    this.boards.instanceColor!.needsUpdate = true
  }

  set visible(v: boolean) {
    this.group.visible = v
  }

  dispose(): void {
    for (const mesh of [this.boards, this.posts]) {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
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

/** Black board, white rim, bold chevron pointing right. Tinted per instance. */
function chevronTexture(): THREE.CanvasTexture {
  const w = 192
  const h = 128
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#0d0e10'
  ctx.fillRect(7, 7, w - 14, h - 14)
  // Chevron: white so instance colour tints it amber/red; the board stays black.
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.moveTo(52, 18)
  ctx.lineTo(96, 18)
  ctx.lineTo(146, h / 2)
  ctx.lineTo(96, h - 18)
  ctx.lineTo(52, h - 18)
  ctx.lineTo(102, h / 2)
  ctx.closePath()
  ctx.fill()
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}
