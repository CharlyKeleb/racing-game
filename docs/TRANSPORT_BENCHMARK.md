# Paced transport baseline (#120)

Run `npm run benchmark:transport -- 30` from the repository root after dependency
installation. The argument is 5–120 wall-clock racing seconds (default 30). The
command regenerates the versioned asset bundle, warms the shipped world, starts
one loopback-only backend, admits two synthetic SDK racers, acknowledges assets,
waits through countdown, and drives stock Porsche cars using AI inputs at a
34 ms interval (below the 30 Hz input limit). It never connects to Supabase/Fly,
uses real accounts, opens public ports, buys capacity or submits a saved result.

The race uses ten laps so a short measurement does not finish early. Lost sockets,
aborted/ended races, nonfinite states, excessive frame volume, stale final frames,
AI recovery/off-course height, a missed 60 Hz tick budget (over six ticks of
measurement tolerance), rejected inputs, no acknowledgement from either racer or
no meaningful movement
invalidate the run. Failed runs do not overwrite the last successful JSON artifact.
The `finally` block shuts down the backend and intentionally aborts the uncompleted
practice session. The report is written to ignored
`.cache/multiplayer/transport-benchmark-<seconds>s.json` and printed to stdout.

## Report interpretation

The report records revision/dirty state, a SHA-256 of the harness source,
protocol/simulation fingerprint, Node,
OS/architecture/CPU model, observed racing duration/ticks, process CPU/core share,
sampled peak RSS/heap, input/frame counts, distance and exact sample percentiles.
It also includes the opt-in [bounded metrics](MULTIPLAYER_METRICS.md) snapshot.
Metrics lifetime includes setup/countdown; racing CPU/frame/ack samples exclude it.

Both SDK clients and AI run in the **same process** as the server on loopback. CPU
and RSS include that harness and warmed runtime/WASM caches, with no renderer or
DB. Do not divide these numbers by room count to infer a linear capacity model.
RSS is sampled once per second plus the initial measurement, so brief peaks may
be missed. Input-to-ack-frame measures time from sending a command until the first
received frame acknowledging that latest applied sequence. It samples acknowledged
mailboxes, not every superseded command, and is neither pure RTT nor input-to-display
latency. Arrival gaps include scheduling/framing. Snapshot JSON bytes exclude
MessagePack, WebSocket/TLS framing and actual egress. No jitter/loss/RTT impairment
is applied, and no continuous track-limit/competitive claim is made.

Use this harness for an honestly labeled local baseline and regression comparison
on the same machine/revision/configuration. It cannot establish sustained Fly room
count, four-racer capacity, distributed-device latency, actual cloud spend, saved
result agreement or a long-session memory bound. Those gates remain open. The
production entrypoint and 256 MiB lobby pilot remain unchanged.

## Recorded local baseline — 2026-10-23

The [raw 30-second report](measurements/transport-2026-10-23-30s.json)
was captured on an Apple M1 Pro, macOS arm64, Node v24.7.0, using protocol 3
and simulation version 1. Its revision is `5a906841edcc465ecece73a10f1fa990dc8365fd`
with **a dirty worktree**: the measurement harness was uncommitted. Preserve that
provenance when comparing or sharing this result.

| Observation | Value |
| --- | ---: |
| Rooms / synthetic SDK racers | 1 / 2 |
| Measured duration | 30.001 s |
| Authoritative ticks observed | 1,800 |
| Inputs accepted / rejected | 1,742 / 0 |
| Distance driven by the two cars | 796 m / 797 m |
| Whole-process CPU, fraction of one core | 7.30% |
| Sampled peak process RSS | 542.97 MiB |
| Sampled peak JS heap | 125.66 MiB |
| Frame arrival gap p50 / p95 / p99 | 49.56 / 60.82 / 66.40 ms |
| Input-to-ack-frame p50 / p95 / p99 | 19.45 / 34.49 / 36.79 ms |
| Snapshot JSON size p50 / p95 | 1,736 / 1,768 bytes |

A five-second smoke run also completed before this measurement. The final harness
adds off-course-height, stale-final-frame, per-racer acknowledgement, rejected-input
and tick-budget rejection guards after the recorded run, and records its source
hash on subsequent runs. These additions passed TypeScript checking but await a
new paced run. The original report predates the source-hash field. The
measurement is evidence for the preceding harness version, not a frozen-commit
reproduction of the final source. Frontend/backend builds, lint and the harness
TypeScript check passed locally. The parent metrics implementation passed the
full 3,200-test suite; that suite does not independently validate this benchmark.

Even this short local run exceeded the production lobby pilot's 256 MiB memory
budget. Do not enable authoritative physics there based on these numbers. A
separate staging capacity decision, sustained hosted measurements, network
impairment tests and two-account/two-device saved-result acceptance remain open.
