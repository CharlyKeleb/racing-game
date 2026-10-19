import { RAIN_SURFACE_GLSL, type RainSurfaceUniforms } from './RainSurface'
import * as THREE from 'three'
import { backend } from '../engine/backend'
import type { QualityPreset } from '../stores/gameStore'

/** Streaks drawn per preset (the box around the camera is the same; density changes). */
export const RAIN_STREAKS: Record<QualityPreset, number> = { low: 2200, medium: 4600, high: 7600 }
const MAX_STREAKS = RAIN_STREAKS.high
/** The box of rain that travels with the camera, metres (x, y, z). */
export const RAIN_BOX = new THREE.Vector3(44, 24, 44)
/** Raindrops fall at ~9 m/s; a breeze leans them. */
export const RAIN_FALL = new THREE.Vector3(1.2, -9.5, 0.6)
/** Streak length per m/s of apparent speed: a short photographic exposure. */
export const RAIN_EXPOSURE = 0.01
/** Streak width, metres. */
export const RAIN_WIDTH = 0.0018

const vertexShader = /* glsl */ `
  varying float vRainClearance;
  ${RAIN_SURFACE_GLSL}
  attribute vec4 aSeed; // xyz: position in the box, w: speed variation
  uniform float uTime;
  uniform vec3 uBox;
  uniform vec3 uFall;
  uniform vec3 uCameraVelocity;
  varying float vAlpha;
  varying float vBrightness;
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    // Each drop falls through a box that wraps around the camera: drops stay
    // put in the world while the camera moves, and there are always some near.
    vec3 fall = uFall * (0.8 + 0.4 * aSeed.w);
    vec3 drop = cameraPosition + mod(aSeed.xyz * uBox + fall * uTime - cameraPosition, uBox) - 0.5 * uBox;
    // Slow, coherent wind drift; never randomise drops from frame to frame.
    drop.x += sin(uTime * 0.7 + aSeed.z * 6.283) * 0.12;
    float dist = length(drop - cameraPosition);
    vec3 motion = -(fall - uCameraVelocity);
    float speed = max(length(motion), 0.001);
    float exposure = ${RAIN_EXPOSURE.toFixed(4)} * (0.55 + aSeed.w * 0.7);
    vec3 along = motion / speed * min(speed * exposure, 0.65);
    vec3 mid = drop + along * position.y;
    vec3 crossAxis = cross(along, mid - cameraPosition);
    vec3 side = crossAxis / max(length(crossAxis), 0.00001);
    // Subpixel distant drops use a wider, fainter footprint to avoid shimmer.
    float width = max(${RAIN_WIDTH.toFixed(4)} * (0.65 + aSeed.w * 0.7), dist * 0.00012);
    vec3 world = mid + side * width * position.x * 2.0;
    float nearFade = smoothstep(0.8, 2.5, dist);
    float farFade = 1.0 - smoothstep(12.0, 22.0, dist);
    vAlpha = nearFade * farFade * (0.07 + 0.15 * aSeed.w) * min(1.0, 0.002 / width);
    vBrightness = 0.55 + 0.25 * aSeed.y;
    vRainClearance = uRainReady > .5 ? world.y-rainHeight(world.xz) : 100.;
    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const fragmentShader = /* glsl */ `
  varying float vAlpha;
  varying vec2 vUv;
  varying float vBrightness;
  varying float vRainClearance;
  #include <fog_pars_fragment>
  void main() {
    // Thin bright core across, fading toward both ends.
    float x = abs(vUv.x - 0.5) * 2.0;
    float across = 1.0 - smoothstep(0.15, 1.0, x);
    float along = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
    float a = across * along * vAlpha;
    if (vRainClearance < .025) discard;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vec3(0.64, 0.69, 0.73) * vBrightness, a);
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

  constructor(surface?: RainSurfaceUniforms) {
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
    plane.dispose()
    if (backend.nodes) {
      const node = backend.nodes.rainMaterial(surface)
      this.material = node.material
      this.uniforms = node.uniforms
    } else {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
          ...(surface ?? {
            uRainSurface: { value: null }, uRainBounds: { value: new THREE.Vector4(0, 0, 0, 52) }, uRainReady: { value: 0 },
          }),
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
    dt = Math.max(0, Math.min(dt, 0.05))
    this.uniforms.time.value += dt
    geo.instanceCount = Math.round(this.streaks * THREE.MathUtils.clamp(intensity, 0, 1))
    // Camera velocity (smoothed), for streaks that lean into the motion.
    const v = this.uniforms.cameraVelocity.value
    if (this.hasLast && dt > 0) {
      const dx = camera.position.x - this.lastCamera.x
      const dy = camera.position.y - this.lastCamera.y
      const dz = camera.position.z - this.lastCamera.z
      // Reject the raw jump before smoothing; a cut must not leave a velocity tail.
      if (dx * dx + dy * dy + dz * dz > Math.pow(120 * dt, 2)) v.set(0, 0, 0)
      else {
        const k = 1 - Math.exp(-dt * 10)
        v.x += (dx / dt - v.x) * k
        v.y += (dy / dt - v.y) * k
        v.z += (dz / dt - v.z) * k
      }
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
