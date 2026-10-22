# Track appearance presets

Settings → Graphics → Track appearance offers **Road focus** (the default)
and **Track default**. The selection persists with the other settings and
applies immediately to every route, all quality levels and streamed LODs.
It is independent of lighting, weather, camera and car paint.

Road focus grades linear base colour before lighting: neutral asphalt becomes
~35% darker, while terrain/vegetation lose some saturation and a little
brightness. Bright pixels are protected. Known kerb, decal, marking and paving
materials remain unchanged; separate props, signs and emissive lights are
untouched. Textured road materials also use a saturation/luminance mask to
preserve bright paint and coloured pixels. Track default sets grading strength
to zero; it uses the track's shipped palette (including Papaya's authored
contrast pass from #88).

`world/TrackLook.ts` owns role selection, the shared strength uniform and the
WebGL wrapper. `engine/nodes/trackLook.ts` is the native WebGPU twin. Procedural
materials and `StreamedTrack`'s shared material libraries install the grade at
creation. A settings change only updates one uniform: no scene traversal,
texture replacement, chunk reload, extra draw calls or postprocessing pass.
There is a small per-fragment colour calculation on affected materials.

Far LODs have already merged roads and props into one vertex-coloured mesh,
so individual material IDs no longer exist. Their grade uses the same colour
masks: dark neutrals receive asphalt treatment; coloured surroundings are
muted and bright markings are protected. This preserves the single-draw-call
far geometry and uses no added textures/attributes. It is a colour-based
approximation, not a new semantic road mask; some dark neutral distant props
can darken too. Native materials include vertex colours before grading and
disable the subsequent automatic multiplication, avoiding doubled colours.
Precompilation provides a white colour attribute for that shader variant.

Wet roads retain the grade, then apply wetness darkening/roughness/reflections.
The WebGL wrapper runs wetness after colour grading. The native wet material
keeps the source colour-node graph, including its live preset uniform. Neither
preset changes handling, surfaces, markings geometry, light intensity or
texture ownership/disposal.

## Verification

`/src/dev/track-look.html` provides the five real routes, both presets,
Low/High quality and wet-road controls with fixed cameras. Add
`?renderer=webgpu&track=drift-park` for native rendering. This fixture uses the
production material library/streamer and never writes persisted settings.

Visual checks: Nürburgring, Marina Bay, Bayview and Papaya in WebGL; Drift Park
in native WebGPU at Low and High, including wet-road preset switching. The
fixed Nürburgring Low view retains 136 calls / 138,725 triangles under either
preset; the same geometry/texture objects remain in use. This is not a GPU
frame-time benchmark. Existing #69 device/Safari performance work remains.

Tests cover shipped material-library role coverage, protected markings,
shared uniform updates for current/future materials, shader composition and
wetness ordering. Build/typecheck, lint and all 324 tests pass.
