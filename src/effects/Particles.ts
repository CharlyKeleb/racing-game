import * as THREE from 'three'

export type ParticleLook = 'puff' | 'grain'

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
}

const vertexShader = /* glsl */ `
  attribute vec3 iPos;
  attribute float iSize;
  attribute float iAlpha;
  attribute float iRot;
  attribute vec3 iColor;
  varying vec2 vUv;
  varying float vAlpha;
  varying vec3 vColor;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vColor = iColor;
    vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
    // Fade particles near the lens so driving through a cloud never fogs the screen.
    vAlpha = iAlpha * smoothstep(1.5, 6.0, -mvPosition.z);
    float c = cos(iRot);
    float s = sin(iRot);
    // Billboard: expand the quad in view space so it always faces the camera.
    mvPosition.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iSize;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const fragmentShader = /* glsl */ `
  varying vec2 vUv;
  varying float vAlpha;
  varying vec3 vColor;
  #include <fog_pars_fragment>
  void main() {
    vec2 d = vUv - 0.5;
    float r = length(d) * 2.0;
  #ifdef GRAIN
    // Small hard-edged speck: a grain or clump of sand / gravel.
    float a = smoothstep(1.0, 0.6, r) * vAlpha;
    vec3 col = vColor * (0.75 + 0.25 * (1.0 - r));
  #else
    // Soft puff with a lumpy edge so overlapping sprites don't read as discs,
    // lit from above (darker underside) so a cloud has some volume.
    float ang = atan(d.y, d.x);
    float lumps = (0.10 * sin(ang * 5.0) + 0.06 * sin(ang * 9.0 + 1.7)) * r;
    float a = smoothstep(1.0, 0.1, r + lumps) * vAlpha;
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
 * is recycled when the pool is full.
 */
export class ParticlePool {
  readonly mesh: THREE.Mesh
  private readonly max: number
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
  private readonly attrs: THREE.InstancedBufferAttribute[]
  private readonly look: ParticleLook
  private cursor = 0
  private live = 0

  constructor(max: number, look: ParticleLook, renderOrder = 2) {
    this.max = max
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
    ]
    geo.instanceCount = max
    this.geometry = geo

    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      vertexShader,
      fragmentShader,
      defines: look === 'grain' ? { GRAIN: '' } : {},
      transparent: true,
      depthWrite: false,
      fog: true,
    })
    this.mesh = new THREE.Mesh(geo, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = renderOrder
  }

  /** `groundY`: grains stop and settle when they fall back to this height. */
  spawn(p: ParticleSpawn, groundY = -Infinity): void {
    const i = this.cursor
    this.cursor = (this.cursor + 1) % this.max
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
    if (this.age[i] >= this.life[i]) this.live++
    this.age[i] = 0
    this.life[i] = p.life
    this.startSize[i] = p.startSize
    this.endSize[i] = p.endSize
    this.peak[i] = p.alpha
    this.lift[i] = p.lift
    this.drag[i] = p.drag
    this.groundY[i] = groundY
    this.rot[i] = Math.random() * Math.PI * 2
    this.spin[i] = this.look === 'grain' ? 0 : (Math.random() - 0.5) * 0.8
  }

  /** `wind`: world-space air drift, m/s; puffs ease toward it. */
  update(dt: number, windX = 0, windZ = 0): void {
    if (this.live === 0) return
    let live = 0
    const grain = this.look === 'grain'
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= this.life[i]) {
        this.alpha[i] = 0
        this.size[i] = 0
        continue
      }
      live++
      const age = (this.age[i] += dt)
      const t = Math.min(1, age / this.life[i])
      const j = i * 3
      const k = Math.exp(-this.drag[i] * dt)
      this.vel[j] = windX + (this.vel[j] - windX) * k
      this.vel[j + 1] = this.vel[j + 1] * k + this.lift[i] * dt
      this.vel[j + 2] = windZ + (this.vel[j + 2] - windZ) * k
      this.pos[j] += this.vel[j] * dt
      this.pos[j + 1] += this.vel[j + 1] * dt
      this.pos[j + 2] += this.vel[j + 2] * dt
      if (this.pos[j + 1] < this.groundY[i]) {
        // Landed: stop dead and fade out where it fell.
        this.pos[j + 1] = this.groundY[i]
        this.vel[j] = this.vel[j + 1] = this.vel[j + 2] = 0
        this.lift[i] = 0
        if (this.life[i] - age > 0.25) this.life[i] = age + 0.25
      }
      const grow = 1 - (1 - t) * (1 - t)
      this.size[i] = this.startSize[i] + (this.endSize[i] - this.startSize[i]) * grow
      // Puffs bloom in quickly then thin out slowly; grains are solid until they fade.
      this.alpha[i] = grain ? this.peak[i] * Math.min(1, (1 - t) * 4) : this.peak[i] * Math.min(1, t * 10) * Math.pow(1 - t, 1.5)
      this.rot[i] += this.spin[i] * dt
    }
    this.live = live
    for (const a of this.attrs) a.needsUpdate = true
  }

  clear(): void {
    this.age.fill(Infinity)
    this.alpha.fill(0)
    this.size.fill(0)
    this.live = 0
    for (const a of this.attrs) a.needsUpdate = true
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}
