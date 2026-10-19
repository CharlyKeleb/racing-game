import * as THREE from 'three'
import { backend } from '../engine/backend'
import type { Vehicle } from '../vehicles/Vehicle'
import { defaultExhausts } from './NitroFlames'

/** Puffs per exhaust: a short column of hot air trailing back from the tip. */
const PUFFS = 3
const MAX_CARS = 8
const MAX_EXHAUSTS = 2
const COUNT = MAX_CARS * MAX_EXHAUSTS * PUFFS
/** Puff diameter (m) at the pipe and at the end of the column. */
const SIZE_NEAR = 0.32
const SIZE_FAR = 0.85
/** Peak image offset in UV units (~4 px at 1080p): a shimmer, not a smear. */
export const HAZE_STRENGTH = 0.0035
/** Nobody sees haze off a car further than this from the camera (m). */
const MAX_DISTANCE = 45

/**
 * How hot the air behind the pipes is, 0..~1.6 (#56): strong idling on the
 * grid (slow exhaust gas pools behind the car), faint once cruising (the
 * airflow sweeps it away), lifted by throttle at low speed and most of all
 * by nitro.
 *
 * @param speed m/s, @param throttle pedal 0..1, @param nitro boost 0..1+
 */
export function hazeIntensity(speed: number, throttle: number, nitro: number): number {
  const still = 1 - smoothstep(2, 20, speed)
  const base = 0.2 + 0.6 * still
  const revs = 0.25 * throttle * (1 - smoothstep(10, 40, speed))
  return Math.min(1.6, base + revs + 0.9 * Math.max(0, nitro))
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

const vertexShader = /* glsl */ `
  attribute float aStrength;
  attribute float aSeed;
  varying vec2 vUv;
  varying float vStrength;
  varying float vSeed;
  void main() {
    vUv = uv;
    vSeed = aSeed;
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    // Same shimmer in pixels near or far: offsets are in screen UV, so ease them off with distance.
    vStrength = aStrength * clamp(6.0 / max(-mv.z, 1.0), 0.25, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`

const fragmentShader = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying float vStrength;
  varying float vSeed;
  void main() {
    vec2 d = vUv - 0.5;
    float fall = 1.0 - smoothstep(0.12, 0.5, length(d));
    // Rising, wavering ripples: two out-of-phase waves give a signed offset field.
    float t = uTime + vSeed * 7.0;
    vec2 off = vec2(
      sin(vUv.y * 17.0 - t * 9.0 + sin(vUv.x * 6.0 + t * 2.0)),
      cos(vUv.x * 13.0 + vUv.y * 7.0 - t * 7.0)
    );
    gl_FragColor = vec4(off * fall * vStrength, 0.0, 1.0);
  }
`

const _m = new THREE.Matrix4()
const _p = new THREE.Vector3()
const _tip = new THREE.Vector3()
const _back = new THREE.Vector3()
const _toCam = new THREE.Vector3()
const _s = new THREE.Vector3()

/**
 * Heat haze behind the exhausts (#56). Camera-facing puffs trailing each
 * car's exhaust tips render into a small signed distortion buffer
 * (`scene`, drawn by the post stack at half resolution); the post stack then
 * offsets the image by it. One instanced draw for every car. Post FX off: no
 * haze.
 */
export class HeatHaze {
  /** Drawn into the distortion buffer, not the main scene. */
  readonly scene = new THREE.Scene()
  private readonly mesh: THREE.InstancedMesh
  private readonly strength: THREE.InstancedBufferAttribute
  private readonly time: { value: number }
  private readonly material: THREE.Material
  private readonly tips = new WeakMap<Vehicle, readonly [number, number, number][]>()
  /** Any puff drawn this frame: the post stack skips the pass when not. */
  active = false

  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1)
    this.strength = new THREE.InstancedBufferAttribute(new Float32Array(COUNT), 1).setUsage(THREE.DynamicDrawUsage)
    const seeds = new Float32Array(COUNT)
    for (let i = 0; i < COUNT; i++) seeds[i] = Math.random()
    geo.setAttribute('aStrength', this.strength)
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1))
    if (backend.nodes) {
      const node = backend.nodes.hazeMaterial()
      this.material = node.material
      this.time = node.time
    } else {
      const material = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader,
        fragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      })
      this.material = material
      this.time = material.uniforms.uTime
    }
    this.mesh = new THREE.InstancedMesh(geo, this.material, COUNT)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    this.scene.add(this.mesh)
  }

  /** Lay out the puffs for this frame. `cars[0]` is the player; render-time, after the car meshes moved. */
  update(cars: readonly Vehicle[], camera: THREE.Camera, dt: number): void {
    this.time.value += dt
    let n = 0
    for (let c = 0; c < cars.length && c < MAX_CARS; c++) {
      const car = cars[c]
      const body = car.model.body
      body.updateWorldMatrix(true, false)
      const v = car.body.linvel()
      const speed = Math.hypot(v.x, v.z)
      const ctrl = car.controller
      const heat = hazeIntensity(speed, ctrl.throttlePedal, ctrl.nitro.intensity)
      _back.setFromMatrixColumn(body.matrixWorld, 2).normalize().negate()
      const tips = this.tipsFor(car)
      for (let e = 0; e < tips.length && e < MAX_EXHAUSTS; e++) {
        const tip = tips[e]
        _tip.set(tip[0], tip[1], tip[2]).applyMatrix4(body.matrixWorld)
        _toCam.subVectors(camera.position, _tip)
        const distance = _toCam.length()
        if (distance > MAX_DISTANCE) continue
        // The buffer has no depth: from in front of the car, the pipes are
        // hidden behind it, so fade the haze out rather than ripple the bodywork.
        const behind = smoothstep(-0.2, 0.35, _toCam.dot(_back) / distance)
        const strength = heat * behind * (1 - smoothstep(MAX_DISTANCE * 0.6, MAX_DISTANCE, distance))
        if (strength < 0.02) continue
        // At speed the hot air is left behind: the column stretches back.
        const stretch = 1 + speed * 0.06
        for (let k = 0; k < PUFFS; k++) {
          const f = k / (PUFFS - 1)
          _p.copy(_tip).addScaledVector(_back, (0.12 + f * 0.6) * stretch)
          _p.y += f * 0.12
          const size = SIZE_NEAR + (SIZE_FAR - SIZE_NEAR) * f
          _m.compose(_p, camera.quaternion, _s.setScalar(size))
          this.mesh.setMatrixAt(n, _m)
          this.strength.setX(n, strength * (1 - 0.35 * f))
          n++
        }
      }
    }
    this.mesh.count = n
    this.active = n > 0
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true
      this.strength.needsUpdate = true
    }
  }

  /** Exhaust tips in body space, worked out once per car. */
  private tipsFor(car: Vehicle): readonly [number, number, number][] {
    let tips = this.tips.get(car)
    if (!tips) this.tips.set(car, (tips = car.config.exhausts ?? defaultExhausts(car.config)))
    return tips
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
