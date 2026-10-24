# Bounded correction decoder (#120)

`decodeCorrectionJson` is the validation boundary for a proposed private correction
format. It returns a detached, complete `CorrectionState` or `null`. It does not
restore physics, change acceptance cursors or enable local prediction. The
[negotiated correction stream](CORRECTION_STREAM.md) now provides an opt-in server
producer and browser consumer; the decoder remains their validation boundary.

The caller supplies a trusted `CorrectionBinding` from its verified race/assets
and connection state: race/racer/car, manifest fingerprint, simulation version,
last accepted correction tick/sequence, highest sequence actually sent and the
approved resolved stock configuration. Those bindings never come from payload
fields. Matching a binding is not authentication: a future handler must also bind
the message to the current authenticated room, account, race and connection
generation. The game server must never accept racer-supplied correction state.

## Complete validation before application

Raw input is limited to 8,192 UTF-8 bytes before JSON parsing, with an initial
string-length guard so oversized Unicode text cannot cause an unbounded encoding
allocation. All object schemas require every known field and reject extras,
arrays in place of objects, missing fields and unknown versions. The envelope
checks protocol 3, exact provenance, advancing ticks within the current 10-minute
practice limit (including 180 countdown ticks), nondecreasing acknowledgements
and acknowledgement not exceeding the highest sequence the caller sent.
Application-mode and first/last consumed-tick metadata must be internally
consistent with the acknowledged sequence and completed snapshot tick.

Body position, rotation, linear/angular velocity and sleep state are decoded
alongside every controller field. Quaternion components must be finite and unit
length within 0.001; they are not silently normalized. Four wheel states are
required, with known surface codes and complete suspension/contact data. Gear,
RPM, suspension travel and boost intensity use the supplied configuration's
limits. Other numeric fields have broad finite safety bounds for this practice
format: positions/contact points within ±1,000,000 m, body velocity components
within ±1,000 m/s, angular components within ±1,000 rad/s, ordinary timers at most
3,600 s, and bounded integer counters/random seeds. Known timer undershoot after
a 60 Hz decrement is allowed. These limits are a decoder envelope, not measured
competitive handling limits or proof that every accepted state is reachable.

Only the three intentional idle timers accept null (drift since-end and backfire
since-high/since-pop). They remain null until trusted restore converts them to
Infinity. Nonfinite numeric JSON (including exponent overflow), numeric strings,
invalid booleans, missing timers and unknown enum values fail the entire decode.
Nothing is clamped or quantized. The typed schema requires readers for all
controller fields, so adding a checkpoint field also requires updating its reader.
No partly decoded object is passed to restore, and malformed input cannot mutate
an existing controller, body or the caller's previous acceptance cursor.

## Evidence and remaining integration

Tests reject every missing/malformed leaf of a complete checkpoint, foreign
provenance, stale/future ticks, rollback/unsent acknowledgements, wrong shape,
unknown fields/prototype-key injection, numeric overflow and invalid config-bound
values. UTF-8 tests distinguish character count from byte size at the boundary.
Live flat-ground fixtures for all six approved stock cars generate checkpoints
through steering, nitro, braking and drift-mode states and verify exact decoding.
This exercises the decoder with actual controllers; it is not a browser/network
or cross-platform determinism test and does not approve drift/manual modes for an
online ruleset. Trusted server policy still owns allowed modes/configuration.

Next: measure the opt-in correction stream’s hosted payload/rate cost, establish
server-to-local tick mapping, then connect
predicted physics and bounded replay/correction smoothing. A body/controller
payload is not equivalent to restoring a complete Rapier solver world; the earlier
[checkpoint proof](CONTROLLER_CHECKPOINTS.md) does not establish pose-only rollback
accuracy. The [input history](INPUT_REPLAY_BOUNDARY.md) remains unconnected until
that mapping and resync policy are tested under latency, jitter and packet loss.
