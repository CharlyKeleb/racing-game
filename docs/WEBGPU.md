# WebGPU renderer trial (#50, #51)

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
| `webgl (webgpu unavailable)` | WebGPU asked for, but no adapter, or the device failed to start |

## How it's built

- **`engine/backend.ts`**: which renderer is active, set by `Renderer.init()`
  before any scene content is built. Code that has a WebGL-only path checks
  `backend.nodes`.
- **`engine/nodes/`**: everything WebGPU needs, in one lazily loaded chunk
  (~235 kB gzip). WebGL players never download it.
  - `WebGPURenderer` and `PMREMGenerator` from `three/webgpu`.
  - `particles.ts`: the GPU particle pool (#51).
  - `postfx.ts`: the post stack as TSL nodes. It has the same chain as the
    `postprocessing` one, which is WebGL only: bloom over a half-float scene
    pass, then ACES + sRGB (`renderOutput`), then SMAA (High) or FXAA, and the
    intro whip-pan blur on top while active.
  - `materials.ts`: node twins of the game's custom WebGL materials:

    | WebGL | Node version |
    | --- | --- |
    | `SkidMarks` `ShaderMaterial` | `skidMarkMaterial` |
    | `DirectionGuide` `onBeforeCompile` per-arrow fade | `instanceFadeMaterial` |
    | `Environment` `Sky` with the exposure / tint / clamp patch | `skyDome` (`SkyMesh`) |
    | `Showroom` `Reflector` floor sheen | `floorSheen` (`reflector()` node) |
    | `HeatHaze` distortion puffs (#56) | `hazeMaterial` (offsets applied in `postfx.ts`) |

**Known gap:** garage liveries (`CarLivery`, via `LiveryGraphics`) still patch
the paint shader with `onBeforeCompile`. Under WebGPU the paint, finish and
plates render, but livery graphics don't show until they get a node twin.

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
- **Draw-call counter.** WebGPU counts draws as `info.render.drawCalls`;
  `Renderer.drawCalls` reads the right one. With post FX on, WebGPU's counter
  only shows the final pass, so measure the budget with post FX off.

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

## Measurements

Nürburgring GP, same spot after the same scripted drive. It ends in a handbrake
slide into the pit wall: smoke and sparks live. Headless Chromium 141 on
SwiftShader (CPU WebGPU / WebGL), so these frame times say nothing about real
GPUs. The counts are what the budget in CLAUDE.md measures.

| Preset | Renderer | Draw calls | Triangles |
| --- | --- | --- | --- |
| Low, post FX off | WebGL | 99 | 163k |
| Low, post FX off | WebGPU | 99 | 181k (of which ~18k are live GPU particles) |
| Low, 3 rivals | WebGL | 153 | 251k |
| Low, 3 rivals | WebGPU | 153 | 270k |
| Medium, post FX off | WebGL | 208 | 445k |
| Medium, post FX off | WebGPU | 182 | 315k |

Solo, Low stays inside the budget (≲150 draw calls, ≲200k triangles) on both.
Three rivals' cars take both renderers over it by the same amount. That's not
a WebGPU cost: their LODs are a separate job. Medium isn't held to the budget,
and the two renderers count shadow-pass draws differently.

Checked under WebGPU:

- Boots to the garage. The paint, floor reflection and PMREM bake match WebGL.
- Races with three rivals.
- Without WebGPU, the setting falls back to the classic renderer with the same
  counts as plain WebGL.
- Skid marks, tyre smoke, sand / dust and sparks (#52) all render.
- Route arrows fade in per instance.
- Day and night sky.
- Post stack on and off, and the intro whip blur toggles.

Not measured here:

- Real-GPU frame rate.
- The mid-range laptop target (#10).
- Safari and Firefox: Safari 26 and Firefox 141 (Windows) ship WebGPU, and the
  fallback covers the rest.

## Go / no-go

**Not yet: keep WebGL the default, ship WebGPU as an opt-in beta.**

It renders the full game with matching visuals and the budget holds on Low.
Before it can be the default it needs:

1. Frame times on real hardware. Use `?perf=1` captures (see
   `docs/performance/ISSUE_69_P0.md`) on the mid-range laptop from #10. WebGPU should match or
   beat WebGL at the same preset in Chrome, Safari and Firefox.
2. A shader-compile hitch check on first race start. WGSL pipelines compile
   lazily; `StreamedTrack.precompile` already calls `compileAsync`.
3. A week of the beta setting without reports of black frames or device-lost
   errors. Device loss isn't handled yet: the page needs a reload.

If those hold, flip the default in `gameStore` and keep the WebGL path as the
automatic fallback.
