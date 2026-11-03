// Build config for the Sketchfab "sports car racing paris" model
// (~/Downloads/sports_car_racing_paris.glb, by amogusstrikesback2, CC BY-NC 4.0 as listed; see
// public/models/CREDITS.md for why that licence is doubtful).
//
// A mobile game's Paris circuit as a ~34 × 29 unit miniature (the Arc de Triomphe is 1 unit tall),
// scaled ×50: 12–15 m streets, a 50 m Arc, a ~1.7 × 1.25 km map with the Seine across it.
// Coordinates below are in SCALED source space (node scripts/track/topdown.mjs with SCALE=50).
// Material names are pinyin: dibiao = ground surface, lujian = shoulder, qiang = wall,
// hulang = guardrail, tiezhalan = iron railing, luzhang = roadblock, peilou = building,
// boli = glass, zhibei = planting, shui = water, guanggao = billboard, tong = barrel.
//
// The race runs the railed ~4 km loop: east along the north quay, a hairpin north past the
// plaza, the long road north-west to the Arc de Triomphe and the teardrop loop at the top,
// then back down the west side through the S-bend to the quay.

const D = (...names) => new RegExp(`^D_(${names.join('|')})$`)

/** Carriageways: the circuit asphalt (7), the quays (19), the teardrop (20), the Arc's ring (21). */
const LANES = ['dibiao_7', 'dibiao_19', 'dibiao_20', 'dibiao_21']
/** Every flat paved surface: carriageways, shoulders and plazas. */
const ROAD = [...LANES, 'lujian_4', 'dibiao_8', 'dibiao_5', 'dibiao_13']
/** Buildings and monuments: props (so they merge) that collide. */
const BUILDINGS = ['peilou_.*', 'boli_.*', 'men_1', 'luofugong_.*', 'kalusuo_1', 'aifeiertieta_.*', 'kaixuanmen_1', 'guanggao_2']

export default {
  id: 'paris',
  name: 'Paris',
  source: `${process.env.HOME}/Downloads/sports_car_racing_paris.glb`,
  out: 'public/models/tracks/paris',
  scale: 50,

  chunkSize: 200,

  /**
   * The game closes roads off its route with tall see-through railings (tiezhalan_3). Two cross
   * this loop: on the north quay where the west side joins it, and at the top of the hairpin.
   */
  dropBoxes: [
    [-476, -18, -468, 12, D('tiezhalan_3')],
    [156, -10, 184, 11, D('tiezhalan_3')],
  ],

  /** Free Roam drives every street: drop the railings, roadblocks and barrels closing them. */
  openRoads: { lanes: D(...ROAD), closures: D('tiezhalan_.*', 'luzhang_2', 'tong_1', 'hulang_1') },

  /**
   * The road edges are lined with 0.5 m kerb walls, guardrails on posts and barrels. A car that
   * brushes them climbs on and beaches; collide them three times as tall so it glances off.
   */
  raiseBarriers: { match: D('qiang_.*', 'hulang_1', 'tong_1', 'tiezhalan_1', 'tiezhalan_4', 'luzhang_2') },

  layers: [
    [D('zhibei_.*'), 'veg'],
    [D(...ROAD), 'road'],
    [D('dibiao_9', 'cao_3', 'shui_1'), 'ground'],
    [D('qiang_.*', 'hulang_1', 'tiezhalan_.*', 'luzhang_2', 'tong_1'), 'barrier'],
    [/.*/, 'prop'],
  ],
  collide: [[D(...BUILDINGS), 'barrier']],

  lod: {
    road: [0.01, 0.25],
    ground: [0.05, 0.6],
    decal: [0.01, 0.25],
    barrier: [0.05, 0.4],
    prop: [0.1, 1],
  },
  weld: { road: 'posnrm', ground: 'posnrm', barrier: 'pos', prop: 'posnrm', decal: 'none' },
  /** Billboards and signs carry text. */
  keepUvs: D('guanggao_2', 'jiantou_1'),

  collisionError: { road: 0.03, ground: 0.15, barrier: 0.1, terrain: 0.5 },
  terrainError: 1,

  sceneryMargin: 350,
  vegKeep: { default: [1, 0.5] },
  textures: { high: 512, low: 256 },
  mergeSmallProps: 4000,

  /** Railings, plant cards, arrows and roadblocks: cut out, never sorted. */
  alpha: [[D('tiezhalan_1', 'tiezhalan_3', 'zhibei_.*', 'luzhang_2', 'jiantou_1'), 'MASK']],

  checkpoints: [
    { at: [-300, 6], dir: [1, 0] }, // north quay, start/finish
    { at: [60, 51], dir: [0.93, 0.36] }, // along the river
    { at: [168, 40], dir: [0, -1] }, // hairpin north past the plaza
    { at: [-56, -84], dir: [-0.9, -0.42] }, // long road north-west
    { at: [-196, -219], dir: [-0.85, -0.5] }, // S-bends
    { at: [-436, -364], dir: [-0.7, -0.7] }, // out of the Arc de Triomphe
    { at: [-516, -469], dir: [-1, 0] }, // top of the teardrop
    { at: [-716, -329], dir: [0, 1] }, // west side
    { at: [-580, -235], dir: [1, 0.1] }, // S-bend
    { at: [-616, -69], dir: [0, 1] }, // down to the quay
  ],
  checkpointRadius: 16,

  gateSurface: D(...LANES),
  lineSurface: D(...LANES),
  lineSpacing: 4,
  spawnBehind: 14,

  surfaces: [
    [D(...ROAD), 'asphalt'],
    [D('cao_3', 'dibiao_9'), 'grass'],
    [D('shui_1'), 'gravel'],
  ],
}
