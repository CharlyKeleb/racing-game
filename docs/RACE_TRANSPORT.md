# Development race transport (#120)

This slice connects the shared physics spike to a server-owned room lifecycle.
Two real SDK clients can load the same race, count down, submit driving controls
and receive identical authoritative car snapshots. The [browser practice adapter](BROWSER_MULTIPLAYER.md)
now draws both cars with interpolation and exposes launch on the optional local
backend. Server-timed practice laps and shared session results are implemented.
[Experimental own-car prediction](ONLINE_PREDICTION.md) is available behind explicit
client/server flags; competitive validation and hosted acceptance remain pending.
An optional [durable result writer and owner history](ONLINE_PRACTICE_HISTORY.md) are now implemented.

## Local development only

The deployed Fly entrypoint (`server/src/index.ts`) does not inject a race factory;
its rooms advertise `raceEnabled: false` and ignore race-start requests. No paid
machine, deployment or production configuration changes are included.
The ordinary server package still builds independently without track assets,
Three or Rapier. The optional adapter lives in `scripts/multiplayer` and runs from
the repository root using its existing frontend/shared physics dependencies.

```sh
npm ci
npm --prefix server ci
cp server/.env.example server/.env.local
# Fill in Supabase URL/public key and explicit browser origins, as for lobby dev.
npm run server:race-dev
```

This builds the fingerprinted simulation package, initializes WASM, and binds
**127.0.0.1:2568** using the real Supabase authenticator. It allows one active
simulation per process and exactly two racers per start. Local SDK callers and the browser practice adapter can exercise the transport.
There is no test-auth flag or bypass in this runner. Integration tests construct
an in-process backend with their own injected authenticator, as lobby tests do.

The existing memory/capacity gate in [the simulation spike](HEADLESS_SIMULATION.md)
still applies. The 60 Hz tick, 20 Hz maximum snapshot cadence and 30 input
messages/second are **local development settings**, not measured Fly capacity or
final network rates. The unpaced spike alone does not justify enabling races on
the existing 256 MiB machine.

## State and message contract

The existing lobby protocol stays at version 1 for additive compatibility with
the deployed lobby. Race descriptors have a separate `RACE_PROTOCOL` version 3,
`SIMULATION_VERSION`, asset fingerprint and random race ID. These are compatibility
claims, not evidence that an untrusted browser loaded assets or ran physics.

Protocol 3 adds explicit retirement results to the original protocol-2 transport.
Optional [corrections](CORRECTION_STREAM.md) and [scheduled inputs](SCHEDULED_PRACTICE_INPUTS.md)
negotiate their own capabilities without enabling them on legacy clients.

| Message | Server behavior |
| --- | --- |
| `start` | Host only, exactly two connected racers, both ready, factory configured, no active race. Freezes the roster/settings and locks admission. |
| `loaded` | Requires this connection's seat, race ID, race protocol, simulation version and fingerprint. Both racers and the server simulation must load before countdown. |
| `input` | Accepted only while racing. Seat ownership comes from the authenticated connection. Allows only sequence, race ID, throttle, brake, steer/source, handbrake and nitro. |
| `cancelRace` | Host may cancel loading/countdown. Only loading/countdown can be cancelled. Racing ends with a shared result; final departures retire that racer. Server failure aborts. |
| `race` (server) | Tick, countdown/racing/finished phase, remaining countdown ticks, transforms/telemetry, applied sequences, checkpoint/lap progress, and final shared result. |
| `returnLobby` | Host only, finished phase only. Clears session results, resets readiness and unlocks the room for another start. |

Loading has a 30-second deadline. Every countdown physics tick uses held controls;
all racers switch to racing after exactly 180 ticks. Ordered checkpoint crossings, laps and finishes use server physics and ticks.
Recovery/reset and manual shifts are not wired into this transport. Stock cars
use the existing automatic gearbox; client-supplied car builds, positions, results
and identity fields are rejected. Host lap selection is frozen and consumed by finish validation.

Inputs use one copied latest-command mailbox per seat, not an unbounded queue.
Sequences are nonnegative safe integers, strictly increasing, with jumps bounded
to 120. Invalid/outdated/future-race packets do not consume a sequence. Each seat
gets 30 accepted input packets per one-second window. A command is acknowledged
only after a physics step applies it. After 15 ticks (250 ms) without a fresh
input, throttle, brake, steer, handbrake and nitro become neutral. This prevents a
held throttle/boost from persisting during a stalled tab or network gap; the car
still obeys momentum. Room traffic is capped at 80 messages/second when race
transport is configured, with a separate 10/second non-input command budget.
Lobby-only rooms retain the existing 10/second overall cap.

A room clock advances fixed ticks, with at most five catch-up steps per callback.
A callback stall over 250 ms or accumulated debt beyond 250 ms aborts the race;
it never silently drops simulation debt. Snapshots are emitted once
per three advanced ticks, plus immediate phase transitions, with no burst of obsolete intermediate frames. These
are server ticks, not client wall-clock times. Use them for interpolation and
future clock/prediction work. The current payload does not contain all hidden
controller state needed to restore deterministic prediction; reconciliation is a
separate implementation step.

Final departure/session expiry during racing retires that racer with no finish time
or rank while the rival continues. Loading/countdown departure aborts without a
result. Local race-backed rooms hold unexpected drops for up to 15 seconds and
require fresh authenticated recovery; see [reconnect details](RACE_RECONNECT.md)
and [retirement rules](RACE_RETIREMENTS.md). Loading failures, cancellation and room
disposal free the world, including late asynchronous factories. The ten-minute
racing limit and 30-minute room lifetime remain. Optional result persistence needs
explicit runner configuration.

`LobbyClient` exposes start/cancel/load-ack/input commands, caps outgoing controls
at 30 Hz and stores only the latest ordered snapshot for the active race. Race
changes/leave/logout clear snapshot/sequence state. The browser adapter renders the shared simulation separately from offline race
rules and never presents local results as server-verified results.

## Practice timing and results

`RaceProgress` is numeric server code with no render dependency. After each fixed
physics step the adapter copies authoritative body positions into reusable scratch
storage. Countdown positions seed each sweep without awarding gates or race time.
Gate 1 is next after the grid; gate 0 completes a lap only after the remaining
course gates. The frozen lobby lap count determines the finish.

A swept horizontal gate-plane crossing must move forward, intersect within the
authored radius, and be within 6 m vertically of the gate. A nonfinite position
or movement exceeding 4 m in a single tick aborts the session through the room's
simulation-error path; it never credits a teleport. This conservative development
bound is not a speed-based anti-cheat verdict. Timing uses integral racing ticks
at 60 Hz, excluding countdown; a same-tick finish shares the same rank. First-lap
time includes the drive from the grid, while subsequent laps run line to line.

Finished racers stop accepting inputs and receive held controls. The second racer
has up to 60 racing seconds after the first finish, bounded by the overall
10-minute racing limit. At either deadline unfinished racers are DNF with no rank
or invented finish time. If everyone finishes, results finalize immediately. The
server retains a single final snapshot for both seats and `sync`, and frees the
Rapier world immediately. While results are open there are no physics ticks or
periodic snapshots. The host can return the crew to the lobby; either player can
leave. Leaving preserves the remaining player's results and transfers host control.

These are **practice results**, not competitive records. Optional [durable persistence](ONLINE_PRACTICE_HISTORY.md) saves them to private owner history; without a configured writer they remain session-only.
The authored eight gates do not enforce continuous track limits or rule out every
shortcut between gates. No client result submission, reward, offline-record promotion or leaderboard update is added. Competitive track limits,
recovery policy and real-account/device/hosted-storage acceptance
remain separate work. Race protocol 3 prevents older practice browsers from
misrepresenting retirements; lobby
protocol remains 1 because the deployed server is still lobby-only.

## Verification

```sh
npm run test:race-transport
npm run test:multiplayer
npm run check:finished-race
npm run server:build
npm run build
npm run lint
npm test
```

Unit tests cover exact countdown ticks, server/peer loading order, incorrect
versions/fingerprints/identities, malformed and spoofed inputs, sequence/rate
limits, input copying/expiry, bounded catch-up, loading timeout/failure and late
resource disposal. Additional rule/result tests cover ordered swept gates, wrong
direction/radius/height, discontinuities, multi-lap timing, ties, finished-input
rejection and both DNF deadlines. A scripted-server SDK integration test checks
equal results for both clients, final snapshot sync, host-only lobby return and
one-time world disposal. This scripted test does not prove completion of a lap on
the shipped physics. The shipped-physics integration test uses two real Colyseus SDK connections
and the shipped Nürburgring/Porsche simulation, checks equal snapshots at the same
tick, ownership and acknowledgements, admission/configuration lock, host permissions,
disconnect cleanup and reuse after cancellation. Client tests check frame ordering,
race isolation, command sequencing, send pacing and cleanup.

The [full-race acceptance command](FINISHED_RACE_ACCEPTANCE.md) drives two AI
cars through the actual physics and ordinary 30 Hz mailbox until both complete
three laps. It checks all ordered gates, positive lap times, finish-time sums
and ranks. This adds local shipped-physics completion evidence without sockets,
Auth, resets or database writes.

These checks do not replace two physical devices, real Supabase session lifecycle
acceptance, device/network measurements or staging production-image profiling.
