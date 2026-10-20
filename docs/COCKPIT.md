# Cockpit calibration and asset scope (#86)

The player camera uses a per-car profile in `src/vehicles/CockpitConfig.ts`.
Coordinates are in the rigged body frame, in metres (+X driver side, +Y up,
+Z forward). The eye follows the rendered suspension/body transform, avoiding
relative motion between the driver's head and the roof during chassis lean.
Near clipping is 2.5 cm inside the car; chase keeps its normal near plane.

## Existing asset audit

- Porsche 911: the shipped interior provides a basic dashboard/bench but no
  separately usable steering wheel or instruments. Add a small three-spoke
  wheel, dark cluster housing and telemetry LCD. Default FOV: 68 degrees.
- Koenigsegg: preserve the existing detailed interior and gauge housing. Isolate
  the steering rim, grips and spokes from the merged `KOP_Cockpit` /
  `KOP_InCarbonFiber` meshes. The wheel is centred at (0.318, 0.670, 0.485);
  the similar-looking housing further forward must remain stationary. Add a
  compact LCD in the stock cluster area. Default FOV: 72 degrees, with a lower
  seat and tighter height limit to clear its roof.
- BMW: isolate the stock `audi_r8_lms_steeringwheel` material geometry from the
  merged interior, retaining its existing texture and interior. Add a compact
  LCD above the wheel. Default FOV: 70 degrees.

The original gauge faces are baked textures, without independent needle nodes.
They remain decorative; the added LCD provides live speed, gear, numeric RPM
and a shift bar. This is a modest runtime supplement, not a replacement of the
interior assets. Existing low-poly surfaces, texture artefacts, mirrors and
interior proportions are unchanged. Mirrors are not live render targets.

Extraction selects whole triangles in a calibrated steering volume, copies
owned geometry, and retains the shared source materials. Disposing restores
original geometry before freeing the copies. No GLB files, cached source
geometry or rival-car interiors are modified. Both LODs are covered by tests
against the actual BMW and Koenigsegg assets.

## Controls and telemetry

Settings → Driving → Cockpit shows controls for the selected car: seat height,
forward/back position, FOV, horizontal look and vertical tilt. Values persist in
`racing-game:settings` under `cockpits[carId]`. Reset affects only that car.
Loaded values are finite-clamped to the calibrated limits; old saves default to
zero offsets. Pause exposes the same controls; resume to inspect the view.

Steering reads the interpolated front steering angle in render time, with a
per-car steering ratio and a 234-degree limit in either direction. The LCD
updates at most 20 Hz and redraws only when displayed telemetry changes. RPM
uses the same staging-rev source as the HUD during the countdown and the
powertrain source while racing. Display values freeze while paused.

Head movement under acceleration/braking is spring-smoothed and limited to
1.2 cm. Camera movement Off and OS reduced motion disable extra head motion,
shake and camera-mode fades. Switching modes uses a 180 ms fade through black
rather than flying the camera through the roof/body. Reduced motion switches
directly. The existing cockpit engine-audio filtering remains in use.

## Verification and budget

Run `npm test -- tests/cockpit.test.ts`, `npm run build` and `npm run lint`.
The tests cover persistence, sanitization, body-relative seating, FOV, mode
transitions, telemetry, pause, steering direction and safe extraction/disposal
of both real asset LODs.

Development pages:

- `/src/dev/cockpit.html`: independent car/LOD, steering, speed/RPM, night,
  seat and FOV controls; never writes saved settings.
- Append `?renderer=webgpu` to exercise native WebGPU.
- `/src/dev/cockpit-race.html`: normal game with an ephemeral cockpit/one-lap
  Papaya setup; append `?car=bmw` or `?car=koenigsegg` to change cars. Normal
  Settings changes still save, as in the real game.

Browser checks include all three interiors, both renderer paths, steering and
night readability, plus a live Porsche race with matching cockpit/HUD speed
and gear and inspection of the pause controls. These are visual checks, not a
fleet/device performance certification.

The LCD uses one 512×128 texture, one built-in unlit material and a housing.
It adds no lights, postprocessing passes or render targets; the fade changes
only the canvas opacity. BMW/Koenigsegg steering splits existing triangles into
1–2 additional draws rather than adding their geometry. Porsche adds one
merged wheel draw (under 1,000 triangles). The calibration scene on Low reported
38 draws / 41,928 triangles (Porsche), 38 / 36,782 (Koenigsegg), and 40 / 11,661
(BMW), including the fixed road/scenery fixture. Koenigsegg High remains about
222k triangles including that scene; this work does not optimize that existing
asset budget. GPU timing and mobile verification remain separate performance
work.
