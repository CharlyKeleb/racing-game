import * as THREE from 'three/webgpu'
import {
  abs, attribute, cameraPosition, clamp, cos, cross, float, fwidth, length, materialColor, materialOpacity, max, min, mix, mod, modelViewMatrix, normalize,
  positionGeometry, positionLocal, reference, reflector, select, sin, smoothstep, step, texture, uniform, uv, varying, vec2, vec3, vec4,
} from 'three/tsl'
import { SkyMesh } from 'three/addons/objects/SkyMesh.js'
import { RAIN_BOX, RAIN_EXPOSURE, RAIN_FALL, RAIN_WIDTH } from '../../effects/Rain'

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
      cloudCoverage: sky.cloudCoverage,
      cloudDensity: sky.cloudDensity,
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

/** LiveryGraphics' uniform objects: the node version reads them live by reference. */
type LiveryUniforms = Record<string, { value: unknown }>

/**
 * Garage livery paint (CarLivery + LiveryGraphics): a physical material whose
 * diffuse colour gets the stripes, hood number and door panels / decals
 * projected from the body-space `liveryPosition` / `liveryNormal`
 * attributes. Mirrors LIVERY_FRAGMENT; the uniforms stay owned by
 * LiveryGraphics and are read by reference, so `apply()` needs no changes.
 */
export function liveryPaintMaterial(u: LiveryUniforms): THREE.MeshPhysicalNodeMaterial {
  const material = new THREE.MeshPhysicalNodeMaterial({ name: 'livery_paint' })
  const f = (name: string) => reference('value', 'float', u[name])
  const v2 = (name: string) => reference('value', 'vec2', u[name])
  const v4 = (name: string) => reference('value', 'vec4', u[name])
  const rgb = (name: string) => reference('value', 'color', u[name])
  const atlas = u.uLiveryAtlas.value as THREE.Texture
  const lp = varying(attribute('liveryPosition', 'vec3'), 'vLiveryPosition')
  const ln = normalize(varying(attribute('liveryNormal', 'vec3'), 'vLiveryNormal'))
  const enabled = step(0.5, f('uLiveryEnabled'))
  const pattern = f('uLiveryPattern')
  const stripe = v4('uLiveryStripe'), panel = v4('uLiveryPanel'), hood = v2('uLiveryHood'), decalSize = v2('uLiveryDecal')
  const primary = rgb('uLiveryPrimary'), accent = rgb('uLiveryAccent')
  const edge = max(fwidth(lp.x), 0.001)
  const ax = abs(lp.x)
  // Stripe distance and width per pattern (1 centre … 7 pinstripe), as the GLSL if-chain.
  const below = (k: number) => pattern.lessThan(k + 0.5)
  const distance = select(below(1), ax,
    select(below(2), abs(ax.sub(stripe.y)),
      select(below(3), abs(lp.x.sub(stripe.z)),
        select(below(4), abs(ax.sub(abs(lp.z.sub(0.4)).mul(0.18))),
          select(below(5), min(ax, abs(ax.sub(stripe.y.mul(1.8)))),
            select(below(6), abs(lp.x.sub(lp.z.mul(0.32))), abs(ax.sub(0.47))))))))
  const width = stripe.x.mul(select(below(1), 1.8, select(below(4), 1, select(below(5), 0.65, select(below(6), 1, 0.25)))))
  const onTop = step(0.45, ln.y).mul(step(stripe.w, lp.y))
  const stripeMask = enabled.mul(step(0.5, pattern)).mul(onTop)
  const outer = float(1).sub(smoothstep(width.add(0.018), width.add(0.018).add(edge), distance)).mul(stripeMask)
  const inner = float(1).sub(smoothstep(width, width.add(edge), distance)).mul(stripeMask)
  const inside = (p: THREE.Node<'vec2'>) => step(0, p.x).mul(step(p.x, 1)).mul(step(0, p.y)).mul(step(p.y, 1))
  let color: THREE.Node<'vec3'> = mix(mix(materialColor.rgb, accent, outer), primary, inner)
  // Hood number.
  const huv = vec2(lp.x.div(hood.y).add(0.5), lp.z.sub(hood.x).div(hood.y).add(0.5))
  const hoodTex = texture(atlas, vec2(huv.x.mul(0.5), huv.y))
  const hoodMask = enabled.mul(step(0.5, f('uLiveryHoodNumber'))).mul(step(0.55, ln.y)).mul(step(stripe.w, lp.y)).mul(inside(huv))
  color = mix(color, hoodTex.rgb, hoodTex.a.mul(hoodMask))
  // Door panels and decals, mirrored on the far side so they read the right way round.
  const side = enabled.mul(step(0.55, abs(ln.x)))
  const direction = select(ln.x.greaterThan(0), float(1), float(-1))
  const puv = vec2(lp.z.sub(panel.y).mul(direction).div(panel.z).add(0.5), lp.y.sub(panel.x).div(panel.w).add(0.5))
  const panelTex = texture(atlas, vec2(puv.x.mul(0.5), puv.y))
  color = mix(color, panelTex.rgb, panelTex.a.mul(side).mul(step(0.5, f('uLiveryDoorNumber'))).mul(inside(puv)))
  const duv = vec2(lp.z.sub(decalSize.x).mul(direction).div(decalSize.y).add(0.5), lp.y.sub(panel.x).div(decalSize.y).add(0.5))
  const decalTex = texture(atlas, vec2(duv.x.mul(0.5).add(0.5), duv.y))
  color = mix(color, decalTex.rgb, decalTex.a.mul(side).mul(inside(duv)))
  material.colorNode = color
  return material
}

/**
 * Rain streaks (#53): the box-wrapped, camera-relative streaks of
 * effects/Rain.ts, in world space (the mesh sits at the origin).
 */
export function rainMaterial() {
  const uTime = uniform(0)
  const cameraVelocity = new THREE.Vector3()
  const uCameraVelocity = uniform(cameraVelocity)
  const box = vec3(RAIN_BOX.x, RAIN_BOX.y, RAIN_BOX.z)
  const seed = attribute('aSeed', 'vec4')
  const fall = vec3(RAIN_FALL.x, RAIN_FALL.y, RAIN_FALL.z).mul(seed.w.mul(0.3).add(0.85))
  const drop = cameraPosition.add(mod(seed.xyz.mul(box).add(fall.mul(uTime)).sub(cameraPosition), box)).sub(box.mul(0.5))
  const along = fall.sub(uCameraVelocity).negate().mul(RAIN_EXPOSURE)
  const mid = drop.add(along.mul(positionGeometry.y.add(0.5)))
  const side = normalize(cross(along, mid.sub(cameraPosition))).mul(RAIN_WIDTH)
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
  material.positionNode = mid.add(side.mul(positionGeometry.x.mul(2)))
  const dist = length(drop.sub(cameraPosition))
  const fade = varying(smoothstep(0.6, 2, dist).mul(float(1).sub(smoothstep(0.35, 0.5, dist.div(RAIN_BOX.x)))), 'vRainFade')
  const p = uv()
  const across = float(1).sub(abs(p.x.sub(0.5)).mul(2))
  material.colorNode = vec3(0.78, 0.84, 0.9)
  material.opacityNode = across.mul(sin(p.y.mul(Math.PI))).mul(fade).mul(0.45)
  material.alphaTest = 0.004
  return { material, uniforms: { time: uTime, cameraVelocity: { value: cameraVelocity } } }
}

/**
 * Lens drops (#53, cockpit view): each drop writes a lens-like inward offset
 * into the distortion buffer, so the image behind it is refracted (and
 * flipped) the way a water drop on glass does. Mirrors effects/LensDrops.ts.
 */
export function lensDropMaterial() {
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false })
  material.toneMapped = false
  material.fog = false
  const strength = varying(attribute('aStrength', 'float'), 'vDrop')
  const d = uv().sub(0.5).mul(2)
  const r = length(d)
  const inside = float(1).sub(smoothstep(0.8, 1, r))
  material.colorNode = vec3(d.mul(inside).mul(strength).negate(), 0)
  material.opacityNode = float(1)
  return material
}
