/**
 * Final grade shared by both post stacks (effects/PostFX.ts for WebGL,
 * engine/nodes/postfx.ts for WebGPU): a light vignette that frames the car and
 * gives the image depth. postprocessing's VignetteEffect parameters.
 */
export const VIGNETTE_OFFSET = 0.32
export const VIGNETTE_DARKNESS = 0.38

/** Largest scene radiance the post stack passes on before blurs and bloom. Half floats overflow to Inf above 65504. */
export const MAX_SCENE_RADIANCE = 256
