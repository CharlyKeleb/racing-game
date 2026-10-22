// Lamborghini Diablo GT1, 2000 Nomad Le Mans livery (downloaded as "2000_lamborghini_nomad_diablo_gt1.glb").
// Run: node scripts/cars/prepare-car.mjs scripts/cars/diablo.config.mjs <2000_lamborghini_nomad_diablo_gt1.glb>
export default {
  id: 'diablo',
  outDir: 'public/models/cars/diablo',
  // Already metres with the nose at +Z: 4.57 m long, 2.65 m wheelbase (real GT1: ~4.5 m / 2.65 m).
  scale: 1,
  wheelParts: { tyre: /^Tyre\./, rim: /^(rim|outer_rim|inner_rim|wheel_black|hub)\./, brake: /^(rotor|caliper)\./ },
  // Lamp reflectors behind the clear covers, and the red tail lamps (the amber ones stay indicators).
  lights: /^(07_-_Default|Material_34)\./,
  // A second copy of the body with alpha 0: never visible, 36k triangles.
  drop: /^20_-_Default\./,
  // Exhaust tips, for the nitro flames.
  report: /^MISC\./,
  // Keep the Nomad livery texture (no 'paint' rename); rims take the garage colour.
  materialNames: { 'rim.003': 'rim' },
  simplify: [
    [/^(caliper|rotor)/, 0.15, 0.03],
    [/^(rim|inner_rim)/, 0.35],
    [/^(chrome|Material_28|Material_75|metal|plastic|NRGHUB|mottled|int_|INT_|redplastic)/, 0.3, 0.02],
    [/^baked_Material/, 0.5],
    [/^WC_TEAM_BODY1_PA/, 0.75],
  ],
  simplifyError: 0.004,
  // Low preset: the cabin behind the tinted canopy goes.
  lowRatio: 0.3,
  lowError: 0.02,
  lowDrop: /^(NRGHUB|INT_|int_|chrome|redplastic|badge_cp|reflector_cp|plastic|metal\.|Material_75|mottled|unicolor_carbon|DBCKPIT|DBRED|Material_28|DIABLO_GT1_DETAIL|XP91SD|hub\.|rotor\.|Material_26|WC_TEAM_WINDOWS_GL)/,
  // Most small parts are coloured by 4–32 px swatches: make them plain colours and merge look-alikes (draw calls).
  flattenTextures: 32,
  mergePlain: true,
  textureSize: 2048,
}
