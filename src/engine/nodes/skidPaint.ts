import * as THREE from 'three/webgpu'
import { abs, attribute, float, fract, mix, normalWorld, positionGeometry, positionWorld, reference, smoothstep, step, texture, uniform, uv, varying, vec3, vec4 } from 'three/tsl'
import { PAINT_EXTENT, skidPaint } from '../../effects/SkidPaint'

const atlas = texture(skidPaint.uSkidPaint.value)
export function setSkidPaintTexture(value: THREE.Texture): void { atlas.value = value }

/** Same atlas layout as WebGL; +Z grows down the native WebGPU texture. */
export function skidPaintMaterials(bounds: { value: THREE.Vector2 }, decay: { value: THREE.Vector2 }) {
  const tile = uniform(bounds.value)
  const stamp = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, depthTest: false, depthWrite: false, toneMapped: false, fog: false })
  const p = positionGeometry
  stamp.vertexNode = vec4(p.x.sub(tile.x).div(16).sub(1), float(1).sub(p.z.sub(tile.y).div(16)), 0, 1)
  const paint = varying(attribute('aPaint', 'vec3'))
  const height = varying(p.y)
  const edge = smoothstep(0, .12, uv().x).mul(float(1).sub(smoothstep(.88, 1, uv().x)))
  stamp.fragmentNode = vec4(paint.x.mul(edge), height, paint.z.mul(edge), 1)
  const fade = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, toneMapped: false, fog: false })
  fade.vertexNode = vec4(positionGeometry.xy, 0, 1)
  const d = uniform(decay.value)
  fade.fragmentNode = vec4(d.x, 1, d.y, 1)
  return { stamp, fade }
}

export function skidPaintColor(base: THREE.Node<'vec3'>) {
  const local = positionWorld.xz.sub(uniform(skidPaint.uSkidBounds.value)).div(PAINT_EXTENT)
  const inside = step(0, local.x).mul(step(local.x, 1)).mul(step(0, local.y)).mul(step(local.y, 1))
  // reference keeps the texture binding current across car swaps / resized targets.
  const paint = atlas.sample(fract(positionWorld.xz.div(PAINT_EXTENT)))
  const valid = inside.mul(reference('value', 'float', skidPaint.uSkidReady)).mul(step(.25, normalWorld.y))
    .mul(float(1).sub(smoothstep(.2, .45, abs(positionWorld.y.sub(paint.g)))))
  const rubber = paint.r.mul(step(.01, paint.r)).mul(valid)
  const rut = paint.b.mul(step(.01, paint.b)).mul(valid)
  return base.mul(mix(vec3(1), vec3(.12), rubber)).mul(mix(vec3(1), vec3(.28, .18, .1), rut))
}
