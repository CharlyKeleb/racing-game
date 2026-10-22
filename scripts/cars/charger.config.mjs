// Dodge "Ice Charger", Fast & Furious 8 (downloaded as "dodge_charger_fast__furious_8.glb").
// Run: node scripts/cars/prepare-car.mjs scripts/cars/charger.config.mjs <dodge_charger_fast__furious_8.glb>
export default {
  id: 'charger',
  outDir: 'public/models/cars/charger',
  // Metres, nose at -Z: turn it round. 5.2 m long, 2.3 m wide over the widebody arches.
  rotateY: 180,
  scale: 1,
  wheelParts: { tyre: /^tyrewallblack$/, rim: /^(black\.002|darkgray\.002|black\.001|darkgray|screw_037)$/, brake: /^(disk_brake|wilwoodhub)$/ },
  // Front lamps, and the round tail lights.
  lights: /^(vehicle_generic_smallspecmap|redlight)$/,
  // Fully transparent (alpha 0) parts: never visible.
  drop: /^(6e2ab3_|vehicle_generic_detail2$|vehicle_licenseplate$|script_rt_dials_dukes$)/,
  // Keep its matte black (no 'paint' rename): the stock garage paint would turn Dom's car red.
  // The chrome spokes take the garage's rim colour; the windows its tint.
  materialNames: { 'black.002': 'rim', higlass: 'glass', 'higlass.001': 'glass' },
  simplify: [
    [/^(black|darkgray\.001|rgba252528ff)$/, 0.3, 0.01],
    [/^vehicle_generic_smallspecmap_PRIMARY$/, 0.45],
    [/^rgba343434ff$/, 0.4, 0.01],
    [/^(rim|darkgray\.002)$/, 0.35, 0.01],
    [/^wilwoodhub$/, 0.25, 0.02],
    [/^(disk_brake|caliper)$/, 0.4, 0.02],
    [/^(bride_alcantara|whiteleather2_SECONDARY)$/, 0.4, 0.01],
    [/^(tyrewallblack|badge|1red\.001)$/, 0.5],
  ],
  simplifyError: 0.004,
  // Most small parts are coloured by 1–64 px swatches: plain colours, merged (draw calls).
  flattenTextures: 64,
  mergePlain: true,
  lowRatio: 0.1,
  lowError: 0.06,
  // Low preset: the cabin and its displays.
  lowDrop: /^(bride_alcantara|whiteleather2_SECONDARY|sparco-logo-vector|gauges1|newhud|4hiblue|1red$|2yell|radar|symbolsdiff1|doortags1|dod_chargerrt_69)/,
  textureSize: 1024,
}
