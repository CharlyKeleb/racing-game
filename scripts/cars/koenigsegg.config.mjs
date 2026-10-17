// Koenigsegg One:1 from Sketchfab ("Koenigsegg One Pro", Allay Design, CC BY 4.0).
// Run: node scripts/cars/prepare-car.mjs scripts/cars/koenigsegg.config.mjs <koenigsegg_one_pro.glb>
export default {
  id: 'koenigsegg',
  outDir: 'public/models/cars/koenigsegg',
  // Source is in centimetre-ish units with the nose already at +Z. ×12 gives a
  // 2.71 m wheelbase and 4.43 m length (real One:1: 2.662 m / 4.50 m).
  scale: 12,
  wheelParts: { tyre: /Tyre/, rim: /Rims/, brake: /DiskBrake/ },
  lights: /Emissive/,
  // Names the runtime matches (CarLivery: paint, rims; Vehicle: head/tail lights are split by the script).
  materialNames: { KOP_Body_Shd: 'paint', KOP_Rims_Shd: 'rim' },
  // [material regex, decimation ratio, optional error override] toward the
  // ~150k triangle budget. Brake discs and calipers sit behind the rims and the
  // grilles are dense meshes, so they take a looser error.
  simplify: [
    [/DiskBrake|caliper/, 0.06, 0.03],
    [/Grills/, 0.2, 0.03],
    [/Steel/, 0.15],
    [/Seats|InCarbon/, 0.3],
    [/OutCarbon|Tyre|^rim$|Cockpit/, 0.32],
    [/Base/, 0.4],
    [/^paint$/, 0.55],
    [/Emissive|headlight|taillight/, 0.6],
  ],
  simplifyError: 0.004,
  lowRatio: 0.35,
  textureSize: 1024,
}
