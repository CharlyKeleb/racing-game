import * as THREE from 'three'
import type { VehicleConfig } from './VehicleConfig'

/** Darkness straight under the car, before fading with airtime. */
const OPACITY = 0.62

let texture: THREE.DataTexture | null = null
/**
 * A soft rounded rectangle: dark under the floor, feathering out past the
 * wheels. Shared by every car. Computed (a rounded-box distance), not drawn on
 * a canvas, so a Vehicle still builds without a DOM (tests, the server).
 */
function shadowTexture(): THREE.DataTexture {
  if (texture) return texture
  const w = 32, h = 64
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Rounded box in -1..1 space: half-size 0.55 x 0.78, corner 0.3, feathered 0.42.
      const px = Math.abs(((x + 0.5) / w) * 2 - 1), py = Math.abs(((y + 0.5) / h) * 2 - 1)
      const qx = Math.max(px - 0.55 + 0.3, 0), qy = Math.max(py - 0.78 + 0.3, 0)
      const d = Math.hypot(qx, qy) - 0.3 + Math.min(Math.max(px - 0.55 + 0.3, py - 0.78 + 0.3), 0)
      const t = Math.min(1, Math.max(0, (d + 0.12) / 0.42))
      const a = Math.round(255 * (1 - t * t * (3 - 2 * t)))
      data.set([a, a, a, 255], (y * w + x) * 4)
    }
  }
  texture = new THREE.DataTexture(data, w, h)
  texture.magFilter = texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

/**
 * Contact shadow: a soft dark pad on the ground under the car, so it sits on
 * the road instead of hovering on its shadow-map shadow (and is grounded at all
 * on Low, which has no shadow map). One draw call per car, MeshBasicMaterial
 * (WebGPU-safe). Rides on the car's root at wheel-contact height; Vehicle fades
 * it out as the wheels leave the ground.
 */
export function createContactShadow(cfg: VehicleConfig): THREE.Mesh {
  const [hx, , hz] = cfg.chassisHalfExtents
  const [cx, , cz] = cfg.chassisCenter
  let ground = 0
  for (const w of cfg.wheels) ground += w.position[1] - cfg.suspension.restLength - w.radius
  ground /= cfg.wheels.length
  const geometry = new THREE.PlaneGeometry(hx * 2 * 1.32, hz * 2 * 1.16)
  geometry.rotateX(-Math.PI / 2)
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000, alphaMap: shadowTexture(), transparent: true, opacity: OPACITY,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'contact-shadow'
  mesh.position.set(cx, ground + 0.025, cz)
  mesh.renderOrder = -1
  mesh.castShadow = mesh.receiveShadow = false
  return mesh
}

/** Fade with how many wheels are down (0..1). */
export function setContactShadowGround(mesh: THREE.Mesh, grounded: number): void {
  ;(mesh.material as THREE.MeshBasicMaterial).opacity = OPACITY * grounded
}
