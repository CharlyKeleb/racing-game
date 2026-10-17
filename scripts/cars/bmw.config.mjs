// BMW E36 GTR-style race car (downloaded as "bmw-racing-car-3d-model-free", source/BMW.glb).
// Run: node scripts/cars/prepare-car.mjs scripts/cars/bmw.config.mjs <BMW.glb>
export default {
  id: 'bmw',
  outDir: 'public/models/cars/bmw',
  // Source lies along X with the nose at -X; turn it to +Z.
  rotateY: 90,
  // ×0.817 gives the E36's 2.70 m wheelbase: 4.58 m long with splitter and wing, 1.97 m wide.
  scale: 0.817,
  // One mesh, many materials: parts match by material name.
  wheelParts: { tyre: /^Mat\.7$/, rim: /^Mat\.8(_0)?$/ },
  lights: /^lightglass|^vehiclelights/,
  // Keep the race livery texture (no 'paint' rename); rims take the garage colour.
  materialNames: { 'Mat.8': 'rim' },
  // Every material came out BLEND: make it opaque except windows (alpha < 1)
  // and the sticker sheet, which needs a cut-out.
  opaqueUnlessListed: true,
  alpha: { 'Mat.14': 'MASK' },
  simplify: [],
  simplifyError: 0.004,
  // Low preset: cabin parts the chase camera can't see (cables, pedals,
  // console, belts, seat fabric), plus a few specks of trim (hub caps, a 12-tri
  // grille patch, lens covers) that each cost a draw call. The dash and steering
  // wheel stay for the cockpit view.
  lowRatio: 0.5,
  lowDrop: /^(z3_int_|common_cloth|Mat_1$|Mat_2$|Mat\.19$|Mat\.18$|common_carbon_01|carbon01_black02__spec_|Matte__FF8B8B8B|Matte__FFCCCCCC|Matte__FF131313|Mat\.21_0$|Mat\.15$|Mat\.8_0$|Mat_3$|Mat\.9$|Mat\.13$)/,
  textureSize: 1024,
}
