// ABT Audi RS6-R (2020), downloaded as "2020_abt__sportline__audi_rs6-r.glb" (ajeythegreat5551, CC BY 4.0).
// Run: node scripts/cars/prepare-car.mjs scripts/cars/rs6r.config.mjs <2020_abt__sportline__audi_rs6-r.glb>
export default {
  id: 'rs6r',
  outDir: 'public/models/cars/rs6r',
  scale: 100,
  wheelParts: { tyre: /^w3DWheel_Front_LSG1$/, rim: /^w3DWheel_Front_LSG1$/, brake: /^wCalliperExotic6_Front_LSG1$/ },
  lights: /^BLight_Geo_lodASG1$/,
  drop: /^BEngine_Geo_lodASG1$/,
  materialNames: { BKit2_Paint_Geo_lodASG1: 'paint', BWindow_Geo_lodASG1: 'window' },
  rimSplit: { material: /^w3DWheel_Front_LSG1$/, share: 0.7 },
  opaqueUnlessListed: true,
  alpha: { BWindow_Geo_lodASG1: 'BLEND', red_glass: 'BLEND', BKit2_Badge_Geo_lodASG1: 'MASK', wCalliperBadge_Front_LSG1: 'MASK' },
  simplify: [
    [/Interior_Geo/, 0.2, 0.01],
    [/3DWheel|^rim$/, 0.3, 0.01],
    [/Light_Geo/, 0.4],
    [/Carbon1/, 0.4],
    [/Coloured_Geo/, 0.45],
    [/^paint$/, 0.7],
  ],
  simplifyError: 0.004,
  lowRatio: 0.2,
  lowError: 0.02,
  lowDrop: /Interior|SeatBelt|Grille[0-9]|Badge|ManufacturerPlate|Textured_Geo/,
  textureSize: 1024,
  // Full model (Medium and up, the garage): round tyres and whole spokes, light decimation elsewhere.
  full: {
    simplify: [
      [/Interior_Geo/, 0.35, 0.005],
      [/Light_Geo/, 0.7],
      [/Carbon1/, 0.7],
      [/Coloured_Geo/, 0.75],
    ],
    textureSize: 2048,
    textureQuality: 90,
  },
}
