import * as THREE from 'three'
import type { WheelState } from '../vehicles/VehicleController'

const MAX_PARTICLES = 384
/** Slip (0..1) where smoke starts. Higher than skid marks: smoke means a real slide. */
const SLIP_THRESHOLD = 0.75
/** Sideways speed (m/s) for full smoke. Hard launches slip but don't slide, so stay clean. */
const FULL_SLIDE = 5
/** Puffs per second per wheel at full slip. */
const EMIT_RATE = 30
const LIFE_MIN = 1.1
const LIFE_MAX = 2.2
const PEAK_ALPHA = 0.2

const vertexShader = /* glsl */ `
  attribute vec3 iPos;
  attribute float iSize;
  attribute float iAlpha;
  attribute float iRot;
  varying vec2 vUv;
  varying float vAlpha;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
    // Fade puffs near the lens so driving through a cloud never fogs the screen.
    vAlpha = iAlpha * smoothstep(2.0, 7.0, -mvPosition.z);
    float c = cos(iRot);
    float s = sin(iRot);
    // Billboard: expand the quad in view space so it always faces the camera.
    mvPosition.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iSize;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vAlpha;
  #include <fog_pars_fragment>
  void main() {
    vec2 d = vUv - 0.5;
    float r = length(d) * 2.0;
    // Soft puff with a lumpy edge so overlapping sprites don't read as discs.
    float lumps = 0.12 * sin(atan(d.y, d.x) * 5.0) * r;
    float a = smoothstep(1.0, 0.15, r + lumps) * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * (0.85 + 0.15 * (1.0 - r)), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

/**
 * Tire smoke from a fixed particle pool, drawn as camera-facing instanced quads
 * in one draw call. Sliding wheels emit puffs that rise, spread, grow and fade.
 * Particles are simulated on the CPU into preallocated typed arrays.
 */
export class TireSmoke {
  readonly mesh: THREE.Mesh
  private readonly geometry: THREE.InstancedBufferGeometry
  private readonly material: THREE.ShaderMaterial
  // Render attributes (uploaded each frame).
  private readonly pos = new Float32Array(MAX_PARTICLES * 3)
  private readonly size = new Float32Array(MAX_PARTICLES)
  private readonly alpha = new Float32Array(MAX_PARTICLES)
  private readonly rot = new Float32Array(MAX_PARTICLES)
  // Simulation state.
  private readonly vel = new Float32Array(MAX_PARTICLES * 3)
  private readonly age = new Float32Array(MAX_PARTICLES).fill(Infinity)
  private readonly life = new Float32Array(MAX_PARTICLES).fill(1)
  private readonly spin = new Float32Array(MAX_PARTICLES)
  private readonly startSize = new Float32Array(MAX_PARTICLES)
  private readonly endSize = new Float32Array(MAX_PARTICLES)
  private readonly emitDebt: number[] = []
  private readonly attrs: THREE.InstancedBufferAttribute[]
  private cursor = 0
  private live = 0

  constructor() {
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
    this.attrs = [attr('iPos', this.pos, 3), attr('iSize', this.size, 1), attr('iAlpha', this.alpha, 1), attr('iRot', this.rot, 1)]
    geo.instanceCount = MAX_PARTICLES
    this.geometry = geo

    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(0xdedfe2) } }]),
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      fog: true,
    })
    this.mesh = new THREE.Mesh(geo, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 2
  }

  /** @param carVelocity chassis velocity, m/s; puffs inherit a little of it. */
  update(wheels: readonly WheelState[], carVelocity: THREE.Vector3Like, dt: number): void {
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i]
      const k = w.grounded ? ((w.slip - SLIP_THRESHOLD) / (1 - SLIP_THRESHOLD)) * Math.min(1, w.slide / FULL_SLIDE) : 0
      if (k <= 0) {
        this.emitDebt[i] = 0
        continue
      }
      let debt = (this.emitDebt[i] ?? 0) + EMIT_RATE * Math.min(1, k) * dt
      while (debt >= 1) {
        this.spawn(w, carVelocity, Math.min(1, k))
        debt -= 1
      }
      this.emitDebt[i] = debt
    }

    if (this.live === 0) return
    let live = 0
    const drag = Math.exp(-1.8 * dt)
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.age[i] >= this.life[i]) {
        this.alpha[i] = 0
        this.size[i] = 0
        continue
      }
      live++
      const age = (this.age[i] += dt)
      const t = Math.min(1, age / this.life[i])
      const j = i * 3
      this.vel[j] *= drag
      this.vel[j + 1] = this.vel[j + 1] * drag + 0.6 * dt // warm air rises
      this.vel[j + 2] *= drag
      this.pos[j] += this.vel[j] * dt
      this.pos[j + 1] += this.vel[j + 1] * dt
      this.pos[j + 2] += this.vel[j + 2] * dt
      const grow = 1 - (1 - t) * (1 - t)
      this.size[i] = this.startSize[i] + (this.endSize[i] - this.startSize[i]) * grow
      this.alpha[i] = PEAK_ALPHA * Math.min(1, t * 8) * Math.pow(1 - t, 1.6)
      this.rot[i] += this.spin[i] * dt
    }
    this.live = live
    for (const a of this.attrs) a.needsUpdate = true
  }

  private spawn(w: WheelState, carVel: THREE.Vector3Like, strength: number): void {
    const i = this.cursor
    this.cursor = (this.cursor + 1) % MAX_PARTICLES
    const j = i * 3
    const spread = w.cfg.width
    this.pos[j] = w.contactPoint.x + (Math.random() - 0.5) * spread
    this.pos[j + 1] = w.contactPoint.y + 0.25
    this.pos[j + 2] = w.contactPoint.z + (Math.random() - 0.5) * spread
    this.vel[j] = carVel.x * 0.25 + (Math.random() - 0.5) * 2
    this.vel[j + 1] = 0.4 + Math.random() * 0.8
    this.vel[j + 2] = carVel.z * 0.25 + (Math.random() - 0.5) * 2
    this.age[i] = 0
    this.life[i] = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN)
    this.startSize[i] = 0.5 + 0.3 * Math.random()
    this.endSize[i] = (1.8 + 1.2 * Math.random()) * (0.6 + 0.4 * strength)
    this.rot[i] = Math.random() * Math.PI * 2
    this.spin[i] = (Math.random() - 0.5) * 1.2
    this.live++
  }

  clear(): void {
    this.age.fill(Infinity)
    this.alpha.fill(0)
    this.size.fill(0)
    this.live = 0
    for (let i = 0; i < this.emitDebt.length; i++) this.emitDebt[i] = 0
    for (const a of this.attrs) a.needsUpdate = true
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}
