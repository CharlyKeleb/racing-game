# Premium car paint

Garage → Paint and Garage → Livery share the Finish selector. Metallic adds
object-space microflake normals and local roughness variation beneath an
unperturbed clearcoat. Glints come from direct and environment lighting, rather
than emissive dots. The grains follow the panels as the car moves; derivative
filtering fades grains that become smaller than a pixel.

Pearl combines a weaker flake layer with angle-dependent base-colour channel
mixing and the physical material's thin-film iridescence. Projected stripes,
numbers and decals retain their chosen colours. Gloss and Matte disable both
procedural layers. Existing per-car finish persistence needs no schema change.

`vehicles/PaintFinish.ts` owns the finish controls and WebGL shader wrapper;
`engine/nodes/materials.ts` implements the matching native TSL physical material.
CarLivery owns the material and restores the cached source materials and geometry
on disposal. Cars without livery-placement metadata also receive premium paint.
Rain's existing clearcoat/roughness override works with these materials.

The showroom's existing lights and environment illuminate both layers without
extra lights or render passes. This is a filtered procedural approximation of
pigment flakes, not individual flakes or a spectral paint simulation.

Verification:

- `npm run build`, `npm run lint`, `npm test`.
- In the showroom, select Metallic and Pearl and orbit the car; switch back to
  Gloss/Matte. Check stripes, numbers, car changes and persisted finish selection.
- The actual Porsche fixture at `/src/dev/rain-preview.html?car=1&finish=pearl`
  supports `finish=metallic` too. Append `&renderer=webgpu` for native TSL; toggle
  Wet weather off to inspect the selected dry finish and back on for rain.
