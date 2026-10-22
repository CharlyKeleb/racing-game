// Mercedes-AMG GT3 2020 (downloaded as "2020_mercedes-benz_amg_gt3.glb").
// Run: node scripts/cars/prepare-car.mjs scripts/cars/amg.config.mjs <2020_mercedes-benz_amg_gt3.glb>
const M = 'amgMercedesAMG_GT3_2020'
export default {
  id: 'amg',
  outDir: 'public/models/cars/amg',
  // Centimetres, nose already at +Z: 4.8 m long, 2.0 m wide (real GT3: 4.75 m / 2.05 m).
  scale: 100,
  // Tyre and rim are one textured material (the tread is in the texture), so it's both.
  wheelParts: { tyre: /Wheel1A_3D/, rim: /Wheel1A_3D/, brake: /CallipersCalliperA_Zone/ },
  // One lamp material at both ends: front → headlights, rear → tail lights.
  lights: /LightA_Material/,
  // The side-exit exhausts, for the nitro flames.
  report: /Grille3A|Grille4A/,
  // Keep the works livery (no 'paint' rename).
  materialNames: { [M + 'Window_Material1']: 'window' },
  // The wheel's inner 70% of radius is the rim: its own material, for the garage's rim colour.
  rimSplit: { material: /Wheel1A_3D/, share: 0.7 },
  // Everything came out BLEND: opaque unless see-through, cut-outs for the mesh grilles and decals.
  opaqueUnlessListed: true,
  alpha: Object.fromEntries(['Grille1A_Material1', 'Grille6A_Material1', 'BadgeA_Material1', '_CallipersCalliperBadgeA_Material1'].map((n) => [M + n, 'MASK']).concat([['uv2MercedesAMG_GT3_2020Carbon1DetailsA_Material1', 'MASK']])),
  simplify: [
    [/InteriorA/, 0.3, 0.01],
    [/Wheel1A_3D|^rim$/, 0.35, 0.01],
    [/CallipersCalliperA_Zone/, 0.3, 0.02],
    [/Carbon1_/, 0.45],
    [/LightA_/, 0.45],
    [/Coloured_/, 0.55],
    [/Paint_/, 0.75],
  ],
  simplifyError: 0.004,
  lowRatio: 0.25,
  lowError: 0.02,
  // Low preset: the cabin, grilles and badges.
  lowDrop: /InteriorA|Grille[1-6]A|BadgeA|CalliperBadge|uv2MercedesAMG/,
  textureSize: 1024,
}
