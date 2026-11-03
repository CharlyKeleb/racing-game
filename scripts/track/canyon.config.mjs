// Build config for the Sketchfab "gt racing 2 - glen canyon dam" model
// (~/Downloads/canyon_dam.glb, by amogusstrikesback2, CC BY 4.0 as embedded in
// the file; see public/models/CREDITS.md). A circuit ripped from GT Racing 2.
//
// Already in metres, Y up (the dam crest is ~520 m, Glen Canyon Dam's is 480 m).
// Coordinates below are in source space (node scripts/track/topdown.mjs).
//
// The lap (~3 km, clockwise on the top-down map): east over the canyon bridge
// (y 40), north up the east loop, down a hairpin onto the dam crest (y 3),
// west over the dam, up a hairpin through the cliff tunnels, round the
// north-west loop, onto the long diagonal back down to the town, and over a
// dirt section (the asphalt branch beside it is closed) to the bridge.

const R = (...names) => new RegExp(`^(${names.join('|')})$`)

/** Carriageways: asphalt (ROAD, ROAD_2), the dam crest (ROAD_1), edge strips and the town approach. */
const LANES = ['ROAD', 'ROAD_1', 'ROAD_2', 'Road_4', 'Material__307', 'Material__237']

export default {
  id: 'canyon',
  name: 'Canyon Dam',
  source: `${process.env.HOME}/Downloads/canyon_dam.glb`,
  out: 'public/models/tracks/canyon',

  chunkSize: 200,

  /** Sun and lens-flare cards placed 2 km up in the sky; the game draws its own sky. */
  dropNodes: /^sun_/,

  layers: [
    [R('SKYBOX'), 'drop'],
    [R(...LANES), 'road'],
    // Orange gravel verges beside the asphalt (139, GR) and the town plaza paving.
    [R('Material__139', 'material', 'TILE'), 'ground'],
    // Near canyon terrain (302), far desert (296), the gorge walls (295).
    [R('Material__302', 'Material__296', 'Material__295'), 'terrain'],
    // Kerbs, guardrails, chevrons (ATLAS_1); tunnel and dam concrete (NONC).
    [R('ATLAS_1', 'NONC'), 'barrier'],
    // Crowd, fence trusses and plant cards (ALPHA, Alpha_2), buildings (BUOILDINGS, ATLAS_2), water.
    [/.*/, 'prop'],
  ],
  collide: [[R('BUOILDINGS'), 'barrier']],

  lod: {
    road: [0.01, 0.25],
    ground: [0.05, 0.6],
    decal: [0.01, 0.25],
    barrier: [0.05, 0.4],
    prop: [0.1, 1],
  },
  weld: { road: 'posnrm', ground: 'posnrm', barrier: 'pos', prop: 'posnrm', decal: 'none' },
  /** Sponsor boards and signs in the building atlas. */
  keepUvs: R('ATLAS_2'),

  collisionError: { road: 0.03, ground: 0.15, barrier: 0.1, terrain: 0.5 },
  /** The backdrop is also the terrain's collision (build-track.mjs), so it's kept fine enough to drive against. */
  terrainError: 0.4,

  sceneryMargin: 350,
  /** The circuit asphalt's box, not the access roads running a kilometre north and south-east. */
  cropTo: R(...LANES),

  vegKeep: { default: [1, 1] },
  textures: { high: 1024, low: 256 },

  mergeSmallProps: 3000,

  /** Fences, crowd and plant cards: cut out, never sorted. */
  alpha: [[R('ALPHA', 'Alpha_2'), 'MASK']],

  checkpoints: [
    { at: [100, 0], dir: [1, 0] }, // canyon bridge, start/finish
    { at: [575, -100], dir: [0, -1] }, // east loop, northbound
    { at: [500, -302], dir: [-1, 0] }, // top of the east loop
    { at: [200, -248], dir: [-1, 0] }, // dam crest
    { at: [-205, -405], dir: [-1, 0] }, // top of the tunnel hairpin
    { at: [-385, -253], dir: [-1, 0] }, // westbound after the crossing
    { at: [-470, -320], dir: [0, -1] }, // north-west loop, northbound
    { at: [-450, -185], dir: [0.65, 0.76] }, // long diagonal down to the town
    { at: [-180, 27], dir: [1, 0] }, // dirt section through the town, back to the bridge
  ],
  checkpointRadius: 16,

  gateSurface: R(...LANES),
  lineSurface: R(...LANES),
  lineSpacing: 4,
  /**
   * From the dam the line must take the hairpin's right leg (north) and come
   * back down the left one, which crosses the dam road at (-258, -340).
   */
  lineVia: {
    3: [[-60, -222], [-150, -262], [-183, -330, 6], [-192, -375, 6]],
    // A digger and cones close the asphalt branch into town: the lap takes the dirt section beside it.
    7: [[-322, -15], [-260, 13]],
    8: [[-140, 25], [-110, 8]],
  },
  spawnBehind: 14,

  surfaces: [
    [R('Material__139', 'material'), 'sand'],
    [R(...LANES, 'TILE'), 'asphalt'],
  ],
}
