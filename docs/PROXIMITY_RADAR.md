# Proximity radar and spotter (#89)

The compact HUD radar shows rivals relative to the player's nose in both camera
modes. White is the player, blue is nearby traffic, amber is a fast rear
approach and red is longitudinal overlap. Left/right bars and text confirm
flank occupancy and clear calls. The wider lateral scale makes adjacent cars
readable; icons indicate orientation rather than exact body dimensions.

Settings → Driving independently toggles Proximity radar and Spotter text.
Settings → Audio toggles Spotter sounds (off by default). Sounds are short
original stereo tones: the warning is panned toward the occupied flank, both
flanks use a lower centred tone, and clear uses a rising interval. These are
tonal cues, not spoken voice lines. They use the normal effects/master mixer.
All preferences persist and old saves receive boolean defaults.

## Collision relevance

`racing/ProximityRadar.ts` contains numeric awareness and route projection with
no engine or React imports. `Game` samples the existing rendered car transforms,
smoothed world velocities, chassis dimensions and tracked centreline indices
at the normal 20 Hz telemetry cadence. Longitudinal overlap accounts for each
rival's orientation, so a sideways/spun car has a wider forward projection.
Left/right remain relative to the player's nose while reversing.

- Limit to 32 m ahead/behind and 9 m laterally; ignore height separation >1.6 m.
- Compare wrapped centreline metres from local projection, using the existing
  progress indices. Nearby parallel/disconnected sections with a large route
  gap are excluded without a global nearest-road search.
- Raycast at chassis height against static colliders. A pit wall/median blocks
  the contact; other dynamic cars do not. Open pit merges without a separating
  wall remain relevant when they share nearby route progress.
- A rear car is marked as approaching when it closes faster than 2.5 m/s and is
  within three seconds of longitudinal overlap. Merely being behind is not a
  warning.

Enter requires 150 ms of stable overlap, with wider release bounds and 500 ms
of stable absence before clear. A 1.4-second cue cooldown retains the latest
occupancy rather than queueing outdated speech/calls. A 600 ms lifecycle warmup
prevents a burst at lights-out/resume/reset. Pause, phase changes, reset/recovery,
car swaps, restart, track changes and disabling settings clear the radar and
cancel scheduled tones immediately. No automatic steering/avoidance is added.

## Ownership and budget

Sixteen fixed contact cells, player/rival input buffers and the static ray are
reused. Route cumulative distances are built per track; rival inputs are built
per race. No new vectors/arrays are created in the awareness update. Rapier
owns its ray-hit return object. At most one static query per nearby candidate
runs at 20 Hz, not on every render frame. Audio nodes are created only on cue
events and disconnected when finished/cancelled. The UI uses its own vanilla
store with a throttled revision; React maps the existing cells for the SVG.
There are no renderer-specific shaders, scene objects or render passes.

The radar reserves a tag-exclusion panel. Desktop places it between the map and
gauges. Touch places it in the central gap away from pedals, steering, camera,
reset and pause controls; the design was inspected at 390×844 and 667×375.

## Reproduction

- `/src/dev/proximity.html`: real race/physics/HUD with three rivals and a
  cockpit default. Start race; the toolbar provides controlled Left pass,
  Right pass, Both, Rear and Clear scenarios. Live stops repositioning cars.
  The scripted scenarios are inspection fixtures, not AI behaviour.
- Append `?sound` for tones or `?renderer=webgpu` for the other renderer.
- `/src/dev/proximity-responsive.html`: production HUD and touch controls at
  portrait/landscape iframe widths; no physics or saved preference writes.

`tests/proximity.test.ts` covers representative passes, clear hysteresis,
closing/receding traffic, route wrap, disconnected segments, bridges, real
Rapier pit-wall queries, reverse/spin orientation, multiple cars, cell reuse,
reset, independent audio/visual preferences and scheduled-tone cancellation.
Run build, lint and the full test suite. Visual fixtures do not establish
fleet-wide performance or exhaustive topology correctness for every circuit.
