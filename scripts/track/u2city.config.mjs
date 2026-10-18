// Build config for the Need for Speed Underground 2 city block (u2bw1.glb).
// Coordinates below are in the SOURCE file's world space (meters, Y up, after
// the file's own Z-up → Y-up rotation), read off top-down renders
// (node scripts/track/topdown.mjs <in.glb> .cache/u2-roads.png '^RDP_').
// build-track.mjs re-centres everything on the start line.
//
// The source is one 865k-triangle game-ripped city mesh (~600 materials named
// by prefix: RDP_ road paint, TRN_ terrain, ORG_ vegetation, ARC_ buildings,
// SGN_/ADS_ signs). It has no circuit of its own: the race runs a ~2.5 km
// clockwise loop over the two-lane city streets, clear of the freeways.

export default {
  id: 'u2city',
  name: 'Bayview Streets',
  source: `${process.env.HOME}/Downloads/u2bw1.glb`,
  out: 'public/models/tracks/u2city',

  chunkSize: 200,

  /** Material → layer, first match wins (see nurburgring.config.mjs for what each layer means). */
  layers: [
    [/^(ORG_(LEAVES|BUSH|PLANTER|SMALLLEAF|DRACAENA|GREENLEAFY|PALMFROND|ASPENB_RR|EUCALYPTUS_A|EUCALYPTUS_B_CK|MAPLE|GREENBUSH|BRANCH|SYCMULHOLLAND_A_CK|MAGNOLIA|HEDGE|PINEBIG|GRASS_001|GRASSLINE)|TRN_TREELINE)/, 'veg'],
    // Streets, lanes, intersections, parking, pavements and courtyards: all drivable.
    [/^(RDP_|ARC_SIDEWALK|ARC_COURTGD|ARC_PARKING|ARC_PRKG_BASE|ARC_CONCFOUNDATION)/, 'road'],
    [/^TRN_(GRASS|DIRT|RUBBLE)|^ORG_GRASSHILL/, 'ground'],
    [/(BARRIER|FENCE|FWY_WALL|TUNWALL|WAL_|CONCRETWALL|RAILBRIDGE|BLOCKWALL)/, 'barrier'],
    [/.*/, 'prop'],
  ],

  lod: {
    road: [0.01, 0.25],
    ground: [0.05, 0.6],
    decal: [0.01, 0.25],
    barrier: [0.05, 0.4],
    prop: [0.08, 1],
  },
  weld: { road: 'posnrm', ground: 'posnrm', barrier: 'pos', prop: 'posnrm', decal: 'none' },
  keepUvs: /^(ADS_|SGN_)/,

  collisionError: { road: 0.03, ground: 0.15, barrier: 0.1, terrain: 0.5 },
  terrainError: 1,

  /** City beyond the circuit's bounding box + this margin (m) is dropped. */
  sceneryMargin: 350,
  /** Crop to the street lanes the circuit runs on, not every freeway in the block. */
  cropTo: /^RDP_(LANEA_YS_AA|LANEB_WD_AA|INTERSECT)/,

  vegKeep: { default: [0.6, 0.25] },

  textures: { high: 512, low: 256 },

  /** Dense city: merge each chunk's small prop meshes (< this many tris) into one draw call. */
  mergeSmallProps: 1200,

  /**
   * Every material is flagged OPAQUE by the exporter; leaf cards and
   * chain-link fences carry their cut-outs in the texture alpha.
   */
  alpha: [[/^(ORG_|TRN_TREELINE|XW_CHAIN|OBJ_FENCE_CHNLINK|ARC_FENCE_SPIKE)/, 'MASK']],

  /**
   * Race direction gates, clockwise: start on the diagonal boulevard heading
   * south-east to the big five-way junction, down the curving avenue, back
   * north-west through the inner streets, up the diagonal and round the
   * northern arc. Gate 0 is the start/finish line.
   */
  checkpoints: [
    { at: [970, 5], dir: [0.84, 0.54] }, // boulevard, start/finish
    { at: [1145, 135], dir: [0.75, 0.66] }, // boulevard into the five-way junction
    { at: [1170, 310], dir: [-0.45, 0.89] }, // avenue south of the junction
    { at: [1040, 540], dir: [-0.6, 0.8] }, // avenue, lower bend
    { at: [890, 595], dir: [-0.69, -0.72] }, // back north-west
    { at: [690, 375], dir: [-0.67, -0.74] }, // inner street
    { at: [690, 260], dir: [0.56, -0.83] }, // up to the diagonal
    { at: [670, 110], dir: [-0.69, -0.72] }, // diagonal north-west
    { at: [630, -175], dir: [0.99, -0.1] }, // northern arc
    { at: [780, -120], dir: [0.88, 0.45] }, // down to the boulevard
  ],
  checkpointRadius: 16,

  /** Gates snap to (and the centreline is traced over) the street lanes. */
  gateSurface: /^RDP_(LANEA_YS_AA|LANEB_WD_AA|INTERSECT)/,
  lineSurface: /^RDP_(LANEA_YS_AA|LANEB_WD_AA|INTERSECT)/,
  lineSpacing: 4,
  spawnBehind: 14,

  /** Surface map (derive-from-chunks.mjs): material → surface. */
  surfaces: [
    [/^(RDP_|ARC_SIDEWALK|ARC_COURTGD|ARC_PARKING|ARC_PRKG_BASE|ARC_CONCFOUNDATION)/, 'asphalt'],
    [/^(TRN_GRASS|ORG_GRASSHILL)/, 'grass'],
    [/^TRN_(DIRT|RUBBLE)/, 'gravel'],
  ],
}
