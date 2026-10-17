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
  lowRatio: 0.5,
  textureSize: 1024,
}
