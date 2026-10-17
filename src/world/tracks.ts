/**
 * Track definitions. The first track is procedural (spline → road ribbon) so
 * we can drive before any Blender track exists. Authored tracks later add a
 * `modelUrl` whose GLB follows the track contract in docs/ASSET_PIPELINE.md.
 */
export interface TrackDefinition {
  id: string
  name: string
  /** Closed Catmull-Rom control points on the XZ plane, meters. */
  controlPoints: [number, number][]
  roadWidth: number
  checkpointCount: number
  modelUrl?: string
}

export const TEST_CIRCUIT: TrackDefinition = {
  id: 'test-circuit',
  name: 'Papaya Test Circuit',
  controlPoints: [
    [0, -120],
    [90, -140],
    [170, -90],
    [190, 10],
    [140, 80],
    [60, 70],
    [20, 130],
    [-60, 170],
    [-150, 120],
    [-170, 20],
    [-110, -40],
    [-60, -110],
  ],
  roadWidth: 14,
  checkpointCount: 12,
}

export const TRACKS: TrackDefinition[] = [TEST_CIRCUIT]
