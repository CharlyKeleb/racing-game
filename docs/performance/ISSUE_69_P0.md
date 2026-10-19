# Issue #69: production baseline protocol

Status: instrumentation prepared; reference-device baseline still pending.
Deployment supplied by the reporter: https://racing-game-jade.vercel.app
Starting checkout: a5cc4dea6f563c02915436f7b9e1d4195f90fb4c.
On 2026-10-19, the deployed menu showed Drift Challenge disabled (SOON),
whereas this checkout enables it. This is direct evidence of a behavior mismatch,
not proof of the deployment SHA. Do not assume that this is the deployed commit. Resolve the deployment's Git SHA
in Vercel before comparing. No rendering or physics tuning belongs in this phase.

## Run manifest (one per capture)

Record UTC time, full commit/deployment identifier, device model, OS, browser
version, GPU, viewport, display refresh rate, DPR, power/battery mode and thermal
state. Record car, track, opponent count, quality, post-FX, time of day, input
method, cache state and network/CPU throttling. Copy settings from the JSON too.
Do not call a browser running on the developer's machine a constrained-phone test.

## Capture

1. Build the chosen commit with `npm run build`; serve with `npm run preview`.
   Test the same commit on Vercel. Keep the game tab visible, with the same viewport.
2. Append `?perf=1` before loading. This exposes `window.__racePerf` only when
   opted in and starts recording early, including boot. No logs are emitted.
3. Record browser Performance and Network traces from navigation. Run separate
   cold-cache and warm-cache captures; repeat each with normal and throttled
   network. Record exact throttling values. Save HAR with content and trace files.
4. Use this 120-second script on Drift Park, then Nürburgring or the city track:
   0–15s menu/garage, 15–30s race selection and intro; 30–60s drive through traffic
   and a streaming boundary; 60–80s drift with visible smoke/skids; 80–90s nitro;
   90–120s continue the same route. If loading takes longer, retain it and annotate
   actual timestamps. Record route landmarks/checkpoints and repeat those exactly.
5. At the end run `window.__racePerf.stop()` then
   `window.__racePerf.download()` in DevTools. `start()` resets the capture for a
   new warmed-race segment; `report()` reads without resetting. Retain both the
   complete startup run and a separate 60–120s warmed-race run.
6. Repeat at least three times. Compare opt-in and normal browser traces to check
   instrumentation overhead. Capture a named mid-range laptop and constrained
   phone; include desktop Chrome and Safari/iOS where available.

## Reading the capture

Frame intervals are raw rAF deltas, before the loop's 250ms clamp. Per-frame rows
include fixed-step count, simulation CPU time, render CPU time and visibility.
Summary p50/p95/p99 and >33/>50/>100ms counts use visible rows only. Discard runs
with visibility changes when comparing race pacing, and isolate warmed racing
using phase-event timestamps rather than comparing a whole-run menu/race average.

Render events count all post-processing passes, with calls/triangles, resident
textures/geometries and actual render DPR. GPU duration events use asynchronous
WebGL2 timer queries where supported; disjoint samples are discarded. There is at
most one outstanding query, so GPU samples are sparse and may arrive later than
the originating frame. Without extension support, use render CPU submission time
and browser GPU traces; CPU submission is not GPU duration.

Chunk fetch-decode includes transfer and GLTF construction (not isolated decoder
worker CPU). Adoption and scene integration are timed separately. GPU uploads
happen at rendering, so a cheap integration event does not prove a cheap upload.
Long tasks are observed when the browser supports them. Use the browser trace
for GC, React/layout attribution and GPU upload attribution.

Input-to-frame latency runs from event-handler receipt to the end of the next
render submission. It excludes OS/browser event queuing, scanout and gamepad
polling. It is not physical input-to-photon latency. Phase changes mark the first
`racing` transition: use its timestamp as the engine-ready-to-control milestone,
then verify visually with throttle/speed. Existing boot measures are included.

Capture buffers retain at most 18,000 frame rows and 18,000 events; `dropped` must
be zero for a complete capture. Data stays in memory until explicitly downloaded.
Resource timing is browser-limited and transfer sizes can be zero for cache or
cross-origin redaction. Resource entries cover the page lifetime, not just a
restarted segment. HAR is authoritative for request/transfer auditing.

## Retained evidence and completion

Store artifacts per run outside Git (traces/HAR may be large). Use a run directory
named with commit, device, track, cache mode and iteration; include manifest,
JSON, HAR, Performance trace and screenshots. Link those artifacts in the PR.
Record deployment asset URLs/hashes and response MIME/compression/cache headers.
Only mark P0 complete after paired deployed/local runs exist with named hardware,
route, startup/transfer data and frame distributions. The current implementation
provides measurement infrastructure, not evidence that deployed jank is fixed.
