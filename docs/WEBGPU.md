# WebGPU renderer trial (#50)

Settings → Graphics → **Renderer** switches between the classic
`WebGLRenderer` (default) and three r186's `WebGPURenderer`. WebGPU runs on Metal
on macOS and on D3D12 or Vulkan elsewhere. Switching reloads the page.

**Fallback.** Where there's no WebGPU adapter, or the device fails to start,
the game uses the classic WebGL renderer, before the WebGPU chunk is even
downloaded. WebGPURenderer's own WebGL 2 backend isn't used. It emulates compute
with transform feedback, which can't do the particle ring's scattered writes
and caps a kernel at four outputs. The classic renderer is the better WebGL path
anyway.

In dev, `window.__game.renderer.backendName` says which one is drawing;
performance captures record it with every frame:

| `backendName` | Meaning |
| --- | --- |
| `webgl` | Classic renderer (the setting is WebGL) |
| `webgpu` | WebGPURenderer on a WebGPU device |
| `webgl (webgpu unavailable)` | WebGPU asked for, but no adapter, the device failed to start, or it was lost earlier this session |

**Device loss.** If the GPU device is lost mid-game (driver reset, GPU switched
or removed), the game reloads on WebGL and stays there until the tab is closed
(a `sessionStorage` flag); the next session tries WebGPU again.

## How it's built

- **`engine/backend.ts`**: which renderer is active, set by `Renderer.init()`
  before any scene content is built. Code that has a WebGL-only path checks
  `backend.nodes`.
- **`engine/nodes/`**: everything WebGPU needs, in one lazily loaded chunk
  (~235 kB gzip). WebGL players never download it.
  - `WebGPURenderer` and `PMREMGenerator` from `three/webgpu`.
  - `particles.ts`: the GPU particle pool (#51).
  - `postfx.ts`: the post stack as TSL nodes. It has the same chain as the
    `postprocessing` one, which is WebGL only: a half-float scene pass,
    depth-aware per-object motion blur, then bloom, ACES + sRGB (`renderOutput`),
    and SMAA (High) or FXAA (see [Motion blur](MOTION_BLUR.md)).
  - `materials.ts`: node twins of the game's custom WebGL materials:

    | WebGL | Node version |
    | --- | --- |
    | `SkidMarks` `ShaderMaterial` | `skidMarkMaterial` |
    | `DirectionGuide` `onBeforeCompile` per-arrow fade | `instanceFadeMaterial` |
    | `Environment` `Sky` with the exposure / tint / clamp patch | `skyDome` (`SkyMesh`) |
    | `Showroom` `Reflector` floor sheen | `floorSheen` (`reflector()` node) |
    | `HeatHaze` distortion puffs (#56) | `hazeMaterial` (offsets applied in `postfx.ts`) |
    | `CarLivery` paint with the `LIVERY_FRAGMENT` patch | `liveryPaintMaterial` (reads `LiveryGraphics`' uniforms by reference) |

**Rule:** `WebGPURenderer` runs no `ShaderMaterial`, `RawShaderMaterial` or
`onBeforeCompile` patch. Any new one needs a node twin in `engine/nodes`,
picked with `backend.nodes`.

### Visual differences found and fixed

- **Track lighting on Low.** WebGL's `MeshLambertMaterial` takes diffuse light
  from `scene.environment` (the baked sky); the node Lambert doesn't. The track
  came out about a third as bright (road pixel 36,36,36 vs 52,59,65). Under
  WebGPU the Low tier keeps PBR, rough and non-metal. Node Lambert lights per
  pixel anyway, so it saved nothing. At Medium the same road pixel now matches
  exactly on both renderers (70,81,91).
- **Texture view swizzle.** three r186 puts the identity `swizzle: 'rgba'` on
  every texture view. Chrome ~141 types that member as a dictionary, throws on
  the string and fails the first frame. `Renderer` drops the identity before
  calling `createView`.
- **Draw-call counter.** WebGPU counts draws as `info.render.drawCalls`, and
  resets its counters from its own animation loop, out of step with the game's.
  `Renderer.render()` now resets and reads them around each frame itself, so
  `Renderer.frameStats` holds the whole frame's draw calls and triangles, every
  post pass included, on both renderers.

## GPU particles (#51)

`GpuParticlePool` runs spawn, integration and fade in TSL compute shaders over
storage buffers. Integration covers velocity, lift, drag, wind, and ground
bounce or settle.

- **CPU:** writes new spawns into a staging buffer. Only the part in use is
  uploaded, once a frame.
- **GPU:** a spawn kernel copies them into the ring. An update kernel steps
  every particle, skipped entirely once everything is dead. The vertex stage
  reads position, age and size straight from the buffers.
- **Draw:** instance *k* draws the *k*-th newest slot. The CPU keeps an upper
  bound on how many can still be alive from the recent spawn batches, and only
  that many instances are drawn, so an idle pool costs no triangles.
- **API:** the same `ParticleSpawn` API and looks (puff, grain, spray, spark)
  as the CPU `ParticlePool`, which WebGL keeps. `createParticles()` picks the
  pool for the renderer.
- **Budget:** `particleBudget()` is 12 under WebGPU and 1 on WebGL. Emitters
  scale by it:

  | Emitter | GPU scaling |
  | --- | --- |
  | `TireSmoke` | Budget × the puffs, each fainter (budget^-0.55), 1.5× life, 1.25× size: drift smoke billows and lingers |
  | `SurfaceSpray` | √budget × grains and sand sheet; budget × dust puffs, fainter and longer-lived |
  | `Sparks` | Up to 8× per contact: thousands per hard hit |

## Benchmark: `?bench=1`

Open the game with `?bench=1` (production builds too, e.g. the Vercel URL). It
starts a race with the saved settings, drives it on autopilot (a centreline
follower, braking for bends), warms up for 8 s, then measures 60 s and shows:

- fps and frame-time p50 / p95 / p99, and counts over 33 / 50 / 100 ms
- average draw calls and triangles per frame, every pass included
- the backend, the GPU name, the browser, the viewport and DPR, and the
  settings

The result is also in `window.__raceBench`, with a **Copy result** button.
Run it once per renderer (Settings → Renderer), same track, preset and
window size, and paste both into #50.

### Results so far

Nürburgring GP, Low, solo, 960×540. Headless Chromium 141 on **SwiftShader**:
the CPU emulates the GPU, so these frame times only show the benchmark works.
They say nothing about real hardware. The counts are real.

| Renderer | Post FX | fps | p50 / p95 ms | Draw calls | Triangles |
| --- | --- | --- | --- | --- | --- |
| WebGL | off | 9.9 | 100 / 123 | 141 | 151k |
| WebGPU | off | 6.1 | 147 / 244 | n/a¹ | n/a¹ |
| WebGL | on | 8.4 | 117 / 144 | 154 | 157k |
| WebGPU | on | 4.5 | 225 / 298 | 168 | 171k |

¹ Measured before the counter fix above.

Budget counts from the earlier scripted drive (same spot, a handbrake slide
into the pit wall with smoke and sparks live, post FX off):

| Preset | Renderer | Draw calls | Triangles |
| --- | --- | --- | --- |
| Low | WebGL | 99 | 163k |
| Low | WebGPU | 99 | 181k (of which ~18k are live GPU particles) |
| Low, 3 rivals | WebGL | 153 | 251k |
| Low, 3 rivals | WebGPU | 153 | 270k |
| Medium | WebGL | 208 | 445k |
| Medium | WebGPU | 182 | 315k |

Solo, Low stays inside the budget (≲150 draw calls, ≲200k triangles) on both.
Three rivals' cars take both renderers over it by the same amount. That's not
a WebGPU cost: their LODs are a separate job. With post FX on, WebGPU's
14 extra draws are its post passes (bloom mips, the haze pass, FXAA).

### Real hardware

Still to fill in with `?bench=1`, one row per renderer:

| Device / GPU | Browser | Renderer | fps | p50 / p95 ms | Notes |
| --- | --- | --- | --- | --- | --- |
| Mid-range laptop (#10) | Chrome | WebGL | | | |
| Mid-range laptop (#10) | Chrome | WebGPU | | | |
| Mac (Apple silicon) | Safari 26 | WebGL / WebGPU | | | |
| Windows | Firefox 141+ | WebGL / WebGPU | | | |

## Visual parity

Checked under WebGPU against WebGL:

- Boots to the garage. The paint and garage liveries, the floor reflection and
  the PMREM bake match WebGL.
- Races with three rivals.
- Track lighting: a sampled road pixel is identical at Medium (70,81,91).
- Skid marks, tyre smoke, sand / dust, sparks (#52) and exhaust heat haze
  (#56) all render; particles come from the GPU pool (#51).
- Route arrows fade in per instance.
- Day and night sky.
- Post stack on and off, and the intro whip blur toggles.
- Fallbacks:
  - with no WebGPU, the setting gives the classic renderer, with the same
    counts as plain WebGL
  - after a lost device, it gives WebGL for the rest of the session

## Go / no-go

**No-go for making WebGPU the default today. Go for shipping it as the opt-in
beta it is now.**

Why: it renders the whole game with matching visuals, it holds the Low budget,
and it falls back safely. But nothing yet shows it's faster on real hardware,
and on WebGPU the post stack costs 14 more draws than on WebGL. Switching the
default needs these, all collected with `?bench=1`:

1. On the mid-range laptop (#10) in Chrome, WebGPU's p95 frame time is no worse
   than WebGL's at the same preset, with post FX on.
2. The same holds in Safari 26 on a Mac, and WebGPU at least runs correctly in
   Firefox 141+ on Windows.
3. No black frames or device-lost reports from the beta in the meantime.

If those hold, change the `renderer` default in `gameStore` to `'webgpu'`.
WebGL stays as the automatic fallback.
