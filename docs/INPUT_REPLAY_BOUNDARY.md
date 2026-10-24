# Input application and replay history (#120)

This chunk makes two prerequisites explicit: what controls the server actually
consumed, and a bounded local record of predicted-tick controls. It does not start
local prediction, infer a client/server tick offset or enable reconciliation.

## Server application metadata

Each current race snapshot vehicle includes optional `inputApplication` alongside
`acknowledgedSequence`. Existing protocol-3 clients can ignore this additive field;
new clients still accept older snapshots without it. No input protocol, race
result schema, ruleset or simulation behavior is changed.

A snapshot at tick T describes the state after physics step T. The metadata's
`mode` describes the controls consumed by that completed step:

- `hold`: countdown or a terminal racer held with handbrake;
- `neutral`: a driving racer without a fresh command, including timeout/drop;
- `command`: the current acknowledged sequence was used for that step.

`firstTick` and `lastTick` identify the first and most recent completed server
steps that used **that acknowledged sequence**. They are null until any command
has been applied. For `command`, `lastTick` equals snapshot tick T. A later neutral
or held step keeps the old command ticks and acknowledgement; it does not pretend
that an acknowledged throttle/nitro command is still driving. A new applied
sequence establishes new first/last ticks. Socket changes between steps do not
rewrite the history of the previous completed step.

The latest-input mailbox can replace several accepted commands before one physics
step. Only the command actually consumed is acknowledged; these fields are not an
audit log proving that every lower sequence was applied. Acknowledgement still
means consumed by simulation, not merely accepted by transport. Metadata objects
are created when a snapshot is built; the per-tick path updates scalar fields.
Simulation exceptions close the room's race rather than publishing an incomplete
step or inventing a result.

The presentation snapshot buffer rejects malformed/inconsistent metadata,
acknowledgement rollback and a command marked applied at a future/older snapshot
step. It retains detached metadata in the exact authoritative frame, without
interpolating categorical mode, acknowledgement or application ticks. A rendered
interpolated pose is not an authoritative correction state.

## Local history contract

`InputHistory` stores contiguous **local predicted ticks**, not network sequences
or timestamps. It preallocates three Float64 control arrays and one byte of flags
per slot, preserving analog precision and keyboard/analog steering semantics.
Handbrake/nitro are included; look-back is presentation only. Copying into caller-
owned scratch input does not expose mutable stored objects. Recording, copying
and discarding allocate no objects or growing collections.

The default capacity is 120 ticks (two seconds at 60 Hz); construction allows
1–600 slots. Filling the ring, missing/duplicate local ticks or invalid controls
latches `needsResync` and prevents replay reads until an explicit trusted reset.
Old history is never silently overwritten. Missing reads leave the caller's input
unchanged. Discarding accepts an explicitly mapped local tick and rejects a future
cutoff. Discarding all visible rows retains the continuity base for the next tick.

There is deliberately no `acknowledge(sequence)` operation. An acknowledged server
sequence is not a count of local physics steps; 30 Hz sends, 60 Hz prediction,
mailbox replacement, network delay and neutral timeouts break that assumption.
A future predictor must establish the tick/application mapping from validated
server correction state before pruning local history. On overflow, missing
history or excess replay work it must resynchronize, not run unbounded catch-up.
The history class itself does not schedule physics or choose a replay budget.

## Verification and work still open

Tests cover receipt versus application, mailbox replacement, first/last tick
updates, countdown, timeout, drop/recovery and retirement; optional-field
compatibility, acknowledgement rollback and invalid metadata; fixed-capacity ring
wrap, detached exact inputs, invalid/gapped/overflow histories and reset behavior.
A replay test restores a gearbox checkpoint and uses journaled inputs to reproduce
uninterrupted future torque/state exactly.

This is local unit evidence, not a real WebSocket/browser or latency/loss test.
A production predictor still needs a bounded authenticated correction decoder,
controller/body correction payload, clock/tick mapping, predicted local world,
replay scheduling/budget, visual smoothing and recovery/reset policy. The earlier
[controller checkpoint proof](CONTROLLER_CHECKPOINTS.md) uses a complete local
Rapier world snapshot; it does not prove pose/velocity-only corrections equivalent
to solver rollback. Server authority and private practice eligibility remain the
same until those gates are satisfied. Recorded benchmark payload sizes predate
this metadata and must be measured again rather than relabeled.
