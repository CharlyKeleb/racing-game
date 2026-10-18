// Source coordinates are world-space metres, Y up. Preserve the authored park.
export default {
  id: 'drift-park', name: 'Drift Park',
  source: process.env.DRIFT_TRACK_SOURCE ?? `${process.env.HOME}/Downloads/drift_race_track_free.glb`,
  out: 'public/models/tracks/drift-park', chunkSize: 120,
  layers: [[/^Asphalt$/, 'road'], [/^Ground$/, 'terrain'], [/^Metal$/, 'barrier'], [/^Leafs_Mat$/, 'veg'], [/.*/, 'prop']],
  lod: {road:[0.005,0.12],ground:[0.03,0.3],decal:[0.01,0.2],barrier:[0.03,0.2],prop:[0.03,0.4]},
  weld: {road:'posnrm',ground:'posnrm',barrier:'pos',prop:'posnrm',decal:'none'}, keepUvs:/^Decals$/,
  collisionError: {road:0.01,ground:0.1,barrier:0.05,terrain:0.1}, terrainError:0.1,
  sceneryMargin:150, vegKeep:{default:[1,0.5]}, textures:{high:1024,low:256},
  checkpoints: [
    {at:[-113,15],dir:[0.7,0.7]},
    {at:[-30,100],dir:[0.7,0.7]},
    {at:[45,170],dir:[1,0]},
    {at:[65,115],dir:[-0.5,-1]},
    {at:[-55,35],dir:[-0.7,-0.7]},
    {at:[-80,-35],dir:[0,-1]},
    {at:[-15,-15],dir:[1,0.3]},
    {at:[65,-40],dir:[0.8,-0.6]},
    {at:[-50,-115],dir:[-1,-0.3]},
    {at:[-135,-65],dir:[-0.3,1]},
  ],
  checkpointRadius:12, gateSurface:/^Asphalt$/,lineSurface:/^Asphalt$/,lineSpacing:3,
  // Keep gate 5 → 6 direct: a via on the entry spur creates overlapping
  // out-and-back sections and sends AI cars into oncoming traffic.
  lineVia:{2:[[62,159]],7:[[60,-75]],8:[[-90,-118]],9:[[-145,-25]]}, spawnBehind:10,
  surfaces:[[/^Asphalt$/,'asphalt'],[/^Ground$/,'grass']],
}
