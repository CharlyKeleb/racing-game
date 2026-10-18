import * as THREE from 'three'
import type { TrackProgress } from '../racing/TrackProgress'
import { planCornerSigns, roadCentreShift, signedBend, type CornerSign } from './routePlan'

/** Most arrows shown at once. */
const COUNT = 24
/** An arrow every this many centreline points (~4 m spacing → every 8 m). */
const STEP = 2
/** Arrows are anchored to the track; they appear this far ahead (~200 m)… */
const AHEAD = 50
/** …and stay this many points behind, so they slide out under the car instead of vanishing. */
const BEHIND = 3
/** Heading change (rad) over ±SPAN points that makes a corner worth marking. */
const MIN_BEND = 0.22
const SPAN = 5
/** Arrows start this many points (~32 m) before a corner, on the approach, like NFS. */
const LEAD_IN = 8
/** Furthest an arrow slides off the traced centreline to reach the middle of the road, m. */
const MAX_SHIFT = 4
/** Arrow footprint on the road, m: long along the road so it reads at a grazing angle. */
const ARROW_LEN = 6.5
const ARROW_WID = 4.2
/** How far (rad) the arrow turns from straight ahead toward the bend: it points into the corner. */
const POINT_IN = 0.32
/**
 * Above the measured road plane. The far road is the coarse LOD1 mesh (up
 * to ~0.25 m off the collision surface the heights come from); at 4 cm the
 * arrows sank into it and blinked in and out.
 */
const HOVER = 0.15
/** Arrow widths tried, as fractions of ARROW_WID, until the whole arrow is on asphalt. The last is used regardless. */
const NARROW = [1, 0.75, 0.55]
/** Far arrows fade in over this many points instead of popping. */
const FADE = 10
/** Amber, as in the HUD: reads on light and dark asphalt with the dark outline baked in. */
const AMBER = new THREE.Color(1, 0.72, 0.12)

/** Corner boards: size, height of the bottom edge above the ground, and how far they turn toward the road. */
const SIGN_W = 1.5
const SIGN_H = 0.95
const SIGN_LIFT = 0.55
const SIGN_TOE = 0.35
/**
 * Ground more than this above the road at a board's spot is a wall or a
 * building: step the board in. Below it (a grass bank, an armco top) the
 * board just stands on it, as boards do on real circuits.
 */
const SIGN_MAX_RISE = 1.2

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _fwd = new THREE.Vector3()
const _left = new THREE.Vector3()
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
const _noTurn = new THREE.Quaternion()

/** How the guide asks about the road under an arrow. */
export interface RoadQuery {
  /** Height of the paved road surface under (x, z), searching near `nearY`; null if there's none. */
  roadHeight(x: number, nearY: number, z: number): number | null
  /** Height of any static ground (road, verge, kerb, wall top) under (x, z), searching near `nearY`; null if there's none. */
  groundHeight(x: number, nearY: number, z: number): number | null
  /** Is (x, z) asphalt or kerb (not grass, sand, gravel)? */
  paved(x: number, z: number): boolean
}

/**
 * Need for Speed-style route markers.
 *
 * Arrows: amber chevrons painted down the middle of the road through each
 * corner ahead, turned into the bend, with a pulse of light running toward
 * the corner and the far ones fading in. One InstancedMesh, one draw call.
 *
 * Corner boards: black boards with amber chevrons on posts, on the outside
 * of every real corner, facing the cars and pointing the way. Two
 * InstancedMeshes (boards, posts), placed once on the first update, when
 * the physics floor can be queried.
 */
export class DirectionGuide {
  readonly group = new THREE.Group()
  private readonly mesh: THREE.InstancedMesh
  private readonly fade: THREE.InstancedBufferAttribute
  private readonly texture: THREE.CanvasTexture
  private readonly line: THREE.Vector3[]
  private readonly edges: { left: Float32Array; right: Float32Array }
  /** Signed heading change per point: + = left-hand bend (glTF +X is left). */
  private readonly bend: Float32Array
  /** Sideways shift from the centreline to the middle of the road, m (+ = left). */
  private readonly shift: Float32Array
  /**
   * Arrow pose per centreline point, solved on first use: 0 = not yet,
   * 1 = placed (posePos/poseQuat/poseWidth valid).
   */
  private readonly poseState: Uint8Array
  private readonly posePos: Float32Array
  private readonly poseQuat: Float32Array
  private readonly poseWidth: Float32Array
  private readonly road: RoadQuery
  private readonly signs: CornerSign[]
  private signsPlaced = false
  private readonly signTexture: THREE.CanvasTexture
  private readonly boards: THREE.InstancedMesh
  private readonly posts: THREE.InstancedMesh
  private time = 0

  /**
   * @param edges distance from each line point to the paved edge on its left / right, m.
   * @param road  road surface queries. Each arrow is laid on the measured road plane
   *   (the Nürburgring has steep grades and camber; a flat arrow there floats at
   *   one end and sinks at the other).
   */
  constructor(line: THREE.Vector3[], edges: { left: Float32Array; right: Float32Array }, road: RoadQuery) {
    this.line = line
    this.edges = edges
    this.road = road
    this.poseState = new Uint8Array(line.length)
    this.posePos = new Float32Array(line.length * 3)
    this.poseQuat = new Float32Array(line.length * 4)
    this.poseWidth = new Float32Array(line.length)
    this.bend = leadIn(signedBend(line, SPAN), LEAD_IN)
    this.shift = roadCentreShift(edges, MAX_SHIFT, 3)

    this.texture = chevronTexture()
    const geo = new THREE.PlaneGeometry(ARROW_WID, ARROW_LEN)
    geo.rotateX(-Math.PI / 2) // lie flat; texture "up" now points along +Z (forward)
    geo.rotateY(Math.PI)
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    })
    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(COUNT), 1)
    this.fade.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('instanceFade', this.fade)
    // Per-arrow opacity for the fade-in (instanceColor only tints rgb).
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float instanceFade;\nvarying float vFade;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = instanceFade;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFade;')
        .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\ndiffuseColor.a *= vFade;')
    }
    this.mesh = new THREE.InstancedMesh(geo, mat, COUNT)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3)
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false // instances move with the car; bounds would go stale
    this.mesh.renderOrder = 1
    this.mesh.count = 0
    this.group.add(this.mesh)

    this.signs = planCornerSigns(line, edges)
    this.signTexture = signTexture()
    const boardGeo = new THREE.PlaneGeometry(SIGN_W, SIGN_H)
    const boardMat = new THREE.MeshBasicMaterial({ map: this.signTexture, side: THREE.DoubleSide })
    this.boards = new THREE.InstancedMesh(boardGeo, boardMat, Math.max(1, this.signs.length))
    this.boards.count = 0
    const postGeo = new THREE.BoxGeometry(0.09, 1, 0.09)
    postGeo.translate(0, 0.5, 0) // origin at the foot
    const postMat = new THREE.MeshLambertMaterial({ color: 0x5c6066 })
    this.posts = new THREE.InstancedMesh(postGeo, postMat, Math.max(1, this.signs.length * 2))
    this.posts.count = 0
    this.group.add(this.boards, this.posts)
    this.group.name = 'direction-guide'
  }

  update(progress: TrackProgress, dt: number): void {
    const n = this.line.length
    if (n < 4) return
    if (!this.signsPlaced) this.placeSigns()
    this.time += dt
    let k = 0
    // Start on a multiple of STEP so each arrow keeps its spot as the car moves.
    const start = Math.ceil((progress.index - BEHIND) / STEP) * STEP
    for (let j = start; j <= progress.index + AHEAD && k < COUNT; j += STEP) {
      const i = ((j % n) + n) % n
      if (Math.abs(this.bend[i]) < MIN_BEND) continue
      if (this.poseState[i] === 0) {
        this.solvePose(i)
        this.poseState[i] = 1
      }
      _pos.fromArray(this.posePos, i * 3)
      _q.fromArray(this.poseQuat, i * 4)
      const w = this.poseWidth[i]
      _m.compose(_pos, _q, _scale.set(w, 1, 1))
      this.mesh.setMatrixAt(k, _m)
      this.fade.setX(k, Math.max(0, Math.min(1, (progress.index + AHEAD - j) / FADE)))

      // A pulse of light runs along the arrows toward the corner.
      const pulse = 0.85 + 0.45 * Math.max(0, Math.sin(this.time * 8 - (j / STEP) * 0.7))
      _c.copy(AMBER).multiplyScalar(pulse)
      this.mesh.setColorAt(k, _c)
      k++
    }
    this.mesh.count = k
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor!.needsUpdate = true
    this.fade.needsUpdate = true
  }

  /**
   * Places point i's arrow in the middle of the road, turned into the bend,
   * narrowed until it fits on the asphalt (never dropped: a missing arrow
   * reads as a gap in the route), then tilted to the plane through the
   * measured road heights at its tip, tail and sides.
   */
  private solvePose(i: number): void {
    const n = this.line.length
    const p = this.line[i]
    const a = this.line[(i - 1 + n) % n]
    const b = this.line[(i + 1) % n]
    const leftTurn = this.bend[i] > 0
    _fwd.set(b.x - a.x, 0, b.z - a.z).normalize()
    // Left of travel is (fz, 0, -fx) in glTF.
    _left.set(_fwd.z, 0, -_fwd.x)
    const cx = p.x + _left.x * this.shift[i]
    const cz = p.z + _left.z * this.shift[i]
    // Arrow axes on the ground: forward (turned into the corner) and its left.
    const yaw = Math.atan2(_fwd.x, _fwd.z) + (leftTurn ? POINT_IN : -POINT_IN)
    _af.set(Math.sin(yaw), 0, Math.cos(yaw))
    _al.set(_af.z, 0, -_af.x)
    const hl = ARROW_LEN / 2

    let width = NARROW[NARROW.length - 1]
    for (const k of NARROW) {
      const hw = (ARROW_WID * k) / 2
      let onRoad = true
      for (const [f, l] of CORNERS) {
        if (!this.road.paved(cx + _af.x * hl * f + _al.x * hw * l, cz + _af.z * hl * f + _al.z * hw * l)) {
          onRoad = false
          break
        }
      }
      if (onRoad) {
        width = k
        break
      }
    }
    const hw = (ARROW_WID * width) / 2
    const centre = this.road.roadHeight(cx, p.y, cz) ?? p.y
    const hF = this.road.roadHeight(cx + _af.x * hl, centre, cz + _af.z * hl) ?? centre
    const hB = this.road.roadHeight(cx - _af.x * hl, centre, cz - _af.z * hl) ?? centre
    const hL = this.road.roadHeight(cx + _al.x * hw, centre, cz + _al.z * hw) ?? centre
    const hR = this.road.roadHeight(cx - _al.x * hw, centre, cz - _al.z * hw) ?? centre

    // Surface frame: tangent along the arrow, bitangent across it, normal up.
    _t.set(_af.x * ARROW_LEN, hF - hB, _af.z * ARROW_LEN).normalize()
    _b.set(_al.x * hw * 2, hL - hR, _al.z * hw * 2).normalize()
    _n.crossVectors(_t, _b).normalize()
    _x.crossVectors(_n, _t).normalize() // arrow's left, re-orthogonalised
    _basis.makeBasis(_x, _n, _t)
    _q.setFromRotationMatrix(_basis)
    _pos.set(cx, (hF + hB + hL + hR) / 4, cz).addScaledVector(_n, HOVER)
    _pos.toArray(this.posePos, i * 3)
    _q.toArray(this.poseQuat, i * 4)
    this.poseWidth[i] = width
  }

  /** Stands every corner board on the ground beside the road, facing the oncoming cars. */
  private placeSigns(): void {
    // Physics answers no ray queries until it has stepped; try again next frame.
    const p0 = this.line[0]
    if (this.road.groundHeight(p0.x, p0.y, p0.z) === null) return
    this.signsPlaced = true
    const n = this.line.length
    let boards = 0, posts = 0
    for (const s of this.signs) {
      const p = this.line[s.index]
      const a = this.line[(s.index - 1 + n) % n]
      const b = this.line[(s.index + 1) % n]
      _fwd.set(b.x - a.x, 0, b.z - a.z).normalize()
      _left.set(_fwd.z, 0, -_fwd.x)
      // Outside of the bend: right of travel for a left turn.
      const out = -s.turn
      const roadY = this.road.roadHeight(p.x, p.y, p.z) ?? p.y
      const edge = s.turn > 0 ? this.edges.right[s.index] : this.edges.left[s.index]
      // The planned spot first, then step in toward the road edge past walls.
      // (Where the run-off is paved the edge can be further out than the
      // planned spot; then only the planned spot is tried.)
      const innermost = Math.min(s.offset, edge + 0.2)
      let offset = s.offset, ground: number | null = null
      for (; offset >= innermost - 1e-6; offset -= 0.5) {
        ground = this.road.groundHeight(p.x + _left.x * out * offset, roadY, p.z + _left.z * out * offset)
        if (ground !== null && ground - roadY <= SIGN_MAX_RISE) break
      }
      if (ground === null || ground - roadY > SIGN_MAX_RISE) continue
      const x = p.x + _left.x * out * offset
      const z = p.z + _left.z * out * offset

      // Face the oncoming cars, toed in toward the road.
      _n.set(-_fwd.x - _left.x * out * SIGN_TOE, 0, -_fwd.z - _left.z * out * SIGN_TOE).normalize()
      _q.setFromUnitVectors(_t.set(0, 0, 1), _n)
      // The texture's chevrons point left; mirror the board for a right-hander.
      _m.compose(_pos.set(x, ground + SIGN_LIFT + SIGN_H / 2, z), _q, _scale.set(s.turn, 1, 1))
      this.boards.setMatrixAt(boards++, _m)
      // Two posts under the board's ends.
      _x.set(1, 0, 0).applyQuaternion(_q)
      for (const side of [-1, 1]) {
        _pos.set(x + _x.x * side * SIGN_W * 0.35, ground - 0.1, z + _x.z * side * SIGN_W * 0.35)
        _m.compose(_pos, _noTurn, _scale.set(1, SIGN_LIFT + SIGN_H * 0.6 + 0.1, 1))
        this.posts.setMatrixAt(posts++, _m)
      }
    }
    this.boards.count = boards
    this.posts.count = posts
    this.boards.instanceMatrix.needsUpdate = true
    this.posts.instanceMatrix.needsUpdate = true
    this.boards.computeBoundingSphere()
    this.posts.computeBoundingSphere()
  }

  /** Corner boards placed so far (for tests and the dev console). */
  get signCount(): number {
    return this.boards.count
  }

  set visible(v: boolean) {
    this.group.visible = v
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.texture.dispose()
    this.boards.geometry.dispose()
    ;(this.boards.material as THREE.Material).dispose()
    this.posts.geometry.dispose()
    ;(this.posts.material as THREE.Material).dispose()
    this.signTexture.dispose()
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

/**
 * A bold chevron pointing "up" the texture: white (tinted amber per arrow)
 * inside a dark outline, on a transparent background, so it reads on pale
 * concrete in daylight as well as on dark asphalt.
 */
function chevronTexture(): THREE.CanvasTexture {
  const w = 128
  const h = 192
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, w, h)
  const chevron = () => {
    ctx.beginPath()
    ctx.moveTo(w / 2, 22)
    ctx.lineTo(w - 16, 104)
    ctx.lineTo(w - 16, 150)
    ctx.lineTo(w / 2, 82)
    ctx.lineTo(16, 150)
    ctx.lineTo(16, 104)
    ctx.closePath()
  }
  ctx.lineJoin = 'round'
  chevron()
  ctx.lineWidth = 14
  ctx.strokeStyle = 'rgba(10,10,12,0.75)'
  ctx.stroke()
  ctx.fillStyle = '#fff'
  ctx.fill()
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/** Black board, white border, three amber chevrons pointing left. */
function signTexture(): THREE.CanvasTexture {
  const w = 256
  const h = 160
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#f2f2f2'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#121214'
  ctx.fillRect(8, 8, w - 16, h - 16)
  ctx.fillStyle = '#ffb81c'
  for (let c = 0; c < 3; c++) {
    const x = 40 + c * 64
    ctx.beginPath()
    ctx.moveTo(x, h / 2)
    ctx.lineTo(x + 44, 24)
    ctx.lineTo(x + 70, 24)
    ctx.lineTo(x + 26, h / 2)
    ctx.lineTo(x + 70, h - 24)
    ctx.lineTo(x + 44, h - 24)
    ctx.closePath()
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}
