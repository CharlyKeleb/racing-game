import type { WebGPURenderer } from 'three/webgpu'
import type * as Nodes from './nodes'

/** Which renderer draws the game (Settings → Graphics → Renderer). */
export type RendererKind = 'webgl' | 'webgpu'

/**
 * The renderer chosen for this session, set once by `Renderer.init()` before
 * any scene content is built. Effects read it to pick their WebGL material or
 * the node (TSL) version: `WebGPURenderer` can't run `ShaderMaterial`s or
 * `onBeforeCompile` patches, and the classic renderer can't run node materials.
 *
 * `nodes` is the lazily loaded node module (three/webgpu + three/tsl and the
 * game's node materials), so WebGL players never download it.
 */
export const backend: {
  kind: RendererKind
  /** The node module, loaded only for WebGPURenderer. */
  nodes: typeof Nodes | null
  /** The WebGPURenderer, for compute dispatches (GPU particles). */
  renderer: WebGPURenderer | null
} = { kind: 'webgl', nodes: null, renderer: null }

/** The node module, for code that only runs when `backend.kind === 'webgpu'`. */
export function nodes(): typeof Nodes {
  if (!backend.nodes) throw new Error('node materials used before the WebGPU renderer loaded')
  return backend.nodes
}
