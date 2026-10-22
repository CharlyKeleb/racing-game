import * as THREE from 'three'
import type { WetReflectionUniforms } from './WetReflections'
import { backend } from '../engine/backend'
import { RAIN_SURFACE_GLSL, type RainSurfaceUniforms } from './RainSurface'

export const WET_ROAD_GLSL = `
float rainPuddle(vec2 p) {
  float n=sin(p.x*.19+sin(p.y*.11))*sin(p.y*.24+sin(p.x*.17))*.5+.5;
  return smoothstep(.62,.82,n);
}
vec2 rainRipple(vec2 p) {
  vec2 cell=floor(p*1.7);
  float hash=fract(sin(dot(cell,vec2(127.1,311.7)))*43758.5453);
  vec2 center=(cell+vec2(.25+hash*.5,.25+fract(hash*7.13)*.5))/1.7;
  vec2 delta=p-center;
  float d=length(delta);
  float age=fract(uRainTime*.85+hash);
  float ring=1.-smoothstep(.012,.045,abs(d-age*.28));
  return delta/max(d,.001)*ring*cos((d-age*.28)*100.)*(1.-age)*.065;
}
`

/** Owns only shader wrappers/node copies, never the track's shared maps or geometry. */
export class WetRoads {
  private readonly materials = new Map<THREE.Material, THREE.Material>()
  private readonly originals = new Map<THREE.Material, { compile: THREE.Material['onBeforeCompile']; key: THREE.Material['customProgramCacheKey'] }>()
  private readonly meshes = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
  private elapsed = Infinity
  private root: THREE.Object3D | null = null
  private readonly surface: RainSurfaceUniforms
  private readonly reflection?: WetReflectionUniforms
  constructor(surface: RainSurfaceUniforms, reflection?: WetReflectionUniforms) { this.surface = surface; this.reflection = reflection }

  update(root: THREE.Object3D, wet: number, dt: number): void {
    this.elapsed += dt
    if (!wet || (this.root === root && this.elapsed < .2)) return
    if (this.root !== root) { this.releaseMaterials(); this.root = root }
    this.elapsed = 0
    root.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return
      const original = node.material
      const swap = (source: THREE.Material): THREE.Material => {
        const layer = source.userData.layer
        if (layer !== 'road' && !/asphalt|tarmac|road/i.test(source.name)) return source
        if (this.materials.has(source)) return this.materials.get(source)!
        if (this.originals.has(source)) return source
        if (backend.nodes && (source instanceof THREE.MeshStandardMaterial || (source as THREE.Material & { isMeshStandardNodeMaterial?: boolean }).isMeshStandardNodeMaterial)) {
          const material = backend.nodes.wetRoadMaterial(source as THREE.MeshStandardMaterial, this.surface, this.reflection)
          this.materials.set(source, material)
          this.materials.set(material, material)
          return material
        }
        const previous = { compile: source.onBeforeCompile, key: source.customProgramCacheKey }
        this.originals.set(source, previous)
        source.onBeforeCompile = (shader, renderer) => {
          previous.compile.call(source, shader, renderer)
          Object.assign(shader.uniforms, this.surface)
          if (this.reflection && (source instanceof THREE.MeshStandardMaterial || source instanceof THREE.MeshLambertMaterial)) {
            Object.assign(shader.uniforms, this.reflection)
            shader.fragmentShader = `uniform sampler2D uWetReflection;
              uniform mat4 uWetReflectionMatrix; uniform vec4 uWetReflectionPlane;
              uniform float uWetReflectionReady;
` + shader.fragmentShader
            shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
              vec4 reflectedCoord=uWetReflectionMatrix*vec4(vRainRoadWorld,1.);
              vec2 reflectedUv=reflectedCoord.xy/max(reflectedCoord.w,.0001)+rainRipple(vRainRoadWorld.xz)*rainPool*.018;
              float reflectedValid=step(0.,reflectedUv.x)*step(reflectedUv.x,1.)*step(0.,reflectedUv.y)*step(reflectedUv.y,1.)*step(.001,reflectedCoord.w);
              float planeFade=1.-smoothstep(.08,.4,abs(dot(uWetReflectionPlane,vec4(vRainRoadWorld,1.))));
              float fresnel=.04+.96*pow(1.-abs(dot(normal,normalize(vViewPosition))),5.);
              float reflectionWeight=rainPool*planeFade*reflectedValid*uWetReflectionReady*mix(.1,.5,fresnel);
              outgoingLight=mix(outgoingLight,texture2D(uWetReflection,clamp(reflectedUv,0.,1.)).rgb*.55,reflectionWeight);
              #include <opaque_fragment>`)
          }
          shader.vertexShader = 'varying vec3 vRainRoadWorld;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRainRoadWorld=(modelMatrix*vec4(position,1.)).xyz;')
          shader.fragmentShader = 'varying vec3 vRainRoadWorld;\n' + RAIN_SURFACE_GLSL + WET_ROAD_GLSL + shader.fragmentShader
          shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
            float rainWet=rainExposed(vRainRoadWorld)*uRainWet;
            float rainPool=rainPuddle(vRainRoadWorld.xz)*rainWet;
            diffuseColor.rgb*=mix(1.,mix(.78,.64,rainPool),rainWet);`)
          if (source instanceof THREE.MeshStandardMaterial) {
            shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
              roughnessFactor=mix(roughnessFactor,min(roughnessFactor,.55),rainWet);
              roughnessFactor=mix(roughnessFactor,.3,rainPool);`)
            shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
              vec2 ripple=rainRipple(vRainRoadWorld.xz)*rainPool;
              normal=normalize(normal+mat3(viewMatrix)*vec3(ripple.x,0.,ripple.y));`)
          }
        }
        source.customProgramCacheKey = () => previous.key.call(source) + ':wet-road-v2:' + Boolean(this.reflection)
        source.needsUpdate = true
        return source
      }
      const next = Array.isArray(original) ? original.map(swap) : swap(original)
      if (next !== original && !this.meshes.has(node)) this.meshes.set(node, original)
      node.material = next
    })
  }
  private restore(): void {
    for (const [mesh, material] of this.meshes) mesh.material = material
    this.meshes.clear()
  }
  private releaseMaterials(): void {
    this.restore()
    for (const [material, previous] of this.originals) {
      material.onBeforeCompile = previous.compile
      material.customProgramCacheKey = previous.key
      material.needsUpdate = true
    }
    for (const material of new Set(this.materials.values())) material.dispose()
    this.materials.clear(); this.originals.clear()
  }
  dispose(): void { this.releaseMaterials(); this.root = null }
}
