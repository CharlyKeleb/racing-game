import * as THREE from 'three'
import { backend } from '../engine/backend'

export type TrackLook = 'default' | 'road-focus'
export type TrackLookRole = 'road' | 'scenery' | 'mixed' | 'protected'
/** Shared by every material in this game session, including future streamed chunks. */
export const trackLookStrength = { value: 1 }
export function setTrackLook(look: TrackLook): void { trackLookStrength.value = look === 'road-focus' ? 1 : 0 }

export function trackLookRole(name: string, layer?: string): TrackLookRole {
  if (name === '__vertex_color') return 'mixed'
  // Collision layers include kerbs, paint and paving; they are not all asphalt.
  if (/curb|kerb|decal|marking|stripe|line|astroturf|tile|brick|travert|grille|pavement/i.test(name)
    || /^(1101|1111|1121|1161)Mtl$/i.test(name)) return 'protected'
  if (layer === 'road') return 'road'
  if (layer === 'ground' || layer === 'terrain' || layer === 'veg') return 'scenery'
  return 'protected'
}

/** Linear-albedo transform, before lighting. Bright paint and strongly coloured pixels are protected. */
export const TRACK_LOOK_GLSL = `
vec3 trackLook(vec3 c, float role) {
  float l=dot(c,vec3(.2126,.7152,.0722));
  float hi=max(c.r,max(c.g,c.b)), lo=min(c.r,min(c.g,c.b));
  float neutral=1.-smoothstep(.18,.45,(hi-lo)/max(hi,.0001));
  float road=neutral*(1.-smoothstep(.22,.55,l));
  float protect=1.-smoothstep(.5,.8,l);
  vec3 muted=mix(c,vec3(l),.3*protect)*mix(1.,.94,protect);
  vec3 asphalt=c*mix(1.,.65,road);
  return role<1.5 ? asphalt : role<2.5 ? muted : mix(muted,asphalt,road);
}`

/** Install once on each library material; switching only updates a uniform. */
export function withTrackLook(source: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial, role = trackLookRole(source.name, source.userData.layer)): THREE.Material {
  if (role === 'protected') return source
  const roleNumber = role === 'road' ? 1 : role === 'scenery' ? 2 : 3
  source.userData.trackLookRole = roleNumber
  if (backend.nodes) {
    const material = backend.nodes.trackLookMaterial(source, trackLookStrength, roleNumber)
    source.dispose()
    return material
  }
  const compile = source.onBeforeCompile, key = source.customProgramCacheKey
  source.onBeforeCompile = (shader, renderer) => {
    compile.call(source, shader, renderer)
    shader.uniforms.uTrackLook = trackLookStrength
    shader.fragmentShader = 'uniform float uTrackLook;\n' + TRACK_LOOK_GLSL + '\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb=mix(diffuseColor.rgb,trackLook(diffuseColor.rgb,${roleNumber.toFixed(1)}),uTrackLook);`)
  }
  source.customProgramCacheKey = () => key.call(source) + ':track-look:' + roleNumber
  source.needsUpdate = true
  return source
}
