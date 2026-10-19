# Rain surface effects

Rain uses four independent systems: airborne streaks (`Rain`), tyre spray
(`RainSpray`), impacts (`RainImpacts`), and road wetness/ripples (`WetRoads`).
Cockpit lens drops remain in the shared distortion pass.

`RainSurface` captures the topmost loaded track geometry into a local 52 m
height field, from 64 m above the camera down to 64 m below it. This provides
road/roof height without CPU particle collision tests. Falling streaks clip at
that height; impact crowns align to the slope estimated from adjacent samples.
Covered roads receive no fresh wetness. Geometry remains in its existing scene;
a dedicated capture layer and temporary material override isolate the pass.
Renderer target, clear state, background, and override are restored afterward.

Wet asphalt retains its maps and material response, with darker patches and
lower roughness. A world-space procedural mask defines pooled areas. Expanding,
fading ripple normals perturb highlights only in these areas. This is an art
mask, not a fluid accumulation or depression simulation. Wetness switches with
weather; it does not yet accumulate or dry gradually. No screen-space scene
reflections are added: puddles reflect the existing environment lighting.

Low uses a 128² capture at up to 5 Hz and 240 impact instances. Medium uses
128² / ~8 Hz / 560; High uses 256² / ~12 Hz / 960. Captures refresh immediately
when the camera moves beyond the cached area. Low's Lambert roads receive the
wet color response and impacts; reflective roughness/ripple normals require
PBR road materials (Medium/High WebGL, all WebGPU tiers).

The height field covers loaded geometry only. It uses the topmost surface,
not multiple stacked water layers, ignores alpha cutouts in the capture, and
cannot represent geometry outside its local height range. Outside its footprint,
roads are assumed exposed. Capture resolution can soften shelter boundaries.

## Verification

- `npx vitest run tests/rain.test.ts tests/rainSurface.test.ts`
- With `npm run dev`, open `/src/dev/rain-preview.html` for WebGL or append
  `?renderer=webgpu` for WebGPU. The fixture renders a sloped road and a roof,
  checks sampled heights against 0.40 m and 2.10 m, and exposes a wet/dry toggle.
  WebGPU also checks the material sampler, catching render-target Y inversions.
- Check actual rain on both procedural and streamed tracks, including a shelter,
  camera changes, quality changes, dry weather, and returning to the garage.
