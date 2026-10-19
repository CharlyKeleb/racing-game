import * as THREE from 'three'
import type { VehicleConfig } from '../vehicles/VehicleConfig'

const FLAME_LENGTH = 0.8
/** Radius at the pipe; the cone is squashed vertically to match oval tips. */
const FLAME_RADIUS = 0.075
const OVAL = 0.62

/** Fallback exhaust tips when the config has none: twin pipes low at the rear bumper. */
export function defaultExhausts(cfg: VehicleConfig): [number, number, number][] {
  const z = cfg.chassisCenter[2] - cfg.chassisHalfExtents[2]
  return [
    [0.32, 0.36, z],
    [-0.32, 0.36, z],
  ]
}

/**
 * Lengthwise flame texture: opaque and hot at the pipe (canvas bottom = cone
 * base, uv.y 0), fading to nothing at the tip, with faint bands like shock
 * diamonds. Solid cones read as blue icicles; this reads as a jet.
 */
function plumeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 4
  c.height = 128
  const g = c.getContext('2d')!
  for (let y = 0; y < 128; y++) {
    const along = 1 - y / 127 // 0 at the pipe, 1 at the tip
    const fade = Math.pow(1 - along, 1.6)
    const bands = 0.8 + 0.2 * Math.cos(along * Math.PI * 7)
    g.fillStyle = `rgba(255,255,255,${(fade * bands).toFixed(3)})`
    g.fillRect(0, y, 4, 1)
  }
  return new THREE.CanvasTexture(c)
}

/** Soft radial glow texture for the hot spot at the pipe outlet. */
function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(160,210,255,0.6)')
  grad.addColorStop(1, 'rgba(40,110,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

/**
 * Nitro flames out of the exhaust tips: a blue outer cone, a white-hot core
 * and a glow at each outlet. Parented to the car body (the node that leans),
 * so the flames stay on the pipes through squat, dive and roll. Additive,
 * colors above 1 so bloom picks them up; length and flicker follow boost
 * intensity, and a perfect boost burns longer and hotter.
 */
export class NitroFlames {
  readonly group = new THREE.Group()
  private readonly flames: THREE.Object3D[] = []
  private readonly glows: THREE.Sprite[] = []
  private readonly geometry: THREE.ConeGeometry
  private readonly materials: THREE.Material[]
  private readonly texture: THREE.CanvasTexture
  private readonly plume: THREE.CanvasTexture
  private time = 0

  constructor(cfg: VehicleConfig) {
    // Cone tip points -Z (backwards), base at the pipe.
    this.geometry = new THREE.ConeGeometry(FLAME_RADIUS, FLAME_LENGTH, 16, 1, true)
    this.geometry.rotateX(-Math.PI / 2)
    this.geometry.translate(0, 0, -FLAME_LENGTH / 2)

    this.plume = plumeTexture()
    const flameMat = (color: number, intensity: number, opacity: number) =>
      new THREE.MeshBasicMaterial({
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
    const outer = flameMat(0x2a6dff, 2.4, 0.9)
    const core = flameMat(0xd8f4ff, 3.2, 1)
    this.texture = glowTexture()
    const glowMat = new THREE.SpriteMaterial({
      map: this.texture,
      color: new THREE.Color(0x9fd0ff).multiplyScalar(2.5),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    })
    this.materials = [outer, core, glowMat]

    for (const [x, y, z] of cfg.exhausts ?? defaultExhausts(cfg)) {
      const flame = new THREE.Group()
      flame.position.set(x, y, z - 0.01)
      const shell = new THREE.Mesh(this.geometry, outer)
      shell.scale.set(1, OVAL, 1)
      const inner = new THREE.Mesh(this.geometry, core)
      inner.scale.set(0.5, 0.5 * OVAL, 0.55)
      flame.add(shell, inner)
      const glow = new THREE.Sprite(glowMat)
      glow.position.set(x, y, z - 0.03)
      this.flames.push(flame)
      this.glows.push(glow)
      this.group.add(flame, glow)
    }
    this.group.visible = false
  }

  /**
   * @param intensity boost amount, 0..1 (above 1 during a perfect boost).
   */
  update(intensity: number, dt: number): void {
    this.time += dt
    this.group.visible = intensity > 0.02
    if (!this.group.visible) return
    for (let i = 0; i < this.flames.length; i++) {
      const t = this.time * 41 + i * 1.7
      const flicker = 0.82 + 0.1 * Math.sin(t) + 0.08 * Math.sin(t * 2.7 + 1)
      const width = 0.75 + 0.25 * Math.min(intensity, 1.4)
      this.flames[i].scale.set(width, width, intensity * flicker)
      const glow = 0.22 + 0.12 * Math.min(intensity, 1.4) * flicker
      this.glows[i].scale.set(glow, glow * OVAL, 1)
    }
  }

  dispose(): void {
    this.group.removeFromParent()
    this.geometry.dispose()
    this.texture.dispose()
    this.plume.dispose()
    for (const m of this.materials) m.dispose()
  }
}
