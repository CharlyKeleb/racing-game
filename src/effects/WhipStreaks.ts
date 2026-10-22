import * as THREE from 'three'

/** Distance in front of the camera, m: just past the near plane. */
const DEPTH = 0.3
/** Opacity at a full whip. Streaks, not a wipe: the shot stays readable. */
const MAX_OPACITY = 0.85

/**
 * The intro whip-pan's smear on presets without post FX (#46), where the
 * motion-blur pass that normally carries it doesn't run. One camera-facing quad
 * with soft horizontal streaks, scrolled in the swing direction and faded by
 * the whip strength: one draw call, and only during the ~0.3 s whips. Plain
 * MeshBasicMaterial, so the WebGPU renderer needs no node twin.
 */
export class WhipStreaks {
  readonly mesh: THREE.Mesh
  private readonly material: THREE.MeshBasicMaterial
  private readonly texture: THREE.CanvasTexture

  constructor() {
    this.texture = streakTexture()
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, opacity: 0, depthTest: false, depthWrite: false,
      toneMapped: false, fog: false, blending: THREE.AdditiveBlending,
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material)
    this.mesh.renderOrder = 10_000
    this.mesh.frustumCulled = false
    this.mesh.visible = false
  }

  /**
   * @param whip whip strength 0..1 (RaceIntroCamera.whip); 0 hides it
   * @param direction swing direction, ±1
   */
  update(camera: THREE.PerspectiveCamera, whip: number, direction: number, dt: number): void {
    this.mesh.visible = whip > 0.01
    if (!this.mesh.visible) return
    this.material.opacity = MAX_OPACITY * whip
    // Scroll the streaks across the frame with the swing.
    this.texture.offset.x = (this.texture.offset.x + direction * whip * dt * 6) % 1
    const height = 2 * DEPTH * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    this.mesh.scale.set(height * camera.aspect * 1.05, height * 1.05, 1)
    this.mesh.position.set(0, 0, -DEPTH).applyQuaternion(camera.quaternion).add(camera.position)
    this.mesh.quaternion.copy(camera.quaternion)
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.mesh.geometry.dispose()
    this.material.dispose()
    this.texture.dispose()
  }
}

/** Soft horizontal streaks, brighter toward the frame edges (the centre stays clearer). */
function streakTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    let seed = 7
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let i = 0; i < 150; i++) {
      const y = random() * 64, len = 60 + random() * 190, x = random() * 256
      const edge = Math.abs(y - 32) / 32
      const a = 0.12 + 0.5 * edge * (0.4 + 0.6 * random())
      const h = 0.5 + random() * 1.2
      // Drawn twice, a texture-width apart, so a streak crossing the edge wraps without a seam.
      for (const shift of [0, -256]) {
        if (shift && x + len <= 256) continue
        const grad = ctx.createLinearGradient(x + shift, 0, x + shift + len, 0)
        grad.addColorStop(0, 'rgba(255,255,255,0)')
        grad.addColorStop(0.5, `rgba(235,242,255,${a.toFixed(3)})`)
        grad.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = grad
        ctx.fillRect(x + shift, y, len, h)
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
