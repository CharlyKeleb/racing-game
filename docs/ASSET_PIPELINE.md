# Asset pipeline

```
.blend (source, never shipped) → Claude + Blender MCP → <id>.glb + vehicle-config.json → public/models/cars/<id>/
```

The `.blend` file is the **source asset**. The browser only ever loads the
exported `.glb`. Every car goes through the same pipeline, so the same
`Vehicle` code drives all of them. Adding car #2…#20 is mostly a Blender MCP
session.

## Car contract

### Units and orientation
- Meters. Apply all transforms (scale = 1) before export.
- glTF axes: **+Y up, +Z forward** (the nose points +Z), so +X is the car's left.
- Origin at ground level, under the center of the wheelbase.

### Node hierarchy (names matter)

```
McLaren            (root, any name)
├── Chassis        body panels, everything that moves with the body
├── Wheel_FL       ┐
├── Wheel_FR       │ separate objects, ORIGIN AT THE AXLE CENTER,
├── Wheel_RL       │ include tire + rim + brake disc
├── Wheel_RR       ┘ (calipers belong in Chassis — they don't spin)
├── Glass          windows (transmission/alpha material)
├── Headlights     emissive, picked up by bloom
├── Taillights     emissive
└── Interior       optional, visible in cockpit cam
```

`CarModel.rigCarModel` finds wheels by `Wheel_FL` etc. It tolerates exporter
suffixes such as `Wheel_FL.001`, re-parents each wheel under a steer pivot and a
spin node, and zeroes its position. The wheel's **origin must be the axle
center**, or it will wobble when it spins.

### Materials
- PBR metallic-roughness only (the glTF exporter bakes Principled BSDF).
- Car paint: high metalness, low roughness and clearcoat. The runtime IBL
  provides reflections.
- Merge materials where possible. Target ≤ ~30 draw calls.

### Budgets
- Full model (`<id>.glb`, Medium and up and the garage): ≤ ~200k triangles. Don't
  decimate the tyres and rims here: in the garage close-up a decimated tyre reads
  as a polygon and the spokes break up.
- Low model (`<id>_low.glb`): ≲ 35k triangles and ≲ 25 draw calls.
- Textures ≤ 2048². Compress with `gltf-transform` or `gltfpack` (meshopt) for
  release builds.

### `vehicle-config.json`

This is a partial `VehicleConfig` (see `src/vehicles/VehicleConfig.ts`). Any
field you omit falls back to the defaults. The pipeline must at least
**measure** these from the model:

```json
{
  "id": "mclaren",
  "name": "McLaren 720S",
  "massKg": 1420,
  "chassisHalfExtents": [0.95, 0.3, 2.2],
  "chassisCenter": [0, 0.55, 0],
  "centerOfMass": [0, 0.38, -0.1],
  "wheels": [
    { "id": "FL", "position": [0.84, 0.55, 1.35], "radius": 0.34, "width": 0.25, "steered": true,  "driven": false, "handbrake": false },
    { "id": "FR", "position": [-0.84, 0.55, 1.35], "radius": 0.34, "width": 0.25, "steered": true,  "driven": false, "handbrake": false },
    { "id": "RL", "position": [0.86, 0.55, -1.32], "radius": 0.36, "width": 0.30, "steered": false, "driven": true,  "handbrake": true },
    { "id": "RR", "position": [-0.86, 0.55, -1.32], "radius": 0.36, "width": 0.30, "steered": false, "driven": true,  "handbrake": true }
  ]
}
```

Wheel `position` is the **suspension mount**: the axle center at rest plus
`suspension.restLength` (default 0.32 m) straight up. The pipeline should report
both the axle centers and the computed mount points.

`chassisHalfExtents` and `chassisCenter` describe a box that covers the body
*above* the wheels. Keep its bottom above the ground clearance so the box
doesn't scrape. The wheels carry the car, not the box.

Optional `"brakeDisc": { "material": "<name>" }` names the wheel material that
is the brake disc, so it can glow when hot (#92, `BrakeDiscGlow`). A wheel
without that material (no disc in the model, or an LOD that dropped it) gets a
glowing ring behind the spokes instead. `intensity` scales the glow if a disc
texture reads too bright or too dim.

## Preparing a car without Blender

`scripts/cars/prepare-car.mjs` applies the same car contract with
gltf-transform, from a per-car spec such as `scripts/cars/koenigsegg.config.mjs`:

```bash
node scripts/cars/prepare-car.mjs scripts/cars/koenigsegg.config.mjs ~/Downloads/koenigsegg_one_pro.glb
```

The script:
1. Bakes the node transforms.
2. Applies `rotateY` (to put the nose at +Z) and `scale`, then grounds the tyres and centres the wheelbase.
3. Splits the four wheels out of shared tyre, rim and brake meshes. Parts are matched by node or material name. Brake parts are split per piece: round pieces centred on the axle (discs) go on the wheel, and off-centre pieces (calipers) go on `Chassis` with a `caliper` material.
4. Splits a lights mesh into `headlight` and `taillight` materials.
5. Renames materials for the livery (`paint`, `rim`) and fixes alpha modes.
6. Decimates to budget and re-encodes textures as WebP, separately for each model.
   `cfg.full` (`simplify`, `textureSize`, `textureQuality`) sets the full model's
   detail. The Low model always takes `cfg.simplify` and `cfg.textureSize`, then
   `cfg.lowRatio`, so raising the full model's detail never makes Low heavier.
   Without `cfg.full`, both models come out as they did before it existed.
7. Writes `<id>.glb` and `<id>_low.glb` (meshopt).

It prints the axle centres, radii, widths and bounds that `vehicle-config.json` needs.
Wheel mounts sit at axle height plus `restLength` (0.32 m). Then add the car to
`src/vehicles/carRegistry.ts` with its `firingPerRev`, its `stats`, and
`selectable: true`, so it appears in the garage's ‹ › car picker.

### Rival LOD

AI rivals on the Low preset load `<id>_rival.glb`, so a grid of 8 still fits a
phone's frame. Build it from the Low model (all cars, or the ids you pass):

```bash
node scripts/cars/build-rival-lod.mjs [id ...]
```

It keeps the contract nodes, the paint (a texture livery keeps its texture and
UVs) and the lamp materials, bakes every other body material into one
vertex-coloured `trim`, see-through parts into one `glass`, each wheel into one
`wheel`, then decimates: about 9 draw calls and 6–14k triangles a car. Add the
file to the car's row as `modelUrlRival`. Rivals never use physical
`transmission` glass (`cheapForRivals` in `RivalPaint.ts`): one transmissive
mesh makes three.js draw the whole opaque scene a second time.

## Track contract

Tracks don't need hand-authored names: `scripts/track/build-track.mjs`
classifies meshes by **material name** with per-track regex rules, then chunks,
simplifies and compresses them for streaming. See
[Track streaming](TRACK_STREAMING.md) for the pipeline, the `track.json`
manifest and how to add a track.

## Engine audio

Each car can ship its own recordings in `public/audio/<id>/`. Point the car's
`audioUrl` in `carRegistry.ts` at that folder. Without it, the car falls back
to the procedural engine.

| File | What |
|---|---|
| `engine-bank.wav` + `.json` | Steady segments of the real engine at a few rpm, plus a pitch mark on every firing pulse (16-bit WAV, Git LFS) |
| `ignition.mp3` | One-shot played at race start; the engine loop fades in after it |
| `lift-off.mp3` | Exhaust burble on lifting off the throttle above ~4200 rpm |
| `CREDITS.md` | Source and license of every recording |

`GranularEngine` replays one Hann-windowed grain of the recording per firing
pulse, spaced at the target rpm (PSOLA). That way 4–5 short real segments
between idle and ~3000 rpm cover the whole rev range without the chipmunk
effect of speeding up a loop.

To build a bank:
1. Find recordings with a free-to-ship license (CC0 or CC BY).
2. Find stretches where the rpm is nearly steady: idle, or the top of a rev blip.
3. List them in a spec, `scripts/audio/<id>.json`, with the engine's firing
   pulses per rev (flat-six 3, V8 4). Then run
   `python3 scripts/audio/make_engine_bank.py scripts/audio/<id>.json <wav dir> public/audio/<id>`.

`tests/engineAudio.test.ts` checks that the bank plays at the requested rpm.

## Impact audio

Car-to-car and wall hits play real recordings from
`public/audio/impacts/impact-bank.wav` + `.json`: three strength tiers (light,
medium, heavy), each with a couple of variants. Landings, kerbs and the wall
scrape stay procedural (`ImpactPCM.ts`). To change the recordings, edit
`SOURCES` / `BANK` in `scripts/audio/build-impact-bank.mjs` (CC0 or CC BY only,
and list them in `public/audio/impacts/CREDITS.md`). Then run
`node scripts/audio/build-impact-bank.mjs <download dir>`. It downloads the
Freesound previews, cuts each one from its first transient, matches loudness
per tier and writes the bank.

Exhaust pops work the same way: `public/audio/backfire/backfire-bank.wav` +
`.json` (short `crackle`s and big `bang`s) is built by
`node scripts/audio/build-backfire-bank.mjs <download dir>`. Each cut is listed
by the time of its pop in the source recording.

## Garage

The menu and garage screens use the NFS 2015 workshop
(`~/Downloads/garage_nfs_2015.glb`, 11.5 MB). Rebuild it with:

```bash
npm run build:garage
```

`scripts/garage/build-garage.mjs` does the following:

- Scales the model ×10 into metres.
- Probes the whole floor with 256 rays at bonnet and camera height, so thin
  poles count. It parks the car where a ±50° camera arc has the most room
  (7.3 m or more), puts the origin there with the floor at y = 0, and turns the
  room so that arc sits on the menu camera's front three-quarter angle.
- Marks every material unlit (`KHR_materials_unlit`), because the lighting is
  baked into the textures. The `Lights_D` glow sheet is drawn additive.
- Writes WebP textures in two tiers: `garage_high.glb` (≤2048 px, 3.1 MB) and
  `garage_low.glb` (≤1024 px, 1.1 MB).
- Writes `garage.json` with wall clearance in 32 directions. The menu camera
  pulls in, and widens its lens, before a wall or pillar could block the car.

At runtime, `Showroom` lights only the car: an environment map baked from the
room itself, a key light, two rims, a contact shadow and a warm floor pool.
Medium and High add a radially faded floor reflection.

## Traffic cars

Free Roam's street traffic (`src/world/StreetLife.ts`) wears the GLBs in `public/models/traffic/`,
listed in `src/world/trafficModels.ts`. A traffic car has no wheel rig: it's one mesh per
material, nose +Z, wheels on y = 0, to scale; its collision box is fitted to its bounds at load.

```
node scripts/traffic/prepare-traffic.mjs source.glb public/models/traffic/<id>.glb --rotate 270 --triangles 6000 --drop Interior
node scripts/traffic/prepare-traffic.mjs source.glb public/models/traffic/<id>_low.glb --rotate 270 --triangles 2500 --texture 512 --drop 'Interior|Numberplates|Carbadges'
```

`--rotate` turns the nose to +Z (check it in the game). Each material is a draw call per model, so
Low uses only the first two models, as `_low` files, and turns their shadows off.

## Licensing

A free download is **not** automatically licensed for redistribution in a
published game. Record the source and license of every model in
`public/models/CREDITS.md` before you ship it. Brand names and liveries may also
need clearance. Keep `.blend` source files out of git, or in Git LFS.

### Steering grip limit

`steerPeakSlipScale` defaults to `0.5` and is resolved for every vehicle, including
older configs that omit it. At speed, steering lock is capped by the smaller of
the existing speed falloff and the kinematic angle for the available tire grip
(including downforce and surface friction), plus this share of the tire’s peak
slip angle. `0` retains the previous steering envelope for comparisons.

Parking lock is preserved. A held handbrake opens the original drift lock
immediately; active drift amount blends toward it smoothly, preserving opposite
lock. AI uses the same limit when converting desired wheel angles into inputs.
