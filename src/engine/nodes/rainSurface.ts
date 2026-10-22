import type { WetReflectionUniforms } from '../../effects/WetReflections'
import { SPLASH_GRAVITY, SPLASH_LIFT_MIN, SPLASH_LIFT_RANGE, SPLASH_AIR_DRAG } from '../../effects/RainImpactPhysics'
import type { CarRainAnchors } from '../../effects/CarRain'
import * as THREE from 'three/webgpu'
import {
  abs, attribute, cameraPosition, cameraViewMatrix, cameraWorldMatrix, cos, exp, cross, float, floor, fract, length, max, min, mix, mod, normalMap, normalView,
  normalize, positionGeometry, positionWorld, reference, sin, smoothstep, step, texture, uniform, uv, varying, vec2, vec3, vec4,
} from 'three/tsl'
import type { RainSurfaceUniforms } from '../../effects/RainSurface'

// Native WebGPU render targets have a top-left origin (the GLSL twin is bottom-left).
function surfaceUv(surface: RainSurfaceUniforms, p: THREE.Node<'vec2'>) {
  const bounds = uniform(surface.uRainBounds.value)
  return vec2(p.x.sub(bounds.x).div(bounds.w).add(.5), p.y.sub(bounds.z).div(bounds.w).add(.5))
}
export function surfaceHeight(surface: RainSurfaceUniforms, p: THREE.Node<'vec2'>) {
  return texture(surface.uRainSurface.value, surfaceUv(surface, p)).r.sub(.5).mul(128).add(uniform(surface.uRainBounds.value).y)
}
export function rainSurfaceMaterial(surface: RainSurfaceUniforms) {
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, toneMapped: false, fog: false })
  const height = positionWorld.y.sub(uniform(surface.uRainBounds.value).y).div(128).add(.5)
  material.colorNode = vec3(height, 0, 0)
  return material
}
export function rainClearance(surface: RainSurfaceUniforms, world: THREE.Node<'vec3'>) {
  const ready = reference('value', 'float', surface.uRainReady)
  return mix(float(100), world.y.sub(surfaceHeight(surface, world.xz)), ready)
}

export function rainImpactMaterial(surface: RainSurfaceUniforms, anchors?: CarRainAnchors) {
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide })
  const seed = attribute('aSeed', 'vec4')
  const bounds = uniform(surface.uRainBounds.value)
  const time = reference('value', 'float', surface.uRainTime)
  const wet = reference('value', 'float', surface.uRainWet)
  const ready = reference('value', 'float', surface.uRainReady)
  const xz = bounds.xz.add(mod(seed.xy.mul(32).sub(bounds.xz).add(16), 32)).sub(16)
  const period = anchors ? seed.w.mul(.15).add(.42) : seed.w.mul(.3).add(.55)
  const h = surfaceHeight(surface, xz)
  const groundNormal = normalize(vec3(
    surfaceHeight(surface, xz.sub(vec2(.22, 0))).sub(surfaceHeight(surface, xz.add(vec2(.22, 0)))),
    .44,
    surfaceHeight(surface, xz.sub(vec2(0, .22))).sub(surfaceHeight(surface, xz.add(vec2(0, .22)))),
  ))
  const center = anchors ? uniform(anchors.matrix.value).mul(vec4(attribute('aAnchor', 'vec3'), 1)).xyz : vec3(xz.x, h, xz.y)
  const normal = anchors ? normalize(uniform(anchors.matrix.value).mul(vec4(attribute('aImpactNormal', 'vec3'), 0)).xyz) : groundNormal
  const clock = time.div(period).add(seed.z)
  const seconds = fract(clock).mul(period)
  const cycle = floor(clock)
  const random = fract(sin(cycle.mul(19.13).add(seed.w.mul(711.7))).mul(43758.5453))
  const angle = random.mul(Math.PI * 2)
  const tangent = normalize(cross(normal, vec3(0, 0, 1)))
  const radial = tangent.mul(cos(angle)).add(cross(normal, tangent).mul(sin(angle)))
  const lift = seed.w.mul(SPLASH_LIFT_RANGE).add(SPLASH_LIFT_MIN)
  const launch = normal.mul(lift).add(radial.mul(random.mul(.7).add(.25)))
  let displacement = launch.mul(seconds).add(vec3(0, seconds.mul(seconds).mul(-SPLASH_GRAVITY * .5), 0))
  if (anchors) {
    const dragTime = float(1).sub(exp(seconds.mul(-SPLASH_AIR_DRAG))).div(SPLASH_AIR_DRAG).sub(seconds)
    displacement = displacement.add(uniform(anchors.velocity.value).mul(dragTime))
  }
  const world = center.add(normal.mul(.006)).add(displacement)
  const diameter = seed.w.mul(.008).add(.008)
  material.positionNode = world.add(cameraWorldMatrix.mul(vec4(positionGeometry.xy.mul(diameter), 0, 0)).xyz)
  const above = displacement.dot(normal)
  let opacity = step(.001, above).mul(wet).mul(ready).mul(smoothstep(.2, 1, normal.y))
    .mul(float(1).sub(smoothstep(10, 22, length(cameraPosition.sub(world)))))
  if (anchors) opacity = opacity.mul(step(surfaceHeight(surface, center.xz).sub(.18), center.y.add(.05)))
  else opacity = opacity.mul(step(surfaceHeight(surface, world.xz).add(.005), world.y))
  const fade = varying(opacity, 'vImpactFade')
  const p = uv().sub(.5).mul(2)
  material.colorNode = vec3(.78, .84, .88)
  material.opacityNode = float(1).sub(smoothstep(.25, 1, length(p))).mul(fade).mul(.75)
  material.alphaTest = .005
  return material
}

export function wetRoadMaterial(source: THREE.MeshStandardMaterial, surface: RainSurfaceUniforms, reflection?: WetReflectionUniforms) {
  const material = new THREE.MeshStandardNodeMaterial()
  THREE.MeshStandardMaterial.prototype.copy.call(material, source)
  const time = reference('value', 'float', surface.uRainTime)
  const p = positionWorld.xz
  const coords = surfaceUv(surface, p)
  const inside = step(0, coords.x).mul(step(coords.x, 1)).mul(step(0, coords.y)).mul(step(coords.y, 1))
  const exposed = mix(1, step(surfaceHeight(surface, p).sub(.18), positionWorld.y), inside.mul(reference('value', 'float', surface.uRainReady)))
  const wet = exposed.mul(reference('value', 'float', surface.uRainWet))
  const noise = sin(p.x.mul(.19).add(sin(p.y.mul(.11)))).mul(sin(p.y.mul(.24).add(sin(p.x.mul(.17))))).mul(.5).add(.5)
  const pool = smoothstep(.62, .82, noise).mul(wet)
  const color = vec3(source.color.r, source.color.g, source.color.b)
  const baseColor = (source as THREE.MeshStandardMaterial & { colorNode?: THREE.Node<'vec3'> | THREE.Node<'vec4'> }).colorNode?.rgb ?? (source.map ? color.mul(texture(source.map).rgb) : color)
  material.colorNode = baseColor.mul(mix(1, mix(.78, .64, pool), wet))
  const roughness = source.roughnessMap ? texture(source.roughnessMap).g.mul(source.roughness) : float(source.roughness)
  material.roughnessNode = mix(mix(roughness, min(roughness, .55), wet), .3, pool)
  const cell = floor(p.mul(1.7))
  const hash = fract(sin(cell.x.mul(127.1).add(cell.y.mul(311.7))).mul(43758.5453))
  const center = cell.add(vec2(hash.mul(.5).add(.25), fract(hash.mul(7.13)).mul(.5).add(.25))).div(1.7)
  const delta = p.sub(center)
  const d = length(delta)
  const age = fract(time.mul(.85).add(hash))
  const band = float(1).sub(smoothstep(.012, .045, abs(d.sub(age.mul(.28)))))
  const ripple = delta.div(max(d, .001)).mul(band).mul(cos(d.sub(age.mul(.28)).mul(100))).mul(float(1).sub(age)).mul(.065).mul(pool)
  // NormalMapNode's declaration predates the typed TSL vec3 extensions.
  const baseNormal = source.normalMap ? normalMap(texture(source.normalMap), uniform(source.normalScale)) as unknown as THREE.Node<'vec3'> : normalView
  material.normalNode = normalize(vec3(baseNormal).add(cameraViewMatrix.mul(vec4(ripple.x, 0, ripple.y, 0)).xyz))
  if (reflection) {
    const projected = uniform(reflection.uWetReflectionMatrix.value).mul(vec4(positionWorld, 1))
    const coord = projected.xy.div(max(projected.w, .0001)).add(ripple.mul(.018))
    const valid = step(0, coord.x).mul(step(coord.x, 1)).mul(step(0, coord.y)).mul(step(coord.y, 1)).mul(step(.001, projected.w))
    const planeFade = float(1).sub(smoothstep(.08, .4, abs(uniform(reflection.uWetReflectionPlane.value).dot(vec4(positionWorld, 1)))))
    const viewDirection = normalize(cameraPosition.sub(positionWorld))
    const fresnel = float(.04).add(float(.96).mul(float(1).sub(abs(viewDirection.dot(uniform(reflection.uWetReflectionPlane.value).xyz))).pow(5)))
    const weight = pool.mul(planeFade).mul(valid).mul(reference('value', 'float', reflection.uWetReflectionReady)).mul(mix(.1, .5, fresnel))
    // Render-target textures use native top-left coordinates on WebGPU.
    const reflected = texture(reflection.uWetReflection.value, vec2(coord.x, float(1).sub(coord.y))).rgb.mul(.55)
    material.emissiveNode = reflected.mul(weight)
    material.colorNode = material.colorNode.mul(float(1).sub(weight))
  }
  return material
}
