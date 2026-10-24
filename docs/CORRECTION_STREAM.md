# Negotiated private corrections (#120)

A correction-capable race factory advertises `correctionVersion: 1` in its race
descriptor. The shared headless development adapter now supports it. Lobby-only
production remains unchanged. Ordinary race snapshots still use protocol 3; this
optional capability does not enable prediction, change results or apply any local
physics correction automatically.

## Server delivery

A connected, authenticated seat can send `corrections` with exactly four fields:
`{version:1, raceId, subscriptionId, enabled}`. The positive safe-integer
subscription ID scopes replacement/stop messages. The server checks the current
race, supported version and countdown/racing phase, and accepts no target racer,
car config, body or controller data. Requests use the existing control-message
budget. One subscription per room seat bounds retained state. An old unsubscribe
cannot cancel a replacement with a different ID.

Only subscribed seats trigger capture. At most once per six completed simulation
ticks (10 Hz at 60 Hz simulation), the room sends each subscribed socket a
`correction` message containing `{subscriptionId,state}`. `state` is the bounded
JSON correction envelope. The race session derives racer/car/provenance and
application acknowledgement from the authenticated seat and authoritative race;
the trusted adapter captures only that racer's body and controller. It never
broadcasts these full checkpoints or includes room codes, names, email or tokens.
The sender cannot select another racer. Tick zero is not emitted.

Each JSON state is limited to 8,192 UTF-8 bytes. The simulation adapter output is
trusted; this limit is checked after serializing its known checkpoint structure,
not a substitute for a bounded decoder of arbitrary client JSON. A failed/oversized
capture is skipped without changing physics, aborting a race or inventing a
result. A factory advertising support without a capture adapter fails loading
and frees its world. Unsupported factories never advertise the capability.

Expired authentication is checked on subscription and again before delivery, even
if the scheduled expiry callback has not run yet. Subscriptions clear on drop/final leave, race cancellation/return/new launch,
completion and disposal. Recovery requires fresh authentication followed by a new
explicit subscription. Neither the seat secret nor an old subscription restores
correction delivery. The existing reconnect/neutral/DNF policies still apply.

## Browser ownership and cleanup

`openCorrectionStream(race, carId, approvedConfig, onCorrection)` is an explicit
engine API. It verifies current connected room/race/version/provenance and the
account's own admitted car before subscribing. The caller must supply the
manifest-verified resolved configuration, not a locally modified garage build.
It returns an idempotent cleanup function; cleanup for an old stream cannot stop
a replacement. Race identity/provenance are copied for the subscription lifetime.

The handler checks the current socket/account/generation/race and matching wrapper
subscription ID, then passes raw state through the complete bounded decoder.
Only accepted corrections advance per-stream tick/acknowledgement cursors. Highest
sent sequence comes from the active input sender (or its authenticated recovery
rebase), so future/unsent acknowledgements are rejected. Malformed/stale/foreign
replies cannot reach the callback. Drop, room/account/race changes, results and
cleanup cancel delivery. Fresh reconnect does not auto-subscribe. A callback
exception stops that optional stream without disconnecting normal racing.

The latest correction is delivered directly to the engine callback; there is no
unbounded queue, React store, localStorage or result upload. Default visual clients
incur no capture/stream cost. The separately flagged
[experimental prediction scene](ONLINE_PREDICTION.md) now opts in, waits for a valid
base, and provides its own stale-stream watchdog, replay budget, tick mapping and
resync policy.
No physics restore is invoked by this transport layer.

## Local evidence and remaining gates

Tests exercise real room control handlers/simulation callbacks with mocked
sockets, capability fallback, strict subscriptions, cadence, two-seat privacy,
replacement/unsubscribe/leave cleanup and failed/oversized adapter capture. A real
headless simulation adapter on a flat synthetic track emits a checkpoint that
passes the full decoder. SDK mock tests cover invalid/foreign/duplicate replies,
unsent acknowledgements, replacement cleanup, race/account changes, result frames,
consumer exceptions and fresh opt-in after authenticated recovery.

These are not real WebSocket/browser, shipped-track capacity or two-device tests.
The 8 KiB/10 Hz limit allows about 80 KiB/s per subscribed racer before framing;
actual payload sizes, encoding/GC/tick cost, hosted bandwidth and acceptable
capacity still require measurement. Existing public-snapshot size metrics do not
include private correction bytes, although capture/serialization work occurs
inside the measured room callback. Do not reinterpret the earlier transport
baseline as measuring this opt-in path. No cloud deployment/migration was made.
