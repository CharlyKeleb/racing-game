// Build config for the Sketchfab "City" model (~/Downloads/city.glb, by
// golukumar, SKETCHFAB Standard licence, see the model page in its asset extras).
//
// The source is a 204k-triangle district modelled as a ~15 × 24 unit miniature
// (street lamps 0.25 units tall), so it is scaled ×32: 8 m lamps, 8–9 m
// streets, 60 m towers, a ~470 × 775 m map. Coordinates below are in SCALED
// source space (node scripts/track/topdown.mjs with SCALE=32).
//
// Its 100 materials are anonymous (material_104_93_N), so the layers come from
// geometry: flat, low surfaces with no walls are road; materials with large
// vertical area are buildings, which collide so the car can't drive into them.
//
// It has no circuit and no ground between blocks (the void around the streets
// is empty). The race runs a ~1.6 km clockwise loop over every street that
// connects: north up the tram avenue, east along the top street, south down
// the narrow back alley between the towers, and west along the bottom street.

/** Materials by number (material_104_93_N). */
const M = (...ids) => new RegExp(`^material_104_93_(${ids.join('|')})$`)

/** Carriageways: the avenue (39), its edge lines, the cross streets and junctions, the alley. */
const LANES = [39, 45, 18, 35, 36, 37, 38, 40, 70, 68, 58, 93, 26, 43, 44, 2, 34]
/** Every flat drivable surface: carriageways plus pavements (19), the tram beds (42) and kerbs. */
const ROAD = [19, 68, 18, 58, 42, 39, 38, 37, 45, 35, 93, 40, 70, 36, 43, 14, 26, 41, 44, 7, 66, 2]
/** Buildings, platforms, walls: mostly vertical faces. */
const BUILDINGS = [20, 22, 52, 54, 55, 92, 86, 48, 84, 85, 29, 47, 56, 69, 90, 94, 61, 27, 25, 97, 96, 23, 24, 21, 83, 30, 33, 49, 57, 74, 67, 16, 46, 31, 13, 72, 32, 95, 75]

export default {
  id: 'city',
  name: 'Station District',
  source: `${process.env.HOME}/Downloads/city.glb`,
  out: 'public/models/tracks/city',
  scale: 32,

  /** World origin in scaled source coords (the start line). Pinned: see build-track.mjs. */
  origin: [191.93, -0.18, -100.53],

  chunkSize: 200,

  /** An untextured 34 × 11 m card standing across the back alley (an occluder left in the export). */
  dropNodes: /^Object_68$/,

  layers: [
    [M(8, 9), 'veg'],
    [M(34), 'decal'],
    [M(...ROAD), 'road'],
    // Ground plates that also carry building walls (the base material has no suffix).
    [/^material_104_93(_0|_1)?$/, 'ground'],
    // Buildings are props (so small ones merge into one draw call per chunk) that still collide.
    [/.*/, 'prop'],
  ],
  collide: [[M(...BUILDINGS), 'barrier']],

  lod: {
    road: [0.01, 0.25],
    ground: [0.05, 0.6],
    decal: [0.01, 0.25],
    barrier: [0.05, 0.5],
    prop: [0.15, 1],
  },
  weld: { road: 'posnrm', ground: 'posnrm', barrier: 'pos', prop: 'posnrm', decal: 'none' },
  /** No text-bearing materials worth keeping unwelded. */
  keepUvs: /^$/,

  collisionError: { road: 0.03, ground: 0.15, barrier: 0.1, terrain: 0.5 },
  terrainError: 1,

  sceneryMargin: 350,
  vegKeep: { default: [0.6, 0.25] },
  textures: { high: 512, low: 256 },

  /**
   * 2,455 small meshes over ~75 materials: merge each chunk's props under this
   * many tris (lamps, signs, most buildings) into one draw call, or Low runs
   * ~260 draw calls.
   */
  mergeSmallProps: 6000,

  /**
   * Clockwise. Gate 0 (start/finish) is on the avenue heading north; the
   * centreline is traced over LANES between them.
   */
  checkpoints: [
    { at: [188, -100], dir: [0, -1] }, // avenue, start/finish
    { at: [186, -330], dir: [0, -1] }, // avenue, north of the big crossing
    { at: [185, -470], dir: [0, -1] }, // north link
    { at: [290, -505], dir: [1, 0] }, // top street
    { at: [370, -460], dir: [-0.4, 1] }, // into the alley
    { at: [345, -300], dir: [0, 1] }, // alley
    { at: [338, -50], dir: [0, 1] }, // alley, south
    { at: [270, 103], dir: [-1, 0] }, // bottom street
    { at: [186, 60], dir: [0, -1] }, // south link back to the avenue
  ],
  checkpointRadius: 14,
  lineVia: {
    /**
     * The middle of the avenue runs 1 m past the end of a tram-stop shelter just after the grid:
     * cars on the line clipped it and stuck. Keep the line in the clear lane between the shelter
     * and the railings along the tram bed.
     */
    0: [[195, -122, 1], [195.5, -130, 1], [195, -138, 1]],
    /** Keep the line in the open alley, not the wider parking deck beside it (lower floor, ramp inside). */
    6: [-40, -30, -20, -10, 0].map((z) => [337, z, 1]),
  },

  /**
   * At ×32 the source's small level mismatches become 0.5–0.6 m slabs, kerb
   * bumps and a 1.1 m step across the back alley, which the car can't climb.
   * Pull everything low within 5 m of the line onto a smoothed profile.
   */
  flattenCorridor: { halfWidth: 5, feather: 3, reach: 1.6 },
  /**
   * The back alley squeezes past deck supports, overhangs and a raised deck
   * edge (a 3 m slot in places). Clear a car-height channel through it,
   * from the top street (gate 3) to the bottom street (gate 7).
   */
  clearCorridor: { fromGate: 3, toGate: 7, halfWidth: 6, low: 0.3, high: 2.6 },

  gateSurface: M(...LANES),
  lineSurface: M(...LANES),
  lineSpacing: 4,
  spawnBehind: 14,

  /** Surface map (derive-from-chunks.mjs). The tram beds beside the avenue are ballast. */
  surfaces: [
    [M(42), 'gravel'],
    [M(...ROAD), 'asphalt'],
    [/^material_104_93(_0|_1)?$/, 'asphalt'],
  ],
}
