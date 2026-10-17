// Build config for the Marina Bay Street Circuit (Singapore) model.
// Coordinates below are in the SOURCE file's world space (meters, Y up, after
// the file's own 2.1x scale and Z-up → Y-up rotation), read off top-down
// renders. build-track.mjs re-centres everything on the start line.
//
// The source is a game-ripped city block: one 813k-triangle mesh, ~195
// materials named only by number ("11851Mtl"), every one flagged BLEND. The
// layer rules below were picked by texture and by how much of each material
// sits beside the racing line; see the PR for the renders.

const mats = (...ids) => new RegExp(`^(${ids.join('|')})Mtl$`)

export default {
  id: 'singapore',
  name: 'Marina Bay',
  source: '.cache/src-singapore/singapore.glb',
  out: 'public/models/tracks/singapore',

  chunkSize: 200,

  /** Material → layer, first match wins (see nurburgring.config.mjs for what each layer means). */
  layers: [
    [mats(151, 141, 1451), 'decal'], // racing line, tyre marks, ground logo
    // Circuit asphalt (11861 under ~98% of the racing line; the others are short
    // bridge / junction sections), then run-off asphalt, concrete, orange paint, paving.
    [mats(11861, 12031, 1941, 1951, 11851, 1131, 11841, 1171), 'road'],
    [mats(191), 'ground'], // grass
    [mats(181), 'terrain'], // the base ground plane under the whole city
    [mats(1881, 1891, 1901, 11751, 1871, 1531, 1841, 12011, 171, 12001), 'barrier'], // walls, fences
    [mats(11871, 11961), 'veg'], // tree and bush cards
    [/.*/, 'prop'], // buildings, grandstands, signage, water, skyline
  ],

  lod: {
    road: [0.01, 0.25],
    ground: [0.05, 0.6],
    decal: [0.01, 0.25],
    barrier: [0.05, 0.4],
    prop: [0.08, 1],
  },
  weld: { road: 'posnrm', ground: 'posnrm', barrier: 'pos', prop: 'posnrm', decal: 'none' },
  keepUvs: /^$/,

  collisionError: { road: 0.03, ground: 0.15, barrier: 0.1, terrain: 0.5 },
  terrainError: 1,

  /** City beyond the circuit's bounding box + this margin (m) is dropped. */
  sceneryMargin: 450,

  vegKeep: { default: [0.6, 0.25] },

  textures: { high: 512, low: 256 },

  /**
   * Every source material is BLEND; the build makes fully opaque textures
   * OPAQUE automatically. These have alpha in the texture but must be solid.
   */
  alpha: [[mats(181, 191, 131, 11861, 12031, 1941, 1951, 11851, 1131, 11841, 1171), 'OPAQUE']],

  /**
   * Race direction gates, anticlockwise like the real circuit: down the pit
   * straight, Turns 1–3 at the south-west, east along the long straight, the
   * two hairpins by the junction, the north-east loop, back past the Float
   * grandstand and onto the pit straight. Gate 0 is the start/finish line.
   */
  checkpoints: [
    { at: [-610, 248], dir: [0, 1] }, // pit straight
    { at: [-470, 600], dir: [1, 0] }, // Turns 1–3
    { at: [-425, 420], dir: [0, -1] }, // up to Turn 5
    { at: [-100, 262], dir: [1, 0.06] }, // long straight east
    { at: [260, 411], dir: [0.86, 0.5] }, // run to the south-east corner
    { at: [380, 330], dir: [0.5, -0.87] }, // up to the junction hairpin
    { at: [700, 250], dir: [0.45, -0.89] }, // north-east straight
    { at: [655, -180], dir: [-0.62, -0.78] }, // north-east loop
    { at: [503, -56], dir: [-0.28, 0.96] }, // down to the second hairpin
    { at: [272, 124], dir: [-0.86, -0.5] }, // back north-west
    { at: [-30, -31], dir: [-1, 0] }, // past the Float
    { at: [-450, -35], dir: [-1, 0] }, // top straight to the last corner
  ],
  checkpointRadius: 22,

  /** Gates snap to (and the centreline is traced over) the circuit asphalt. */
  gateSurface: mats(11861, 12031, 1941, 1951),
  lineSurface: mats(11861, 12031, 1941, 1951),
  lineSpacing: 4,
  /** The two hairpins nearly touch across a patch of junction asphalt: pin each apex. */
  lineVia: {
    5: [[437, 268]],
    8: [[408, 224]],
  },
  spawnBehind: 14,

  /** Surface map (derive-from-chunks.mjs): material → surface. */
  surfaces: [
    [mats(11861, 12031, 1941, 1951, 11851, 1131, 11841, 1171), 'asphalt'],
    [mats(191), 'grass'],
  ],
}
