import * as THREE from 'three/webgpu'
import { attribute, clamp, cos, float, length, materialOpacity, max, min, modelViewMatrix, positionLocal, reflector, sin, smoothstep, texture, uniform, uv, varying, vec2, vec3, vec4 } from 'three/tsl'
import { SkyMesh } from 'three/addons/objects/SkyMesh.js'

/**
 * Node (TSL) versions of the game's custom WebGL materials, for
 * WebGPURenderer: it runs neither `ShaderMaterial` nor `onBeforeCompile`.
 * Each mirrors the GLSL it replaces; see the WebGL side for the reasoning.
 */

/** SkidMarks: per-vertex alpha that fades out over `life` seconds after the vertex's birth time. */
export function skidMarkMaterial(life: number, color: THREE.Color) {
  const uTime = uniform(0)
  const age = uTime.sub(attribute('aBirth', 'float'))
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  material.colorNode = vec3(color.r, color.g, color.b)
  material.opacityNode = attribute('aAlpha', 'float').mul(float(1).sub(smoothstep(life * 0.4, life, age)))
  material.alphaTest = 0.004
  return { material, time: uTime }
}

/**
 * DirectionGuide arrows: a MeshBasicMaterial whose opacity is also scaled by
 * a per-instance `instanceFade` attribute (instanceColor only tints rgb).
 */
export function instanceFadeMaterial(source: THREE.MeshBasicMaterial): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial()
  THREE.Material.prototype.copy.call(material, source)
  material.map = source.map
  material.color.copy(source.color)
  material.opacityNode = materialOpacity.mul(texture(source.map!).a).mul(attribute('instanceFade', 'float'))
  return material
}

/**
 * The sky dome (TSL `SkyMesh`, same model and uniforms as the WebGL `Sky`),
 * with the game's exposure, flat tint and radiance clamp on top.
 */
export function skyDome() {
  const sky = new SkyMesh()
  const exposure = uniform(1)
  const tint = uniform(new THREE.Vector3())
  const clampMax = uniform(1.6)
  const base = sky.material.colorNode as THREE.Node<'vec4'>
  sky.material.colorNode = vec4(min(base.rgb.mul(exposure).add(tint), vec3(clampMax)), 1)
  return {
    mesh: sky as THREE.Mesh,
    /** Same names as the WebGL Sky's uniforms, so Environment drives both alike. */
    uniforms: {
      turbidity: sky.turbidity,
      rayleigh: sky.rayleigh,
      mieCoefficient: sky.mieCoefficient,
      mieDirectionalG: sky.mieDirectionalG,
      sunPosition: sky.sunPosition,
      uSkyExposure: exposure,
      uSkyTint: tint,
      uSkyMax: clampMax,
    } as Record<string, { value: unknown }>,
  }
}

/**
 * The garage floor's polished-concrete sheen: a planar reflection added
 * faintly over the floor and faded out radially (Showroom.buildFloorSheen).
 */
export function floorSheen(radius: number, color: number, resolutionScale: number) {
  const mirror = reflector({ resolutionScale })
  mirror.target.rotateX(-Math.PI / 2)
  const geometry = new THREE.CircleGeometry(radius, 48)
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  const fade = float(1).sub(smoothstep(radius * 0.35, radius, length(positionLocal.xy)))
  const tint = new THREE.Color(color)
  material.colorNode = mirror.rgb.mul(vec3(tint.r, tint.g, tint.b)).mul(fade)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.rotation.x = -Math.PI / 2
  return {
    mesh,
    /** The reflection camera's anchor: must sit in the scene, on the floor plane. */
    target: mirror.target,
    dispose() {
      geometry.dispose()
      material.dispose()
      mirror.dispose?.()
    },
  }
}

/**
 * HeatHaze (#56): writes a signed screen offset (rg) into the distortion
 * buffer, additively. Mirrors the GLSL in effects/HeatHaze.ts.
 */
export function hazeMaterial() {
  const uTime = uniform(0)
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false })
  material.toneMapped = false
  material.fog = false
  const depth = modelViewMatrix.mul(vec4(positionLocal, 1)).z.negate()
  const strength = varying(attribute('aStrength', 'float').mul(clamp(float(6).div(max(depth, 1)), 0.25, 1)), 'vStrength')
  const seed = varying(attribute('aSeed', 'float'), 'vSeed')
  const p = uv()
  const d = p.sub(0.5)
  const fall = float(1).sub(smoothstep(0.12, 0.5, length(d)))
  const t = uTime.add(seed.mul(7))
  const off = vec2(
    sin(p.y.mul(17).sub(t.mul(9)).add(sin(p.x.mul(6).add(t.mul(2))))),
    cos(p.x.mul(13).add(p.y.mul(7)).sub(t.mul(7))),
  )
  material.colorNode = vec3(off.mul(fall).mul(strength), 0)
  material.opacityNode = float(1)
  return { material, time: uTime }
}
