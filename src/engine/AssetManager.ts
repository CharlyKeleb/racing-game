import { performanceCapture } from './PerformanceCapture'
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

// Decode meshopt buffers on worker threads so streamed track chunks don't
// stall the main thread mid-race.
const METADATA_CACHE_LIMIT = 32
/**
 * A download is given up only once no bytes have arrived for this long. It used to be a fixed
 * deadline (12 s for JSON, 20 s for models), which a slow but steady connection blew through:
 * a 5 MB car takes ~30 s at 1.5 Mbps, and the track manifest queued behind it read as missing.
 */
const STALL_MS = 15_000
/** Waits (ms) before retrying a download that failed on the network, stalled or hit a server error. */
const RETRY_WAITS = [1000, 3000]

let workersStarted = false
function startDecoderWorkers(): void {
  if (workersStarted || typeof Worker === 'undefined') return
  workersStarted = true
  // oxlint-disable-next-line react-hooks/rules-of-hooks -- a meshopt API, not a React hook
  MeshoptDecoder.useWorkers(Math.min(2, Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1)))
}

interface GltfEntry {
  promise: Promise<GLTF>
  /** Fraction downloaded, 0..1. */
  progress: number
  listeners: Set<(fraction: number) => void>
}

/**
 * Caches and loads runtime assets. GLBs are expected to come out of the
 * Blender MCP pipeline (docs/ASSET_PIPELINE.md), optionally meshopt-compressed
 * with gltfpack / gltf-transform.
 */
export class AssetManager {
  private disposed = false
  private readonly gltfLoader: GLTFLoader
  private readonly gltfCache = new Map<string, GltfEntry>()
  private readonly jsonCache = new Map<string, Promise<unknown | null>>()

  constructor() {
    this.gltfLoader = new GLTFLoader()
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder)
    startDecoderWorkers()
  }

  /** Uncached load, for streamed content the caller owns and disposes. `onProgress` gets the downloaded fraction, 0..1. */
  async loadGltf(url: string, signal?: AbortSignal, onProgress?: (fraction: number) => void): Promise<GLTF> {
    if (this.disposed) throw new Error('Asset manager disposed')
    const profiling = performanceCapture.active
    const started = profiling ? performance.now() : 0
    const absolute = new URL(url, document.baseURI)
    const download = await fetchBytes(absolute.href, signal, onProgress)
    if (!download) throw new Error(`GLTF unavailable: ${url}`)
    const bytes = download.bytes
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

  /** Returns a fresh clone so callers can mutate their copy freely. `onProgress` reports the download, shared or not. */
  async loadModel(url: string, onProgress?: (fraction: number) => void): Promise<THREE.Group> {
    const gltf = await this.cachedGltf(url, onProgress)
    if (this.disposed) throw new Error('Asset manager disposed')
    return gltf.scene.clone(true)
  }

  /** Fetches and parses a model into the cache, for a later loadModel to clone at once. */
  async preloadModel(url: string): Promise<void> {
    // A failed preload is retried (and reported) by the real load.
    await this.cachedGltf(url).catch(() => {})
  }

  private cachedGltf(url: string, onProgress?: (fraction: number) => void): Promise<GLTF> {
    if (this.disposed) return Promise.reject(new Error('Asset manager disposed'))
    let entry = this.gltfCache.get(url)
    if (!entry) {
      const listeners = new Set<(fraction: number) => void>()
      const created: GltfEntry = { promise: Promise.resolve(null as unknown as GLTF), progress: 0, listeners }
      created.promise = this.loadGltf(url, undefined, (p) => {
        created.progress = p
        for (const listener of listeners) listener(p)
      })
      created.promise.then(() => listeners.clear(), () => {
        listeners.clear()
        if (this.gltfCache.get(url) === created) this.gltfCache.delete(url)
      })
      this.gltfCache.set(url, entry = created)
    }
    if (onProgress) {
      onProgress(entry.progress)
      // A preload already under way still reports its progress to the load that needs it.
      if (entry.progress < 1) entry.listeners.add(onProgress)
    }
    return entry.promise
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

  /** Null covers a missing file, SPA HTML fallback responses, and a download that still failed after retrying. */
  private async fetchJson(url: string): Promise<unknown | null> {
    try {
      const download = await fetchBytes(url)
      if (!download || !download.contentType.includes('json')) return null
      return JSON.parse(new TextDecoder().decode(download.bytes))
    } catch (err) {
      console.warn(`[AssetManager] couldn't download ${url}`, err)
      return null
    }
  }

  /** Raw bytes, or null when missing (or still failing after retries). */
  async loadBinary(url: string): Promise<Uint8Array | null> {
    try {
      const download = await fetchBytes(url)
      return download ? new Uint8Array(download.bytes) : null
    } catch (err) {
      console.warn(`[AssetManager] couldn't download ${url}`, err)
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
    for (const { promise } of this.gltfCache.values()) void promise.then(disposeGltf, () => {})
    this.gltfCache.clear()
    this.jsonCache.clear()
  }

}

/**
 * GET `url` as bytes. Null when it isn't there: a 4xx, or a SPA's HTML fallback page. A network
 * error, a stall (see STALL_MS) or a server error is retried (RETRY_WAITS), then thrown, as is an
 * abort by `signal`. `onProgress` gets the fraction received (0 until the size is known).
 */
async function fetchBytes(url: string, signal?: AbortSignal, onProgress?: (fraction: number) => void): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchBytesOnce(url, signal, onProgress)
    } catch (err) {
      // Aborted by the caller: not a network failure, nothing to retry.
      if (signal?.aborted || attempt >= RETRY_WAITS.length) throw err
      await new Promise<void>((done) => setTimeout(done, RETRY_WAITS[attempt]))
      signal?.throwIfAborted()
    }
  }
}

async function fetchBytesOnce(url: string, signal?: AbortSignal, onProgress?: (fraction: number) => void): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const stall = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const alive = () => {
    clearTimeout(timer)
    timer = setTimeout(() => stall.abort(new DOMException(`Download stalled: ${url}`, 'TimeoutError')), STALL_MS)
  }
  alive()
  try {
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, stall.signal]) : stall.signal })
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('text/html') || (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429)) {
      void response.body?.cancel().catch(() => {})
      return null
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
    if (!response.body) return { bytes: await response.arrayBuffer(), contentType }
    // Content-Length is the encoded size: with compression on the wire it isn't the byte count read.
    const encoded = response.headers.get('content-encoding')
    const total = encoded && encoded !== 'identity' ? 0 : Number(response.headers.get('content-length')) || 0
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    for (;;) {
      alive()
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.byteLength
      if (onProgress && total) onProgress(Math.min(1, received / total))
    }
    const bytes = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    onProgress?.(1)
    return { bytes: bytes.buffer, contentType }
  } finally {
    clearTimeout(timer)
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
