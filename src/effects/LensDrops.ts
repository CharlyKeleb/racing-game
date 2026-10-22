import * as THREE from 'three'
import { backend } from '../engine/backend'

const MAX_DROPS = 48
/** How far in front of the lens the drops are laid out (inside the near plane's reach). */
const DISTANCE = 0.25
/** Offset strength in the distortion buffer (× HAZE_STRENGTH in the post stack): a drop refracts hard. */
const REFRACTION = 4

const vertexShader = /* glsl */ `
  attribute float aStrength;
  varying vec2 vUv;
  varying float vStrength;
  void main() {
    vUv = uv;
    vStrength = aStrength;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  varying vec2 vUv;
  varying float vStrength;
  void main() {
    // A drop acts as a tiny lens: sample from the opposite side of its centre.
    vec2 d = (vUv - 0.5) * 2.0;
    float inside = 1.0 - smoothstep(0.8, 1.0, length(d));
    gl_FragColor = vec4(-d * inside * vStrength, 0.0, 1.0);
  }
`

interface Drop {
  x: number
  y: number
  size: number
  age: number
  life: number
}

const _m = new THREE.Matrix4()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()

/**
 * Raindrops on the lens in cockpit view (#53). Drops land at a rate set by
 * the rain, bead, slide down (and back, at speed, as the airflow pushes them)
 * and dry off. They're drawn into the heat-haze distortion buffer, so each
 * one refracts the image behind it; no new pass. Needs post FX.
 */
export class LensDrops {
  readonly mesh: THREE.InstancedMesh
  private readonly strength: THREE.InstancedBufferAttribute
  private readonly material: THREE.Material
  private readonly drops: Drop[] = []
  private debt = 0

  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1)
    this.strength = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DROPS), 1).setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('aStrength', this.strength)
    this.material = backend.nodes
      ? backend.nodes.lensDropMaterial()
      : new THREE.ShaderMaterial({ vertexShader, fragmentShader, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false })
    this.mesh = new THREE.InstancedMesh(geo, this.material, MAX_DROPS)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    for (let i = 0; i < MAX_DROPS; i++) this.drops.push({ x: 0, y: 0, size: 0, age: 0, life: 0 })
  }

  /** Any drop on the lens this frame. */
  get active(): boolean {
    return this.mesh.count > 0
  }

  /**
   * @param rain 0..1, 0 when it isn't raining or not in cockpit view (drops dry off).
   * @param speed car speed, m/s: airflow streams drops back and up the screen.
   */
  update(camera: THREE.PerspectiveCamera, rain: number, speed: number, dt: number): void {
    // Landing rate: a steady patter, more at speed (driving into the rain).
    this.debt += rain * (6 + speed * 0.25) * dt
    while (this.debt >= 1) {
      this.debt -= 1
      let d: Drop | null = null
      for (const drop of this.drops) if (drop.age >= drop.life) { d = drop; break }
      if (!d) break
      d.x = Math.random() * 2 - 1
      d.y = Math.random() * 2 - 1
      d.size = 0.012 + Math.random() * 0.03
      d.age = 0
      d.life = 1.5 + Math.random() * 2.5
    }
    camera.updateMatrixWorld()
    // Lay them out on a plane DISTANCE in front of the lens, in screen units.
    const h = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * DISTANCE
    const w = h * camera.aspect
    let n = 0
    for (const d of this.drops) {
      if (d.age >= d.life) continue
      d.age += dt
      // Gravity runs them down slowly; airflow pushes them up and out at speed.
      d.y += (-0.04 + Math.min(1, speed / 40) * 0.5) * dt
      d.x += d.x * Math.min(1, speed / 40) * 0.25 * dt
      if (Math.abs(d.x) > 1.05 || Math.abs(d.y) > 1.05) { d.life = 0; continue }
      const t = d.age / d.life
      _p.set(d.x * w, d.y * h, -DISTANCE).applyMatrix4(camera.matrixWorld)
      _m.compose(_p, camera.quaternion, _s.setScalar(d.size * DISTANCE * 4))
      this.mesh.setMatrixAt(n, _m)
      this.strength.setX(n, REFRACTION * Math.min(1, t * 8) * (1 - t * t))
      n++
    }
    this.mesh.count = n
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true
      this.strength.needsUpdate = true
    }
  }

  clear(): void {
    for (const d of this.drops) d.life = 0
    this.mesh.count = 0
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
