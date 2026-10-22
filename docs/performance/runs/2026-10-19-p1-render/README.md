# P1 first rendering pass, 19 October 2026

This change starts P1; it does not complete #69 or declare the local game optimized.
It depends on the capture infrastructure in PR #70. Physics rate, handling, race
timing, selected quality persistence and the default post-FX toggle are unchanged.

## Changes

- Initial render DPR is capped at 1 on Medium/High and 0.8 on Low, within the
  display/preset ceiling. This trades initial sharpness on Retina displays for
  a conservative workload. Sustained headroom can recover up to the selected
  preset ceiling (1/1.5/2 for Low/Medium/High).
- Adaptive resolution requires two consecutive <55fps measurement windows and
  a three-second cooldown before decreasing by 0.15. Recovery requires eight
  consecutive >58fps windows and an eight-second cooldown, increasing by 0.1.
  Neutral, hidden and invalid/stall windows break consecutive evidence. This
  bounds resizing and avoids accumulating recovery across interrupted good runs.
- Applying unchanged quality, including volume/camera or post-FX changes, retains
  learned DPR. A deliberate quality/display-DPR change starts a new controller.
- Post-FX is lazy: no composer/effect targets are created while disabled. Turning
  it off disposes them and restores renderer auto-clearing and direct ACES tone
  mapping. Turning it on recreates them at the current drawing-buffer size.
- High retains the existing SMAA, bloom intensity and eight-level full-resolution
  bloom input. Medium/Low use FXAA, respectively half/quarter-size bloom input,
  and five/three mip levels. The scene and final composite remain at the renderer
  DPR. FXAA can soften fine edges, and lower bloom resolution changes glints/glow.
  Disabling post-FX still bypasses the complete stack.
- ScaledBloomEffect scales the whole bloom path, including luminance and mipmaps.
  Its resize guard prevents the library's synchronous Resolution callback from
  applying the scale twice. A real-effect unit test checks target dimensions
  across repeated resizes and a return to full size.
- Buffer resizing no longer calls renderer.setSize again after setPixelRatio;
  only active post targets are resized. A preset change rebuilds the effect
  profile; unrelated settings do not rebuild it.

## Render-cost isolation

Local production build, same Apple M1 MacBook Pro/8GB/macOS 26.3 and in-app Chrome
155 as P0. This run's viewport was **1024×934**, display DPR 2. It differs from
P0's 1280×720 and must not be compared as identical pixel load. AC power, low-power
mode off. Porsche 911, High scene geometry, Nürburgring, noon, three opponents.

Each render-only case loads the track, starts a race, sends Enter, holds the
handbrake for five seconds and pauses at the starting grid. Capture restarts
while paused; the controls are collapsed during sampling. The analyzer discards
five initial seconds. These are single samples (roughly 37–45 analyzed seconds),
not repeated GPU benchmarks. Shader/streaming initialization is outside the
window. Same fixed DPR **1**, paused overlay and zero player speed in every case.
Slight camera/geometry variation and system noise remain possible.

Capture opt-in is required for these URL flags:

- `?perf=1&perfDpr=1`: normal High post-FX, shadows on.
- Append `&perfShadows=0`: isolate shadows.
- Append `&perfPostfx=0`: bypass the complete post stack.
- Append `&perfFxQuality=medium`: use only Medium's effect profile with unchanged
  High track geometry/shadows/DPR. This isolates effects from track LOD changes.

The report includes the diagnostic overrides separately from saved player settings.
The flags have no effect without `perf=1` and are never persisted.

### Results

All GPU times are asynchronous sparse query samples, in milliseconds. These are
render workload measurements, not input-to-photon latency or whole-app CPU times.

- High normal (`p1-normal`): GPU p50/p95/p99 **7.10/8.00/10.12**, 561 all-pass draw
  calls and 165 resident textures at the final frame.
- Shadows off: **6.62/8.18/9.62**, 392 calls, 161 textures. Draw submission falls,
  but GPU p95 did not improve in this sample. No shadow-quality change is justified
  by this measurement alone.
- Entire post stack off: **3.87/4.21/4.40**, 542 calls, 139 textures. This identifies
  post-FX as meaningful GPU cost here; it does not prescribe disabling it for users.
- Final Medium profile, still High scene/shadows: **5.90/7.25/9.66**, 555 calls,
  151 textures. Approximately **17% lower GPU median** and **9% lower p95** than
  the normal sample. Repeat/device validation is needed before generalizing.
  CPU render submission p95 was 4.5ms versus 4.4ms normal; this is a GPU/resource
  change, not evidence of a CPU speedup. Both stationary cases were near 60fps.

Two intermediate trials are retained, not shipped profiles: `p1-medium-fx` only
reduced the luminance buffer/mip count and AA search preset; `p1-scaled-medium-fx`
also scaled the full bloom pyramid while retaining SMAA. Their GPU p95 values
were 8.17 and 7.94ms, respectively. These did not establish a worthwhile p95 gain;
the final Medium profile uses FXAA instead. The High render path was kept stable
through these trials, but samples come from successive production builds rather
than a single repeated randomized benchmark.

## Normal adaptive driving check

`p1-adaptive-drive` has no isolation overrides: High, post-FX on, three opponents,
normal adaptive resolution. Production JS: `index-CP2rtJ3J.js`. It repeats the P0
stress inputs (throttle, right handbrake slide, nitro, reset, throttle, opposite
slide, more throttle), with collisions and observation gaps. HUD confirmed speed,
gear, nitro use and AI movement. After the first racing transition plus five
seconds, the retained window contains **70.78 seconds / 4,168 frames**:

- Frame p50/p95/p99: **16.7/17.6/33.3ms**, maximum 66.6ms.
- >33/>50/>100ms frames: **57/2/0**.
- GPU sample p50/p95/p99: **13.76/23.20/30.93ms**.
- Nine DPR changes; observed DPR range 1.2–1.6. The preceding menu/intro capture
  begins at DPR 1; recovery during the menu occurs before this analyzed segment.
- No dropped entries or visibility changes.

The earlier local P0 circuit sample had 16 DPR changes in 63.61 seconds, but its
viewport and actual route differed. This is not a controlled before/after speedup
claim. Recovery/resize bounds and settings retention also have deterministic tests.

Verified Low with post-FX off, then Medium with effects on, then restored High
through the actual pause settings. Live views showed a clear road/car/HUD and no
persistent frame trails after disposing the composer. Saved Medium, Low/direct
and High screenshots are local artifacts. These are daylight checks; night glints,
Safari/iOS, constrained phones and prolonged quality switching still need review.

## Evidence and reproduction

Raw JSON/screenshots: ignored `.cache/performance/issue-69-p1-render/` (local).
`summary.json` is the compact committed evidence. Recompute with:

```sh
python3 scripts/performance/summarize.py .cache/performance/issue-69-p1-render
```

The analyzer accepts paused render-only segments as well as racing segments.
It retains all positive visible intervals after warm-up and does not discard
outliers. The raw capture includes startup and all discarded warm-up data.

Build, lint and the full test suite are required. Rendering lifecycle tests cover
allocation/disposal, auto-clear restoration, retained adapted DPR, quality profile
rebuilds and display-DPR resizing. Controller tests cover stalls, hysteresis,
cooldowns and preset/display bounds. These complement production-browser checks;
they do not replace device profiling.

Remaining P1 scope: geometry/scenery/LOD budgets, particles/overdraw, streamed GPU
upload spikes, simulation/collision hot paths where measured, HUD subscriptions,
input responsiveness and hidden-tab work. Remaining P0 coverage is still open.
This pass does not change the CPU/memory-based default quality classification;
initial DPR is conservative, but there is no new GPU benchmark-based classifier.
No Vercel P1 deployment or production rollout is claimed by these local captures.
