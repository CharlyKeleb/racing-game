import * as THREE from 'three'
import { LIVERY_PLACEMENTS } from './LiveryDesign'

/** Clearcoated paint, as the garage's default finishes give the player's car. */
const CLEARCOAT = { clearcoat: 1, clearcoatRoughness: 0.04 }
/** Base layer for plain paint, or a livery without roughness/metalness maps: a metallic like the garage's. */
const BASE = { metalness: 0.6, roughness: 0.28 }

/**
 * The body paint, by the same rule as the garage livery (CarLivery): 'plain'
 * for a material named `paint` / `paint.*` (its stock maps are just base
 * colour, replaced by the paint colour), 'livery' for one of the car's paint
 * aliases (a texture with decals and sponsor art, kept), else null.
 */
export function paintKind(name: string, carId: string): 'plain' | 'livery' | null {
  const n = name.toLowerCase()
  if (n === 'paint' || n.startsWith('paint.')) return 'plain'
  return LIVERY_PLACEMENTS[carId]?.paintAliases.includes(name) ? 'livery' : null
}

/**
 * A rival's own copy of a body material. Paint becomes clearcoated physical
 * paint like the player's: plain paint in the rival's team colour, a texture
 * livery (decals, sponsor art) kept as it is under the clearcoat. Everything
 * else is a plain clone.
 */
export function rivalMaterial(source: THREE.Material, carId: string, colour: number): THREE.Material {
  return cheapForRivals(paintedCopy(source, carId, colour))
}

/**
 * Rivals' glass is see-through blending, not physical transmission. One
 * transmissive mesh anywhere makes three.js draw every opaque object (the whole
 * track) a second time into a transmission buffer, and a double-sided
 * transparent mesh is drawn twice (back faces, then front). On rivals neither
 * shows, so: tinted alpha glass, one pass.
 */
export function cheapForRivals(material: THREE.Material): THREE.Material {
  if (material instanceof THREE.MeshPhysicalMaterial && material.transmission > 0) {
    // Glass that let ~all light through reads as a light tint, never invisible.
    const opacity = THREE.MathUtils.clamp(1 - material.transmission * 0.7, 0.25, material.opacity)
    material.transmission = 0
    material.transmissionMap = null
    material.thickness = 0
    material.transparent = true
    material.opacity = opacity
    material.depthWrite = false
  }
  if (material.transparent) material.forceSinglePass = true
  return material
}

function paintedCopy(source: THREE.Material, carId: string, colour: number): THREE.Material {
  const kind = source instanceof THREE.MeshStandardMaterial ? paintKind(source.name, carId) : null
  if (!kind) {
    const own = source.clone()
    // Older assets name the body "body color" instead: recolour it as before.
    if (/body.?colou?r/i.test(source.name) && own instanceof THREE.MeshStandardMaterial) own.color.setHex(colour)
    return own
  }
  let paint: THREE.MeshPhysicalMaterial
  if (source instanceof THREE.MeshPhysicalMaterial) paint = source.clone()
  else {
    paint = new THREE.MeshPhysicalMaterial()
    THREE.MeshStandardMaterial.prototype.copy.call(paint, source)
  }
  paint.setValues(CLEARCOAT)
  if (kind === 'plain') {
    paint.setValues({ map: null, roughnessMap: null, metalnessMap: null, ...BASE })
    paint.color.setHex(colour)
  } else if (!paint.roughnessMap && !paint.metalnessMap) paint.setValues(BASE)
  return paint
}
