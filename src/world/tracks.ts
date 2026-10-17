/**
 * Track definitions. Procedural tracks are a spline → road ribbon built at
 * runtime; streamed tracks come from scripts/track/build-track.mjs (a chunked
 * GLB package with a track.json manifest, see docs/TRACK_STREAMING.md).
 */
export type TrackDefinition = ProceduralTrackDefinition | StreamedTrackDefinition

export interface StreamedTrackDefinition {
  kind: 'streamed'
  id: string
  name: string
  manifestUrl: string
}

export interface ProceduralTrackDefinition {
  kind: 'procedural'
  id: string
  name: string
  /** Closed Catmull-Rom control points on the XZ plane, meters. */
  controlPoints: [number, number][]
  roadWidth: number
  checkpointCount: number
}

export const TEST_CIRCUIT: ProceduralTrackDefinition = {
  kind: 'procedural',
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

export const NURBURGRING: StreamedTrackDefinition = {
  kind: 'streamed',
  id: 'nurburgring',
  name: 'Nürburgring GP',
  manifestUrl: '/models/tracks/nurburgring/track.json',
}

export const TRACKS: TrackDefinition[] = [NURBURGRING, TEST_CIRCUIT]

export function getTrack(id: string): TrackDefinition {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0]
}
