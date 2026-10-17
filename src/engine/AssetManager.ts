import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

/**
 * Caches and loads runtime assets. GLBs are expected to come out of the
 * Blender MCP pipeline (docs/ASSET_PIPELINE.md), optionally meshopt-compressed
 * with gltfpack / gltf-transform.
 */
export class AssetManager {
  private readonly gltfLoader: GLTFLoader
  private readonly gltfCache = new Map<string, Promise<GLTF>>()

  constructor() {
    this.gltfLoader = new GLTFLoader()
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder)
  }

  /** Returns a fresh clone so callers can mutate their copy freely. */
  async loadModel(url: string): Promise<THREE.Group> {
    let promise = this.gltfCache.get(url)
    if (!promise) {
      promise = this.gltfLoader.loadAsync(url)
      this.gltfCache.set(url, promise)
      promise.catch(() => this.gltfCache.delete(url))
    }
    const gltf = await promise
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
}
