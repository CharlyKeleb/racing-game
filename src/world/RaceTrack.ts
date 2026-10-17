import type * as THREE from 'three'
import type { QualityPreset } from '../stores/gameStore'
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
  readonly id: string
  readonly name: string
  readonly group: THREE.Group
  readonly checkpoints: Checkpoint[]
  readonly spawn: SpawnPoint
  /** Closed centreline in race direction, ~4 m spacing, point 0 at the start line. */
  readonly line: THREE.Vector3[]
  /** Below this height the car has fallen out of the world. */
  readonly killY: number
  /** Where to put the car after a reset past checkpoint `index`. */
  respawnAt(index: number): SpawnPoint
  /** Render-time tick: streaming, LOD. `velocity` lets streamers prefetch ahead. */
  update(position: THREE.Vector3, velocity: THREE.Vector3, dt: number): void
  setQuality(quality: QualityPreset): Promise<void> | void
  viewDistance(quality: QualityPreset): ViewDistance
  dispose(): void
}
