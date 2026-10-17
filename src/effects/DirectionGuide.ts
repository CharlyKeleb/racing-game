import * as THREE from 'three'
import type { TrackProgress } from '../racing/TrackProgress'

const COUNT = 18
/** Centreline points between chevrons (line spacing is ~4 m → a chevron every ~8 m). */
const STEP = 2
/** First chevron this many points ahead of the car, so it isn't drawn under the bonnet. */
const LEAD = 2
const HOVER = 0.06
/** Chevrons at the far end shrink away over this many slots. */
const TAIL = 5
const AMBER = new THREE.Color(1, 0.62, 0.05)
const CORNER = new THREE.Color(1, 0.3, 0.02)

const _m = new THREE.Matrix4()
const _fwd = new THREE.Vector3()
const _up = new THREE.Vector3()
const _right = new THREE.Vector3()
const _pos = new THREE.Vector3()
const _c = new THREE.Color()
const _scale = new THREE.Vector3()

/**
 * Amber chevrons painted along the centreline ahead of the car, pointing the
 * way. One InstancedMesh (a single draw call). A brightness wave runs forward
 * along them, they deepen toward orange where the track bends so corners read
 * early, and the far end shrinks away instead of popping.
 */
export class DirectionGuide {
  readonly group = new THREE.Group()
  private readonly mesh: THREE.InstancedMesh
  private readonly line: THREE.Vector3[]
  private readonly bend: Float32Array
  private time = 0

  constructor(line: THREE.Vector3[]) {
    this.line = line
    this.bend = curvature(line)

    // A flat "^" chevron pointing +Z, 5 m wide × 5 m long with thick arms.
    // From the chase cam a ground decal is seen at a grazing angle and shrinks
    // to a sliver, so it has to be long to read.
    const shape = new THREE.Shape()
    shape.moveTo(0, 2.6)
    shape.lineTo(2.5, -2.4)
    shape.lineTo(1.25, -2.4)
    shape.lineTo(0, 0.2)
    shape.lineTo(-1.25, -2.4)
    shape.lineTo(-2.5, -2.4)
    shape.closePath()
    const geo = new THREE.ShapeGeometry(shape)
    geo.rotateX(-Math.PI / 2) // shape +Y → world −Z…
    geo.rotateY(Math.PI) // …turned to point +Z (direction of travel)

    // Solid (not additive): additive amber washes out to pale yellow on sunlit asphalt.
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
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
    this.group.add(this.mesh)
    this.group.name = 'direction-guide'
  }

  update(progress: TrackProgress, dt: number): void {
    const n = this.line.length
    if (n < 4) return
    this.time += dt
    for (let k = 0; k < COUNT; k++) {
      const i = (progress.index + LEAD + k * STEP) % n
      const a = this.line[(i - 1 + n) % n]
      const b = this.line[(i + 1) % n]
      _fwd.subVectors(b, a).normalize()
      _right.crossVectors(_fwd, _up.set(0, 1, 0)).normalize()
      _up.crossVectors(_right, _fwd)
      // makeBasis(x, y, z): x = left (glTF +X is left), y = up, z = forward
      _m.makeBasis(_right.negate(), _up, _fwd)
      // Shrink the last few so the far end tapers off.
      const size = k >= COUNT - TAIL ? (COUNT - k) / (TAIL + 1) : 1
      _m.scale(_scale.setScalar(size))
      _pos.copy(this.line[i]).addScaledVector(_up, HOVER)
      _m.setPosition(_pos)
      this.mesh.setMatrixAt(k, _m)

      // A brightness pulse travels forward; corners shift toward orange.
      const pulse = 0.8 + 0.35 * Math.max(0, Math.sin(this.time * 6 - k * 0.55))
      _c.copy(AMBER).lerp(CORNER, this.bend[i]).multiplyScalar(pulse)
      this.mesh.setColorAt(k, _c)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor!.needsUpdate = true
  }

  set visible(v: boolean) {
    this.group.visible = v
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.group.removeFromParent()
  }
}

/** 0 on straights → 1 in hairpins: heading change over ±20 m. */
function curvature(line: THREE.Vector3[]): Float32Array {
  const n = line.length
  const out = new Float32Array(n)
  const span = 5
  for (let i = 0; i < n; i++) {
    const a = line[(i - span + n) % n]
    const b = line[i]
    const c = line[(i + span) % n]
    const h1 = Math.atan2(b.x - a.x, b.z - a.z)
    const h2 = Math.atan2(c.x - b.x, c.z - b.z)
    let d = Math.abs(h2 - h1)
    if (d > Math.PI) d = 2 * Math.PI - d
    out[i] = Math.min(1, d / 1.2)
  }
  return out
}
