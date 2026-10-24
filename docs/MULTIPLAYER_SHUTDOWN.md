# Draining and shutdown (#120)

`createBackend().drain()` makes readiness return 503, rejects new admission (also
authentication/reservations already in flight), clears rematch votes and prevents
new starts/rematches. Health remains 200 while the process is alive. Existing
races keep their authoritative clock and input. A previously held seat can still
reconnect under its original grace/Auth deadlines and must verify fresh identity;
a not-yet-consumed ordinary reservation cannot enter after drain begins.

Rooms publish `draining` so the lobby and driving HUD explain the restart window.
The maintenance/expiry close code is 4011, distinct from the existing Auth rejection
code; the browser offers a new lobby rather than telling the user to sign in again.

`shutdown(graceMs)` is idempotent. It drains, waits for active loading/countdown/
racing sessions and accepted result enqueues, then stops Colyseus. It returns the
number of unfinished races aborted and result enqueues still unconfirmed. A race
that finishes within the window keeps its earned result. At the deadline, remaining
races abort without results. Whole-room closure/expiry/shutdown sets a closing guard
before removing clients, so those removals cannot manufacture individual DNFs.
Genuine individual departures during the window retain the normal retirement rules.

The shipped lobby runner and local physics runner use a **15-second grace** and
retain a **20-second hard process deadline**; Fly's existing pilot kill timeout is
25 seconds. This is a bounded finish opportunity, not a promise to finish a
10-minute race during deploy. A second signal cannot restart or extend shutdown.
The local runner closes its optional outbox afterward. Reports contain only counts.
Any unconfirmed enqueue produces a nonzero exit; it is never reported as flushed.
Already durable pending files replay on restart through the idempotent RPC.

The grace window includes waiting for accepted enqueue promises to finish their
local durable write. It does not wait for every pending database retry to succeed.
A hard process kill, filesystem failure or expiry of the hard deadline can still
lose a result whose durable enqueue was never confirmed. No in-memory race,
reconnect lease, room code or rematch vote survives process restart. Never promote
client screenshots/offline records to compensate for an aborted race.

## Local verification

`npm run test:race-shutdown` uses real SDK clients with the scripted authoritative
course and covers whole-room closure without fabricated DNFs, earned finishes,
forced aborts, repeated shutdown calls, readiness/health, in-flight Auth admission,
reserved-seat rejection/claim cleanup, held-seat recovery with fresh Auth,
start/rematch suppression and pending enqueues completing or exceeding the deadline.
The pre-existing shipped-physics transport/reconnect suites remain required.

The CLI runners compile/typecheck. Synthetic source-runner tests and the compiled
lobby entrypoint both handle SIGTERM/SIGINT immediately after readiness; readiness
is printed only after handlers are registered. Signal delivery on Fly, external readiness
routing, persistence after a real process crash and a hosted redeploy/rollback drill
remain staging acceptance work. No live deployment or infrastructure change is
part of this chunk. In particular, production remains the lobby-only pilot.
