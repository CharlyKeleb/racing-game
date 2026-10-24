# Online own-car prediction and responsive controls

Prediction is enabled by default when the matching server capabilities and a
track collision clone are available. Set `VITE_ONLINE_PREDICTION=0` for rollback.
Remote cars continue through `SnapshotBuffer`; checkpoint, lap, finish and saved results
remain authoritative server data. The private-racing Fly configuration enables scheduled controls.

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
memory. Desktop response was checked with the real track and two rendered
clients; low-memory/mobile headroom remains unverified. Allocation failure falls
back to server snapshots.

The predictor seeds only from a fully decoded server correction. A 6–24 tick
lead, starting from `max(6, ceil((RTT + variation) * 60 / 1000) + 4)` plus up to
three ticks of spare headroom, covers both correction delivery and outgoing command delay. A requirement above 24 ticks temporarily falls back. When it returns within
budget, prediction resumes from a fresh correction. If the measured requirement
grows within budget, the scene clears the previous schedule and reseeds with a
larger bounded lead instead of disabling prediction for the rest of the race.
Missing initial RTT samples defer initialization until a sample arrives.
Initial lookahead is neutral and emits no burst of
already-late commands. Each subsequent fixed step records controls against its
explicit future server tick and sends that tick. The server steps its own clock,
applies each queued command once at the requested tick, and neutralizes gaps.
Client sequence numbers never stand in for an elapsed duration.

Corrections restore the full controller and body state, then replay at most 36
journaled ticks. Replay does not retransmit input or run race rules, storage,
audio events or progression. Missing history causes a fresh neutral rebase.
The journal is fixed capacity. Restoring body/controller state does not restore
Rapier solver warm-start/contact history; exact full-world determinism is not
claimed. Small position corrections decay visually over about 100 ms; jumps over
5 m snap. Own-car interpolation uses the fixed-loop alpha; remote interpolation
keeps its existing delay.

No correction or no acknowledgement progress for 500 ms suspends prediction.
Failure to receive an initial correction within one second falls back and retries
after a one-second cooldown. Invalid/foreign/stale corrections are rejected by the stream decoder.
Menus, hidden tabs, connection changes, delayed public frames, finishing and scene
disposal stop the correction subscription and restore mailbox controls. Queued
scheduled input is cleared without resetting sequence history or race resources.

## Verification and remaining acceptance

Unit checks cover bounded replay, exact tick scheduling, neutral bootstrap,
stale correction and acknowledgement watchdogs, and stream/mode cleanup. Real
Rapier/headless simulations run 900 racing ticks under synthetic 33, 100, 200 and
300 ms RTT, one-tick jitter, omitted input messages and omitted correction
messages. They compare own-car poses at matching server ticks, requiring p95
position error below 0.5 m and maximum below 1 m. These checks passed locally.

The scene integration check proves local throttle changes the own-car pose
without another public snapshot, keeps the remote car on snapshots, and frees
the isolated world. It uses a mocked stream. It also checks that missing RTT
during reconnect pauses prediction until a new sample, rather than permanently
disabling it. The scene regression additionally covers 237 ms RTT + 79 ms variation,
300 ms RTT + 33 ms variation, a late first sample, explicit rollback, and
recovery after a temporary over-budget sample. Local throttle and wheel steering
change at the next fixed step without another server frame.

The historical [local browser smoke check](BROWSER_PREDICTION_SMOKE.md) used
loopback and synthetic message omission. The new
[responsive-controls check](MULTIPLAYER_RESPONSIVENESS.md) additionally delays
actual loopback TCP/WebSocket traffic by 150 ms each way. Two rendered clients
kept prediction ready at about 300 ms RTT; selected software samples measured
29.1 ms acceleration and 13.7 ms steering to the first changed rendered state.
Menu return and drop/reauthentication/fresh-RTT recovery also resumed prediction.
These samples are not latency percentiles or physical key-to-photon measurements.

The original two-account/two-Mac saved-result acceptance tested the earlier
snapshot-only build. The responsiveness run used synthetic local accounts and
no database. Real WAN jitter/loss, mobile memory/frame-time, long sessions and
competitive eligibility remain separate acceptance work; no zero-latency claim
is implied by local prediction.
