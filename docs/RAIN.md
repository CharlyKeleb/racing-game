# Rain surface effects

Rain uses four independent systems: airborne streaks (`Rain`), tyre spray
(`RainSpray`), impacts (`RainImpacts`), and road wetness/ripples (`WetRoads`).
`CarRain` additionally samples upper body geometry once per selected model and
anchors a separate ballistic droplet batch to the moving body. No per-frame raycasts or
attribute uploads are needed. Wet paint gains a clear water coat, restoring the
chosen finish in dry weather. Cockpit lens drops remain in the shared distortion pass.

`RainSurface` captures the topmost loaded track geometry into a local 52 m
height field, from 64 m above the camera down to 64 m below it. This provides
road/roof height without CPU particle collision tests. Falling streaks clip at
that height; impact droplets align to the slope estimated from adjacent samples.
Covered roads receive no fresh wetness. Geometry remains in its existing scene;
a dedicated capture layer and temporary material override isolate the pass.
Renderer target, clear state, background, and override are restored afterward.

Secondary impact droplets use launch velocity, outward directions and 9.81 m/s²
gravity, evaluated in elapsed seconds. Road droplets stop on returning to the
captured surface. Car droplets inherit vehicle velocity, with exponential air
drag relative to the moving body, and terminate below the local hit plane.
The car approximation assumes its recent linear velocity over the short flight;
it does not record a history of the rotating body or solve fluid dynamics.
Droplets are rendered as small camera-facing discs, each with an independent
trajectory; no expanding crown image is used.

Wet asphalt retains its maps and material response, with darker patches and
lower roughness. A world-space procedural mask defines pooled areas. Expanding,
fading ripple normals perturb highlights only in these areas. This is an art
mask, not a fluid accumulation or depression simulation. Wetness switches with
weather; it does not yet accumulate or dry gradually. `WetReflections` adds a linear HDR planar scene capture to the pooled areas,
including visible cars, emissive lamp lenses and exhaust flames. The same mask
keeps the drier patches less reflective, and the exposure mask keeps sheltered
roads dry. Environment lighting remains underneath the scene reflection.

The reflection plane follows the road triangle below the player, including its
slope. Reflections fade between 8 and 40 cm from this plane to avoid projecting
one road level onto bridges or unrelated elevations. An oblique near plane
rejects geometry underneath the road; road receiver meshes are excluded from the
capture to prevent render-target feedback. Capture state and receiver visibility
are restored even on failure. Dry weather stops capture and invalidates the image.
This is a planar approximation on **all** presets, not SSR: curved/nonplanar roads
can lose reflections outside the local plane. It does not reflect other road
surfaces, and refresh cadence can lag fast motion. Headlight beams themselves are
lights, not visible geometry; their lenses and illuminated scene objects reflect.

Reflection budgets are 256×128 at up to 10 Hz (Low), 512×256 at 20 Hz
(Medium), and 768×384 at 30 Hz (High), with no capture when dry. Each capture
renders the visible scene again within 120 m; full track/device frame budgets remain unmeasured.
Both WebGL (including Lambert Low roads) and WebGPU support scene reflections.

Low uses a 128² capture at up to 5 Hz and 480 impact instances. Medium uses
128² / ~8 Hz / 1400; High uses 256² / ~12 Hz / 2200. Captures refresh immediately
when the camera moves beyond the cached area. Low's Lambert roads receive the
wet color response and impacts; reflective roughness/ripple normals require
PBR road materials (Medium/High WebGL, all WebGPU tiers).

The height field covers loaded geometry only. It uses the topmost surface,
not multiple stacked water layers, ignores alpha cutouts in the capture, and
cannot represent geometry outside its local height range. Outside its footprint,
roads are assumed exposed. Capture resolution can soften shelter boundaries.

## Verification

- `npx vitest run tests/rain.test.ts tests/rainSurface.test.ts tests/wetReflections.test.ts`
- With `npm run dev`, open `/src/dev/rain-preview.html` for WebGL or append
  `?renderer=webgpu` for WebGPU. The fixture renders a sloped road and a roof,
  checks sampled heights against 0.40 m and 2.10 m, and exposes a wet/dry toggle.
  Append `&car=1` (or `?car=1` on WebGL) to inspect actual Porsche body impacts.
  WebGPU also checks the material sampler, catching render-target Y inversions.
- Check actual rain on both procedural and streamed tracks, including a shelter,
  camera changes, quality changes, dry weather, and returning to the garage.

The preview includes the scene reflection pass. Append `?quality=low` for the
WebGL Lambert path, or `?renderer=webgpu` for the native node-material path.
