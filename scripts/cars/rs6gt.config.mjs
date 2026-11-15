// Audi RS6 GT Avant (2024), downloaded as "audi_rs6_gt_avant__www.vecarz.com.glb" (vecarz, CC BY-NC-SA 4.0).
// Run: node scripts/cars/prepare-car.mjs scripts/cars/rs6gt.config.mjs <audi_rs6_gt_avant__www.vecarz.com.glb>
export default {
  id: 'rs6gt',
  outDir: 'public/models/cars/rs6gt',
  // Metres, nose already at +Z.
  scale: 1,
  wheelParts: { tyre: /^tire$/, rim: /^(WHEEL|rim_black|rim_misc)$/, brake: /^(EXT_Disc|caliper|caliper_alpha)$/ },
  lights: /LightA_Material1$/,
  // Tiny dashboard and trim pieces (HUD screens, gauge glows, plate): a draw call each for a few triangles.
  drop: /^(hud1|hud2|hud_pobokam|rpmwhie|light_int|str_int|andro|material_41|Material_56|mirrors|EXT_PLATE_plastic|win_int)$/,
  materialNames: { body: 'paint', WHEEL: 'rim', glass: 'window' },
  simplify: [
    [/^(black1|leather|alca|black_int|int_metal|black_gloss_int|int_misc|stro4ka|int_alpha|win_int)$/, 0.2, 0.01],
    [/^(black_gloss_ext|black_ext|material)$/, 0.4, 0.01],
    [/LightA_Material1$/, 0.4],
    [/^(rim|rim_black|rim_misc)$/, 0.4, 0.01],
    [/^paint$/, 0.7],
  ],
  simplifyError: 0.004,
  lowRatio: 0.2,
  lowError: 0.02,
  lowDrop: /^(black1|leather|alca|black_int|int_metal|black_gloss_int|int_misc|stro4ka|int_alpha|win_int|hud1|hud2|hud_pobokam|rpmwhie|light_int|str_int|andro|wiper)$/,
  // Small parts coloured by plain materials or tiny swatches: merged into one (draw calls).
  flattenTextures: 64,
  mergePlain: true,
  textureSize: 1024,
}
