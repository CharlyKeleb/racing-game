import * as THREE from 'three'

export const TILE_SIZE = 32
export const TILE_COUNT = 4
export const PAINT_EXTENT = TILE_SIZE * TILE_COUNT
const empty = new THREE.DataTexture(new Uint8Array(4), 1, 1)
empty.needsUpdate = true
/** Shared references also reach materials created later by the track streamer. */
export const skidPaint = {
  uSkidPaint: { value: empty as THREE.Texture },
  uSkidBounds: { value: new THREE.Vector2() },
  uSkidReady: { value: 0 },
}
export function tileSlot(x: number, z: number): number {
  return ((z % TILE_COUNT + TILE_COUNT) % TILE_COUNT) * TILE_COUNT + (x % TILE_COUNT + TILE_COUNT) % TILE_COUNT
}

export const SKID_PAINT_GLSL = `
uniform sampler2D uSkidPaint;
uniform vec2 uSkidBounds;
uniform float uSkidReady;
varying vec3 vSkidWorld;
varying float vSkidUp;
vec3 skidAlbedo(vec3 base) {
  vec2 local=(vSkidWorld.xz-uSkidBounds)/128.;
  float inside=step(0.,local.x)*step(local.x,1.)*step(0.,local.y)*step(local.y,1.);
  vec4 paint=texture2D(uSkidPaint,fract(vSkidWorld.xz/128.));
  float valid=inside*uSkidReady*step(.25,vSkidUp)*(1.-smoothstep(.2,.45,abs(vSkidWorld.y-paint.g)));
  float rubber=paint.r*step(.01,paint.r)*valid;
  float rut=paint.b*step(.01,paint.b)*valid;
  return base*mix(vec3(1.),vec3(.12),rubber)*mix(vec3(1.),vec3(.28,.18,.1),rut);
}`

/** Called only on track surface materials, never cars or props. */
export function withSkidPaint(source: THREE.Material): THREE.Material {
  const compile = source.onBeforeCompile, key = source.customProgramCacheKey
  source.onBeforeCompile = (shader, renderer) => {
    compile.call(source, shader, renderer)
    Object.assign(shader.uniforms, skidPaint)
    shader.vertexShader = 'varying vec3 vSkidWorld; varying float vSkidUp;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 skidLocal=vec4(transformed,1.);
      vec3 skidNormal=normal;
      #ifdef USE_BATCHING
        skidLocal=batchingMatrix*skidLocal;
        skidNormal=mat3(batchingMatrix)*skidNormal;
      #endif
      #ifdef USE_INSTANCING
        skidLocal=instanceMatrix*skidLocal;
        skidNormal=mat3(instanceMatrix)*skidNormal;
      #endif
      vSkidWorld=(modelMatrix*skidLocal).xyz;
      vSkidUp=normalize(mat3(modelMatrix)*skidNormal).y;`)
    shader.fragmentShader = SKID_PAINT_GLSL + shader.fragmentShader.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\ndiffuseColor.rgb=skidAlbedo(diffuseColor.rgb);')
  }
  source.customProgramCacheKey = () => key.call(source) + ':skid-paint-v1'
  source.needsUpdate = true
  return source
}
