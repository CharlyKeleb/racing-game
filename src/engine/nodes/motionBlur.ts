import * as THREE from 'three/webgpu'
import { cameraProjectionMatrix, modelViewMatrix, positionLocal, uniform, varying, vec4 } from 'three/tsl'
import type { MotionUniforms } from '../../effects/MotionVectors'

/** Same signed-UV buffer as the WebGL pass; native targets have Y down. */
export function motionVectorMaterial(u: MotionUniforms) {
  const material = new THREE.MeshBasicNodeMaterial({ toneMapped: false, fog: false })
  const view = modelViewMatrix.mul(vec4(positionLocal, 1))
  const current = varying(cameraProjectionMatrix.mul(view))
  const previous = varying(uniform(u.previousViewProjection.value).mul(uniform(u.previous.value)).mul(vec4(positionLocal, 1)))
  const sharp = uniform('float').onObjectUpdate(() => u.sharp.value)
  const motion = current.xy.div(current.w.max(.001)).sub(previous.xy.div(previous.w.max(.001))).mul(.5)
  material.fragmentNode = vec4(motion.x.mul(sharp.oneMinus()), motion.y.negate().mul(sharp.oneMinus()), sharp, varying(view.z.negate()).div(2000))
  return material
}
