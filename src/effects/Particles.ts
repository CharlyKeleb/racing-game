import * as THREE from 'three'
import { backend } from '../engine/backend'

/**
 * puff: soft smoke / dust; grain: one hard speck; spray: a cluster of tiny
 * grains scattered across the sprite — a handful of thrown sand, not a ball;
 * spark: a glowing streak stretched along its velocity, drawn additively.
 */
export type ParticleLook = 'puff' | 'grain' | 'spray' | 'spark'

export interface ParticleSpawn {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number
  startSize: number
  endSize: number
  /** Peak opacity. */
  alpha: number
  r: number
  g: number
  b: number
  /** Vertical acceleration, m/s² (+ rises like warm smoke, −9.81 falls like sand). */
  lift: number
  /** Velocity decay rate, 1/s (air drag). */
  drag: number
  /**
   * Restitution when it hits `groundY` (sparks skip off the road). Below
   * ~0.5 m/s of bounce, or without it, it settles and fades where it landed.
   */
  bounce?: number
}

/** What emitters need from a particle pool: the CPU `ParticlePool` or the GPU one (#51). */
export interface ParticleSystem {
  readonly mesh: THREE.Object3D
  readonly max: number
  spawn(p: ParticleSpawn, groundY?: number): void
  update(dt: number, windX?: number, windZ?: number): void
  /** Cap live particles (per-quality budget, effects/EffectBudget). */
  setLimit(limit: number): void
  clear(): void
  dispose(): void
}

/**
 * A pool for the active renderer: compute-shader particles under WebGPU, the
 * CPU pool under WebGL. `max` is the CPU budget; the GPU pool gets
 * `particleBudget()` times as many.
 */
export function createParticles(max: number, look: ParticleLook, renderOrder = 2, nearFade: [number, number] = [1.5, 6]): ParticleSystem {
  if (backend.nodes && backend.renderer) return new backend.nodes.GpuParticlePool(backend.renderer, Math.round(max * particleBudget()), look, renderOrder, nearFade)
  return new ParticlePool(max, look, renderOrder, nearFade)
}

/**
 * How many times the CPU particle budget the active renderer affords. GPU
 * particles cost no CPU per particle, so emitters spawn this many more
 * (thicker, longer smoke; denser sprays; thousands of sparks per hit).
 */
export function particleBudget(): number {
  return backend.kind === 'webgpu' ? 12 : 1
}

/** Spark streak length per m/s of screen-plane speed: a ~1/30 s exposure. */
const SPARK_STREAK = 0.05
/** Spark minimum width per metre of distance (~3 px at 1080p with the 60° lens). */
const SPARK_MIN_WIDTH = 0.0032
/** Spark core brightness: well over 1 so bloom picks them up. */
const SPARK_HDR = 3.5

const vertexShader = /* glsl */ `
  attribute vec3 iPos;
  attribute float iSize;
  attribute float iAlpha;
  attribute float iRot;
  attribute vec3 iColor;
  #ifdef SPARK
  attribute vec3 iVel;
  #endif
  varying vec2 vUv;
  varying float vAlpha;
  varying vec3 vColor;
  varying float vSeed;
  uniform vec2 uNearFade;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vColor = iColor;
    vSeed = iRot; // random per particle: also seeds the spray's grain pattern
    vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
    // Fade particles near the lens so driving through a cloud never fogs the screen.
    vAlpha = iAlpha * smoothstep(uNearFade.x, uNearFade.y, -mvPosition.z);
  #ifdef SPARK
    // Streak: stretch the quad along the velocity as seen on screen, head at
    // the particle, tail trailing behind (a short exposure of a hot speck).
    vec2 dir = (modelViewMatrix * vec4(iVel, 0.0)).xy;
    float speed = length(dir);
    dir = speed > 1e-4 ? dir / speed : vec2(0.0, 1.0);
    // At least ~2 px wide at any distance: a real speck is far thinner, but
    // it's a glowing point light, and a 1-px line just shimmers away.
    float width = max(iSize, -mvPosition.z * ${SPARK_MIN_WIDTH.toFixed(4)});
    float stretch = max(width * 3.0, iSize + speed * ${SPARK_STREAK.toFixed(3)});
    // Quad x → dir turned -90°, y → dir: a rotation, not a mirror, so the
    // winding stays front-facing.
    mvPosition.xy += dir * (position.y - 0.5) * stretch + vec2(dir.y, -dir.x) * position.x * width;
  #else
    float c = cos(iRot);
    float s = sin(iRot);
    // Billboard: expand the quad in view space so it always faces the camera.
    mvPosition.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iSize;
  #endif
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const fragmentShader = /* glsl */ `
  varying vec2 vUv;
  varying float vAlpha;
  varying vec3 vColor;
  varying float vSeed;
  #include <fog_pars_fragment>
  void main() {
    vec2 d = vUv - 0.5;
    float r = length(d) * 2.0;
  #ifdef SPARK
    // Hot core across the streak, brightest at the head; colour cools from
    // yellow-white at the head to orange-red down the tail and as it ages
    // (vAlpha falls with age).
    float across = 1.0 - smoothstep(0.0, 1.0, abs(d.x) * 2.0);
    float a = across * mix(0.2, 1.0, vUv.y) * vAlpha;
    vec3 col = mix(vec3(1.0, 0.2, 0.03), vec3(1.0, 0.78, 0.4), vAlpha * vUv.y) * vColor * ${SPARK_HDR.toFixed(1)};
  #elif defined(SPRAY)
    // A 9×9 grid of cells, each holding at most one round grain; fewer toward
    // the rim, so the cluster thins out instead of ending in an edge.
    vec2 g = vUv * 9.0;
    vec2 cell = floor(g);
    float h = fract(sin(dot(cell + vSeed * vec2(7.31, 3.17), vec2(12.9898, 78.233))) * 43758.5453);
    vec2 f = fract(g) - 0.5 + (vec2(fract(h * 7.0), fract(h * 13.0)) - 0.5) * 0.4;
    float grainDot = 1.0 - smoothstep(0.16, 0.34, length(f));
    float keep = step(0.45 + 0.45 * r, h);
    float a = grainDot * keep * (1.0 - smoothstep(0.75, 1.0, r)) * vAlpha;
    vec3 col = vColor * (0.7 + 0.45 * h);
  #elif defined(GRAIN)
    // Small hard-edged speck: a grain or clump of sand / gravel.
    float a = (1.0 - smoothstep(0.6, 1.0, r)) * vAlpha;
    vec3 col = vColor * (0.75 + 0.25 * (1.0 - r));
  #else
    // Soft puff with a lumpy edge so overlapping sprites don't read as discs,
    // lit from above (darker underside) so a cloud has some volume.
    // atan(0, 0) is undefined in GLSL (NaN on some GPUs), and one NaN pixel
    // blacks out the whole frame once bloom spreads it — nudge off the centre.
    float ang = atan(d.y, d.x + 1e-4);
    float lumps = (0.10 * sin(ang * 5.0) + 0.06 * sin(ang * 9.0 + 1.7)) * r;
    // smoothstep needs edge0 < edge1; reversed edges are undefined behaviour.
    float a = (1.0 - smoothstep(0.1, 1.0, r + lumps)) * vAlpha;
    vec3 col = vColor * mix(0.72, 1.04, vUv.y);
  #endif
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

/**
 * A fixed pool of camera-facing particles, one draw call. Simulated on the CPU
 * in preallocated typed arrays (no per-frame allocation); the oldest particle
 * slots are recycled when the pool is full. Live particles occupy a dense prefix.
 */
export class ParticlePool implements ParticleSystem {
  readonly mesh: THREE.Mesh
  readonly max: number
  private readonly geometry: THREE.InstancedBufferGeometry
  private readonly material: THREE.ShaderMaterial
  // Render attributes.
  private readonly pos: Float32Array
  private readonly size: Float32Array
  private readonly alpha: Float32Array
  private readonly rot: Float32Array
  private readonly color: Float32Array
  // Simulation state.
  private readonly vel: Float32Array
  private readonly age: Float32Array
  private readonly life: Float32Array
  private readonly spin: Float32Array
  private readonly startSize: Float32Array
  private readonly endSize: Float32Array
  private readonly peak: Float32Array
  private readonly lift: Float32Array
  private readonly drag: Float32Array
  private readonly groundY: Float32Array
  private readonly bounce: Float32Array
  private readonly attrs: THREE.InstancedBufferAttribute[]
  private readonly look: ParticleLook
  private colorDirty = false
  private readonly scalarState: readonly Float32Array[]
  private cursor = 0
  private live = 0
  private limit: number

  /**
   * @param nearFade distance from the lens (m) where particles start / finish
   *   fading in. Big soft clouds need a wide band so driving through them never
   *   fogs the screen; small dense spray can come right up to the camera.
   */
  constructor(max: number, look: ParticleLook, renderOrder = 2, nearFade: [number, number] = [1.5, 6]) {
    this.max = max
    this.limit = max
    this.look = look
    this.pos = new Float32Array(max * 3)
    this.size = new Float32Array(max)
    this.alpha = new Float32Array(max)
    this.rot = new Float32Array(max)
    this.color = new Float32Array(max * 3)
    this.vel = new Float32Array(max * 3)
    this.age = new Float32Array(max).fill(Infinity)
    this.life = new Float32Array(max).fill(1)
    this.spin = new Float32Array(max)
    this.startSize = new Float32Array(max)
    this.endSize = new Float32Array(max)
    this.peak = new Float32Array(max)
    this.lift = new Float32Array(max)
    this.drag = new Float32Array(max)
    this.groundY = new Float32Array(max)
    this.bounce = new Float32Array(max)
    this.scalarState = [this.size, this.alpha, this.rot, this.age, this.life,
      this.spin, this.startSize, this.endSize, this.peak, this.lift, this.drag, this.groundY, this.bounce]

    const plane = new THREE.PlaneGeometry(1, 1)
    const geo = new THREE.InstancedBufferGeometry()
    geo.index = plane.index
    geo.setAttribute('position', plane.getAttribute('position'))
    geo.setAttribute('uv', plane.getAttribute('uv'))
    const attr = (name: string, array: Float32Array, itemSize: number) => {
      const a = new THREE.InstancedBufferAttribute(array, itemSize).setUsage(THREE.DynamicDrawUsage)
      geo.setAttribute(name, a)
      return a
    }
    this.attrs = [
      attr('iPos', this.pos, 3),
      attr('iSize', this.size, 1),
      attr('iAlpha', this.alpha, 1),
      attr('iRot', this.rot, 1),
      attr('iColor', this.color, 3),
      // Sparks draw along their velocity: the simulation array doubles as a render attribute.
      ...(look === 'spark' ? [attr('iVel', this.vel, 3)] : []),
    ]
    geo.instanceCount = 0
    this.geometry = geo

    this.material = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uNearFade: { value: new THREE.Vector2(...nearFade) } },
      vertexShader,
      fragmentShader,
      defines: look === 'grain' ? { GRAIN: '' } : look === 'spray' ? { SPRAY: '' } : look === 'spark' ? { SPARK: '' } : {},
      transparent: true,
      blending: look === 'spark' ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false,
      fog: true,
    })
    this.mesh = new THREE.Mesh(geo, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = renderOrder
    this.mesh.visible = false
  }

  /** `groundY`: grains stop and settle when they fall back to this height. */
  spawn(p: ParticleSpawn, groundY = -Infinity): void {
    if (this.limit === 0) return
    const i = this.live < this.limit ? this.live++ : this.cursor
    this.cursor = (i + 1) % this.limit
    this.colorDirty = true
    const j = i * 3
    this.pos[j] = p.x
    this.pos[j + 1] = p.y
    this.pos[j + 2] = p.z
    this.vel[j] = p.vx
    this.vel[j + 1] = p.vy
    this.vel[j + 2] = p.vz
    this.color[j] = p.r
    this.color[j + 1] = p.g
    this.color[j + 2] = p.b
    this.size[i] = p.startSize
    this.alpha[i] = 0
    this.age[i] = 0
    this.life[i] = p.life
    this.startSize[i] = p.startSize
    this.endSize[i] = p.endSize
    this.peak[i] = p.alpha
    this.lift[i] = p.lift
    this.drag[i] = p.drag
    this.groundY[i] = groundY
    this.bounce[i] = p.bounce ?? 0
    this.rot[i] = Math.random() * Math.PI * 2
    this.spin[i] = this.look === 'grain' ? 0 : (Math.random() - 0.5) * 0.8
  }

  /** `wind`: world-space air drift, m/s; puffs ease toward it. */
  update(dt: number, windX = 0, windZ = 0): void {
    if (this.live === 0) return
    const grain = this.look === 'grain'
    const spark = this.look === 'spark'
    let i = 0
    while (i < this.live) {
      const age = (this.age[i] += dt)
      if (age >= this.life[i]) {
        this.remove(i)
        continue
      }
      const t = Math.min(1, age / this.life[i])
      const j = i * 3
      const k = Math.exp(-this.drag[i] * dt)
      this.vel[j] = windX + (this.vel[j] - windX) * k
      this.vel[j + 1] = this.vel[j + 1] * k + this.lift[i] * dt
      this.vel[j + 2] = windZ + (this.vel[j + 2] - windZ) * k
      this.pos[j] += this.vel[j] * dt
      this.pos[j + 1] += this.vel[j + 1] * dt
      this.pos[j + 2] += this.vel[j + 2] * dt
      if (this.pos[j + 1] < this.groundY[i] && this.vel[j + 1] < -0.5 / Math.max(this.bounce[i], 0.01)) {
        // Skipped off the ground: lose most of the bounce and some speed.
        this.pos[j + 1] = this.groundY[i]
        this.vel[j + 1] *= -this.bounce[i]
        this.vel[j] *= 0.7
        this.vel[j + 2] *= 0.7
      } else if (this.pos[j + 1] < this.groundY[i]) {
        // Landed: stop dead and fade out where it fell.
        this.pos[j + 1] = this.groundY[i]
        this.vel[j] = this.vel[j + 1] = this.vel[j + 2] = 0
        this.lift[i] = 0
        if (this.life[i] - age > 0.25) this.life[i] = age + 0.25
      }
      const grow = 1 - (1 - t) * (1 - t)
      this.size[i] = this.startSize[i] + (this.endSize[i] - this.startSize[i]) * grow
      // Puffs bloom in quickly then thin out slowly; grains are solid until they fade.
      // Sparks cool steadily from the moment they're struck (the shader shifts their colour with it).
      this.alpha[i] = spark ? this.peak[i] * Math.pow(1 - t, 1.3)
        : grain ? this.peak[i] * Math.min(1, (1 - t) * 4) : this.peak[i] * Math.min(1, t * 10) * Math.pow(1 - t, 1.5)
      this.rot[i] += this.spin[i] * dt
      i++
    }
    this.geometry.instanceCount = this.live
    this.mesh.visible = this.live > 0
    if (this.live === 0) return
    for (let index = 0; index < this.attrs.length; index++) {
      // Colour is constant over a particle's life; only spawn/compaction changes it.
      if (index === 4 && !this.colorDirty) continue
      const attr = this.attrs[index]
      attr.clearUpdateRanges()
      attr.addUpdateRange(0, this.live * attr.itemSize)
      attr.needsUpdate = true
    }
    this.colorDirty = false
  }

  /** Swap removal keeps simulation and GPU instance ranges free of dead slots. */
  private remove(index: number): void {
    const last = --this.live
    if (index === last) return
    for (const state of this.scalarState) state[index] = state[last]
    const target = index * 3
    const source = last * 3
    for (let axis = 0; axis < 3; axis++) {
      this.pos[target + axis] = this.pos[source + axis]
      this.vel[target + axis] = this.vel[source + axis]
      this.color[target + axis] = this.color[source + axis]
    }
    this.colorDirty = true
  }

  setLimit(limit: number): void {
    this.limit = Math.max(0, Math.min(this.max, Math.floor(limit)))
    this.live = Math.min(this.live, this.limit)
    this.cursor = this.limit > 0 ? this.cursor % this.limit : 0
    this.geometry.instanceCount = this.live
    this.mesh.visible = this.live > 0
  }

  clear(): void {
    this.live = 0
    this.cursor = 0
    this.colorDirty = false
    this.geometry.instanceCount = 0
    this.mesh.visible = false
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}
