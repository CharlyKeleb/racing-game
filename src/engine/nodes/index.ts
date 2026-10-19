/**
 * Everything WebGPURenderer needs, in one lazily loaded chunk (see
 * engine/backend.ts): the renderer and PMREM from three/webgpu, plus the
 * game's node (TSL) materials, GPU particles and post stack.
 */
export { WebGPURenderer, PMREMGenerator } from 'three/webgpu'
export { GpuParticlePool } from './particles'
export { NodePostFX } from './postfx'
export { floorSheen, hazeMaterial, instanceFadeMaterial, lensDropMaterial, liveryPaintMaterial, rainMaterial, skidMarkMaterial, skyDome } from './materials'

export { rainSurfaceMaterial, rainImpactMaterial, wetRoadMaterial } from './rainSurface'
