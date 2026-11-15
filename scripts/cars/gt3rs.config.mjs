// Porsche 911 GT3 RS (992), downloaded as "porsche_911_gt3_rs.glb" (RES1N, CC BY 4.0).
// Run: node scripts/cars/prepare-car.mjs scripts/cars/gt3rs.config.mjs <porsche_911_gt3_rs.glb>
const M = 'Porsche_911GT3RS992Tribute_2023'
export default {
  id: 'gt3rs',
  outDir: 'public/models/cars/gt3rs',
  // Centimetres, nose already at +Z.
  scale: 100,
  // Tyre and rim are one textured material (the tread is in the texture).
  wheelParts: { tyre: /Wheel1A_3D/, rim: /Wheel1A_3D/, brake: /CallipersCalliperA_Zone/ },
  lights: /LightA_Material/,
  materialNames: { [M + 'Paint_Material']: 'paint', [M + 'Window_Material']: 'window' },
  rimSplit: { material: /Wheel1A_3D/, share: 0.7 },
  simplify: [
    [/InteriorB/, 0.25, 0.01],
    [/Wheel1A_3D|^rim$/, 0.3, 0.01],
    [/CallipersCalliperA_Zone/, 0.3, 0.02],
    [/LightA_/, 0.4],
    [/Coloured_/, 0.45],
    [/^paint$/, 0.65],
  ],
  simplifyError: 0.004,
  lowRatio: 0.2,
  lowError: 0.02,
  lowDrop: /InteriorB|Grille[0-9]|BadgeA|ManufacturerPlate|TexturedA/,
  textureSize: 1024,
  // Full model (Medium and up, the garage): round tyres and whole spokes, light decimation elsewhere.
  full: {
    simplify: [
      [/InteriorB/, 0.35, 0.005],
      [/CallipersCalliperA_Zone/, 0.6, 0.01],
      [/LightA_/, 0.6],
      [/Coloured_/, 0.6],
      [/^paint$/, 0.9],
    ],
    textureSize: 2048,
    textureQuality: 90,
  },
}
