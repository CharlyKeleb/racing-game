// Nissan Skyline GT-R R33 LM (1995), downloaded as "1995_nissan_skyline_gt-r_skyline_r33_lm.glb" (Ddiaz Design, CC BY-NC-SA 4.0).
// Run: node scripts/cars/prepare-car.mjs scripts/cars/r33.config.mjs <1995_nissan_skyline_gt-r_skyline_r33_lm.glb>
export default {
  id: 'r33',
  outDir: 'public/models/cars/r33',
  // Centimetres, nose already at +Z.
  scale: 100,
  wheelParts: { tyre: /mm_tyre1$/, rim: /mm_wheel1$/, brake: /mm_rotor1$|BRAKE_CALIPER/ },
  lights: /mm_lights1$/,
  // Keep the LM's race livery on the body (no 'paint' rename); the rims take the garage colour.
  materialNames: { r33Vehicle_Exterior_mm_wheel1: 'rim', r33Vehicle_Exterior_mm_windows1: 'window' },
  simplify: [
    [/^int1$/, 0.35, 0.01],
    [/^carpiaint$/, 0.75],
    [/^rim$/, 0.5, 0.01],
  ],
  simplifyError: 0.004,
  lowRatio: 0.3,
  lowError: 0.02,
  lowDrop: /^int1$|mm_badges1$|mm_cab1$/,
  // Small parts coloured by plain materials or tiny swatches: merged into one (draw calls).
  flattenTextures: 64,
  mergePlain: true,
  textureSize: 1024,
}
