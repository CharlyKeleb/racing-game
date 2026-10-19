# Initial desktop baseline, 19 October 2026

This is an exploratory baseline, not P0 acceptance. One local and one Vercel
capture per track establish that the measurement path works. The driving paths
and capture lengths differ, so these are not controlled before/after results.
No performance tuning was applied.

## Build and machine

- Commit: `9e5402f865dc19c0de36969db855e4fb4a2c2ff5` (capture controls).
- Vercel deployment: `dpl_9RJYtwfmDwUHur4uNP8Cg6DZXf5K`.
- Separate project: https://racing-game-p0-preview.vercel.app/?perf=1
- Local production preview: `http://127.0.0.1:4174/?perf=1`.
- Matching assets: `index-BCFFnfvk.js`, `index-kmOE_J98.css` in both build logs.
- MacBook Pro `MacBookPro17,1`, Apple M1, 8-core GPU, 8 GB RAM, macOS 26.3.
- Browser UA reports Chrome 155.0.0.0 (Codex in-app browser), 1280×720 viewport,
  DPR 2, 8 logical cores. Observed cadence approximately 60 Hz; physical display
  model/refresh and thermal state were not independently captured.
- AC power, 100% battery, low-power mode off.
- Porsche 911, High, post-FX enabled, noon, chase camera, challenging difficulty.
  Nürburgring: quick race, three opponents, three laps. Drift Park: Flow State,
  no opponents. Keyboard input. Normal network, no CPU/network throttle applied.
- Warm/revalidated startup samples; cache was not explicitly cleared. The first
  deployed startup used a previously selected Koenigsegg before switching to
  Porsche, and is retained separately as uncontrolled evidence, not comparison.

## Sequence and retained evidence

Captures run from the menu through loading/intro/countdown into driving. Timed
inputs: W 15s; W+D+Space 2s; W+Shift 5s; reset; W 15s; W+A+Space 2s. Drift runs
then include W 15s; deployed circuit includes an additional W 15s. Tool calls
and observations introduce gaps. Intro timing differs. Collisions, resets and
actual trajectories differ. These are stress sequences, not equivalent laps.
HUD observations confirmed motion, nitro consumption, AI traffic, track progress
and banked drift points (local 65; deployed 8). Both tracks produced chunk events.

Raw JSON and a deployed drift screenshot are retained in the ignored directory
`.cache/performance/issue-69-2026-10-19/`. It contains local/deployed circuit,
local/deployed drift, local/deployed warm startup, and uncontrolled deployed
startup JSON. No capture reported dropped entries or visibility changes.
The directory is local evidence, not uploaded with this PR. `summary.json`
contains compact derived results. Reproduce it with:

```sh
python3 scripts/performance/summarize.py .cache/performance/issue-69-2026-10-19
```

The analyzer discards pre-racing data and the first five racing seconds, then
uses positive visible frame intervals. It reports nearest-rank percentiles;
raw captures preserve startup/intro stalls. It does not discard outliers.

## Findings

- Warmed Nürburgring: local frame p50/p95/p99 **16.7/17.7/33.7 ms**;
  deployed **16.7/17.7/33.4 ms**. Local >50/>100ms frames: **13/1**;
  deployed: **6/0**. Different trajectories and sample lengths prevent a speedup
  claim; the overlap does not support blaming hosting alone.
- Warmed Drift Park: local **16.7/17.6/33.4 ms**; deployed
  **16.7/17.4/33.3 ms**. Local >50/>100ms: **8/0**; deployed: **10/1**.
  The deployed outlier was **1033.3 ms**, with 15 catch-up steps, 7.2ms simulation
  and 6.4ms render CPU submission on the following frame. Its source remains
  unattributed. Browser automation/screenshot work can perturb timing; no browser
  trace exists to distinguish that from application, GPU or OS work.
- Simulation p95 was **1.1/1.0ms** (local/deployed circuit) and **0.7/0.7ms**
  (drift). These samples do not justify changing the fixed physics rate.
- Sparse GPU duration p95 was **36.3/26.3ms** on circuit and **29.6/40.0ms**
  on drift. CPU render p95 was **5.3/4.6ms** and **1.9/2.0ms** respectively.
  GPU queries are asynchronous and sparse; they cannot attribute a specific
  frame stall to a shader or upload. They justify investigating render cost.
- Circuit all-pass draw calls p95 were **506/484**, triangles **720k/712k**.
  Drift draw calls p95 were **137/131**, triangles **506k/501k**. Counts include
  shadow/post passes, so they are not unique scene-mesh triangle counts.
- Dynamic render DPR ranged **0.75–0.95 / 0.75–1.30** on circuit and
  **1.10–1.35 / 1.05–1.40** on drift, despite requested High and display DPR 2.
  Different dynamic resolution histories confound direct GPU-time comparison.
- Circuit CPU chunk integration p99 was **2.9/0.5ms**; drift **0.2/0.2ms**.
  Deployed fetch-plus-decode p95 was **511ms** circuit, **390ms** drift versus
  **38ms/13ms** locally. This includes network waiting, not blocking main-thread
  time; it is not evidence of a 511ms decoder stall. GPU uploads are not isolated.
- Warm startup boot-to-menu measure: **539ms local / 431ms deployed** after the
  engine boot mark; relative to navigation, that mark plus duration is about
  **1.235s / 0.937s**. These are engine milestones, not paint metrics.
  Resource Timing reports 89 entries and 24,000 transfer bytes for each warm
  startup, predominantly cache/revalidation responses. It is not a cold-download
  budget. The main JS build remains about **5.70MB raw / 2.09MB gzip**.
- From race `loading` phase to `racing`: **9.12s local / 8.88s deployed** on
  circuit, including deliberate intro/countdown. Time before clicking Race is
  excluded. First visual response to throttle was verified in the HUD.
- On this separate preview, JS HEAD response was gzip, application/javascript,
  Vercel cache HIT, `public, max-age=0, must-revalidate`. Drift manifest was
  application/json, cache HIT with the same revalidation policy. These observations
  say nothing about the original owner's deployment headers.

## Next work and remaining P0 coverage

First profile render cost with shadows/post-FX/particles toggled independently,
then correlate upload and main-thread traces with the retained outliers. Preserve
handling and the fixed timestep. Investigate the negative first rAF delta in a
startup capture separately; raw diagnostics retain it and this analyzer excludes
nonpositive intervals.

Still outstanding: three repetitions per case; exact clean-route reproduction;
explicit cold/warm cache and throttled-network matrix; browser Performance traces
and HAR; GC/React/layout attribution; instrumentation-overhead comparison;
physical constrained phone and Safari/iOS; actual affected device/browser; thermal
state; and ten-minute resource-lifetime tests. The browser automation surface does
not expose tracing, cache clearing or network/CPU throttling, so none are claimed.
Input latency includes UI automation and menu events and is not used as a trusted
physical driving-latency benchmark. **P0 remains open.**
