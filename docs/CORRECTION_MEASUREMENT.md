# Local correction cost measurement (#120)

Run `npm run benchmark:corrections -- 30` to measure 30 **simulated** racing
seconds without sockets. This is an unpaced process benchmark; it does not wait
30 wall-clock seconds. The harness runs the real exported Nürburgring collision
assets, two stock Porsches and the existing AI planner through `RaceSession`.
It loads both seats, completes the 180-tick countdown, schedules one command per
seat per exact server tick, samples public snapshots at 20 Hz and captures each
seat's private correction at 10 Hz. Every correction must pass the browser's
complete provenance/config decoder with an exact consumed-sequence acknowledgement.

It rejects a stalled/changed lifecycle or clock, missing/oversized correction,
rejected input, nonfinite/off-course state, AI recovery request, insufficient
movement, or incomplete sample count. No teleports or resets make a run pass.
Arguments are bounded to 5–120 simulated seconds. Reports include the dirty base
revision, asset fingerprint and a hash over the benchmark/adapter/session/queue/
progress/protocol/decoder source files. Generated output is in
`.cache/multiplayer/benchmark-corrections.json`.

The [recorded 2026-10-23 run](measurements/corrections-2026-10-23-30s.json) on
Apple M1 Pro / Node 24.7.0 completed 1,800 racing ticks and 600 valid corrections.
Both cars traveled about 796–797 m. Measured values:

| Measurement | Local observation |
| --- | --- |
| Correction JSON p95 / maximum | 3,212 / 3,224 bytes, under the 8,192-byte cap |
| Private JSON per racer per simulated second | About 31,571–31,583 bytes, excluding framing/TLS |
| Public snapshot JSON p95 | 1,776 bytes |
| Capture + encode p95 per correction | 0.045 ms |
| Complete browser decoder p95 per correction | 0.107 ms |
| Server + harness tick work p95 / p99 | 0.436 / 1.169 ms |
| Sampled whole-process RSS maximum | About 462 MiB |

Tick samples include AI/planning, harness bookkeeping, scheduled-input validation,
session/physics steps, public JSON serialization and private capture/encoding.
Decoder time is subtracted from that sample and reported separately; whole-process
CPU and RSS still include the decoder, loader, parsed JSON assets and harness.
Memory is sampled once per simulated second and can miss transient peaks.
Startup/countdown/output are outside measured tick work. The short unpaced loop
does not represent steady wall-clock GC, scheduler debt or sustained server load.

These measurements do not include Colyseus socket framing/broadcasts, real
network delivery, renderer, client prediction world/replay, database writes or
container/hosted overhead. They neither establish Fly room capacity nor authorize
enabling races on the current 256 MiB pilot. The earlier paced transport baseline
uses a different fingerprint and predates this optional correction path; retain
both reports with their own provenance.
