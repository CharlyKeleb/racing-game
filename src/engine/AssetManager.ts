import { performanceCapture } from './PerformanceCapture'
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

// Decode meshopt buffers on worker threads so streamed track chunks don't
// stall the main thread mid-race.
const METADATA_CACHE_LIMIT = 32

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
  private readonly jsonCache = new Map<string, Promise<unknown | null>>()

  constructor() {
    this.gltfLoader = new GLTFLoader()
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder)
    startDecoderWorkers()
  }

  /** Uncached load, for streamed content the caller owns and disposes. */
  async loadGltf(url: string, signal?: AbortSignal): Promise<GLTF> {
    if (this.disposed) throw new Error('Asset manager disposed')
    const profiling = performanceCapture.active
    const started = profiling ? performance.now() : 0
    const absolute = new URL(url, document.baseURI)
    const timeout = AbortSignal.timeout(20_000)
    const response = await fetch(absolute, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
    if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error(`GLTF unavailable: ${url}`)
    const bytes = await response.arrayBuffer()
    signal?.throwIfAborted()
    const fetched = profiling ? performance.now() : 0
    const gltf = await this.gltfLoader.parseAsync(bytes, new URL('.', absolute).href)
    if (profiling) {
      performanceCapture.event('asset-fetch', fetched - started, { url, bytes: bytes.byteLength })
      performanceCapture.event('asset-parse', performance.now() - fetched, { url })
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
      promise = this.loadGltf(url)
      this.gltfCache.set(url, promise)
      const pending = promise
      promise.catch(() => {
        if (this.gltfCache.get(url) === pending) this.gltfCache.delete(url)
      })
    }
    const gltf = await promise
    if (this.disposed) throw new Error('Asset manager disposed')
    return gltf.scene.clone(true)
  }

  /** Deduplicate metadata requests within a page; each caller gets an owned copy. */
  async loadJson<T>(url: string): Promise<T | null> {
    if (this.disposed) return null
    let pending = this.jsonCache.get(url)
    if (pending) {
      // Refresh insertion order so infrequently used entries are evicted first.
      this.jsonCache.delete(url)
      this.jsonCache.set(url, pending)
    } else {
      pending = this.fetchJson(url)
      this.jsonCache.set(url, pending)
      const request = pending
      void request.then(value => {
        // A transient error must not poison future race/car selection attempts.
        if (value === null && this.jsonCache.get(url) === request) this.jsonCache.delete(url)
      })
      if (this.jsonCache.size > METADATA_CACHE_LIMIT) {
        const oldest = this.jsonCache.keys().next().value
        if (oldest !== undefined) this.jsonCache.delete(oldest)
      }
    }
    const value = await pending
    return this.disposed || value === null ? null : structuredClone(value) as T
  }

  /** Null covers a missing file and SPA HTML fallback responses. */
  private async fetchJson(url: string): Promise<unknown | null> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12_000) })
      if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null
      return await res.json()
    } catch {
      return null
    }
  }

  /** Raw bytes, or null when missing. */
  async loadBinary(url: string): Promise<Uint8Array | null> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12_000) })
      if (!res.ok || res.headers.get('content-type')?.includes('text/html')) return null
      return new Uint8Array(await res.arrayBuffer())
    } catch {
      return null
    }
  }

  /** Cheap existence check so we can fall back to placeholder assets quietly. */
  async exists(url: string): Promise<boolean> {
    try {
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
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
    this.jsonCache.clear()
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
