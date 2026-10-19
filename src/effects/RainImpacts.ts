import * as THREE from 'three'
import { backend } from '../engine/backend'
import { RAIN_SURFACE_GLSL, type RainSurfaceUniforms } from './RainSurface'
import type { QualityPreset } from '../stores/gameStore'

export const IMPACT_COUNTS: Record<QualityPreset, number> = { low: 240, medium: 560, high: 960 }

/** Short, sparse splash crowns on the topmost exposed geometry, including slopes and roofs. */
export class RainImpacts {
  readonly mesh: THREE.Mesh
  constructor(surface: RainSurfaceUniforms) {
    const plane = new THREE.PlaneGeometry(1, 1)
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.index = plane.index
    geometry.setAttribute('position', plane.getAttribute('position'))
    geometry.setAttribute('uv', plane.getAttribute('uv'))
    plane.dispose()
    const seeds = new Float32Array(IMPACT_COUNTS.high * 4)
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random()
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4))
    geometry.instanceCount = IMPACT_COUNTS.medium
    const material = backend.nodes ? backend.nodes.rainImpactMaterial(surface) : new THREE.ShaderMaterial({
      uniforms: { ...surface, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) }, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
      vertexShader: `${RAIN_SURFACE_GLSL}
        attribute vec4 aSeed; varying vec2 vUv; varying float vAlpha;
        #include <fog_pars_vertex>
        void main() {
          vUv=uv;
          vec2 xz=uRainBounds.xz+mod(aSeed.xy*32.-uRainBounds.xz+16.,32.)-16.;
          float age=fract(uRainTime*(1.4+aSeed.w)+aSeed.z);
          float h=rainHeight(xz);
          float e=.22;
          vec3 normal=normalize(vec3(rainHeight(xz-vec2(e,0.))-rainHeight(xz+vec2(e,0.)),2.*e,rainHeight(xz-vec2(0.,e))-rainHeight(xz+vec2(0.,e))));
          vec3 center=vec3(xz.x,h,xz.y);
          vec3 toCamera=cameraPosition-center;
          vec3 tangent=normalize(cross(normal, normalize(toCamera)+vec3(.001,0.,0.)));
          float width=.05+age*.18;
          float height=.025+sin(age*3.14159)*.07;
          vec3 world=center+normal*.012+tangent*position.x*width+normal*(position.y+.5)*height;
          vAlpha=(1.-age)*(1.-age)*uRainWet*uRainReady*step(-.2,normal.y)*smoothstep(.2,1.,normal.y);
          vAlpha*=1.-smoothstep(9.,18.,length(toCamera));
          vec4 mvPosition=viewMatrix*vec4(world,1.);
          gl_Position=projectionMatrix*mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `varying vec2 vUv; varying float vAlpha;
        #include <fog_pars_fragment>
        void main(){
          float x=abs(vUv.x-.5)*2.;
          float crown=.18+.65*pow(abs(sin(vUv.x*15.708)),3.);
          float a=(1.-smoothstep(.04,.16,abs(vUv.y-crown)))*(1.-x*x)*vAlpha*.32;
          if(a<.005)discard;
          gl_FragColor=vec4(.55,.61,.64,a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    })
    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 3
    this.mesh.visible = false
  }
  setQuality(quality: QualityPreset): void { (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = IMPACT_COUNTS[quality] }
  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose() }
}
