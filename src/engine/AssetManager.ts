import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

// Decode meshopt buffers on worker threads so streamed track chunks don't
// stall the main thread mid-race.
let workersStarted = false
function startDecoderWorkers(): void {
  if (workersStarted || typeof Worker === 'undefined') return
  workersStarted = true
  // oxlint-disable-next-line react-hooks/rules-of-hooks -- a meshopt API, not a React hook
  MeshoptDecoder.useWorkers(Math.min(2, Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1)))
}

/**
 * Caches and loads runtime assets. GLBs are expected to come out of the
 * Blender MCP pipeline (docs/ASSET_PIPELINE.md), optionally meshopt-compressed
 * with gltfpack / gltf-transform.
 */
export class AssetManager {
  private disposed = false
  private readonly gltfLoader: GLTFLoader
  private readonly gltfCache = new Map<string, Promise<GLTF>>()

  constructor() {
    this.gltfLoader = new GLTFLoader()
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder)
    startDecoderWorkers()
  }

  /** Uncached load, for streamed content the caller owns and disposes. */
  async loadGltf(url: string, signal?: AbortSignal): Promise<GLTF> {
    if (this.disposed) throw new Error('Asset manager disposed')
    let gltf: GLTF
    if (signal) {
      const absolute = new URL(url, document.baseURI)
      const response = await fetch(absolute, { signal })
      if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error(`GLTF unavailable: ${url}`)
      const bytes = await response.arrayBuffer()
      signal.throwIfAborted()
      gltf = await this.gltfLoader.parseAsync(bytes, new URL('.', absolute).href)
    } else {
      gltf = await this.gltfLoader.loadAsync(url)
    }
    if (this.disposed || signal?.aborted) {
      disposeGltf(gltf)
      if (signal?.aborted) signal.throwIfAborted()
      throw new Error('Asset manager disposed')
    }
    return gltf
  }

  /** Returns a fresh clone so callers can mutate their copy freely. */
  async loadModel(url: string): Promise<THREE.Group> {
    if (this.disposed) throw new Error('Asset manager disposed')
    let promise = this.gltfCache.get(url)
    if (!promise) {
      promise = this.gltfLoader.loadAsync(url)
      this.gltfCache.set(url, promise)
      promise.catch(() => this.gltfCache.delete(url))
    }
    const gltf = await promise
    if (this.disposed) throw new Error('Asset manager disposed')
    return gltf.scene.clone(true)
  }

  /** Returns null when the file is missing (Vite serves index.html for 404s in dev). */
  async loadJson<T>(url: string): Promise<T | null> {
    try {
      const res = await fetch(url)
      if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null
      return (await res.json()) as T
    } catch {
      return null
    }
  }

  /** Raw bytes, or null when missing. */
  async loadBinary(url: string): Promise<Uint8Array | null> {
    try {
      const res = await fetch(url)
      if (!res.ok || res.headers.get('content-type')?.includes('text/html')) return null
      return new Uint8Array(await res.arrayBuffer())
    } catch {
      return null
    }
  }

  /** Cheap existence check so we can fall back to placeholder assets quietly. */
  async exists(url: string): Promise<boolean> {
    try {
      const res = await fetch(url, { method: 'HEAD' })
      const type = res.headers.get('content-type') ?? ''
      return res.ok && !type.includes('text/html')
    } catch {
      return false
    }
  }
  /** Cached source models own shared geometry/textures; release them at shutdown. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const promise of this.gltfCache.values()) void promise.then(disposeGltf, () => {})
    this.gltfCache.clear()
  }

}

/** Release a GLTF that will never be adopted by a scene owner. */
export function disposeGltf(gltf: GLTF): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  for (const scene of gltf.scenes) scene.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    geometries.add(node.geometry)
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material)
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
    }
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
  for (const texture of textures) texture.dispose()
}
