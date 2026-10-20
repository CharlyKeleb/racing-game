import * as THREE from 'three/webgpu'
import { attribute, float, max, min, mix, reference, smoothstep, texture, vec3, vec4 } from 'three/tsl'

/** Native twin of TRACK_LOOK_GLSL. Include map/vertex colour before grading, with alpha intact. */
export function trackLookMaterial(source: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial, strength: { value: number }, role: number) {
  const material = source instanceof THREE.MeshLambertMaterial ? new THREE.MeshLambertNodeMaterial() : new THREE.MeshStandardNodeMaterial()
  if (source instanceof THREE.MeshLambertMaterial) THREE.MeshLambertMaterial.prototype.copy.call(material, source)
  else THREE.MeshStandardMaterial.prototype.copy.call(material, source)
  let base: THREE.Node<'vec4'> = vec4(source.color.r, source.color.g, source.color.b, 1)
  if (source.map) base = base.mul(texture(source.map))
  if (source.vertexColors) base = base.mul(vec4(attribute('color', 'vec3'), 1))
  material.vertexColors = false // already included; do not multiply again after colorNode
  const c = base.rgb, l = c.dot(vec3(.2126, .7152, .0722))
  const hi = max(c.r, max(c.g, c.b)), lo = min(c.r, min(c.g, c.b))
  const chroma = hi.sub(lo).div(max(hi, .0001))
  const neutral = float(1).sub(smoothstep(.18, .45, chroma))
  const road = neutral.mul(float(1).sub(smoothstep(.22, .55, l)))
  const protect = float(1).sub(smoothstep(.5, .8, l))
  const muted = mix(c, vec3(l), protect.mul(.12)).mul(mix(1, .68, protect))
  const asphalt = mix(c, vec3(l), road.mul(.5)).mul(mix(vec3(1, 1, 1), vec3(.41, .37, .35), road))
  const colour = smoothstep(.15, .4, chroma)
  const kerb = mix(c.mul(1.06), max(mix(vec3(l), c, 1.8), vec3(0, 0, 0)).mul(.75), colour)
  const result = role === 1 ? asphalt : role === 2 ? muted : role === 3 ? mix(muted, asphalt, road) : kerb
  material.colorNode = vec4(mix(c, result, reference('value', 'float', strength)), base.a)
  return material
}
