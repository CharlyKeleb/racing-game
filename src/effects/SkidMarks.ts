import * as THREE from 'three'
import { surfaceProps } from '../vehicles/Surface'
import type { WheelState } from '../vehicles/VehicleController'

const MAX_SEGMENTS = 2400
/**
 * Sliding speed of the contact patch (m/s, WheelState.slide) where marks start
 * and where they're darkest. A tire cornering hard but within its grip doesn't
 * slide, so it leaves nothing: marks mean a real slide, lock-up or wheelspin.
 */
const MIN_SLIDE = 1.2
const FULL_SLIDE = 8
const MAX_OPACITY = 0.55
/** Seconds a mark stays before it finishes fading out. */
const LIFETIME = 24
/** Shortest segment written, meters. Shorter steps wait for the wheel to move on. */
const MIN_SEGMENT = 0.25
/** A longer step means a respawn or teleport, so the trail restarts. */
const MAX_SEGMENT = 4
/** Above the contact point, clear of the road ribbon (y 0.01) and kerbs (0.015). */
const LIFT = 0.025
const NEVER = -1e9
/** Ruts in loose ground: darker and longer-lived than rubber, scaled by how loose it is. */
const RUT_OPACITY = 0.6
const RUT_LIFETIME = 45

interface Trail {
  active: boolean
  hasEdges: boolean
  center: THREE.Vector3
  left: THREE.Vector3
  right: THREE.Vector3
  alpha: number
}

const _p = new THREE.Vector3()
const _side = new THREE.Vector3()
const _l = new THREE.Vector3()
const _r = new THREE.Vector3()

const vertexShader = /* glsl */ `
  attribute float aAlpha;
  attribute float aBirth;
  uniform float uTime;
  uniform float uLife;
  varying float vAlpha;
  #include <fog_pars_vertex>
  void main() {
    float age = uTime - aBirth;
    vAlpha = aAlpha * (1.0 - smoothstep(uLife * 0.4, uLife, age));
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  #include <fog_pars_fragment>
  void main() {
    if (vAlpha < 0.004) discard;
    gl_FragColor = vec4(uColor, vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

/**
 * Rubber left on the road by sliding tires — or, in `ruts` mode, the dark
 * compacted tracks a tyre ploughs through sand, gravel and grass. One
 * ring-buffered mesh holds every mark: each segment is a quad joined to the
 * previous one, so a slide draws a continuous strip. Each vertex stores its
 * birth time; the shader fades it out, so aging costs nothing on the CPU. Only
 * freshly written quads are uploaded.
 */
export class SkidMarks {
  readonly mesh: THREE.Mesh
  private readonly positions: Float32Array
  private readonly alphas: Float32Array
  private readonly births: Float32Array
  private readonly posAttr: THREE.BufferAttribute
  private readonly alphaAttr: THREE.BufferAttribute
  private readonly birthAttr: THREE.BufferAttribute
  private readonly material: THREE.ShaderMaterial
  private readonly trails: Trail[] = []
  private head = 0
  private time = 0
  private readonly ruts: boolean

  /** @param ruts mark loose ground wherever a tyre rolls through it, instead of rubber on tarmac. */
  constructor({ ruts = false }: { ruts?: boolean } = {}) {
    this.ruts = ruts
    const verts = MAX_SEGMENTS * 4
    this.positions = new Float32Array(verts * 3)
    this.alphas = new Float32Array(verts)
    this.births = new Float32Array(verts).fill(NEVER)

    const index = new Uint32Array(MAX_SEGMENTS * 6)
    for (let s = 0; s < MAX_SEGMENTS; s++) {
      const v = s * 4
      index.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], s * 6)
    }

    const geo = new THREE.BufferGeometry()
    this.posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage)
    this.alphaAttr = new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage)
    this.birthAttr = new THREE.BufferAttribute(this.births, 1).setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('position', this.posAttr)
    geo.setAttribute('aAlpha', this.alphaAttr)
    geo.setAttribute('aBirth', this.birthAttr)
    geo.setIndex(new THREE.BufferAttribute(index, 1))

    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        // Ruts: damp, compacted sand under the dry surface — dark brown, not black.
        { uTime: { value: 0 }, uLife: { value: ruts ? RUT_LIFETIME : LIFETIME }, uColor: { value: new THREE.Color(ruts ? 0x2e2216 : 0x0b0b0c) } },
      ]),
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
    this.mesh = new THREE.Mesh(geo, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
  }

  update(wheels: readonly WheelState[], dt: number): void {
    this.time += dt
    this.material.uniforms.uTime.value = this.time

    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i]
      const trail = (this.trails[i] ??= {
        active: false,
        hasEdges: false,
        center: new THREE.Vector3(),
        left: new THREE.Vector3(),
        right: new THREE.Vector3(),
        alpha: 0,
      })
      // Rubber only marks tarmac when sliding; ruts mark loose ground whenever a tyre rolls through.
      const loose = w.grounded ? surfaceProps(w.surface).loose : 0
      const marks = this.ruts ? loose > 0 : w.grounded && w.slide >= MIN_SLIDE && loose === 0
      if (!marks) {
        trail.active = false
        continue
      }
      _p.copy(w.contactPoint)
      _p.y += LIFT
      if (!trail.active) {
        trail.active = true
        trail.hasEdges = false
        trail.center.copy(_p)
        continue
      }

      const dx = _p.x - trail.center.x
      const dz = _p.z - trail.center.z
      const len = Math.hypot(dx, dz)
      if (len < MIN_SEGMENT) continue
      if (len > MAX_SEGMENT) {
        trail.hasEdges = false
        trail.center.copy(_p)
        continue
      }

      const alpha = this.ruts
        ? RUT_OPACITY * loose * Math.min(1, 0.6 + w.slide / FULL_SLIDE)
        : MAX_OPACITY * Math.min(1, 0.2 + (0.8 * (w.slide - MIN_SLIDE)) / (FULL_SLIDE - MIN_SLIDE))
      const half = w.cfg.width * (this.ruts ? 0.5 : 0.45)
      _side.set(-dz / len, 0, dx / len).multiplyScalar(half)
      if (!trail.hasEdges) {
        trail.left.copy(trail.center).add(_side)
        trail.right.copy(trail.center).sub(_side)
        trail.alpha = alpha
        trail.hasEdges = true
      }
      _l.copy(_p).add(_side)
      _r.copy(_p).sub(_side)
      this.writeSegment(trail.left, trail.right, _l, _r, trail.alpha, alpha)
      trail.left.copy(_l)
      trail.right.copy(_r)
      trail.center.copy(_p)
      trail.alpha = alpha
    }
  }

  private writeSegment(l0: THREE.Vector3, r0: THREE.Vector3, l1: THREE.Vector3, r1: THREE.Vector3, a0: number, a1: number): void {
    const s = this.head
    this.head = (this.head + 1) % MAX_SEGMENTS
    const v = s * 4
    const p = this.positions
    l0.toArray(p, v * 3)
    r0.toArray(p, v * 3 + 3)
    l1.toArray(p, v * 3 + 6)
    r1.toArray(p, v * 3 + 9)
    this.alphas[v] = this.alphas[v + 1] = a0
    this.alphas[v + 2] = this.alphas[v + 3] = a1
    this.births.fill(this.time, v, v + 4)

    this.posAttr.addUpdateRange(v * 3, 12)
    this.alphaAttr.addUpdateRange(v, 4)
    this.birthAttr.addUpdateRange(v, 4)
    this.posAttr.needsUpdate = this.alphaAttr.needsUpdate = this.birthAttr.needsUpdate = true
  }

  /** Wipes every mark (new race). */
  clear(): void {
    this.births.fill(NEVER)
    this.birthAttr.clearUpdateRanges()
    this.birthAttr.needsUpdate = true
    for (const t of this.trails) t.active = false
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
