# Scheduled practice controls (#120)

The optional scheduled-control path assigns each control sample to an exact
future **server** physics step. It removes the ambiguity between a 60 Hz local
input history and the legacy 30 Hz latest-input mailbox. It does not grant the
client ownership of time, physics, car state, results or competitive eligibility.

The generic server defaults this capability off; the hosted private-racing
configuration now enables it for responsive own-car controls. The local runner can opt in with
`MULTIPLAYER_SCHEDULED_INPUTS=1`; a trusted factory then advertises
`scheduledInputVersion:1` alongside correction support. Existing clients and
factories retain the mailbox path. The historical lobby-only entrypoint remains separate. This is a private-practice capability, not a
new verified leaderboard ruleset.

`scheduledInput` carries existing bounded controls plus `{version:1,tick}`. The
server checks the authenticated connected seat, current race, sequence/ranges,
strict payload keys and supported version. Targets must follow the countdown,
be ahead of the current server tick and at most 24 ticks (400 ms) ahead. Target
ticks strictly increase: queued ticks cannot be overwritten or replayed late.
At most 24 slots per racer are preallocated. One command is consumed once at its
specified completed server tick; a gap consumes neutral controls, including no
boost. Future packets never call step or advance the server clock. Acknowledgement
reports only the command actually consumed, not later accepted queue entries.

The scheduled admission ceiling is 72 commands/s, allowing fixed-step catch-up
and timer-boundary headroom around 60 Hz. The room's existing overall 80-message
limit also applies. Admission headroom cannot create extra simulation steps: the
server still runs 60 Hz and caps catch-up. The legacy mailbox remains 30/s. Result
storage remains private/ineligible practice; separate competitive ruleset and
provenance review is required before exposing comparisons or rewards.

After the first valid scheduled sample the seat stops accepting mailbox commands.
`inputMode:{version:1,raceId,mode:'mailbox'}` explicitly cancels queued controls and
clears stale held input before fallback. Drop/recovery also clears the schedule.
Received/applied sequence history, vehicle/controller resources and race progress
are preserved. A fresh command must use a new sequence. The client send helpers
prevent mixed send paths and require advertised support; `OnlineRaceScene` uses this path when matching correction/scheduling capabilities
and local prediction are enabled. See [responsive controls](MULTIPLAYER_RESPONSIVENESS.md).

Tests cover exact ticks, gaps, queue/horizon/sequence/range guards, packet-driven
clock rejection, legacy fallback, recovery cleanup, rate limiting and client
capability/send-mode behavior. A correct predictor must still map its prediction
head to future server ticks, retain those tick-keyed inputs, restore full validated
corrections and replay with a bounded budget. Latency/loss, browser/device,
performance and hosted capacity gates remain open.
