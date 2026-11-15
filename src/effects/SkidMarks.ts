import * as THREE from 'three'
import { backend } from '../engine/backend'
import type { AnyRenderer } from '../engine/Renderer'
import type { QualityPreset } from '../stores/gameStore'
import { surfaceProps } from '../vehicles/Surface'
import type { WheelState } from '../vehicles/VehicleController'
import { TILE_COUNT, TILE_SIZE, skidPaint, tileSlot } from './SkidPaint'

const MIN_SLIDE = 1.2
const MIN_SEGMENT = .15
const MAX_SEGMENT = 4
const MAX_WHEELS = 4
interface Trail { active: boolean; loose: boolean; center: THREE.Vector3; left: THREE.Vector3; right: THREE.Vector3; edges: boolean }
const _side = new THREE.Vector3(), _left = new THREE.Vector3(), _right = new THREE.Vector3()

/** GPU-painted surface history. Geometry holds ONLY this frame's four wheel stamps. */
export class SkidMarks {
  readonly target = new THREE.WebGLRenderTarget(1024, 1024, {
    type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  })
  private readonly trails: Trail[] = Array.from({ length: MAX_WHEELS }, () => ({ active: false, loose: false, center: new THREE.Vector3(), left: new THREE.Vector3(), right: new THREE.Vector3(), edges: false }))
  private readonly ownersX = new Float64Array(TILE_COUNT * TILE_COUNT).fill(Infinity)
  private readonly ownersZ = new Float64Array(TILE_COUNT * TILE_COUNT).fill(Infinity)
  private readonly positions = new THREE.BufferAttribute(new Float32Array(MAX_WHEELS * 12), 3).setUsage(THREE.DynamicDrawUsage)
  private readonly values = new THREE.BufferAttribute(new Float32Array(MAX_WHEELS * 12), 3).setUsage(THREE.DynamicDrawUsage)
  private readonly stampScene = new THREE.Scene()
  private readonly fadeScene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly bounds = { value: new THREE.Vector2() }
  private readonly decay = { value: new THREE.Vector2(1, 1) }
  private readonly stamp: THREE.Mesh
  private readonly fade: THREE.Mesh
  private readonly clearColor = new THREE.Color()
  private readonly viewport = new THREE.Vector4()
  private readonly scissor = new THREE.Vector4()
  private readonly stampBounds = new THREE.Box2()
  private count = 0
  private tilePixels = 256
  private dirty = true
  private elapsed = Infinity
  private dt = 0

  constructor() {
    this.target.texture.name = 'skids:rubber-height-ruts'
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', this.positions)
    geometry.setAttribute('aPaint', this.values)
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(MAX_WHEELS * 8), 2))
    const index: number[] = []
    for (let i = 0; i < MAX_WHEELS; i++) {
      const v = i * 4
      index.push(v, v + 1, v + 2, v + 2, v + 1, v + 3)
      ;(geometry.getAttribute('uv') as THREE.BufferAttribute).array.set([0, 0, 1, 0, 0, 1, 1, 1], i * 8)
    }
    geometry.setIndex(index)
    const materials = backend.nodes ? backend.nodes.skidPaintMaterials(this.bounds, this.decay) : {
      stamp: new THREE.ShaderMaterial({
        uniforms: { uTile: this.bounds }, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
        vertexShader: `uniform vec2 uTile; attribute vec3 aPaint; varying vec3 vPaint; varying vec2 vUv;
          void main(){vPaint=vec3(aPaint.x,position.y,aPaint.z);vUv=uv;
          gl_Position=vec4((position.xz-uTile)/32.*2.-1.,0.,1.);}`,
        fragmentShader: `varying vec3 vPaint; varying vec2 vUv; void main(){
          float edge=smoothstep(0.,.12,vUv.x)*(1.-smoothstep(.88,1.,vUv.x));
          gl_FragColor=vec4(vPaint.x*edge,vPaint.y,vPaint.z*edge,1.);}`,
      }),
      fade: new THREE.ShaderMaterial({
        uniforms: { uDecay: this.decay }, depthTest: false, depthWrite: false, toneMapped: false,
        vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}',
        fragmentShader: 'uniform vec2 uDecay; void main(){gl_FragColor=vec4(uDecay.x,1.,uDecay.y,1.);}',
      }),
    }
    // Multiplication in the blend unit fades intensity without reading/copying the atlas.
    materials.fade.transparent = true
    materials.fade.blending = THREE.CustomBlending
    materials.fade.blendSrc = THREE.ZeroFactor
    materials.fade.blendDst = THREE.SrcColorFactor
    materials.fade.blendSrcAlpha = THREE.ZeroFactor
    materials.fade.blendDstAlpha = THREE.OneFactor
    this.stamp = new THREE.Mesh(geometry, materials.stamp)
    this.fade = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), materials.fade)
    this.stamp.frustumCulled = this.fade.frustumCulled = false
    this.stampScene.add(this.stamp); this.fadeScene.add(this.fade)
    skidPaint.uSkidPaint.value = this.target.texture
    backend.nodes?.setSkidPaintTexture(this.target.texture)
  }

  setQuality(quality: QualityPreset): void {
    const pixels = quality === 'low' ? 256 : quality === 'medium' ? 384 : 512
    if (pixels === this.tilePixels) return
    this.tilePixels = pixels
    this.target.setSize(pixels * TILE_COUNT, pixels * TILE_COUNT)
    this.clear()
  }

  update(wheels: readonly WheelState[], dt: number): void {
    this.dt += Math.max(0, dt)
    this.elapsed += Math.max(0, dt)
    this.count = 0
    this.stampBounds.makeEmpty()
    for (let i = 0; i < Math.min(wheels.length, MAX_WHEELS); i++) {
      const w = wheels[i], trail = this.trails[i]
      const loose = surfaceProps(w.surface).loose
      if (!w.grounded || (!loose && w.slide < MIN_SLIDE)) { trail.active = false; continue }
      const p = w.contactPoint
      if (!trail.active || trail.loose !== (loose > 0)) {
        trail.active = true; trail.edges = false; trail.loose = loose > 0; trail.center.copy(p); continue
      }
      const dx = p.x - trail.center.x, dz = p.z - trail.center.z, length = Math.hypot(dx, dz)
      if (length < MIN_SEGMENT) continue
      if (length > MAX_SEGMENT || Math.abs(p.y - trail.center.y) > 2) { trail.edges = false; trail.center.copy(p); continue }
      _side.set(-dz / length, 0, dx / length).multiplyScalar(w.cfg.width * .45)
      if (!trail.edges) { trail.left.copy(trail.center).add(_side); trail.right.copy(trail.center).sub(_side); trail.edges = true }
      _left.copy(p).add(_side); _right.copy(p).sub(_side)
      const strength = loose ? .6 * loose * Math.min(1, .6 + w.slide / 8) : .55 * Math.min(1, .2 + .8 * (w.slide - MIN_SLIDE) / (8 - MIN_SLIDE))
      const offset = this.count * 12
      trail.left.toArray(this.positions.array, offset); trail.right.toArray(this.positions.array, offset + 3)
      _left.toArray(this.positions.array, offset + 6); _right.toArray(this.positions.array, offset + 9)
      for (let v = 0; v < 4; v++) {
        this.values.setXYZ(this.count * 4 + v, loose ? 0 : strength, 0, loose ? strength : 0)
        const x = this.positions.array[offset + v * 3], z = this.positions.array[offset + v * 3 + 2]
        this.stampBounds.min.x = Math.min(this.stampBounds.min.x, x); this.stampBounds.min.y = Math.min(this.stampBounds.min.y, z)
        this.stampBounds.max.x = Math.max(this.stampBounds.max.x, x); this.stampBounds.max.y = Math.max(this.stampBounds.max.y, z)
      }
      this.count++; this.elapsed = 0
      trail.center.copy(p); trail.left.copy(_left); trail.right.copy(_right)
    }
    this.positions.needsUpdate = this.values.needsUpdate = this.count > 0
    this.stamp.geometry.setDrawRange(0, this.count * 6)
  }

  /** Called before the main scene draw; nothing is drawn while the history is empty. */
  render(renderer: AnyRenderer, position: THREE.Vector3): void {
    if (!this.dirty && this.elapsed > 60 && !this.count) { this.dt = 0; return }
    const minX = Math.floor(position.x / TILE_SIZE) - 2, minZ = Math.floor(position.z / TILE_SIZE) - 2
    const target = renderer.getRenderTarget(), autoClear = renderer.autoClear
    const alpha = renderer.getClearAlpha(), scissorTest = renderer.getScissorTest()
    renderer.getClearColor(this.clearColor); renderer.getViewport(this.viewport); renderer.getScissor(this.scissor)
    try {
      renderer.autoClear = false
      renderer.setRenderTarget(this.target)
      renderer.setClearColor(0, 0)
      this.target.scissorTest = false
      renderer.setScissorTest(false)
      this.target.viewport.set(0, 0, this.target.width, this.target.height)
      renderer.setViewport(this.target.viewport)
      if (this.dirty) renderer.clear()
      else if (this.dt > 0) {
        this.decay.value.set(Math.exp(-this.dt / 6), Math.exp(-this.dt / 11))
        renderer.render(this.fadeScene, this.camera)
      }
      this.target.scissorTest = true
      renderer.setScissorTest(true)
      for (let z = minZ; z < minZ + TILE_COUNT; z++) for (let x = minX; x < minX + TILE_COUNT; x++) {
        const slot = tileSlot(x, z), px = slot % TILE_COUNT * this.tilePixels, py = Math.floor(slot / TILE_COUNT) * this.tilePixels
        this.target.viewport.set(px, py, this.tilePixels, this.tilePixels)
        this.target.scissor.copy(this.target.viewport)
        renderer.setViewport(this.target.viewport)
        renderer.setScissor(px, py, this.tilePixels, this.tilePixels)
        if (this.ownersX[slot] !== x || this.ownersZ[slot] !== z) {
          if (!this.dirty) {
            // WebGPU render-pass clears ignore scissors: draw a zero multiplier instead.
            this.decay.value.set(0, 0)
            renderer.render(this.fadeScene, this.camera)
          }
          this.ownersX[slot] = x; this.ownersZ[slot] = z
        }
        if (!this.count || this.stampBounds.max.x < x * TILE_SIZE || this.stampBounds.min.x > (x + 1) * TILE_SIZE
          || this.stampBounds.max.y < z * TILE_SIZE || this.stampBounds.min.y > (z + 1) * TILE_SIZE) continue
        this.bounds.value.set(x * TILE_SIZE, z * TILE_SIZE)
        renderer.render(this.stampScene, this.camera)
      }
      skidPaint.uSkidBounds.value.set(minX * TILE_SIZE, minZ * TILE_SIZE)
      skidPaint.uSkidReady.value = 1
      this.dirty = false; this.count = 0; this.dt = 0
    } finally {
      renderer.setRenderTarget(target as THREE.WebGLRenderTarget | null)
      renderer.setViewport(this.viewport); renderer.setScissor(this.scissor); renderer.setScissorTest(scissorTest)
      renderer.setClearColor(this.clearColor, alpha); renderer.autoClear = autoClear
    }
  }

  clear(): void {
    this.dirty = true; this.count = 0; this.dt = 0; this.elapsed = Infinity
    this.ownersX.fill(Infinity); this.ownersZ.fill(Infinity)
    skidPaint.uSkidReady.value = 0
    for (const trail of this.trails) trail.active = false
  }
  dispose(): void {
    if (skidPaint.uSkidPaint.value === this.target.texture) skidPaint.uSkidReady.value = 0
    this.target.dispose()
    for (const mesh of [this.stamp, this.fade]) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose() }
  }
}
