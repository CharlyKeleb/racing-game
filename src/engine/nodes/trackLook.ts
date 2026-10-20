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
  const neutral = float(1).sub(smoothstep(.18, .45, hi.sub(lo).div(max(hi, .0001))))
  const road = neutral.mul(float(1).sub(smoothstep(.22, .55, l)))
  const protect = float(1).sub(smoothstep(.5, .8, l))
  const muted = mix(c, vec3(l), protect.mul(.3)).mul(mix(1, .94, protect))
  const asphalt = c.mul(mix(1, .65, road))
  const result = role === 1 ? asphalt : role === 2 ? muted : mix(muted, asphalt, road)
  material.colorNode = vec4(mix(c, result, reference('value', 'float', strength)), base.a)
  return material
}
