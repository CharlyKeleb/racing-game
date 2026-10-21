import * as THREE from 'three'
import { BANG, NONE, type PopKind } from '../vehicles/Backfire'
import type { VehicleConfig } from '../vehicles/VehicleConfig'

const FLAME_LENGTH = 0.8
/** Radius at the pipe; the cone is squashed vertically to match oval tips. */
const FLAME_RADIUS = 0.075
const OVAL = 0.62
/** Fireball diameter at full bloom, m: a crackle, and a bang. */
const CRACKLE_SIZE = 0.34
const BANG_SIZE = 0.62
const FIREBALL_VARIANTS = 3
/** Glow puffs streaming down each jet: the flame's soft, turbulent body around the core cone. */
const PUFFS = 24
const PUFF_FLOW = 2.6

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

/**
 * Core texture, wrapped round the flame cone (v along it): opaque and white-hot
 * at the pipe, fading smoothly to the tip. The flowing glow puffs around it
 * carry the turbulence; any banding here turned into zigzags on the thin cone.
 */
function plumeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 4
  c.height = 128
  const g = c.getContext('2d')!
  for (let y = 0; y < 128; y++) {
    const along = 1 - y / 127 // 0 at the pipe, 1 at the tip
    g.fillStyle = `rgba(255,255,255,${Math.pow(1 - along, 1.5).toFixed(3)})`
    g.fillRect(0, y, 4, 1)
  }
  return new THREE.CanvasTexture(c)
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

interface Pipe {
  jet: THREE.Group
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
 * - Nitro: a three-layer jet out of each tip, a white-hot core, a blue body and
 *   a violet outer haze, with streaks flowing down it and the length and
 *   angle flickering per pipe, plus a glow at the outlet.
 * - Backfires: a fireball per pipe, like a real race car popping on the
 *   overrun: a white-hot flash that blooms into a turbulent orange ball and
 *   cools to red as it fades (~0.1 s for a crackle, ~0.17 s for a bang).
 *
 * Additive and bloom-bright; MeshBasic/Sprite materials only, so WebGPU needs
 * no node twin. Nothing is drawn while there's no nitro and no pop.
 */
export class NitroFlames {
  readonly group = new THREE.Group()
  private readonly pipes: Pipe[] = []
  private readonly geometry: THREE.ConeGeometry
  private readonly materials: THREE.Material[] = []
  private readonly textures: THREE.Texture[] = []
  private readonly fireballs: THREE.Texture[] = []
  private readonly plume: THREE.CanvasTexture
  private time = 0
  /** Flame body: two point clouds (outer haze, inner glow) across all pipes, one draw call each. */
  private readonly outerPuffs: THREE.Points
  private readonly innerPuffs: THREE.Points
  private readonly puffPositions: Float32Array[] = []
  private readonly puffColors: Float32Array[] = []

  constructor(cfg: VehicleConfig) {
    // Cone tip points -Z (backwards), base at the pipe.
    this.geometry = new THREE.ConeGeometry(FLAME_RADIUS, FLAME_LENGTH, 20, 1, true)
    this.geometry.rotateX(-Math.PI / 2)
    this.geometry.translate(0, 0, -FLAME_LENGTH / 2)

    this.plume = plumeTexture()
    this.textures.push(this.plume)
    const flameMat = (color: number, intensity: number, opacity: number) => {
      const m = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(intensity),
        alphaMap: this.plume,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
        toneMapped: false,
      })
      this.materials.push(m)
      return m
    }
    const core = flameMat(0xd8f4ff, 3.4, 1)
    const glowTex = glowTexture()
    this.textures.push(glowTex)
    const glowMat = new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(0x9fd0ff).multiplyScalar(2.5), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false })
    this.materials.push(glowMat)
    for (let v = 0; v < FIREBALL_VARIANTS; v++) {
      const t = fireballTexture(101 + v * 37)
      this.fireballs.push(t)
      this.textures.push(t)
    }

    for (const [x, y, z] of cfg.exhausts ?? defaultExhausts(cfg)) {
      const jet = new THREE.Group()
      jet.position.set(x, y, z - 0.01)
      const inner = new THREE.Mesh(this.geometry, core)
      inner.scale.set(0.6, 0.6 * OVAL, 0.55)
      jet.add(inner)
      const glow = new THREE.Sprite(glowMat)
      glow.position.set(x, y, z - 0.03)
      const ballMat = new THREE.SpriteMaterial({ map: this.fireballs[0], blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, transparent: true })
      const flashMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, transparent: true })
      this.materials.push(ballMat, flashMat)
      const ball = new THREE.Sprite(ballMat)
      const flash = new THREE.Sprite(flashMat)
      ball.visible = flash.visible = false
      this.pipes.push({ jet, phase: this.pipes.length * 0.37, glow, ball, ballMat, flash, flashMat, x, y, z })
      this.group.add(jet, glow, ball, flash)
    }
    const puffs = (size: number) => {
      const count = this.pipes.length * PUFFS
      const positions = new Float32Array(count * 3), colors = new Float32Array(count * 4)
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage))
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4).setUsage(THREE.DynamicDrawUsage))
      const material = new THREE.PointsMaterial({ size, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false, sizeAttenuation: true })
      this.materials.push(material)
      this.puffPositions.push(positions)
      this.puffColors.push(colors)
      const points = new THREE.Points(geometry, material)
      points.frustumCulled = false
      this.group.add(points)
      return points
    }
    this.outerPuffs = puffs(0.36)
    this.innerPuffs = puffs(0.17)
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
    this.outerPuffs.visible = this.innerPuffs.visible = jet
    if (jet) this.updatePuffs(intensity)
    for (let i = 0; i < this.pipes.length; i++) {
      const p = this.pipes[i]
      p.jet.visible = p.glow.visible = jet
      if (jet) {
        const t = this.time * 41 + i * 1.7
        const flicker = 0.8 + 0.12 * Math.sin(t) + 0.08 * Math.sin(t * 2.7 + 1) + 0.05 * Math.sin(t * 6.3 + i)
        const width = 0.75 + 0.25 * Math.min(intensity, 1.4)
        p.jet.scale.set(width, width, intensity * flicker)
        // A little wander, as the exhaust gas buffets the flame.
        p.jet.rotation.set(0.04 * Math.sin(t * 0.37 + i), 0.05 * Math.sin(t * 0.29 + 2 * i), 0)
        const glow = 0.14 + 0.08 * Math.min(intensity, 1.4) * flicker
        p.glow.scale.set(glow, glow * OVAL, 1)
      }
      p.ball.visible = p.flash.visible = fire
      if (fire) this.fireball(p, pop, i)
    }
  }

  /**
   * Glow puffs flow from each pipe to the flame tip and recycle, wandering a
   * little more the further they get: blue-white near the pipe, violet at
   * the tip, fading out. Positions are in the body's space.
   */
  private updatePuffs(intensity: number): void {
    const length = FLAME_LENGTH * 1.15 * Math.min(1.4, intensity)
    for (let layer = 0; layer < 2; layer++) {
      const pos = this.puffPositions[layer], col = this.puffColors[layer]
      const outer = layer === 0
      for (let i = 0; i < this.pipes.length; i++) {
        const p = this.pipes[i]
        for (let k = 0; k < PUFFS; k++) {
          const n = i * PUFFS + k
          // 0 at the pipe, 1 at the tip; each puff flows back and starts over.
          const t = (k / PUFFS + this.time * PUFF_FLOW + p.phase) % 1
          const seed = n * 12.9898
          const wander = (outer ? 0.05 : 0.025) * t
          pos[n * 3] = p.x + wander * Math.sin(this.time * 23 + seed)
          pos[n * 3 + 1] = p.y + wander * OVAL * Math.sin(this.time * 29 + seed * 1.7)
          pos[n * 3 + 2] = p.z - 0.02 - t * length
          // Hot blue-white at the pipe to blue, then violet at the tip (values past 1 bloom).
          const fade = Math.pow(1 - t, outer ? 1.3 : 1.8) * Math.min(1, Math.max(0, t - 0.06) * 8)
          col[n * 4] = outer ? 0.35 + 0.55 * t : 0.7 - 0.3 * t
          col[n * 4 + 1] = outer ? 0.45 - 0.25 * t : 0.85 - 0.25 * t
          col[n * 4 + 2] = outer ? 1.6 : 1.8
          col[n * 4 + 3] = fade * (outer ? 0.3 : 0.5)
        }
      }
    }
    this.outerPuffs.geometry.attributes.position.needsUpdate = this.outerPuffs.geometry.attributes.color.needsUpdate = true
    this.innerPuffs.geometry.attributes.position.needsUpdate = this.innerPuffs.geometry.attributes.color.needsUpdate = true
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
    this.geometry.dispose()
    this.outerPuffs.geometry.dispose()
    this.innerPuffs.geometry.dispose()
    for (const t of this.textures) t.dispose()
    for (const m of this.materials) m.dispose()
  }
}
