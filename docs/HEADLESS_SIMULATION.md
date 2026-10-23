# Headless simulation spike (#120)

This is the shared-physics prerequisite for online racing. The deployed lobby
still does not launch races. No backend deployment, database change, paid capacity
change, network prediction, checkpoint verification or result persistence is
included in this slice.

## Shared boundary

`VehiclePhysics` owns the exact chassis mass/inertia, contact collider, controller
and physical reset used by the browser's `Vehicle`. `Vehicle` retains its model,
interpolation, lamps, camera feedback and visual effects. The shared controller
uses Three's numeric vectors/quaternions, but needs no renderer, DOM or Web Audio.

`HeadlessSimulation` loads trusted prebuilt track data, owns a Rapier world and
steps all drivers before one world step at the existing offline 1/60-second tick.
It accepts up to four trusted stock configurations. Calls are synchronous; the
caller owns scheduling and admission. Inputs are copied and range checked. This
is not a network input handler: sequence numbers, expiry/neutral controls after a
drop, packet limits and authenticated ownership belong to the next delivery.

Ghost mode uses collision groups for chassis contact and excludes dynamic bodies
from suspension rays. Cars can overlap without pushing or driving over each
other; they still contact track geometry. Offline vehicles retain contact
collisions. Simulations must be disposed when finished to free the Rapier world
and event queue. They are not designed to be used after disposal or stepped
concurrently/reentrantly.

## Reproducible track and car package

```sh
npm ci
npm --prefix server ci
npm run build:simulation
npm run test:simulation
npm run benchmark:simulation -- 2 180
```

The build command emits `.cache/multiplayer/simulation-assets.json`. It exports
only the shipped Nürburgring collision meshes (including world transforms and
barrier flags), decoded surface grid, checkpoints, centreline, pole spawn and the
six existing lobby stock car JSON configurations. It needs the checked-out LFS
assets. It never fetches a source GLB or imports car render models. Car configs
are resolved against the same defaults at runtime; client garage upgrades are
not part of the package. Inclusion in this spike does not approve competitive
car balance or launch rules.

The package has a format version and a SHA-256 fingerprint covering track inputs,
stock JSON, vehicle/simulation source, physics world, launch/surface helpers and
the root dependency lockfile. The conservative source set includes cosmetic
vehicle files. Rebuild after source/asset/dependency changes. The fingerprint is
build provenance, not a client compatibility handshake or cheat prevention.
Runtime `SIMULATION_VERSION` is a separate manually maintained contract version.
Generated packages/reports are ignored cache artifacts, not public browser assets.
The existing Fly image does not yet package this runtime or these assets.

Tests compare every exported collision triangle against the browser's GLTFLoader
path and surface cells against its decoder. They also cover repeatable interleaved
two-car replays in one Node runtime, overlapping ghosts and suspension queries,
barrier collisions, local contact collisions, physical resets, input copying and
seat limits. Same-runtime replay equality does not prove cross-platform or
cross-version deterministic prediction.

## Measurement and release gates

The benchmark runs AI controls for 180 simulated seconds after two seconds of
suspension warmup. It uses the existing starting grid, stock Porsche configuration
and driver planner, and fails if a racer falls away from the route or requests
recovery. It does not teleport cars to make the measurement pass. It reports tick
wall-time percentiles, total process CPU, final process RSS and distance, and
writes `.cache/multiplayer/benchmark-2.json`. Arguments select 1–4 racers and
1–600 simulated seconds. Reported tick time includes AI planning/input application
and physics, excluding startup/loading and output. RSS is a final sample, not
peak memory; the process also includes the development TypeScript loader and
parsed asset arrays. The unpaced loop does not exercise an event-loop scheduler.

The [recorded local Apple M1 Pro / Node 24.7.0 run](performance/runs/2026-10-23-headless/two-racers.json)
covered about 5 km per car over 10,800 measured two-car ticks, with 0.229 ms p95
and 0.391 ms p99 tick wall time. It was run separately from the test suite. Local process RSS was roughly 450–495 MiB across runs,
above the existing 256 MiB Fly pilot allocation. These are development-process
measurements, not evidence that the production room fits or does not fit in that
allocation. The JSON package deliberately favors inspection over memory density;
a compact asset representation and production-image memory profiling are pending.

Before enabling races on Fly, package/bundle the shared runtime independently,
measure steady/peak memory and CPU in a staging production image, include room,
network and serialization overhead, test latency/jitter on two real devices and
record sustained tick misses. Do not select snapshot rates, increase paid
capacity or claim measured production race capacity from this local spike.

The [local race transport](RACE_TRANSPORT.md) adds server-owned loading/countdown,
bounded sequenced inputs and authoritative snapshots. The [browser practice adapter](BROWSER_MULTIPLAYER.md) adds presentation and
server-pose interpolation; full prediction/reconciliation is pending.
Then validate checkpoint/lap/finish rules and persist idempotent verified results.
The two-device lobby acceptance gate and production frontend environment/release
from the epic remain outstanding.
