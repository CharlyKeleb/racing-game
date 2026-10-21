import * as THREE from 'three'

/** Distance in front of the camera, m: just past the near plane. */
const DEPTH = 0.3
/** Segments around the ring; streak texture repeats this many times around. */
const SEGMENTS = 64
const REPEAT = 3
/** Clear centre while boosting, as a share of half the frame height; the ignition burst starts much closer in. */
const INNER = 0.62
const INNER_BURST = 0.12
/** Brightness while boosting, and on top at the instant of ignition. */
const HOLD = 0.55
const BURST = 1.1
/** Seconds the ignition burst takes to fly out and fade. */
const BURST_SEC = 0.55
/** Streak flow outward, texture lengths per second at full boost. */
const FLOW = 2.6

const BOOST_TINT = new THREE.Color(0.55, 0.85, 1.25)
const PERFECT_TINT = new THREE.Color(1.25, 0.6, 1.1)

/**
 * The nitro rush, NFS Nitro style: on ignition a ring of light streaks bursts
 * out of the middle of the frame, then keeps streaming outward around the
 * edges while the boost burns, leaving the car and the road ahead clear. One
 * camera-facing annulus (UVs run around and outward) with a scrolling streak
 * texture; inner ring black so the streaks fade in from the clear centre. One
 * draw call, additive MeshBasicMaterial: WebGPU needs no node twin. Hidden
 * whenever there's no boost and no burst.
 */
export class NitroRush {
  readonly mesh: THREE.Mesh
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.MeshBasicMaterial
  private readonly texture: THREE.CanvasTexture
  private readonly positions: Float32Array
  private burst = 0
  private level = 0

  constructor() {
    const verts = (SEGMENTS + 1) * 2
    this.positions = new Float32Array(verts * 3)
    const uvs = new Float32Array(verts * 2)
    const colors = new Float32Array(verts * 3)
    const index: number[] = []
    for (let s = 0; s <= SEGMENTS; s++) {
      const u = (s / SEGMENTS) * REPEAT
      // Inner vertex (dark: streaks fade in from the clear middle), outer vertex (full).
      uvs.set([u, 0, u, 1], s * 4)
      colors.set([0, 0, 0, 1, 1, 1], s * 6)
      if (s < SEGMENTS) {
        const v = s * 2
        index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3)
      }
    }
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this.geometry.setIndex(index)
    this.texture = streakTexture()
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture, vertexColors: true, transparent: true, opacity: 0, depthTest: false, depthWrite: false,
      toneMapped: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    })
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.name = 'nitro-rush'
    this.mesh.renderOrder = 10_000
    this.mesh.frustumCulled = false
    this.mesh.visible = false
  }

  /** The boost just lit: fire the burst. */
  ignite(): void {
    this.burst = 1
  }

  /**
   * @param intensity nitro boost, 0..1 (above 1 in a perfect boost); 0 fades the rush out
   * @param enabled the Speed Lines setting: off hides it entirely
   */
  update(camera: THREE.PerspectiveCamera, intensity: number, perfect: boolean, enabled: boolean, dt: number): void {
    if (!enabled) {
      this.burst = this.level = 0
      this.mesh.visible = false
      return
    }
    const target = Math.min(1.2, Math.max(0, intensity))
    this.level += (target - this.level) * (1 - Math.exp(-(target > this.level ? 12 : 4) * dt))
    this.burst = Math.max(0, this.burst - dt / BURST_SEC)
    const brightness = HOLD * this.level + BURST * this.burst * this.burst
    this.mesh.visible = brightness > 0.01
    if (!this.mesh.visible) return

    this.material.opacity = Math.min(1, brightness)
    this.material.color.copy(perfect ? PERFECT_TINT : BOOST_TINT).multiplyScalar(1 + this.burst)
    // Streaks pour outward, faster while the burst is flying.
    this.texture.offset.y = (this.texture.offset.y - dt * FLOW * (0.4 + this.level + 2 * this.burst)) % 1

    // Rebuild the ring in camera units: 1 = half the frame height at DEPTH.
    const half = DEPTH * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    const out = Math.hypot(camera.aspect, 1) * 1.05
    const eased = 1 - this.burst
    const inner = INNER_BURST + (INNER - INNER_BURST) * (1 - (1 - eased) * (1 - eased))
    for (let s = 0; s <= SEGMENTS; s++) {
      const a = (s / SEGMENTS) * Math.PI * 2
      const x = Math.cos(a) * half
      const y = Math.sin(a) * half
      // Slightly oval, wider than tall, like the frame.
      const p = this.positions
      p[s * 6] = x * inner * 1.25
      p[s * 6 + 1] = y * inner
      p[s * 6 + 3] = x * out
      p[s * 6 + 4] = y * out
    }
    this.geometry.attributes.position.needsUpdate = true
    this.mesh.position.set(0, 0, -DEPTH).applyQuaternion(camera.quaternion).add(camera.position)
    this.mesh.quaternion.copy(camera.quaternion)
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.geometry.dispose()
    this.material.dispose()
    this.texture.dispose()
  }
}

/** Thin streaks running along v (outward), of mixed length and brightness; tiles in both directions. */
function streakTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (ctx) {
    let seed = 11
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let i = 0; i < 70; i++) {
      const x = random() * 256, y = random() * 128, len = 25 + random() * 80
      const w = 0.6 + random() * 1.6
      const a = 0.25 + random() * 0.75
      // Drawn twice, a tile apart, so a streak crossing the edge wraps without a seam.
      for (const shift of [0, -128]) {
        if (shift && y + len <= 128) continue
        const grad = ctx.createLinearGradient(0, y + shift, 0, y + shift + len)
        grad.addColorStop(0, 'rgba(255,255,255,0)')
        grad.addColorStop(0.7, `rgba(255,255,255,${a.toFixed(3)})`)
        grad.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = grad
        ctx.fillRect(x, y + shift, w, len)
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
