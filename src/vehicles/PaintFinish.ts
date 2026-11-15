import * as THREE from 'three'
import type { PaintFinish } from './CarBuild'

/** Shared controls for the GLSL and native TSL paint layers. */
export function paintFinishUniforms() {
  return { uPaintFlake: { value: 0 }, uPaintPearl: { value: 0 } }
}
export type PaintFinishUniforms = ReturnType<typeof paintFinishUniforms>
export function setPaintFinish(uniforms: PaintFinishUniforms, finish: PaintFinish): void {
  uniforms.uPaintFlake.value = finish === 'metallic' ? 1 : finish === 'pearl' ? .25 : 0
  uniforms.uPaintPearl.value = finish === 'pearl' ? 1 : 0
}

/** Flake cells per metre. ~1.7 mm: sub-pixel (filtered away) at chase distance, a glint at 4K close-ups. */
export const PAINT_FLAKE_DENSITY = 600

// Grains stay attached to the panels: object space, but in metres. The vertex
// position alone is in the mesh's *quantized* units (KHR_mesh_quantization puts
// a ~2.5× dequantization scale on the node), which made each flake a 1 cm
// square that read as blocky pixels on the paint. Each flake is a round dot in
// its cell, and derivative filtering fades it before it shrinks under ~3 px, so
// the paint never speckles. Same numbers in the TSL twin (engine/nodes/materials.ts).
export function patchPaintFinish(material: THREE.MeshPhysicalMaterial, uniforms: PaintFinishUniforms): void {
  const compile = material.onBeforeCompile
  const key = material.customProgramCacheKey()
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = 'varying vec3 vPaintLocal;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaintLocal=position*vec3(length(modelMatrix[0].xyz),length(modelMatrix[1].xyz),length(modelMatrix[2].xyz));')
    shader.fragmentShader = `varying vec3 vPaintLocal;
      uniform float uPaintFlake; uniform float uPaintPearl; uniform mat3 normalMatrix;
      vec3 paintHash(vec3 p) {
        return fract(sin(vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6))))*43758.5453);
      }
    ` + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float paintAngle=pow(1.-abs(dot(normalize(vNormal),normalize(vViewPosition))),2.);
      vec3 pearlTint=mix(vec3(1.,.78,.93),vec3(.70,.91,1.),paintAngle);
      diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.gbr,paintAngle*uPaintPearl*.4)*mix(vec3(1.),pearlTint,uPaintPearl*.65);`)
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      vec3 grainPosition=vPaintLocal*${PAINT_FLAKE_DENSITY.toFixed(1)};
      vec3 grainHash=paintHash(floor(grainPosition));
      vec3 grainWidth=fwidth(grainPosition);
      float grainFilter=1.-smoothstep(.15,.4,max(grainWidth.x,max(grainWidth.y,grainWidth.z)));
      float grainDot=1.-smoothstep(.22,.38,length(fract(grainPosition)-.5));
      float grainStrength=smoothstep(.82,.94,grainHash.x)*grainDot*grainFilter*uPaintFlake;
      roughnessFactor=mix(roughnessFactor,.11,grainStrength);`)
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      vec3 grainTilt=normalMatrix*(grainHash*2.-1.);
      grainTilt-=normal*dot(normal,grainTilt);
      normal=normalize(normal+grainTilt*grainStrength*.3);`)
  }
  material.customProgramCacheKey = () => key + ':premium-paint-v3'
}
