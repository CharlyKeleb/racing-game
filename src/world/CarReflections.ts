import type * as THREE from 'three'

type Lit = THREE.MeshStandardMaterial & { isMeshStandardNodeMaterial?: boolean }

/**
 * Point every lit (standard/physical) material on a car at the cars'
 * reflection map (Environment.carEnvironment), or back to the scene
 * environment with `map` null (the garage showroom bakes its own room).
 * Unlit materials (nitro flames, trails, lamp glows) are left alone. Only
 * touches materials whose value differs, so calling it repeatedly is cheap;
 * a material only recompiles when it gains or loses its own map.
 */
export function applyCarReflections(root: THREE.Object3D, map: THREE.Texture | null, intensity: number): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of materials) {
      const lit = m as Lit
      if (!lit.isMeshStandardMaterial && !lit.isMeshStandardNodeMaterial) continue
      if (lit.envMap !== map) {
        if (!lit.envMap !== !map) lit.needsUpdate = true
        lit.envMap = map
      }
      const strength = map ? intensity : 1
      if (lit.envMapIntensity !== strength) lit.envMapIntensity = strength
    }
  })
}
