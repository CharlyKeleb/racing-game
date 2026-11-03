import * as THREE from 'three'
import type { TrafficModel } from './StreetLife'

/**
 * Civilian cars for the street maps' traffic, built by scripts/traffic/prepare-traffic.mjs
 * (credits in public/models/CREDITS.md). Each GLB is nose toward +Z, wheels on y = 0, about 4.4 m long.
 */
export const TRAFFIC_MODEL_IDS = ['milano95', 'kiri86', 'lasley67', 'canyon75taxi', 'fairheaven80taxi'] as const

export const trafficModelUrl = (id: string): string => `/models/traffic/${id}.glb`

/** A loaded traffic GLB as one mesh per material, transforms baked in. */
export function toTrafficModel(root: THREE.Object3D): TrafficModel {
  const parts: TrafficModel = []
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) parts.push({ geometry, material })
  })
  return parts
}
