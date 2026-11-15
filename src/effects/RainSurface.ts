import * as THREE from 'three'
import { backend } from '../engine/backend'
import type { AnyRenderer } from '../engine/Renderer'
import type { QualityPreset } from '../stores/gameStore'

/** A local rain shadow map. Captures visible track roofs and roads, not a flat ground estimate. */
export class RainSurface {
  readonly target = new THREE.WebGLRenderTarget(256, 256, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true })
  readonly uniforms = {
    uRainSurface: { value: this.target.texture },
    uRainBounds: { value: new THREE.Vector4(0, 0, 0, 52) },
    uRainReady: { value: 0 }, uRainTime: { value: 0 }, uRainWet: { value: 0 },
  }
  private readonly camera = new THREE.OrthographicCamera(-26, 26, 26, -26, .1, 128)
  private readonly material: THREE.Material
  private readonly clearColor = new THREE.Color()
  private elapsed = Infinity
  private interval = .12
  private track: THREE.Object3D | null = null

  constructor() {
    this.target.texture.name = 'rain:surface-height'
    this.camera.up.set(0, 0, -1)
    this.camera.layers.set(31)
    this.material = backend.nodes ? backend.nodes.rainSurfaceMaterial(this.uniforms) : new THREE.ShaderMaterial({
      uniforms: this.uniforms, side: THREE.DoubleSide, toneMapped: false,
      vertexShader: `
        #include <common>
        #include <batching_pars_vertex>
        varying float vHeight; uniform vec4 uRainBounds;
        void main() {
          #include <batching_vertex>
          vec4 local = vec4(position,1.);
          #ifdef USE_BATCHING
            local=batchingMatrix*local;
          #endif
          #ifdef USE_INSTANCING
            local=instanceMatrix*local;
          #endif
          vec4 world = modelMatrix * local; vHeight = (world.y-uRainBounds.y)/128.+.5;
        gl_Position = projectionMatrix * viewMatrix * world; }`,
      fragmentShader: `varying float vHeight; void main() { gl_FragColor = vec4(vHeight,0.,0.,1.); }`,
    })
  }

  setQuality(quality: QualityPreset): void {
    const size = quality === 'low' || quality === 'medium' ? 128 : 256
    this.target.setSize(size, size)
    this.interval = quality === 'low' ? .2 : quality === 'medium' ? .12 : .08
    this.elapsed = Infinity
    this.uniforms.uRainReady.value = 0
  }

  update(renderer: AnyRenderer, scene: THREE.Scene, track: THREE.Object3D, camera: THREE.Camera, wet: number, dt: number): void {
    this.uniforms.uRainWet.value = wet
    this.uniforms.uRainTime.value += Math.max(0, Math.min(dt, .05))
    if (!wet) { this.elapsed = Infinity; this.uniforms.uRainReady.value = 0; return }
    this.elapsed += Math.max(0, dt)
    const bounds = this.uniforms.uRainBounds.value
    const moved = Math.hypot(camera.position.x - bounds.x, camera.position.z - bounds.z) > 8 || Math.abs(camera.position.y - bounds.y) > 12
    if (this.track === track && !moved && this.elapsed < this.interval) return
    this.track = track
    this.elapsed = 0
    // Streamed meshes arriving since the previous capture join the weather layer.
    track.traverse(node => { if (node instanceof THREE.Mesh) node.layers.enable(31) })
    bounds.set(Math.round(camera.position.x / 2) * 2, camera.position.y, Math.round(camera.position.z / 2) * 2, 52)
    this.camera.position.set(bounds.x, bounds.y + 64, bounds.z)
    this.camera.lookAt(bounds.x, bounds.y, bounds.z)
    this.camera.updateMatrixWorld(true)
    const target = renderer.getRenderTarget()
    const override = scene.overrideMaterial
    const background = scene.background
    const autoClear = renderer.autoClear
    const alpha = renderer.getClearAlpha()
    renderer.getClearColor(this.clearColor)
    try {
      scene.background = null
      scene.overrideMaterial = this.material
      renderer.autoClear = true
      renderer.setClearColor(0x000000, 0)
      renderer.setRenderTarget(this.target)
      renderer.clear()
      renderer.render(scene, this.camera)
      this.uniforms.uRainReady.value = 1
    } finally {
      renderer.setRenderTarget(target as THREE.WebGLRenderTarget | null)
      renderer.setClearColor(this.clearColor, alpha)
      renderer.autoClear = autoClear
      scene.overrideMaterial = override
      scene.background = background
    }
  }

  dispose(): void { this.target.dispose(); this.material.dispose() }
}
export type RainSurfaceUniforms = RainSurface['uniforms']

export const RAIN_SURFACE_GLSL = `
uniform sampler2D uRainSurface;
uniform vec4 uRainBounds;
uniform float uRainReady;
uniform float uRainWet;
uniform float uRainTime;
vec2 rainSurfaceUv(vec2 xz) { return vec2((xz.x-uRainBounds.x)/uRainBounds.w+.5, .5-(xz.y-uRainBounds.z)/uRainBounds.w); }
float rainHeight(vec2 xz) { return (texture2D(uRainSurface, rainSurfaceUv(xz)).r-.5)*128.+uRainBounds.y; }
float rainExposed(vec3 p) {
  vec2 uv = rainSurfaceUv(p.xz);
  float inside = step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);
  return mix(1.,step(rainHeight(p.xz)-.18,p.y),inside*uRainReady);
}
`
