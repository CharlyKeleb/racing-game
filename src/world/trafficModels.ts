import * as THREE from 'three'
import type { TrafficModel } from './StreetLife'

/**
 * Civilian cars for the street maps' traffic, built by scripts/traffic/prepare-traffic.mjs
 * (credits in public/models/CREDITS.md). Each GLB is nose toward +Z, wheels on y = 0, about 4.4 m long.
 */
/** Low quality uses only the first two (a saloon and a taxi), as lighter `_low` files. */
export const TRAFFIC_MODEL_IDS = ['milano95', 'canyon75taxi', 'kiri86', 'lasley67', 'fairheaven80taxi'] as const

export const LOW_TRAFFIC_MODELS = 2

export const trafficModelUrl = (id: string, low: boolean): string => `/models/traffic/${id}${low ? '_low' : ''}.glb`

/** A loaded traffic GLB as one mesh per material, transforms baked in. */
export function toTrafficModel(root: THREE.Object3D): TrafficModel {
  const parts: TrafficModel = []
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const geometry = mesh.geometry.clone()
    // Meshopt-quantised positions are normalised integers in [-1, 1] with the scale on the node:
    // widen them to floats first, or baking the node's scale in clamps the car to a 2 m cube.
    const position = geometry.getAttribute('position')
    if (!(position.array instanceof Float32Array) || position.normalized) {
      const floats = new Float32Array(position.count * 3)
      for (let i = 0; i < position.count; i++) { floats[i * 3] = position.getX(i); floats[i * 3 + 1] = position.getY(i); floats[i * 3 + 2] = position.getZ(i) }
      geometry.setAttribute('position', new THREE.BufferAttribute(floats, 3))
    }
    geometry.applyMatrix4(mesh.matrixWorld)
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) parts.push({ geometry, material })
  })
  return parts
}
