import type { QualityPreset } from '../stores/gameStore'
import * as THREE from 'three'
import { BRAKE, LIFT, type BrakingGuide } from '../racing/BrakingGuide'
import type { Point3 } from '../racing/TrackProgress'

/** Points drawn ahead of the car (~4 m apart): fewer on Low. */
const AHEAD = { low: 40, high: 70 }
/** Ribbon width per cue, m: the shape tells accelerate / lift / brake apart without colour. */
const WIDTH = [0.45, 0.9, 1.5]
const COLORS = [new THREE.Color(0x2dff5a), new THREE.Color(0xffd447), new THREE.Color(0xff3b2f)]
/** Above the measured road surface, m (plus a polygon offset against z-fighting). */
const HOVER = 0.05
/** Fade over the first and last few points so the ribbon never starts or ends abruptly. */
const FADE_NEAR = 3
const FADE_FAR = 12
/** "Corners only": fade in / out over this many points around a corner zone. */
const CORNER_FADE = 4
const MAX = AHEAD.high

/**
 * The braking guide drawn on the road ahead (#93): one dynamic ribbon of
 * bounded size (≤70 points, one draw call), coloured and sized by BrakingGuide's
 * cue for each point at the car's current speed. Heights come from the road
 * collider under each centreline point, sampled once and cached, so it sits on
 * banking, crests and bridges instead of floating at the centreline height.
 * Plain MeshBasicMaterial with vertex colours: no WebGPU node twin needed.
 */
export class DrivingLine {
  readonly mesh: THREE.Mesh
  private readonly geometry = new THREE.BufferGeometry()
  private readonly material: THREE.MeshBasicMaterial
  private readonly positions = new Float32Array(MAX * 2 * 3)
  private readonly colors = new Float32Array(MAX * 2 * 4)
  private readonly heights: Float32Array
  private count = AHEAD.high

  private readonly line: readonly Point3[]
  /** Road surface height under a centreline point, or null where there's none. */
  private readonly roadHeight: (x: number, y: number, z: number) => number | null

  constructor(line: readonly Point3[], roadHeight: (x: number, y: number, z: number) => number | null) {
    this.line = line
    this.roadHeight = roadHeight
    this.heights = new Float32Array(line.length).fill(NaN)
    const index: number[] = []
    for (let i = 0; i < MAX - 1; i++) {
      const a = i * 2
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
    this.geometry.setIndex(index)
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage))
    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    })
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.name = 'DrivingLine'
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 2
    this.mesh.visible = false
  }

  setQuality(quality: QualityPreset): void {
    this.count = quality === 'low' ? AHEAD.low : AHEAD.high
  }

  private height(i: number): number {
    let h = this.heights[i]
    if (Number.isNaN(h)) {
      const p = this.line[i]
      h = this.heights[i] = this.roadHeight(p.x, p.y, p.z) ?? p.y
    }
    return h
  }

  /**
   * @param from centreline index the car is at (TrackProgress.index)
   * @param speed car speed, m/s
   * @param cornersOnly draw only corners and their braking zones
   */
  update(guide: BrakingGuide, from: number, speed: number, cornersOnly: boolean): void {
    const n = this.line.length, count = this.count
    for (let k = 0; k < MAX; k++) {
      const v = k * 2
      if (k >= count) {
        this.colors[v * 4 + 3] = this.colors[v * 4 + 7] = 0
        continue
      }
      const i = (from + 1 + k) % n
      const p = this.line[i], a = this.line[(i - 1 + n) % n], b = this.line[(i + 1) % n]
      let tx = b.x - a.x, tz = b.z - a.z
      const len = Math.hypot(tx, tz) || 1
      tx /= len; tz /= len
      const cue = guide.cue(i, speed, guide.ahead(from, i))
      const half = WIDTH[cue] / 2
      const y = this.height(i) + HOVER
      // Left of travel (glTF +X left): (tz, -tx).
      const pos = this.positions, o = v * 3
      pos[o] = p.x + tz * half; pos[o + 1] = y; pos[o + 2] = p.z - tx * half
      pos[o + 3] = p.x - tz * half; pos[o + 4] = y; pos[o + 5] = p.z + tx * half
      let alpha = Math.min(1, (k + 1) / FADE_NEAR, (count - k) / FADE_FAR) * (cue === BRAKE ? 0.85 : cue === LIFT ? 0.75 : 0.55)
      if (cornersOnly) alpha *= cornerWeight(guide, i, n)
      const c = COLORS[cue], col = this.colors
      for (let o = v * 4; o <= v * 4 + 4; o += 4) {
        col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b; col[o + 3] = alpha
      }
    }
    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.color.needsUpdate = true
    this.geometry.setDrawRange(0, (count - 1) * 6)
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.geometry.dispose()
    this.material.dispose()
  }
}

/** 1 inside a corner zone, fading to 0 over CORNER_FADE points either side of it. */
function cornerWeight(guide: BrakingGuide, i: number, n: number): number {
  if (guide.isCorner(i)) return 1
  for (let d = 1; d <= CORNER_FADE; d++) {
    if (guide.isCorner((i + d) % n) || guide.isCorner((i - d + n) % n)) return 1 - d / (CORNER_FADE + 1)
  }
  return 0
}
