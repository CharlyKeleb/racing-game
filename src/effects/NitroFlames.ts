import * as THREE from 'three'
import { BANG, NONE, type PopKind } from '../vehicles/Backfire'
import type { VehicleConfig } from '../vehicles/VehicleConfig'

/** Nitro flame length at full boost, m (a perfect boost runs a little longer). */
const FLAME_LENGTH = 1.05
const OVAL = 0.62
/** Fireball diameter at full bloom, m: a crackle, and a bang. */
const CRACKLE_SIZE = 0.34
const BANG_SIZE = 0.62
const FIREBALL_VARIANTS = 3
/** Flame puffs per pipe: billowing billboards that flow out of the pipe and grow, like burning gas. */
const PUFFS = 18
/** Puff cycles per second (how fast the gas streams out). */
const PUFF_FLOW = 3.1
/** Puff size at the pipe and at the end of the flame, m: the plume widens as it leaves. */
const PUFF_START = 0.12
const PUFF_END = 0.42

/** Fallback exhaust tips when the config has none: twin pipes low at the rear bumper. */
export function defaultExhausts(cfg: VehicleConfig): [number, number, number][] {
  const z = cfg.chassisCenter[2] - cfg.chassisHalfExtents[2]
  return [
    [0.32, 0.36, z],
    [-0.32, 0.36, z],
  ]
}

/** Seeded random so the generated textures are the same every load. */
function seeded(seed: number): () => number {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

/** Soft radial glow for the hot spot at the pipe outlet. */
function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

/**
 * A backfire fireball: a lumpy ball of overlapping puffs, white-hot in the
 * middle and ragged at the edge. Greyscale (the sprite colour heats it), so one
 * texture burns white, then orange, then dull red as the fireball cools.
 */
function fireballTexture(seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const random = seeded(seed)
  g.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 26; i++) {
    const angle = random() * Math.PI * 2, reach = Math.pow(random(), 0.7) * 34
    const x = 64 + Math.cos(angle) * reach, y = 64 + Math.sin(angle) * reach * 0.85
    const r = 14 + random() * 20 * (1 - reach / 50)
    const grad = g.createRadialGradient(x, y, 0, x, y, r)
    const a = 0.22 + 0.25 * (1 - reach / 34)
    grad.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`)
    grad.addColorStop(0.6, `rgba(255,255,255,${(a * 0.35).toFixed(3)})`)
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(x - r, y - r, r * 2, r * 2)
  }
  return new THREE.CanvasTexture(c)
}

/** Fireball colour as it cools: white-hot → yellow → orange → dull red (values above 1 feed the bloom). */
// Not tone-mapped, so channels past 1 clip to white: keep green and blue under 1 so orange stays orange (red past 1 still blooms).
const FIRE_STOPS = [new THREE.Color(2.2, 0.95, 0.45), new THREE.Color(1.9, 0.62, 0.12), new THREE.Color(1.5, 0.3, 0.04), new THREE.Color(0.7, 0.1, 0.02)]
const _fire = new THREE.Color()
function fireColor(t: number, out: THREE.Color): THREE.Color {
  const x = Math.min(0.999, Math.max(0, t)) * (FIRE_STOPS.length - 1)
  const i = Math.floor(x)
  return out.copy(FIRE_STOPS[i]).lerp(FIRE_STOPS[i + 1], x - i)
}

/**
 * Nitro flame colour along the plume, nitrous-blue like NFS: white-hot at the
 * nozzle, electric blue in the body, violet at the edges, dying out dark
 * purple. Red stays under 1 so the blue doesn't wash out to white untone-mapped.
 */
const JET_STOPS = [new THREE.Color(0.9, 1.3, 2.4), new THREE.Color(0.35, 0.85, 2.3), new THREE.Color(0.55, 0.35, 1.9), new THREE.Color(0.45, 0.12, 0.9), new THREE.Color(0.12, 0.02, 0.25)]
function jetColor(t: number, out: THREE.Color): THREE.Color {
  const x = Math.min(0.999, Math.max(0, t)) * (JET_STOPS.length - 1)
  const i = Math.floor(x)
  return out.copy(JET_STOPS[i]).lerp(JET_STOPS[i + 1], x - i)
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _qSpin = new THREE.Quaternion()
const _qView = new THREE.Quaternion()
const _pos = new THREE.Vector3()
const _scale = new THREE.Vector3()
const _axisZ = new THREE.Vector3(0, 0, 1)
const _jet = new THREE.Color()

interface Pipe {
  phase: number
  glow: THREE.Sprite
  ball: THREE.Sprite
  ballMat: THREE.SpriteMaterial
  flash: THREE.Sprite
  flashMat: THREE.SpriteMaterial
  x: number
  y: number
  z: number
}

/** What the exhaust is doing this frame (from the car's Backfire). */
export interface ExhaustPop {
  /** 0..1, 1 the instant it lit. */
  flash: number
  kind: PopKind
  strength: number
  /** Pops so far: varies each fireball's look. */
  count: number
}

const NO_POP: ExhaustPop = { flash: 0, kind: NONE, strength: 0, count: 0 }

/**
 * Exhaust fire, parented to the car body (the node that leans) so it stays on
 * the pipes through squat, dive and roll.
 *
 * - Nitro: a billowing plume of lumpy fire billboards per pipe, like a real
 *   car shooting flames: small, dense and blue-white at the nozzle, growing
 *   and widening into white-yellow, then orange fire that drifts, turns and
 *   dies away dark red, plus a small glow at the outlet. One instanced draw
 *   call for all pipes.
 * - Backfires: a fireball per pipe, like a race car popping on the overrun: a
 *   white-hot flash that blooms into a turbulent orange ball and cools to red
 *   as it fades (~0.1 s for a crackle, ~0.17 s for a bang).
 *
 * Additive and bloom-bright; MeshBasic/Sprite materials only, so WebGPU needs
 * no node twin. Nothing is drawn while there's no nitro and no pop.
 */
export class NitroFlames {
  readonly group = new THREE.Group()
  private readonly pipes: Pipe[] = []
  private readonly materials: THREE.Material[] = []
  private readonly textures: THREE.Texture[] = []
  private readonly fireballs: THREE.Texture[] = []
  private time = 0
  /** The nitro flame: lumpy fire billboards for every pipe in one instanced draw call. */
  private readonly puffs: THREE.InstancedMesh
  private readonly puffGeometry = new THREE.PlaneGeometry(1, 1)
  /**
   * The camera the flame billboards turn to face (Game sets it once). Without
   * one they face straight back, which still reads from the chase camera.
   */
  static camera: THREE.Camera | null = null

  constructor(cfg: VehicleConfig) {
    const glowTex = glowTexture()
    this.textures.push(glowTex)
    const glowMat = new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(0xd6e4ff).multiplyScalar(1.7), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false })
    this.materials.push(glowMat)
    for (let v = 0; v < FIREBALL_VARIANTS; v++) {
      const t = fireballTexture(101 + v * 37)
      this.fireballs.push(t)
      this.textures.push(t)
    }

    for (const [x, y, z] of cfg.exhausts ?? defaultExhausts(cfg)) {
      const glow = new THREE.Sprite(glowMat)
      glow.position.set(x, y, z - 0.03)
      const ballMat = new THREE.SpriteMaterial({ map: this.fireballs[0], blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, transparent: true })
      const flashMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, transparent: true })
      this.materials.push(ballMat, flashMat)
      const ball = new THREE.Sprite(ballMat)
      const flash = new THREE.Sprite(flashMat)
      ball.visible = flash.visible = false
      this.pipes.push({ phase: this.pipes.length * 0.37, glow, ball, ballMat, flash, flashMat, x, y, z })
      this.group.add(glow, ball, flash)
    }
    const puffMat = new THREE.MeshBasicMaterial({ map: this.fireballs[1], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false, side: THREE.DoubleSide })
    this.materials.push(puffMat)
    this.puffs = new THREE.InstancedMesh(this.puffGeometry, puffMat, Math.max(1, this.pipes.length * PUFFS))
    this.puffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.puffs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.puffs.count * 3), 3).setUsage(THREE.DynamicDrawUsage)
    this.puffs.frustumCulled = false
    this.group.add(this.puffs)
    this.group.visible = false
  }

  /**
   * @param intensity nitro boost, 0..1 (above 1 during a perfect boost).
   * @param pop the car's backfire this frame.
   */
  update(intensity: number, dt: number, pop: ExhaustPop = NO_POP): void {
    this.time += dt
    const jet = intensity > 0.02
    const fire = pop.flash > 0.01
    this.group.visible = jet || fire
    if (!this.group.visible) return
    this.puffs.visible = jet
    if (jet) this.updatePuffs(intensity)
    for (let i = 0; i < this.pipes.length; i++) {
      const p = this.pipes[i]
      p.glow.visible = jet
      if (jet) {
        const t = this.time * 41 + i * 1.7
        const flicker = 0.8 + 0.12 * Math.sin(t) + 0.08 * Math.sin(t * 2.7 + 1) + 0.05 * Math.sin(t * 6.3 + i)
        const glow = 0.09 + 0.06 * Math.min(intensity, 1.4) * flicker
        p.glow.scale.set(glow, glow * OVAL, 1)
      }
      p.ball.visible = p.flash.visible = fire
      if (fire) this.fireball(p, pop, i)
    }
  }

  /**
   * Flame puffs flow out of each pipe and recycle: small, blue-white and
   * dense at the nozzle, growing into billowing white-yellow then orange
   * fire, drifting and turning as they go, dying out dark red. Each is a
   * lumpy fire billboard turned to face the camera, so the plume has no hard
   * edge from any side. All pipes, one instanced draw call, no allocation.
   */
  private updatePuffs(intensity: number): void {
    const boost = Math.min(1.4, intensity)
    const length = FLAME_LENGTH * (0.75 + 0.45 * boost)
    // Billboards face the camera: its rotation, seen from the flames' parent space.
    const camera = NitroFlames.camera
    this.group.updateWorldMatrix(true, false)
    if (camera) {
      camera.getWorldQuaternion(_qView)
      this.group.getWorldQuaternion(_q).invert()
      _qView.premultiply(_q)
    } else _qView.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.PI)
    const colors = this.puffs.instanceColor!
    for (let i = 0; i < this.pipes.length; i++) {
      const p = this.pipes[i]
      for (let k = 0; k < PUFFS; k++) {
        const n = i * PUFFS + k
        const t = (k / PUFFS + this.time * PUFF_FLOW + p.phase) % 1 // 0 at the pipe, 1 at the end
        const seed = n * 12.9898
        // Turbulence: the further out, the more the gas wanders.
        const wander = 0.09 * t * t
        _pos.set(
          p.x + wander * Math.sin(this.time * 9 + seed),
          p.y + wander * 0.7 * Math.sin(this.time * 11 + seed * 1.7) + 0.05 * t * t,
          p.z - 0.03 - t * length,
        )
        const size = (PUFF_START + (PUFF_END - PUFF_START) * Math.pow(t, 0.8)) * (0.85 + 0.25 * boost) * (0.85 + 0.3 * Math.abs(Math.sin(seed)))
        _scale.set(size, size, 1)
        _qSpin.setFromAxisAngle(_axisZ, seed + this.time * (1.5 + (n % 3)))
        _m.compose(_pos, _q.copy(_qView).multiply(_qSpin), _scale)
        this.puffs.setMatrixAt(n, _m)
        // Additive: brightness is opacity. Fade in off the nozzle, burn, die away.
        const fade = Math.min(1, t * 9) * Math.pow(1 - t, 1.1) * (0.75 + 0.3 * boost)
        jetColor(t * 0.95, _jet).multiplyScalar(fade)
        colors.setXYZ(n, _jet.r, _jet.g, _jet.b)
      }
    }
    this.puffs.instanceMatrix.needsUpdate = true
    colors.needsUpdate = true
  }

  private fireball(p: Pipe, pop: ExhaustPop, i: number): void {
    const age = 1 - pop.flash // 0 when it lights, 1 when it's gone
    const big = pop.kind === BANG
    // Blooms fast, then hangs as it cools; drifts back off the pipe.
    const bloom = 1 - Math.pow(1 - Math.min(1, age * 2.2), 3)
    const size = (big ? BANG_SIZE : CRACKLE_SIZE) * (0.35 + 0.65 * bloom) * (0.75 + 0.35 * pop.strength) * (1 + 0.12 * ((pop.count + i) % 3))
    p.ball.scale.set(size, size * 0.9, 1)
    p.ball.position.set(p.x, p.y + 0.02 * bloom, p.z - 0.05 - size * 0.45 - 0.2 * age)
    p.ballMat.map = this.fireballs[(pop.count * 2 + i) % FIREBALL_VARIANTS]
    p.ballMat.rotation = pop.count * 2.1 + i * 1.3 + age * 0.6
    fireColor(Math.min(1, age * (big ? 1.3 : 1.6)), p.ballMat.color)
    p.ballMat.opacity = Math.pow(pop.flash, 0.6) * (0.75 + 0.25 * pop.strength)
    // The white flash at the pipe, over in the first third of its life.
    const flash = Math.max(0, 1 - age * 3)
    const flashSize = (big ? 0.5 : 0.3) * (0.6 + 0.4 * pop.strength)
    p.flash.scale.set(flashSize, flashSize * OVAL, 1)
    p.flash.position.set(p.x, p.y, p.z - 0.04)
    p.flashMat.color.copy(fireColor(0, _fire))
    p.flashMat.opacity = flash
  }

  dispose(): void {
    this.group.removeFromParent()
    this.puffGeometry.dispose()
    for (const t of this.textures) t.dispose()
    for (const m of this.materials) m.dispose()
  }
}
