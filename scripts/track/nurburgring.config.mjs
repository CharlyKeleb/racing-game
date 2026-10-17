// Build config for the Nürburgring GP (2022 layout) Sketchfab export.
// Coordinates below are in the SOURCE file's world space (meters, Y up),
// read off `topdown.mjs` renders. build-track.mjs re-centres everything on the
// start line, so the runtime sees the start/finish at the origin.

export default {
  id: 'nurburgring',
  name: 'Nürburgring GP',
  source: `${process.env.HOME}/Downloads/nurburgring_gp_2022_layout.glb`,
  out: 'public/models/tracks/nurburgring',

  /** Streaming grid cell size, meters. ~200 m keeps each chunk < ~300 KB. */
  chunkSize: 200,

  /**
   * Material → layer. First match wins. Layers decide collision, LOD error,
   * whether the chunk streamer may hide them on low quality, etc.
   *   road     drivable surfaces, collide, near-lossless LOD0
   *   ground   grass/sand/gravel run-off, collide
   *   decal    lines/blend borders on top of the road — visual only
   *   barrier  armco, tyre walls, concrete walls — collide
   *   prop     buildings, stands, signs, lights — visual only, aggressive LOD
   *   veg      tree cards — thinned, alpha-tested, hidden on low
   *   terrain  the 18 km landscape — one simplified backdrop, collides
   *   drop     not shipped
   */
  layers: [
    [/^top2$/, 'terrain'],
    [/^(tree|pines)/, 'veg'],
    [/^(lines|lines_yellow|redline|sandbrd|grassbrd|nurb_decal|box_decal|logos_wall)/, 'decal'],
    [/^(asph|curb|pits|conc_|pavement|tiles|travert|astroturf)/, 'road'],
    [/^(grass\.|grassblock|sand\.|gravel)/, 'ground'],
    [/^(tyrewall|galvanized|grail|walls_new|wall_|concrete|rockwall|sound_barriers|metal_wall)/, 'barrier'],
    [/^(interiors|display_ACE|medical|tent_bath|box_door|ponyva)/, 'drop'],
    [/.*/, 'prop'],
  ],

  /** Absolute simplification error (m) per layer and LOD. null = keep as-is. */
  lod: {
    road: [0.01, 0.25],
    ground: [0.05, 0.6],
    decal: [0.01, 0.25],
    barrier: [0.06, 0.4],
    prop: [0.06, 0.8],
  },
  /** LOD0 welding per layer (see weld() in build-track.mjs). LOD1 always welds by position. */
  weld: { road: 'posnrm', ground: 'posnrm', barrier: 'pos', prop: 'posnrm', decal: 'none' },
  /** Materials whose UVs carry text/logos: never welded, only simplified as authored. */
  keepUvs: /^(signs|spons|adv|logos|garage_spons|dorint_spons|tuv|schumacher|display|nurb_decal|box_decal|timetower)/,

  /** Collision mesh error (m); terrain is coarse because you only touch it off-track. */
  collisionError: { road: 0.03, ground: 0.15, barrier: 0.1, terrain: 1.5 },
  /** Backdrop terrain visual error (m). */
  terrainError: 3,

  /** Scenery beyond the road's bounding box + this margin (m) is dropped. */
  sceneryMargin: 350,

  /** Fraction of tree cards (connected components) kept. [lod0, lod1] */
  vegKeep: {
    'trees_new.002': [0.3, 0.1],
    default: [0.1, 0.03],
  },

  /** Max texture size per material tier. */
  textures: { high: 1024, low: 256 },

  /**
   * Race direction gates on the GP loop (source XZ, tangent = direction of
   * travel). Gate 0 is the start/finish line; the car spawns behind it.
   */
  checkpoints: [
    { at: [-847, 2700], dir: [-0.69, 0.72] }, // start/finish straight
    { at: [-1260, 2812], dir: [-1, 0] }, // Mercedes Arena
    { at: [-1320, 3227], dir: [-0.29, 0.96] }, // run down to Ford-Kurve
    { at: [-1240, 3500], dir: [0, 1] }, // Ford-Kurve
    { at: [-1687, 3847], dir: [0, -1] }, // Dunlop hairpin
    { at: [-1493, 3607], dir: [0.4, -0.92] }, // Schumacher S
    { at: [-1100, 2562], dir: [0.945, -0.327] }, // back straight
    { at: [-560, 2407], dir: [-0.3, 0.95] }, // Coca-Cola Kurve
  ],
  checkpointRadius: 28,

  /** Racing surface the centreline is traced over (excludes service roads). */
  lineSurface: /^(asph\.003|asph_new|curb_b\.|curbs_new)/,
  lineSpacing: 4,
  /** Extra waypoints after gate N, where the shortest road path isn't the circuit. */
  lineVia: {
    // Mercedes Arena: without this the path doubles back down the entry road
    // instead of running round the loop, and the minimap shows a dead-end spur.
    1: [[-1369, 2880]],
  },
  spawnBehind: 14,
}
