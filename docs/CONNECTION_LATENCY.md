# Private room connection latency (#120)

The lobby and online race HUD show the current player's measured round-trip time
to the room server. It includes browser/server scheduling and WebSocket transport,
not only the network path. It is not input-to-display latency, simulation input age
or a prediction/reconciliation measurement. No server region is inferred from RTT;
region selection and hosted/device latency acceptance remain separate work.

## Additive capability and bounded echo

A current backend advertises `latencyProbe: true` in its lobby snapshot. A current
client sends no probes to a backend without that flag, and older clients need not
send probes to a newer backend. Lobby/race protocol numbers and result provenance
are unchanged by this additive display capability.

The authenticated client sends one nonnegative safe-integer sequence over the
existing room socket. The server echoes only that integer to its sender. The
handler uses the existing ten-per-second shared control-message budget and the
room's overall message/size limits. It never echoes arbitrary objects, client
strings/timestamps or tokens, and never broadcasts another player's measurement.
A held reconnect seat must complete fresh authentication before echoes resume.
These messages do not affect physics, race timing, result eligibility or admission.

The client checks for a new probe every two seconds, keeps at most one outstanding
probe, and replaces an unanswered probe after five seconds. Only a matching,
unexpired echo can create a sample. Duplicate/unrelated/old-socket echoes are
ignored. A monotonic client clock measures both ends of the round trip, so the
measurement needs no agreement with the server clock. The fixed eight-sample
window exposes the latest RTT and the range (maximum minus minimum) as “variation”,
not statistical network jitter. Rounded display values retain no player identity.

Samples aged five seconds are discarded at the next scheduled probe check.
Browser background throttling may delay that check; a resumed callback expires old
samples before sending again. A drop, room exit, logout or connection replacement
clears displayed values immediately. A reconnect starts a fresh window only after
successful authentication and sequence resynchronization. The UI initially says
“Measuring connection…” and hides the readout on unsupported/disconnected rooms.
No probe history is persisted or uploaded to the backend metrics reporter.

## Local verification and remaining gates

Tests cover the actual room control handler's payload validation, shared budget
and held-seat guard without opening sockets; fixed sample storage, expiry,
duplicate replies and invalid clock deltas; mocked SDK capability negotiation,
logout/reconnect timer cleanup and old-socket isolation; and static UI rendering.
Frontend/backend builds and lint pass. These do not establish real network RTT,
background-browser behavior or two-device acceptance. A real WebSocket/browser
run and the 30/100/200 ms RTT, jitter/loss/disconnect matrix remain pending.
