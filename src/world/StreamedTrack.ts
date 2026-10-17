import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { AssetManager } from '../engine/AssetManager'
import type { QualityPreset } from '../stores/gameStore'
import { Surface } from '../vehicles/Surface'
import type { SpawnPoint } from '../vehicles/Vehicle'
import type { RaceTrack, ViewDistance } from './RaceTrack'
import { decodeSurfaceRle, SurfaceMap, type SurfaceGridInfo } from './SurfaceMap'
import { NOT_LOADED, planLods, type ChunkInfo, type StreamRadii } from './streaming/ChunkPlanner'
import type { Checkpoint } from './Track'

/** Shape of track.json written by scripts/track/build-track.mjs. */
export interface TrackManifest {
  version: number
  id: string
  name: string
  chunkSize: number
  materials: { high: string; low: string }
  backdrop: string
  collision: string
  spawn: { position: [number, number, number]; heading: number }
  checkpoints: { index: number; position: [number, number, number]; tangent: [number, number, number]; radius: number }[]
  line: [number, number, number][]
  lineLength: number
  /** Surface-type grid (scripts/track/derive-from-chunks.mjs). Absent: everything reads as asphalt. */
  surface?: SurfaceGridInfo
  chunks: { id: string; min: [number, number, number]; max: [number, number, number]; lods: { url: string; bytes: number; tris: number }[] }[]
}

type Tier = 'high' | 'low'

export interface LoadOptions {
  assets: AssetManager
  renderer: THREE.WebGLRenderer
  camera: THREE.Camera
  /** The scene the track will live in — for shader precompilation. */
  scene: THREE.Scene
  world: RAPIER.World
  quality: QualityPreset
  onProgress?: (p: number) => void
}

/** Per-quality streaming budget. Low targets ~60 fps on 2019-era phones. */
const BUDGET: Record<QualityPreset, { radii: StreamRadii; tier: Tier; veg: boolean; shadows: boolean; concurrency: number }> = {
  low: { radii: { lod0: 120, lod1: 420, hysteresis: 40 }, tier: 'low', veg: false, shadows: false, concurrency: 1 },
  medium: { radii: { lod0: 200, lod1: 600, hysteresis: 50 }, tier: 'high', veg: true, shadows: false, concurrency: 2 },
  high: { radii: { lod0: 320, lod1: 900, hysteresis: 60 }, tier: 'high', veg: true, shadows: true, concurrency: 3 },
}

/** Stub name the pipeline gives merged far-LOD meshes (see build-track.mjs). */
const VERTEX_COLOR_MATERIAL = '__vertex_color'

/** Re-plan a few times a second — chunks are 200 m, the car covers ~20 m per tick at 300 km/h. */
const PLAN_INTERVAL = 0.2
/** Seconds of travel to prefetch ahead of the car. */
const LOOKAHEAD = 2.5

interface ChunkState {
  info: ChunkInfo
  urls: string[]
  /** LOD currently in the scene. */
  shown: number
  object: THREE.Object3D | null
  /** LOD being fetched, if any. */
  loading: number
}

const _ahead = new THREE.Vector3()

/**
 * A track streamed from a chunked GLB package: a shared material library,
 * an always-resident backdrop + collision mesh, and a grid of geometry chunks
 * swapped between LOD0 / LOD1 / unloaded around the car.
 *
 *   load():   manifest → material library → collision → backdrop → chunks near spawn
 *   update(): plan LODs → fetch (bounded concurrency) → integrate ≤ 1 chunk per frame
 */
export class StreamedTrack implements RaceTrack {
  readonly group = new THREE.Group()
  readonly checkpoints: Checkpoint[]
  readonly spawn: SpawnPoint
  readonly line: THREE.Vector3[]
  readonly killY: number
  readonly name: string
  readonly id: string

  private readonly baseUrl: string
  private readonly manifest: TrackManifest
  private readonly assets: AssetManager
  private readonly renderer: THREE.WebGLRenderer
  private readonly world: RAPIER.World
  private quality: QualityPreset
  private materials = new Map<string, THREE.Material>()
  private readonly fallbackMaterial = new THREE.MeshLambertMaterial({ color: 0x777777 })
  private readonly chunks: ChunkState[]
  private readonly infos: ChunkInfo[]
  private readonly camera: THREE.Camera
  private readonly scene: THREE.Scene
  private readonly wanted: Int8Array
  private readonly distances: Float32Array
  private readonly current: Int8Array
  private readonly ready: { index: number; lod: number; object: THREE.Object3D }[] = []
  private inFlight = 0
  private planTimer = 0
  private body: RAPIER.RigidBody | null = null
  /** Handles of the paved-road collision meshes (vs run-off, barriers, terrain). */
  private readonly roadColliders = new Set<number>()
  private surfaces: SurfaceMap | null = null
  private backdrop: THREE.Object3D | null = null
  private disposed = false

  private constructor(baseUrl: string, manifest: TrackManifest, opts: LoadOptions) {
    this.baseUrl = baseUrl
    this.manifest = manifest
    this.assets = opts.assets
    this.renderer = opts.renderer
    this.camera = opts.camera
    this.scene = opts.scene
    this.world = opts.world
    this.quality = opts.quality
    this.name = manifest.name
    this.id = manifest.id
    this.group.name = `track:${manifest.id}`

    this.checkpoints = manifest.checkpoints.map((c) => ({
      index: c.index,
      position: new THREE.Vector3(...c.position),
      tangent: new THREE.Vector3(...c.tangent).normalize(),
      radius: c.radius,
    }))
    this.spawn = { position: new THREE.Vector3(...manifest.spawn.position), heading: manifest.spawn.heading }
    this.line = manifest.line.map((p) => new THREE.Vector3(...p))
    this.chunks = manifest.chunks.map((c) => ({
      info: { minX: c.min[0], minZ: c.min[2], maxX: c.max[0], maxZ: c.max[2], lodCount: c.lods.length },
      urls: c.lods.map((l) => baseUrl + l.url),
      shown: NOT_LOADED,
      object: null,
      loading: NOT_LOADED,
    }))
    this.infos = this.chunks.map((c) => c.info)
    this.killY = Math.min(...manifest.chunks.map((c) => c.min[1])) - 60
    this.wanted = new Int8Array(this.chunks.length).fill(NOT_LOADED)
    this.current = new Int8Array(this.chunks.length).fill(NOT_LOADED)
    this.distances = new Float32Array(this.chunks.length)
  }

  /**
   * Loads everything needed to start racing at the spawn point. Resolves once
   * the car's surroundings are in full detail; the rest streams in while driving.
   */
  static async load(manifestUrl: string, opts: LoadOptions): Promise<StreamedTrack> {
    const manifest = await opts.assets.loadJson<TrackManifest>(manifestUrl)
    if (!manifest) throw new Error(`Track manifest missing: ${manifestUrl}`)
    const baseUrl = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1)
    const track = new StreamedTrack(baseUrl, manifest, opts)
    const progress = opts.onProgress ?? (() => {})

    progress(0.05)
    await Promise.all([track.loadMaterials(BUDGET[opts.quality].tier), track.loadCollision(), track.loadSurfaces()])
    progress(0.35)
    await track.loadBackdrop()
    progress(0.45)
    await track.preload(track.spawn.position, (p) => progress(0.45 + p * 0.55))
    return track
  }

  // ── Setup ───────────────────────────────────────────────────────────────

  private async loadMaterials(tier: Tier): Promise<void> {
    const gltf = await this.assets.loadGltf(this.baseUrl + this.manifest.materials[tier])
    const loaded = (await gltf.parser.getDependencies('material')) as THREE.MeshStandardMaterial[]
    const next = new Map<string, THREE.Material>()
    for (const src of loaded) next.set(src.name, this.convertMaterial(src, tier))
    // Merged far-LOD chunks: one untextured, vertex-coloured material for all of them.
    next.set(
      VERTEX_COLOR_MATERIAL,
      tier === 'low'
        ? new THREE.MeshLambertMaterial({ name: VERTEX_COLOR_MATERIAL, vertexColors: true })
        : new THREE.MeshStandardMaterial({ name: VERTEX_COLOR_MATERIAL, vertexColors: true, roughness: 0.95, metalness: 0 }),
    )

    const old = this.materials
    this.materials = next
    // Retarget already-streamed meshes, then free the previous tier's GPU memory.
    this.forEachTrackMesh((mesh) => (mesh.material = this.materialFor(mesh.userData.mat as string)))
    disposeMaterials(old)
    await this.precompile()
  }

  /**
   * Low tier swaps PBR for Lambert: per-vertex lighting, far cheaper on mobile
   * GPUs, and the track is mostly diffuse surfaces anyway.
   */
  private convertMaterial(src: THREE.MeshStandardMaterial, tier: Tier): THREE.Material {
    const layer = (src.userData.layer as string | undefined) ?? 'prop'
    if (src.map) {
      src.map.anisotropy = tier === 'high' && (layer === 'road' || layer === 'decal') ? Math.min(4, this.renderer.capabilities.getMaxAnisotropy()) : 1
    }
    let m: THREE.Material
    if (tier === 'low') {
      m = new THREE.MeshLambertMaterial({
        name: src.name,
        map: src.map,
        color: src.color,
        emissive: src.emissive,
        emissiveMap: src.emissiveMap,
        transparent: src.transparent,
        alphaTest: src.alphaTest,
        side: src.side,
      })
      src.dispose()
    } else {
      src.envMapIntensity = 0.4
      m = src
    }
    if (layer === 'decal') {
      // Lines and kerb borders sit millimetres above the asphalt.
      m.polygonOffset = true
      m.polygonOffsetFactor = -2
      m.polygonOffsetUnits = -2
      if (m.transparent) m.depthWrite = false
    }
    m.userData.layer = layer
    return m
  }

  /**
   * Compile every shader variant up front so the first sight of a material
   * doesn't hitch. Uses the real scene's lights/fog so the programs match.
   */
  private async precompile(): Promise<void> {
    const scene = new THREE.Scene()
    const geo = new THREE.PlaneGeometry(0.01, 0.01)
    for (const m of this.materials.values()) scene.add(new THREE.Mesh(geo, m))
    try {
      await this.renderer.compileAsync(scene, this.camera, this.scene)
    } finally {
      geo.dispose()
    }
  }

  private async loadCollision(): Promise<void> {
    const gltf = await this.assets.loadGltf(this.baseUrl + this.manifest.collision)
    if (this.disposed) return
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    const v = new THREE.Vector3()
    gltf.scene.updateMatrixWorld(true)
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const pos = mesh.geometry.getAttribute('position')
      const index = mesh.geometry.getIndex()
      if (!index) return
      const vertices = new Float32Array(pos.count * 3)
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
        vertices[i * 3] = v.x
        vertices[i * 3 + 1] = v.y
        vertices[i * 3 + 2] = v.z
      }
      const barrier = mesh.name.startsWith('barrier')
      const desc = RAPIER.ColliderDesc.trimesh(vertices, Uint32Array.from(index.array))
        .setFriction(barrier ? 0.25 : 0.9)
        .setRestitution(barrier ? 0.2 : 0)
      const collider = this.world.createCollider(desc, this.body!)
      if (mesh.name.startsWith('road')) this.roadColliders.add(collider.handle)
      mesh.geometry.dispose()
    })
  }

  private async loadSurfaces(): Promise<void> {
    const info = this.manifest.surface
    if (!info) return
    const bytes = await this.assets.loadBinary(this.baseUrl + info.url)
    if (bytes) this.surfaces = new SurfaceMap(info, decodeSurfaceRle(bytes, info.width * info.height))
  }

  surfaceAt(x: number, z: number): Surface {
    return this.surfaces ? this.surfaces.at(x, z) : Surface.Asphalt
  }

  private async loadBackdrop(): Promise<void> {
    const gltf = await this.assets.loadGltf(this.baseUrl + this.manifest.backdrop)
    this.backdrop = this.adopt(gltf.scene)
    this.group.add(this.backdrop)
  }

  /** Loads every chunk the spawn point wants before the race begins. */
  private async preload(at: THREE.Vector3, onProgress: (p: number) => void): Promise<void> {
    planLods(this.infos, [at.x, at.z], [at.x, at.z], BUDGET[this.quality].radii, this.current, this.wanted, this.distances)
    const jobs = this.chunks.map((_, i) => i).filter((i) => this.wanted[i] !== NOT_LOADED)
    let done = 0
    const queue = [...jobs].sort((a, b) => this.distances[a] - this.distances[b])
    const worker = async () => {
      for (let i = queue.shift(); i !== undefined; i = queue.shift()) {
        const object = await this.fetchChunk(i, this.wanted[i])
        if (this.disposed) return
        this.show(i, this.wanted[i], object)
        onProgress(++done / jobs.length)
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
  }

  // ── Streaming ───────────────────────────────────────────────────────────

  update(position: THREE.Vector3, velocity: THREE.Vector3, dt: number): void {
    // Integrate at most one finished chunk per frame: GPU upload of a fresh
    // chunk is the main hitch source on mobile.
    const next = this.ready.shift()
    if (next) {
      if (this.wanted[next.index] === next.lod) this.show(next.index, next.lod, next.object)
      else disposeObject(next.object)
    }

    this.planTimer -= dt
    if (this.planTimer > 0) return
    this.planTimer = PLAN_INTERVAL

    _ahead.copy(position).addScaledVector(velocity, LOOKAHEAD)
    const budget = BUDGET[this.quality]
    planLods(this.infos, [position.x, position.z], [_ahead.x, _ahead.z], budget.radii, this.current, this.wanted, this.distances)

    // Unloads are cheap — do them all now.
    for (let i = 0; i < this.chunks.length; i++) {
      if (this.wanted[i] === NOT_LOADED && this.chunks[i].shown !== NOT_LOADED) this.show(i, NOT_LOADED, null)
    }

    // Fetch the nearest missing chunks first.
    if (this.inFlight >= budget.concurrency) return
    const pending: number[] = []
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i]
      const w = this.wanted[i]
      if (w !== NOT_LOADED && w !== c.shown && c.loading !== w && !this.ready.some((r) => r.index === i && r.lod === w)) pending.push(i)
    }
    pending.sort((a, b) => this.distances[a] - this.distances[b])
    for (const i of pending) {
      if (this.inFlight >= budget.concurrency) break
      const lod = this.wanted[i]
      this.chunks[i].loading = lod
      this.inFlight++
      this.fetchChunk(i, lod)
        .then((object) => {
          if (this.disposed) disposeObject(object)
          else this.ready.push({ index: i, lod, object })
        })
        .catch((err: unknown) => console.warn(`[StreamedTrack] chunk ${this.manifest.chunks[i].id} lod${lod} failed`, err))
        .finally(() => {
          this.inFlight--
          if (this.chunks[i].loading === lod) this.chunks[i].loading = NOT_LOADED
        })
    }
  }

  private async fetchChunk(index: number, lod: number): Promise<THREE.Object3D> {
    const gltf = await this.assets.loadGltf(this.chunks[index].urls[lod])
    return this.adopt(gltf.scene)
  }

  /** Swap a chunk's visible LOD (or unload it with NOT_LOADED). */
  private show(index: number, lod: number, object: THREE.Object3D | null): void {
    const c = this.chunks[index]
    if (c.object) {
      this.group.remove(c.object)
      disposeObject(c.object)
    }
    c.object = object
    c.shown = lod
    this.current[index] = lod
    if (object) this.group.add(object)
  }

  /**
   * Prepares freshly loaded geometry: shared materials by name, shadow flags
   * per layer, vegetation visibility, and frozen matrices (the track never moves,
   * so skip per-frame matrix updates for thousands of nodes).
   */
  private adopt(root: THREE.Object3D): THREE.Object3D {
    const budget = BUDGET[this.quality]
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        const stub = mesh.material as THREE.Material
        mesh.userData.mat = stub.name
        mesh.material = this.materialFor(stub.name)
        stub.dispose()
        // Node names are 'layer__material' ('__' survives GLTFLoader's name sanitising).
        const layer = mesh.name.split('__')[0]
        mesh.userData.layer = layer
        applyLayerFlags(mesh, budget)
      }
      o.matrixAutoUpdate = false
      o.updateMatrix()
    })
    root.updateMatrixWorld(true)
    root.matrixWorldAutoUpdate = false
    return root
  }

  private materialFor(name: string): THREE.Material {
    return this.materials.get(name) ?? this.fallbackMaterial
  }

  private forEachTrackMesh(fn: (mesh: THREE.Mesh) => void): void {
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) fn(o as THREE.Mesh)
    })
  }

  // ── RaceTrack ───────────────────────────────────────────────────────────

  isRoadCollider(collider: RAPIER.Collider): boolean {
    return this.roadColliders.has(collider.handle)
  }

  respawnAt(index: number): SpawnPoint {
    const cp = this.checkpoints[index] ?? this.checkpoints[0]
    if (index === 0) return this.spawn
    return {
      position: cp.position.clone().setY(cp.position.y + 0.8),
      heading: Math.atan2(cp.tangent.x, cp.tangent.z),
    }
  }

  async setQuality(quality: QualityPreset): Promise<void> {
    if (quality === this.quality) return
    const prevTier = BUDGET[this.quality].tier
    this.quality = quality
    const b = BUDGET[quality]
    this.forEachTrackMesh((mesh) => applyLayerFlags(mesh, b))
    this.planTimer = 0
    if (b.tier !== prevTier) await this.loadMaterials(b.tier)
  }

  viewDistance(quality: QualityPreset): ViewDistance {
    const r = BUDGET[quality].radii.lod1
    // Fog swallows the streaming edge so chunks never visibly pop in.
    // Haze starts well out: starting it close washed the road out to a pale grey.
    return { fogNear: r * 0.45, fogFar: r * 0.95 }
  }

  /** Debug/HUD: how much of the track is resident. */
  get stats(): { lod0: number; lod1: number; loading: number } {
    let lod0 = 0
    let lod1 = 0
    for (const c of this.chunks) {
      if (c.shown === 0) lod0++
      else if (c.shown === 1) lod1++
    }
    return { lod0, lod1, loading: this.inFlight }
  }

  dispose(): void {
    this.disposed = true
    for (const r of this.ready) disposeObject(r.object)
    this.ready.length = 0
    for (let i = 0; i < this.chunks.length; i++) this.show(i, NOT_LOADED, null)
    if (this.backdrop) disposeObject(this.backdrop)
    if (this.body) this.world.removeRigidBody(this.body)
    disposeMaterials(this.materials)
    this.fallbackMaterial.dispose()
    this.group.removeFromParent()
  }
}

/** Shadows only where they read (near detail), vegetation only when the budget allows. */
function applyLayerFlags(mesh: THREE.Mesh, budget: { shadows: boolean; veg: boolean }): void {
  const layer = mesh.userData.layer as string
  mesh.receiveShadow = budget.shadows && (layer === 'road' || layer === 'ground' || layer === 'decal' || layer === 'terrain')
  mesh.castShadow = budget.shadows && (layer === 'barrier' || layer === 'prop')
  if (layer === 'veg') mesh.visible = budget.veg
}

/** Geometry only — materials are shared and owned by the library. */
function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.isMesh) mesh.geometry.dispose()
  })
}

function disposeMaterials(materials: Map<string, THREE.Material>): void {
  const textures = new Set<THREE.Texture>()
  for (const m of materials.values()) {
    const { map, emissiveMap } = m as THREE.MeshStandardMaterial
    if (map) textures.add(map)
    if (emissiveMap) textures.add(emissiveMap)
    m.dispose()
  }
  textures.forEach((t) => t.dispose())
}
