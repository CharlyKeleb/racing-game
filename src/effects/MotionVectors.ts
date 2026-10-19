import * as THREE from 'three'
import { backend } from '../engine/backend'
import type { AnyRenderer } from '../engine/Renderer'

export interface MotionUniforms {
  previous: { value: THREE.Matrix4 }
  previousViewProjection: { value: THREE.Matrix4 }
  sharp: { value: number }
}
interface Entry {
  mesh: THREE.Mesh
  original: THREE.Material | THREE.Material[]
  material: THREE.Material | THREE.Material[]
  uniforms: MotionUniforms
  layers: number
  frame: number
}

/** Signed UV velocity, protected-player mask, and linear depth. Opaque geometry only. */
export class MotionVectors {
  readonly target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter })
  private readonly entries = new Map<THREE.Mesh, Entry>()
  private readonly previousVP = new THREE.Matrix4()
  private readonly currentVP = new THREE.Matrix4()
  private readonly previousPosition = new THREE.Vector3()
  private readonly previousRotation = new THREE.Quaternion()
  private readonly clear = new THREE.Color()
  private frame = 0
  private valid = false
  private player: THREE.Object3D | null = null

  setSize(w: number, h: number): void { this.target.setSize(Math.max(1, w), Math.max(1, h)); this.valid = false }
  reset(): void { this.valid = false }

  capture(renderer: AnyRenderer, scene: THREE.Scene, camera: THREE.Camera, player: THREE.Object3D | null): boolean {
    scene.updateMatrixWorld()
    camera.updateMatrixWorld()
    this.currentVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    const ready = this.valid && this.player === player && camera.position.distanceToSquared(this.previousPosition) < 400 && Math.abs(camera.quaternion.dot(this.previousRotation)) > .85
    this.player = player
    this.frame++
    const cameraLayers = camera.layers.mask
    const background = scene.background
    const override = scene.overrideMaterial
    const target = renderer.getRenderTarget()
    const alpha = renderer.getClearAlpha()
    const autoClear = renderer.autoClear
    const shadows = 'autoUpdate' in renderer.shadowMap ? renderer.shadowMap.autoUpdate : false
    renderer.getClearColor(this.clear)
    try {
      scene.traverse(this.prepare)
      camera.layers.set(30)
      scene.background = null
      scene.overrideMaterial = null
      if ('autoUpdate' in renderer.shadowMap) renderer.shadowMap.autoUpdate = false
      renderer.autoClear = true
      renderer.setRenderTarget(this.target)
      renderer.setClearColor(0x000000, 1)
      renderer.clear()
      renderer.render(scene, camera)
    } finally {
      for (const [mesh, entry] of this.entries) {
        if (entry.frame !== this.frame) {
          this.disposeEntry(entry)
          this.entries.delete(mesh)
          continue
        }
        mesh.material = entry.original
        mesh.layers.mask = entry.layers
        entry.uniforms.previous.value.copy(mesh.matrixWorld)
      }
      camera.layers.mask = cameraLayers
      scene.background = background
      scene.overrideMaterial = override
      renderer.setRenderTarget(target as THREE.WebGLRenderTarget | null)
      renderer.setClearColor(this.clear, alpha)
      renderer.autoClear = autoClear
      if ('autoUpdate' in renderer.shadowMap) renderer.shadowMap.autoUpdate = shadows
    }
    this.previousVP.copy(this.currentVP)
    this.previousPosition.copy(camera.position)
    this.previousRotation.copy(camera.quaternion)
    this.valid = true
    return ready
  }

  private prepare = (object: THREE.Object3D): void => {
    if (!(object instanceof THREE.Mesh)) return
    let sharp = 0
    for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) {
      if (parent === this.player) { sharp = 1; break }
    }
    let entry = this.entries.get(object)
    if (entry && entry.original !== object.material) {
      this.disposeEntry(entry)
      this.entries.delete(object)
      entry = undefined
    }
    if (!entry) {
      const uniforms: MotionUniforms = { previous: { value: object.matrixWorld.clone() }, previousViewProjection: { value: this.previousVP }, sharp: { value: 0 } }
      const make = (source: THREE.Material) => {
        const material = backend.nodes ? backend.nodes.motionVectorMaterial(uniforms) : glMotionMaterial(uniforms)
        material.side = source.side
        material.visible = source.visible && (!source.transparent || sharp === 1)
        return material
      }
      entry = { mesh: object, original: object.material, material: Array.isArray(object.material) ? object.material.map(make) : make(object.material), uniforms, layers: object.layers.mask, frame: this.frame }
      this.entries.set(object, entry)
    }
    entry.frame = this.frame
    entry.layers = object.layers.mask
    entry.uniforms.sharp.value = sharp
    if (!this.valid) entry.uniforms.previous.value.copy(object.matrixWorld)
    object.material = entry.material
    object.layers.enable(30)
  }

  private disposeEntry(entry: Entry): void {
    if (Array.isArray(entry.material)) for (const material of entry.material) material.dispose()
    else entry.material.dispose()
  }
  dispose(): void { for (const entry of this.entries.values()) this.disposeEntry(entry); this.entries.clear(); this.target.dispose() }
}

function glMotionMaterial(u: MotionUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...u }, toneMapped: false,
    vertexShader: `
      #include <common>
      #include <batching_pars_vertex>
      uniform mat4 previous; uniform mat4 previousViewProjection;
      varying vec4 vCurrent; varying vec4 vPrevious; varying float vDepth;
      void main() {
        #include <batching_vertex>
        vec4 local = vec4(position, 1.);
        #ifdef USE_BATCHING
          local = batchingMatrix * local;
        #endif
        #ifdef USE_INSTANCING
          local = instanceMatrix * local;
        #endif
        vec4 view = viewMatrix * modelMatrix * local;
        vDepth = -view.z;
        vCurrent = projectionMatrix * view;
        vPrevious = previousViewProjection * previous * local;
        gl_Position = vCurrent;
      }`,
    fragmentShader: `
      uniform float sharp;
      varying vec4 vCurrent; varying vec4 vPrevious; varying float vDepth;
      void main() {
        vec2 motion = (vCurrent.xy / max(vCurrent.w, .001) - vPrevious.xy / max(vPrevious.w, .001)) * .5;
        gl_FragColor = vec4(motion * (1. - sharp), sharp, vDepth / 2000.);
      }`,
  })
}
