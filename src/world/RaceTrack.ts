import type { TrackAtmosphere } from './TrackAtmosphere'
import type { MinimapRaster } from './MinimapData'
import type RAPIER from '@dimforge/rapier3d-compat'
import type * as THREE from 'three'
import type { QualityPreset } from '../stores/gameStore'
import type { Surface } from '../vehicles/Surface'
import type { SpawnPoint } from '../vehicles/Vehicle'
import type { Checkpoint } from './Track'

/** How far the player can see on this track at a quality level. */
export interface ViewDistance {
  fogNear: number
  fogFar: number
}

/**
 * What Game needs from a track, whether procedural (Track) or streamed from a
 * chunked GLB package (StreamedTrack).
 */
export interface RaceTrack {
  readonly atmosphere?: TrackAtmosphere
  readonly id: string
  readonly name: string
  readonly group: THREE.Group
  readonly checkpoints: Checkpoint[]
  readonly spawn: SpawnPoint
  /** Closed centreline in race direction, ~4 m spacing, point 0 at the start line. */
  readonly line: THREE.Vector3[]
  /** What the ground is at a world XZ position (tire grip, sand / dust effects). */
  surfaceAt(x: number, z: number): Surface
  /** Experimental prediction owns/frees the returned isolated static-collision world. */
  createPredictionWorld?(): RAPIER.World
  /** Full road/land coverage for the HUD; independent of the racing line. */
  mapOverview?(): MinimapRaster | null
  /** True for colliders that are the paved road itself (not terrain, run-off or barriers). */
  isRoadCollider(collider: RAPIER.Collider): boolean
  /** Below this height the car has fallen out of the world. */
  readonly killY: number
  /** Where to put the car after a reset past checkpoint `index`. */
  respawnAt(index: number): SpawnPoint
  /** Render-time tick: streaming, LOD. `velocity` lets streamers prefetch ahead. */
  update(position: THREE.Vector3, velocity: THREE.Vector3, dt: number): void
  setQuality(quality: QualityPreset): Promise<void> | void
  /**
   * Load what the track needs to be raced and seen, beyond the physics the
   * loader returns with: materials, scenery, the chunks around the grid.
   * Absent = already complete. Boot calls it behind the menu.
   */
  loadVisuals?(onProgress?: (p: number) => void): Promise<void>
  viewDistance(quality: QualityPreset): ViewDistance
  dispose(): void
}
