// Dodge Challenger SRT Demon (2018), downloaded as "2018_dodge_challenger_srt_demon.glb" (VTX, CC BY-NC-SA 4.0).
// Run: node scripts/cars/prepare-car.mjs scripts/cars/demon.config.mjs <2018_dodge_challenger_srt_demon.glb>
const M = 'dDodge_ChallengerSRTDemonRewardRecycled_2018'
export default {
  id: 'demon',
  outDir: 'public/models/cars/demon',
  scale: 100,
  wheelParts: { tyre: /Wheel1A_3D/, rim: /Wheel1A_3D/, brake: /CalliperGlos|^phong3$/ },
  lights: /LightA_Material/,
  drop: /EngineA_Material/,
  materialNames: { [M + 'Paint_Material1']: 'paint', [M + 'Window_Material1']: 'window' },
  rimSplit: { material: /Wheel1A_3D/, share: 0.7 },
  opaqueUnlessListed: true,
  alpha: { [M + 'Window_Material1']: 'BLEND', red_glass: 'BLEND', orange_glass: 'BLEND', [M + 'BadgeA_Material1']: 'MASK', [M + 'CalliperBadg_a8c3a2e1']: 'MASK', [M + 'Manufacturer_b564044']: 'MASK' },
  simplify: [
    [/InteriorA/, 0.25, 0.01],
    [/Wheel1A_3D|^rim$/, 0.4, 0.01],
    [/Coloured_/, 0.55],
    [/^paint$/, 0.75],
  ],
  simplifyError: 0.004,
  lowRatio: 0.25,
  lowError: 0.02,
  lowDrop: /InteriorA|InteriorTill|Grille[0-9]|BadgeA|Manufacturer|CalliperBadg/,
  textureSize: 1024,
}
