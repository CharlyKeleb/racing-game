# Track streaming

The Nürburgring GP source model (Sketchfab, 136 MB, 1.83M triangles, 106 PNG
textures, an 18 km terrain and ~1M triangles of forest) is far too heavy to
ship to a phone. An offline pipeline turns it into a **streamed package**, and
`StreamedTrack` loads only what's around the car.

```
~/Downloads/nurburgring_gp_2022_layout.glb
        │  npm run build:track   (scripts/track/build-track.mjs + nurburgring.config.mjs, ~7 s,
        │                         then derive-from-chunks.mjs)
        ▼
public/models/tracks/nurburgring/
  track.json            manifest: chunks + bounds, spawn, checkpoints, centreline, stats
  surface.bin           surface type per 1 m cell (asphalt, kerb, grass, sand, gravel), RLE   70 KB
  materials_high.glb    93 materials, WebP textures ≤1024   2.4 MB ┐ one is loaded,
  materials_low.glb     same, textures ≤256                 0.7 MB ┘ shared by every chunk
  collision.glb         70k-tri Rapier mesh (road, run-off, barriers, terrain)  0.4 MB
  backdrop.glb          terrain simplified to 12k tris                          0.1 MB
  chunks/<i>_<j>_lod0.glb   full detail, per material     97 chunks, 436k tris, 9.0 MB total
  chunks/<i>_<j>_lod1.glb   one merged vertex-coloured mesh      134k tris, 2.1 MB total
```

First load on a phone (Low) is about **2–3 MB**: the low material library,
collision, backdrop and the chunks around the start line. Everything else streams
in while driving.

## Pipeline steps (build-track.mjs)

1. **Bake transforms.** Every primitive goes to world space (meters, Y up).
2. **Classify by material** into layers (config `layers`): `road`, `ground`,
   `decal`, `barrier`, `prop`, `veg`, `terrain`, `drop`. The layer decides
   collision, LOD error, shadows, and whether Low may hide it.
3. **Place gates.** Hand-placed checkpoints from `topdown.mjs` maps snap to the
   nearest racing asphalt (≤30 m), and the build fails if one can't. Gate 0 (the
   start/finish line) becomes the origin, so the runtime track is centred on
   the start line at y = 0.
4. **Trim.** Scenery more than 350 m outside the circuit is dropped (mostly the
   far forests), and tree cards are thinned by whole connected components (30%
   of near trees and 10% of forest kept, at LOD0).
5. **Chunk.** Triangles are bucketed into a 200 m grid by centroid. Vertices
   shared with a neighbouring chunk are **locked**, so simplification can never
   open a crack between chunks.
6. **Weld + simplify** (meshoptimizer, absolute error in metres):
   - Sketchfab exports guardrails, poles and props as near triangle soup (every
     face has its own UVs and normals), so no simplifier can touch them until
     they're welded. LOD0 welds by position + normal (hard edges stay sharp).
     Barriers weld by position.
   - Text-bearing materials (`keepUvs`: signs, sponsor boards) are never welded,
     so their text stays crisp.
   - LOD1 welds everything by position, recomputes normals, prunes small parts,
     then **merges the whole chunk into one mesh** coloured with each material's
     average texture colour. That's one draw call per far chunk.
7. **Collision.** Road, run-off and barrier meshes per chunk plus the terrain,
   welded and simplified, positions only, 16-bit quantised.
8. **Material libraries.** Base colour and emissive only (normal and specular
   maps dropped), roughness ≥ 0.6, metalness 0. Alpha-blended trees and fences
   become alpha-tested: no sorting and much less overdraw. Textures are WebP in
   two tiers.
9. **Compress.** Every chunk uses meshopt (`EXT_meshopt_compression`) with
   quantised positions and normals.

| | Source | Shipped |
| --- | --- | --- |
| Triangles | 1,828,407 | 436k LOD0 / 134k LOD1 |
| Size | 136 MB | 15 MB total, ~2–3 MB first load |
| Textures | 106 PNG, 39 MB (one 4K) | 88 WebP, 0.7 MB (low) / 2.4 MB (high) |
| Collision | n/a | 70k tris, 0.4 MB |

## Runtime (src/world/StreamedTrack.ts)

- **Load order:** manifest → material library + collision (in parallel) →
  backdrop → every chunk the spawn point wants (with a progress bar) → race.
- **Plan** (`streaming/ChunkPlanner.ts`, pure and unit-tested): five times a
  second, each chunk's distance is measured to the car and to a look-ahead point
  2.5 s ahead along its velocity. Inside `lod0` it gets full detail, inside
  `lod1` the merged far LOD, beyond that it's unloaded. Hysteresis stops
  flicker on boundaries.
- **Fetch** nearest-first with bounded concurrency. Meshopt decoding runs on
  worker threads.
- **Integrate at most one chunk per frame.** The GPU upload of a fresh chunk is
  the main hitch source on mobile. A LOD swap only happens once the new LOD is
  ready, so there are no holes.
- **Shared materials:** chunks carry name-only material stubs, and `adopt()`
  swaps in the library material, so each texture is decoded and uploaded once.
  All shader variants are precompiled against the real scene's lights before
  the race starts.
- **Static scene:** track nodes get `matrixAutoUpdate = false`, so thousands of
  nodes cost nothing per frame.
- **Fog hides the streaming edge:** `viewDistance()` puts fog's far end at 95% of
  the LOD1 radius, and the camera's far plane follows.

### Quality budgets

| Preset | LOD0 radius | LOD1 radius | Textures | Shading | Trees | Shadows | Fetches |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Low (phones) | 120 m | 420 m | 256 px | Lambert | off | off | 1 |
| Medium | 200 m | 600 m | 1024 px | Standard | on | off (track) | 2 |
| High | 320 m | 900 m | 1024 px | Standard | on | on | 3 |

Low also uses the simplified car (`porsche911_low.glb`: 148k → 56k triangles,
`npm run build:car-lod`), a pixel ratio of at most 1, and post FX off by default.
On top of every preset, **dynamic resolution** (`Renderer.adapt`) drops the pixel
ratio when frame rate falls under 55 fps and creeps back up after 3 smooth
seconds.

Measured on the start straight and at the Dunlop hairpin on the Low preset:
**83–158 draw calls, 108–192k triangles per frame.** That includes the car;
before the far-LOD merge and car LOD it was 140–255 calls and 235–290k
triangles.

## Mobile

- First-run defaults come from `engine/device.ts`: phones get Low (or Medium on
  8-core, 6 GB+ devices) with post FX off.
- **Touch controls** (`ui/TouchControls.tsx`): an analog steering pad on the
  left (drag from where you touch; 40% of the pad width is full lock), and Gas,
  Brake, N₂O and Drift on the right. Reset and Pause are top-right. Each control
  captures its own pointer, so three-finger steer + gas + nitro works.
- The viewport is locked (no pinch or double-tap zoom), with `touch-action: none`
  on the canvas and safe-area insets for notches.

## Centreline and surface map (derive-from-chunks.mjs)

`npm run derive:track` works from the shipped LOD0 chunks alone, so it runs
without the source GLB:

- **Centreline**: traced over `lineSurface` through the gates plus `lineVia`
  points (source coordinates). It drives the minimap, the roadside corner boards
  and wrong-way detection. Where the shortest road path between two gates isn't
  the circuit, add a via point. The Mercedes Arena needed one; without it the
  line doubled back down the arena's entry road.
- **Surface map**: the top-most road or ground material per 1 m cell, mapped to
  `Surface` codes (`src/vehicles/Surface.ts`). Tires read it for grip and rolling
  drag (gravel traps stop the car), and the effects read it for sand spray and
  dust. Off the grid counts as open terrain, which drives like grass.

## Race logic on a real track

- Eight gates around the GP loop, verified by script: driving through them in
  order completes a lap.
- **R**, the touch reset button, or falling below `killY` respawns the car at
  the **last gate passed**, not the start line.

## Adding another track

1. Copy `scripts/track/nurburgring.config.mjs`, then point `source` and `out` at
   the new files.
2. Render the asphalt to find the loop:
   ```bash
   node scripts/track/topdown.mjs <in.glb> .cache/map.png '^asph' [minX minZ maxX maxZ pxPerMeter]
   ```
3. Put 6–10 gates on unambiguous parts of the loop, then check them on the map:
   ```bash
   GATES_ONLY=1 node scripts/track/build-track.mjs <config>
   ```
   ```bash
   MARKERS=.cache/gates.json node scripts/track/topdown.mjs <in.glb> .cache/gates.png '^asph'
   ```
4. Build it (`node scripts/track/build-track.mjs <config>`) and add a
   `StreamedTrackDefinition` to `src/world/tracks.ts`.

Material layer rules are per source model. Check the `top lod0 materials` line
in the build log to see what dominates.

## Debugging

In dev, `window.__game.debugStep(60)` advances 60 frames by hand, even when the
tab is hidden and rAF is throttled. It returns ms/frame, draw calls, triangles,
pixel ratio, resident chunks and the car's position. `debugInput({ throttle: 1 })`
holds inputs for those runs.
