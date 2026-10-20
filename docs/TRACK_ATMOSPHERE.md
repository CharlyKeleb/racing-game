# Track atmosphere and road contrast

Papaya Test Circuit is the reference circuit for #88. The final scope follows
player feedback: flags, event banners, a small unmanned pit canopy/equipment
area, and spatial wind/fabric/pit-fan sound. There are no spectators, stands,
crowd loops or applause. The existing race finish sting remains unchanged.

The asphalt is darker and its grain has lower contrast; white edge lines and
red/white kerbs carry the road silhouette. Grass and trees use muted colours.
The old dashed road centreline is removed. Papaya retains this authored palette; the optional global Road focus preset
also supports streamed circuits. See TRACK_LOOK.md.

## Placement and rendering

`world/atmospherePlan.ts` holds three route-relative site definitions. It
checks the full furniture footprint against every road segment, rejecting a
site near another section of the circuit. Local +Z points away from the road.
The reference track is flat; this is not automatic placement for arbitrary
streamed terrain. Before adding a streamed circuit, author placements against
its actual barriers, elevations and buildings, then check all footprint heights
and sightlines. Do not blindly reuse the procedural offsets.

`Track` builds a matching Armco collider for each site's front barrier and
excludes trees within 17m. Barrier colliders are excluded from road-height
queries and are removed when the track is disposed.

`TrackAtmosphere` merges static furniture per site, shares one original
1024×128 banner atlas, and combines each pair of flags into one mesh. All
materials are built-in Three materials, supported by both renderer paths.
No extra lights, shadows, downloaded models or custom shader variants.
Each site is at most three draw calls; all three sites total 978 triangles.
Groups and meshes retain frustum culling, plus 130/200/260m distance cutoffs for
Low/Medium/High. Flag deformation runs only nearby on Medium/High. Low,
reduced-motion preference, and the fixture's Motion Off use static poses;
pause freezes the current pose. Per-frame work uses existing attributes.

## Sound and lifecycle

`audio/TracksidePCM.ts` creates two quiet six-second mono 22.05kHz loops: soft
wind/fabric and a pit version with a faint fan. All geometry, lettering and PCM
are original generated assets, with no external attribution/licence dependency.
There are no voices. The two PCM buffers total ~1.01MiB; no audio downloads.

`TracksideAmbience` uses at most four sources (three in Papaya), with distance
rolloff, a 150m cutoff, distance filtering and stereo panning from the active
camera's world position/right vector. This includes intro and finish cameras.
Sources feed the existing master volume/limiter, fade out in the garage/menu,
and follow the existing audio-context pause/background handling. Track changes
stop and disconnect old sources; disposal releases the graph. Unsupported
circuits have no trackside sources. Settings → Audio → Trackside ambience has
its own persisted level; zero mutes it without muting engine or music.

## Verification

`/src/dev/track-atmosphere.html` builds the real procedural track and atmosphere
with the production renderer. Add `?renderer=webgpu` for the native path; check
the displayed backend rather than assuming support. Controls select the three
areas, quality, motion, audio, pause, and atmosphere visibility for a baseline.
It does not change persisted game settings. The CPU timings measure update and
render submission, not GPU frame time or production device performance.

Local fixed-camera WebGL preview, post FX off and Low resolution: baseline
7 draw calls / 30,204 triangles; the visible start/finish site adds 3 calls /
422 triangles (10 / 30,626 total). Indicative CPU update+submission median was
0.1–0.2ms and p95 0.2–0.5ms. These are a small local scene comparison, not proof
of stable frame pacing on phones or closure of #69. Native WebGPU visually
renders the same furniture, colours and flags; its fixture uses the renderer's
per-frame `drawCalls` accessor rather than the cumulative `info.render.calls`.

Tests cover reference footprint clearance, rejection beside another route,
geometry/draw budgets, paused/static flag states, hidden/distant groups, PCM
seams/headroom, camera-relative panning, muting and source cleanup. Build,
lint and all 321 tests pass, including the final road-collider filtering change.
Also check a real Papaya race (the race-finish fixture selects it ephemerally),
menus, pause/resume, audio zero/master mute, and track switching. Device-level
and Safari performance remain part of #69.
