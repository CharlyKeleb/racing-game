import * as THREE from 'three'
import { backend } from '../engine/backend'

export type TrackLook = 'default' | 'road-focus'
export type TrackLookRole = 'road' | 'scenery' | 'mixed' | 'kerb' | 'protected'
/** Shared by every material in this game session, including future streamed chunks. */
export const trackLookStrength = { value: 1 }
export function setTrackLook(look: TrackLook): void { trackLookStrength.value = look === 'road-focus' ? 1 : 0 }

export function trackLookRole(name: string, layer?: string): TrackLookRole {
  if (name === '__vertex_color') return 'mixed'
  // Red/white kerbs get their own grade: deep red and crisp white, like a real circuit.
  if (/curb|kerb/i.test(name) || /^(1111|1121)Mtl$/i.test(name)) return 'kerb'
  // Collision layers include paint and paving; they are not all asphalt.
  if (/decal|marking|stripe|line|astroturf|tile|brick|travert|grille|pavement/i.test(name)
    || /^(1101|1161)Mtl$/i.test(name)) return 'protected'
  if (layer === 'road') return 'road'
  if (layer === 'ground' || layer === 'terrain' || layer === 'veg') return 'scenery'
  return 'protected'
}

/**
 * Linear-albedo transform, before lighting. Bright paint and strongly
 * coloured pixels are protected. Tuned against a dry aerial circuit photo
 * (asphalt #28292d on screen, kerbs #850b0a / #b7b7b9, dark grass): the
 * asphalt was ~1.5× too bright and blue from the sky light, kerbs a washed
 * pink, grass pale.
 *   road     neutral dark pixels darken to ~45% and lose the blue cast
 *   scenery  darker and a little less saturated, so the road leads
 *   mixed    merged far LODs: the road path on neutral dark pixels, scenery elsewhere
 *   kerb     red deepens and saturates; white brightens a touch
 */
export const TRACK_LOOK_GLSL = `
vec3 trackLook(vec3 c, float role) {
  float l=dot(c,vec3(.2126,.7152,.0722));
  float hi=max(c.r,max(c.g,c.b)), lo=min(c.r,min(c.g,c.b));
  float chroma=(hi-lo)/max(hi,.0001);
  float neutral=1.-smoothstep(.18,.45,chroma);
  float road=neutral*(1.-smoothstep(.22,.55,l));
  float protect=1.-smoothstep(.5,.8,l);
  vec3 muted=mix(c,vec3(l),.12*protect)*mix(1.,.68,protect);
  vec3 asphalt=mix(c,vec3(l),.5*road)*mix(vec3(1.),vec3(.41,.37,.35),road);
  float colour=smoothstep(.15,.4,chroma);
  vec3 kerb=mix(c*1.06,max(mix(vec3(l),c,1.8),0.)*.75,colour);
  return role<1.5 ? asphalt : role<2.5 ? muted : role<3.5 ? mix(muted,asphalt,road) : kerb;
}`

/** Install once on each library material; switching only updates a uniform. */
export function withTrackLook(source: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial, role = trackLookRole(source.name, source.userData.layer)): THREE.Material {
  if (role === 'protected') return source
  const roleNumber = role === 'road' ? 1 : role === 'scenery' ? 2 : role === 'mixed' ? 3 : 4
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
