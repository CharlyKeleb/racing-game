# Experimental online own-car prediction (#120)

Prediction is local work for practice acceptance, disabled by default. Remote
cars continue through `SnapshotBuffer`; checkpoint, lap, finish and saved results
remain authoritative server data. The deployed lobby service is unchanged.

Enable `MULTIPLAYER_SCHEDULED_INPUTS=1` for the optional practice runner and
`VITE_ONLINE_PREDICTION=1` when building/running the browser. Both sides must use
the same exported simulation fingerprint and advertise correction version 1 and
scheduled-input version 1. A measured connection RTT sample and a streamed track
with a collision-world clone are required. Otherwise the existing snapshot and
mailbox-input path remains active. See [scheduled inputs](SCHEDULED_PRACTICE_INPUTS.md)
and [correction delivery](CORRECTION_STREAM.md).

`PredictionWorld` owns one ghost chassis plus a copy of the track's static
colliders. Offline cars and garage physics are excluded. It frees the world on
scene disposal and does not mutate the offline world. This duplicates collision
memory; device memory and frame-time profiling are still required before enabling
it by default.

The predictor seeds only from a fully decoded server correction. A 6–18 tick
lead, computed as `max(6, ceil((RTT + variation) * 60 / 1000) + 4)`, covers both
correction delivery and outgoing command delay. A larger required lead disables
prediction for that race. Initial lookahead is neutral and emits no burst of
already-late commands. Each subsequent fixed step records controls against its
explicit future server tick and sends that tick. The server steps its own clock,
applies each queued command once at the requested tick, and neutralizes gaps.
Client sequence numbers never stand in for an elapsed duration.

Corrections restore the full controller and body state, then replay at most 24
journaled ticks. Replay does not retransmit input or run race rules, storage,
audio events or progression. Missing history causes a fresh neutral rebase.
The journal is fixed capacity. Restoring body/controller state does not restore
Rapier solver warm-start/contact history; exact full-world determinism is not
claimed. Small position corrections decay visually over about 100 ms; jumps over
5 m snap. Own-car interpolation uses the fixed-loop alpha; remote interpolation
keeps its existing delay.

No correction or no acknowledgement progress for 500 ms suspends prediction.
Failure to receive an initial correction within one second disables it for the
race. Invalid/foreign/stale corrections are rejected by the stream decoder.
Menus, hidden tabs, connection changes, delayed public frames, finishing and scene
disposal stop the correction subscription and restore mailbox controls. Queued
scheduled input is cleared without resetting sequence history or race resources.

## Verification and remaining acceptance

Unit checks cover bounded replay, exact tick scheduling, neutral bootstrap,
stale correction and acknowledgement watchdogs, and stream/mode cleanup. Real
Rapier/headless simulations run 900 racing ticks under synthetic 33, 100 and
200 ms RTT, one-tick jitter, omitted input messages and omitted correction
messages. They compare own-car poses at matching server ticks, requiring p95
position error below 0.5 m and maximum below 1 m. These checks passed locally.

The scene integration check proves local throttle changes the own-car pose
without another public snapshot, keeps the remote car on snapshots, and frees
the isolated world. It uses a mocked stream. It also checks that missing RTT
during reconnect pauses prediction until a new sample, rather than permanently
disabling it. A measured RTT exceeding the allocated lead still disables it.

The [local browser smoke check](BROWSER_PREDICTION_SMOKE.md) additionally uses
two synthetic racers over real loopback WebSockets, rendered cars, menus and a
drop/reauthentication/fresh-RTT recovery. Synthetic message omission is not a real
WebSocket/TCP network-shaping test. Hosted network shaping, low-memory/mobile
performance, hosted headroom and two-account/two-physical-device saved-result
acceptance remain open. Competitive eligibility remains pending.
