import * as THREE from 'three/webgpu'
import {
  Fn, If, abs, cameraPosition, clamp, exp, float, instanceIndex, instancedArray, length, max, min, mix,
  pow, select, smoothstep, sin, atan, fract, floor, step, dot, storage, uniform, uv, varying, vec2, vec3, vec4,
} from 'three/tsl'
import type { ParticleLook, ParticleSpawn, ParticleSystem } from '../../effects/Particles'

/** Spawns the CPU can queue between two updates; more are dropped (only in a frame-time spike). */
const SPAWN_MAX = 4096
/** Floats per queued spawn: five vec4s, see `spawn()`. */
const SPAWN_STRIDE = 20
/** See Particles.ts: spark streak exposure, minimum width per metre, core brightness. */
const SPARK_STREAK = 0.05
const SPARK_MIN_WIDTH = 0.0032
const SPARK_HDR = 3.5
/** Spawn batches remembered for the live-count bound: one per update, ~17 s at 60 fps. */
const HISTORY = 1024

/**
 * The GPU particle pool (#51): spawn, integrate (velocity, lift, drag, wind,
 * bounce) and fade run in TSL compute shaders over storage buffers, so a pool
 * costs no CPU per particle and can be 10x+ the size of the CPU one.
 *
 * The CPU only writes new spawns into a small staging buffer (uploaded once a
 * frame, just the part in use). A spawn kernel copies them into the ring of
 * live particles, an update kernel steps every particle, and the vertex stage
 * reads position, age and size straight from the storage buffers. Same
 * `ParticleSpawn` API and looks as the CPU `ParticlePool`, which WebGL keeps.
 */
export class GpuParticlePool implements ParticleSystem {
  readonly mesh: THREE.Mesh
  readonly max: number
  private readonly renderer: THREE.WebGPURenderer
  private readonly staging: Float32Array
  private readonly stagingAttr: THREE.StorageInstancedBufferAttribute
  private readonly spawnCompute: THREE.ComputeNode
  private readonly updateCompute: THREE.ComputeNode
  private readonly clearCompute: THREE.ComputeNode
  private readonly uSpawnCount = uniform(0, 'uint')
  private readonly uCursor = uniform(0, 'uint')
  private readonly uDt = uniform(0)
  private readonly uWind = uniform(new THREE.Vector2())
  /** Next ring slot to write; the vertex stage counts back from it (newest first). */
  private readonly uHead = uniform(0, 'uint')
  /**
   * Recent spawn batches (time, count) for a CPU-side upper
   * bound on how many particles can still be alive: only that many of the
   * newest slots are drawn, so an idle pool costs no triangles.
   */
  private readonly batches = new Float32Array(HISTORY * 2)
  private batchHead = 0
  private clock = 0
  private queued = 0
  private cursor = 0
  private clearPending = false
  /** Seconds since the last spawn: the update kernel is skipped once everything must be dead. */
  private idle = Infinity
  private maxLife = 0
  private readonly look: ParticleLook

  constructor(renderer: THREE.WebGPURenderer, capacity: number, look: ParticleLook, renderOrder = 2, nearFade: [number, number] = [1.5, 6]) {
    this.renderer = renderer
    this.max = capacity
    this.look = look
    const count = capacity

    // Live particles. w components: pos.w age, vel.w life.
    const pos = instancedArray(count, 'vec4')
    const vel = instancedArray(count, 'vec4')
    /** startSize, endSize, rotation, spin */
    const shape = instancedArray(count, 'vec4')
    /** rgb, peak alpha */
    const color = instancedArray(count, 'vec4')
    /** lift, drag, bounce, groundY */
    const phys = instancedArray(count, 'vec4')

    this.staging = new Float32Array(SPAWN_MAX * SPAWN_STRIDE)
    this.stagingAttr = new THREE.StorageInstancedBufferAttribute(this.staging, 4)
    const queue = storage(this.stagingAttr, 'vec4', SPAWN_MAX * (SPAWN_STRIDE / 4)).toReadOnly()

    this.spawnCompute = Fn(() => {
      If(instanceIndex.lessThan(this.uSpawnCount), () => {
        const slot = this.uCursor.add(instanceIndex).mod(count)
        const base = instanceIndex.mul(SPAWN_STRIDE / 4)
        pos.element(slot).assign(vec4(queue.element(base).xyz, 0))
        vel.element(slot).assign(queue.element(base.add(1)))
        shape.element(slot).assign(queue.element(base.add(2)))
        color.element(slot).assign(queue.element(base.add(3)))
        phys.element(slot).assign(queue.element(base.add(4)))
      })
    })().compute(SPAWN_MAX)

    this.clearCompute = Fn(() => {
      pos.element(instanceIndex).w.assign(1e9)
      vel.element(instanceIndex).w.assign(0)
    })().compute(count)

    const grainLook = look === 'grain'
    this.updateCompute = Fn(() => {
      const p = pos.element(instanceIndex)
      const v = vel.element(instanceIndex)
      const ph = phys.element(instanceIndex)
      If(p.w.lessThan(v.w), () => {
        const dt = this.uDt
        p.w.addAssign(dt)
        const k = exp(ph.y.negate().mul(dt))
        const wind = vec3(this.uWind.x, 0, this.uWind.y)
        const nv = wind.add(v.xyz.sub(wind).mul(k)).toVar()
        nv.y.assign(v.y.mul(k).add(ph.x.mul(dt)))
        const np = p.xyz.add(nv.mul(dt)).toVar()
        If(np.y.lessThan(ph.w), () => {
          // Skip off the ground while there's bounce left, else settle and fade where it fell.
          If(nv.y.lessThan(float(-0.5).div(max(ph.z, 0.01))), () => {
            np.y.assign(ph.w)
            nv.assign(vec3(nv.x.mul(0.7), nv.y.mul(ph.z.negate()), nv.z.mul(0.7)))
          }).Else(() => {
            np.y.assign(ph.w)
            nv.assign(vec3(0))
            ph.x.assign(0)
            v.w.assign(min(v.w, p.w.add(0.25)))
          })
        })
        p.xyz.assign(np)
        v.xyz.assign(nv)
        const sh = shape.element(instanceIndex)
        if (!grainLook) sh.z.addAssign(sh.w.mul(dt))
      })
    })().compute(count)

    // ── Render: one instanced quad per particle, billboarded in world space ──
    // Instance k draws the k-th newest slot, so drawing the first `mesh.count` covers everything alive.
    const slot = this.uHead.add(count * 2 - 1).sub(instanceIndex).mod(count)
    const P = pos.element(slot)
    const V = vel.element(slot)
    const S = shape.element(slot)
    const C = color.element(slot)
    const t = clamp(P.w.div(max(V.w, 1e-4)), 0, 1)
    const alive = step(P.w, V.w.sub(1e-4)) // 1 while age < life
    const grow = float(1).sub(pow(float(1).sub(t), 2))
    const size = mix(S.x, S.y, grow).mul(alive)
    const peak = C.w
    const fade = look === 'spark' ? peak.mul(pow(float(1).sub(t), 1.3))
      : look === 'grain' ? peak.mul(min(1, float(1).sub(t).mul(4)))
      : peak.mul(min(1, t.mul(10))).mul(pow(float(1).sub(t), 1.5))
    // Camera basis in world space (the mesh sits at the origin, so local = world).
    const basis = (column: number) => {
      const v = new THREE.Vector3()
      return uniform(v).onRenderUpdate(({ camera }) => v.setFromMatrixColumn(camera!.matrixWorld, column))
    }
    const right = basis(0), up = basis(1), back = basis(2)
    const depth = dot(P.xyz.sub(cameraPosition), back.negate())
    const corner = uv().sub(0.5)
    let offset
    if (look === 'spark') {
      // Streak along the velocity as seen on screen, head at the particle.
      const sv = vec2(dot(V.xyz, right), dot(V.xyz, up))
      const speed = length(sv)
      const dir = select(speed.greaterThan(1e-4), sv.div(max(speed, 1e-4)), vec2(0, 1))
      const width = max(size, depth.mul(SPARK_MIN_WIDTH)).mul(alive)
      const stretch = max(width.mul(3), size.add(speed.mul(SPARK_STREAK))).mul(alive)
      const o = dir.mul(corner.y.sub(0.5)).mul(stretch).add(vec2(dir.y, dir.x.negate()).mul(corner.x).mul(width))
      offset = right.mul(o.x).add(up.mul(o.y))
    } else {
      const c = S.z.cos(), s = S.z.sin()
      const o = vec2(c.mul(corner.x).sub(s.mul(corner.y)), s.mul(corner.x).add(c.mul(corner.y))).mul(size)
      offset = right.mul(o.x).add(up.mul(o.y))
    }
    const vAlpha = varying(fade.mul(smoothstep(nearFade[0], nearFade[1], depth)).mul(alive), 'vAlpha')
    const vColor = varying(C.xyz, 'vColor')
    const vSeed = varying(S.z, 'vSeed')

    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
    material.positionNode = P.xyz.add(offset)
    const d = uv().sub(0.5)
    const r = length(d).mul(2)
    let alpha, rgb
    if (look === 'spark') {
      const across = float(1).sub(smoothstep(0, 1, abs(d.x).mul(2)))
      alpha = across.mul(mix(0.2, 1, uv().y)).mul(vAlpha)
      rgb = mix(vec3(1, 0.2, 0.03), vec3(1, 0.78, 0.4), vAlpha.mul(uv().y)).mul(vColor).mul(SPARK_HDR)
      material.blending = THREE.AdditiveBlending
    } else if (look === 'spray') {
      const g = uv().mul(9)
      const cell = floor(g)
      const h = fract(sin(dot(cell.add(vSeed.mul(vec2(7.31, 3.17))), vec2(12.9898, 78.233))).mul(43758.5453))
      const f = fract(g).sub(0.5).add(vec2(fract(h.mul(7)), fract(h.mul(13))).sub(0.5).mul(0.4))
      const grainDot = float(1).sub(smoothstep(0.16, 0.34, length(f)))
      const keep = step(r.mul(0.45).add(0.45), h)
      alpha = grainDot.mul(keep).mul(float(1).sub(smoothstep(0.75, 1, r))).mul(vAlpha)
      rgb = vColor.mul(h.mul(0.45).add(0.7))
    } else if (look === 'grain') {
      alpha = float(1).sub(smoothstep(0.6, 1, r)).mul(vAlpha)
      rgb = vColor.mul(float(1).sub(r).mul(0.25).add(0.75))
    } else {
      const ang = atan(d.y, d.x.add(1e-4))
      const lumps = sin(ang.mul(5)).mul(0.1).add(sin(ang.mul(9).add(1.7)).mul(0.06)).mul(r)
      alpha = float(1).sub(smoothstep(0.1, 1, r.add(lumps))).mul(vAlpha)
      rgb = vColor.mul(mix(0.72, 1.04, uv().y))
    }
    material.colorNode = rgb
    material.opacityNode = alpha
    material.alphaTest = 0.003

    const plane = new THREE.PlaneGeometry(1, 1)
    this.mesh = new THREE.Mesh(plane, material)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = renderOrder
    this.clearPending = true
  }

  get live(): number {
    return this.idle < this.maxLife ? this.max : 0
  }

  spawn(p: ParticleSpawn, groundY = -Infinity): void {
    if (this.queued >= SPAWN_MAX) return
    const o = this.queued++ * SPAWN_STRIDE
    const q = this.staging
    q[o] = p.x; q[o + 1] = p.y; q[o + 2] = p.z; q[o + 3] = 0
    q[o + 4] = p.vx; q[o + 5] = p.vy; q[o + 6] = p.vz; q[o + 7] = p.life
    q[o + 8] = p.startSize; q[o + 9] = p.endSize
    q[o + 10] = Math.random() * Math.PI * 2
    q[o + 11] = this.look === 'grain' ? 0 : (Math.random() - 0.5) * 0.8
    q[o + 12] = p.r; q[o + 13] = p.g; q[o + 14] = p.b; q[o + 15] = p.alpha
    q[o + 16] = p.lift; q[o + 17] = p.drag; q[o + 18] = p.bounce ?? 0
    q[o + 19] = Number.isFinite(groundY) ? groundY : -1e9
    this.idle = 0
    this.maxLife = Math.max(this.maxLife, p.life)
  }

  update(dt: number, windX = 0, windZ = 0): void {
    if (this.clearPending) {
      this.renderer.compute(this.clearCompute)
      this.clearPending = false
    }
    if (this.queued > 0) {
      this.stagingAttr.clearUpdateRanges()
      this.stagingAttr.addUpdateRange(0, this.queued * SPAWN_STRIDE)
      this.stagingAttr.needsUpdate = true
      this.uSpawnCount.value = this.queued
      this.uCursor.value = this.cursor
      this.renderer.compute(this.spawnCompute)
      this.cursor = (this.cursor + this.queued) % this.max
      this.uHead.value = this.cursor
      this.batches[this.batchHead * 2] = this.clock
      this.batches[this.batchHead * 2 + 1] = this.queued
      this.batchHead = (this.batchHead + 1) % HISTORY
      this.queued = 0
    }
    this.clock += dt
    this.mesh.count = this.liveBound()
    // Nothing alive: skip the update dispatch entirely.
    this.idle += dt
    if (this.idle > this.maxLife + 0.5) {
      this.maxLife = 0
      this.mesh.count = 0
      return
    }
    this.uDt.value = dt
    this.uWind.value.set(windX, windZ)
    this.renderer.compute(this.updateCompute)
  }

  /** Spawns young enough to be alive, counting back through the batches (newest first). */
  private liveBound(): number {
    let n = 0
    for (let k = 1; k <= HISTORY; k++) {
      const b = ((this.batchHead - k + HISTORY) % HISTORY) * 2
      const count = this.batches[b + 1]
      // Past the longest life seen: this batch and everything older is dead.
      if (count === 0 || this.clock - this.batches[b] > this.maxLife + 0.5) break
      n += count
      if (n >= this.max) break
    }
    return Math.min(n, this.max)
  }

  clear(): void {
    this.batches.fill(0)
    this.mesh.count = 0
    this.queued = 0
    this.clearPending = true
    this.idle = Infinity
    this.maxLife = 0
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}
