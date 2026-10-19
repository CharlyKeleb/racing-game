import * as THREE from 'three'
import { backend } from '../engine/backend'
import type { QualityPreset } from '../stores/gameStore'

/** Streaks drawn per preset (the box around the camera is the same; density changes). */
export const RAIN_STREAKS: Record<QualityPreset, number> = { low: 2500, medium: 5000, high: 8000 }
const MAX_STREAKS = RAIN_STREAKS.high
/** The box of rain that travels with the camera, metres (x, y, z). */
export const RAIN_BOX = new THREE.Vector3(36, 22, 36)
/** Raindrops fall at ~9 m/s; a breeze leans them. */
export const RAIN_FALL = new THREE.Vector3(1.2, -9.5, 0.6)
/** Streak length per m/s of apparent speed: a ~1/70 s exposure. */
export const RAIN_EXPOSURE = 0.014
/** Streak width, metres. */
export const RAIN_WIDTH = 0.009

const vertexShader = /* glsl */ `
  attribute vec4 aSeed; // xyz: position in the box, w: speed variation
  uniform float uTime;
  uniform vec3 uBox;
  uniform vec3 uFall;
  uniform vec3 uCameraVelocity;
  varying float vAlpha;
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    // Each drop falls through a box that wraps around the camera: drops stay
    // put in the world while the camera moves, and there are always some near.
    vec3 fall = uFall * (0.85 + 0.3 * aSeed.w);
    vec3 drop = cameraPosition + mod(aSeed.xyz * uBox + fall * uTime - cameraPosition, uBox) - 0.5 * uBox;
    // Streak along the drop's motion as the camera sees it: the faster you
    // drive, the longer and flatter the streaks.
    vec3 along = -(fall - uCameraVelocity) * ${RAIN_EXPOSURE.toFixed(4)};
    vec3 mid = drop + along * (position.y + 0.5);
    vec3 side = normalize(cross(along, mid - cameraPosition)) * ${RAIN_WIDTH.toFixed(4)};
    vec3 world = mid + side * position.x * 2.0;
    // Fade near the lens and toward the edge of the box.
    float dist = length(drop - cameraPosition);
    vAlpha = smoothstep(0.6, 2.0, dist) * (1.0 - smoothstep(0.35, 0.5, dist / uBox.x));
    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const fragmentShader = /* glsl */ `
  varying float vAlpha;
  varying vec2 vUv;
  #include <fog_pars_fragment>
  void main() {
    // Thin bright core across, fading toward both ends.
    float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
    float along = sin(vUv.y * 3.14159);
    float a = across * along * vAlpha * 0.45;
    if (a < 0.004) discard;
    gl_FragColor = vec4(0.78, 0.84, 0.9, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

/**
 * Rain streaks around the camera (#53). Simulated in the vertex shader:
 * every streak is a seed in a box that wraps around the camera, so falling
 * costs no CPU and no buffer upload. Streaks are stretched along their
 * motion relative to the camera, so at speed they lean back and lengthen.
 * One instanced draw.
 */
export class Rain {
  readonly mesh: THREE.Mesh
  private readonly uniforms: {
    time: { value: number }
    cameraVelocity: { value: THREE.Vector3 }
  }
  private readonly material: THREE.Material
  private readonly lastCamera = new THREE.Vector3()
  private hasLast = false
  private streaks = RAIN_STREAKS.medium

  constructor() {
    const plane = new THREE.PlaneGeometry(1, 1)
    const geo = new THREE.InstancedBufferGeometry()
    geo.index = plane.index
    geo.setAttribute('position', plane.getAttribute('position'))
    geo.setAttribute('uv', plane.getAttribute('uv'))
    const seeds = new Float32Array(MAX_STREAKS * 4)
    for (let i = 0; i < MAX_STREAKS; i++) {
      seeds[i * 4] = Math.random()
      seeds[i * 4 + 1] = Math.random()
      seeds[i * 4 + 2] = Math.random()
      seeds[i * 4 + 3] = Math.random()
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4))
    geo.instanceCount = 0
    if (backend.nodes) {
      const node = backend.nodes.rainMaterial()
      this.material = node.material
      this.uniforms = node.uniforms
    } else {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
          uTime: { value: 0 },
          uBox: { value: RAIN_BOX.clone() },
          uFall: { value: RAIN_FALL.clone() },
          uCameraVelocity: { value: new THREE.Vector3() },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        fog: true,
      })
      this.material = material
      this.uniforms = { time: material.uniforms.uTime, cameraVelocity: material.uniforms.uCameraVelocity }
    }
    this.mesh = new THREE.Mesh(geo, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 4
    this.mesh.visible = false
  }

  setQuality(quality: QualityPreset): void {
    this.streaks = RAIN_STREAKS[quality]
  }

  /** `intensity` 0 (dry) .. 1 (full rain). Render-time, after the camera moved. */
  update(camera: THREE.Camera, intensity: number, dt: number): void {
    const geo = this.mesh.geometry as THREE.InstancedBufferGeometry
    this.mesh.visible = intensity > 0
    if (!this.mesh.visible) {
      this.hasLast = false
      return
    }
    this.uniforms.time.value += dt
    geo.instanceCount = Math.round(this.streaks * intensity)
    // Camera velocity (smoothed), for streaks that lean into the motion.
    const v = this.uniforms.cameraVelocity.value
    if (this.hasLast && dt > 0) {
      const k = 1 - Math.exp(-dt * 8)
      v.x += ((camera.position.x - this.lastCamera.x) / dt - v.x) * k
      v.y += ((camera.position.y - this.lastCamera.y) / dt - v.y) * k
      v.z += ((camera.position.z - this.lastCamera.z) / dt - v.z) * k
    } else {
      v.set(0, 0, 0)
    }
    // A respawn or a camera cut is a jump, not a velocity.
    if (v.lengthSq() > 120 * 120) v.set(0, 0, 0)
    this.lastCamera.copy(camera.position)
    this.hasLast = true
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
