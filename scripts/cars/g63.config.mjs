// Mercedes-AMG G63 (2020), downloaded as "2020_mercedes-benz_g-class_amg_g63.glb" (Outlaw Games, CC BY-NC 4.0).
// Run: node scripts/cars/prepare-car.mjs scripts/cars/g63.config.mjs <2020_mercedes-benz_g-class_amg_g63.glb>
const M = 'MMercedesAMG_G63SUVRewardRecycled_2020'
export default {
  id: 'g63',
  outDir: 'public/models/cars/g63',
  scale: 100,
  wheelParts: { tyre: /Wheel1A_3D/, rim: /Wheel1A_3D/, brake: /CallipersCalliper|^calip_C2$/ },
  lights: /LightA_Material/,
  // The engine bay under a closed bonnet: never seen.
  drop: /EngineA_Material/,
  materialNames: { [M + 'Paint_Material1']: 'paint', [M + 'Window_Material1']: 'window' },
  rimSplit: { material: /Wheel1A_3D/, share: 0.7 },
  opaqueUnlessListed: true,
  alpha: { [M + 'Window_Material1']: 'BLEND', red_glass: 'BLEND', orange_glass: 'BLEND', [M + 'BadgeA_Material1']: 'MASK' },
  simplify: [
    [/InteriorA/, 0.2, 0.01],
    [/Wheel1A_3D|^rim$/, 0.35, 0.01],
    [/LightA_/, 0.45],
    [/TexturedA_/, 0.4],
    [/Coloured_/, 0.5],
    [/^paint$/, 0.7],
  ],
  simplifyError: 0.004,
  lowRatio: 0.2,
  lowError: 0.02,
  lowDrop: /InteriorA|InteriorTilling|Grille[0-9]|BadgeA|ManufacturerPlate|Textured2A/,
  textureSize: 1024,
}
