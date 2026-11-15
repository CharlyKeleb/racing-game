import { SPLASH_GRAVITY, SPLASH_LIFT_MIN, SPLASH_LIFT_RANGE, SPLASH_AIR_DRAG } from './RainImpactPhysics'
import type { CarRainAnchors } from './CarRain'
import * as THREE from 'three'
import { backend } from '../engine/backend'
import { RAIN_SURFACE_GLSL, type RainSurfaceUniforms } from './RainSurface'
import type { QualityPreset } from '../stores/gameStore'

export const IMPACT_COUNTS: Record<QualityPreset, number> = { low: 480, medium: 1400, high: 2200, ultra: 2200 }

/** Short, sparse splash crowns on the topmost exposed geometry, including slopes and roofs. */
export class RainImpacts {
  readonly mesh: THREE.Mesh
  private readonly carCount: number | null
  constructor(surface: RainSurfaceUniforms, anchors?: CarRainAnchors) {
    this.carCount = anchors ? anchors.positions.length / 3 : null
    const plane = new THREE.PlaneGeometry(1, 1)
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.index = plane.index
    geometry.setAttribute('position', plane.getAttribute('position'))
    geometry.setAttribute('uv', plane.getAttribute('uv'))
    plane.dispose()
    if (anchors) {
      geometry.setAttribute('aAnchor', new THREE.InstancedBufferAttribute(anchors.positions, 3))
      geometry.setAttribute('aImpactNormal', new THREE.InstancedBufferAttribute(anchors.normals, 3))
    }
    const seeds = new Float32Array((this.carCount ?? IMPACT_COUNTS.high) * 4)
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random()
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4))
    geometry.instanceCount = this.carCount ?? IMPACT_COUNTS.medium
    const material = backend.nodes ? backend.nodes.rainImpactMaterial(surface, anchors) : new THREE.ShaderMaterial({
      defines: anchors ? { CAR_RAIN: 1 } : {},
      uniforms: { ...(anchors ? { uCarMatrix: anchors.matrix, uCarVelocity: anchors.velocity } : {}), ...surface, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) }, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
      vertexShader: `${RAIN_SURFACE_GLSL}
        #ifdef CAR_RAIN
          attribute vec3 aAnchor; attribute vec3 aImpactNormal; uniform mat4 uCarMatrix; uniform vec3 uCarVelocity;
        #endif
        attribute vec4 aSeed; varying vec2 vUv; varying float vAlpha;
        #include <fog_pars_vertex>
        void main() {
          vUv=uv;
          #ifdef CAR_RAIN
          vec3 center=(uCarMatrix*vec4(aAnchor,1.)).xyz;
          vec3 normal=normalize(mat3(uCarMatrix)*aImpactNormal);
          float period=.42+aSeed.w*.15;
          #else
          vec2 xz=uRainBounds.xz+mod(aSeed.xy*32.-uRainBounds.xz+16.,32.)-16.;
          float period=.55+aSeed.w*.3;
          float h=rainHeight(xz);
          float e=.22;
          vec3 normal=normalize(vec3(rainHeight(xz-vec2(e,0.))-rainHeight(xz+vec2(e,0.)),2.*e,rainHeight(xz-vec2(0.,e))-rainHeight(xz+vec2(0.,e))));
          vec3 center=vec3(xz.x,h,xz.y);
          #endif
          float clock=uRainTime/period+aSeed.z;
          float seconds=fract(clock)*period;
          float cycle=floor(clock);
          float random=fract(sin(cycle*19.13+aSeed.w*711.7)*43758.5453);
          float angle=random*6.283185;
          vec3 tangent=normalize(cross(normal,vec3(0.,0.,1.)));
          vec3 radial=tangent*cos(angle)+cross(normal,tangent)*sin(angle);
          float lift=${SPLASH_LIFT_MIN}+aSeed.w*${SPLASH_LIFT_RANGE};
          vec3 velocity=normal*lift+radial*(.25+random*.7);
          vec3 displacement=velocity*seconds+vec3(0.,-${SPLASH_GRAVITY * .5}*seconds*seconds,0.);
          #ifdef CAR_RAIN
            // Inherit the car's velocity at launch, then lose speed to air drag.
            displacement+=uCarVelocity*((1.-exp(-${SPLASH_AIR_DRAG}*seconds))/${SPLASH_AIR_DRAG}-seconds);
          #endif
          vec3 world=center+normal*.006+displacement;
          float above=dot(displacement,normal);
          vAlpha=step(.001,above)*uRainWet*uRainReady*smoothstep(.2,1.,normal.y);
          vAlpha*=1.-smoothstep(10.,22.,length(cameraPosition-world));
          #ifdef CAR_RAIN
            vAlpha*=rainExposed(center+vec3(0.,.05,0.));
          #else
            vAlpha*=step(rainHeight(world.xz)+.005,world.y);
          #endif
          vec4 mvPosition=viewMatrix*vec4(world,1.);
          mvPosition.xy+=position.xy*(.008+aSeed.w*.008);
          gl_Position=projectionMatrix*mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `varying vec2 vUv; varying float vAlpha;
        #include <fog_pars_fragment>
        void main(){
          vec2 p=(vUv-.5)*2.;
          float a=(1.-smoothstep(.25,1.,length(p)))*vAlpha*.75;
          if(a<.005)discard;
          gl_FragColor=vec4(.78,.84,.88,a);
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
  setQuality(quality: QualityPreset): void { (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = this.carCount === null ? IMPACT_COUNTS[quality] : Math.round(this.carCount * (quality === 'low' ? .5 : quality === 'medium' ? .8 : 1)) }
  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose() }
}
