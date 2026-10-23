# Development race transport (#120)

This slice connects the shared physics spike to a server-owned room lifecycle.
Two real SDK clients can load the same race, count down, submit driving controls
and receive identical authoritative car snapshots. The [browser practice adapter](BROWSER_MULTIPLAYER.md)
now draws both cars with interpolation and exposes launch on the optional local
backend. Full prediction/reconciliation and verified finish/results remain pending.

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
the deployed lobby. Race descriptors have a separate `RACE_PROTOCOL` version 1,
`SIMULATION_VERSION`, asset fingerprint and random race ID. These are compatibility
claims, not evidence that an untrusted browser loaded assets or ran physics.

| Message | Server behavior |
| --- | --- |
| `start` | Host only, exactly two connected racers, both ready, factory configured, no active race. Freezes the roster/settings and locks admission. |
| `loaded` | Requires this connection's seat, race ID, race protocol, simulation version and fingerprint. Both racers and the server simulation must load before countdown. |
| `input` | Accepted only while racing. Seat ownership comes from the authenticated connection. Allows only sequence, race ID, throttle, brake, steer/source, handbrake and nitro. |
| `cancelRace` | Host may cancel loading/countdown. A race already underway ends on disconnect, expiry, server failure or the development time limit. |
| `race` (server) | Tick, countdown/racing phase, remaining countdown ticks, server-owned car transforms/velocities and driving telemetry, plus last applied sequence for each racer. |

Loading has a 30-second deadline. Every countdown physics tick uses held controls;
all racers switch to racing after exactly 180 ticks. Checkpoints, laps, finish,
recovery/reset and manual shifts are not wired into this transport. Stock cars
use the existing automatic gearbox; client-supplied car builds, positions, results
and identity fields are rejected. Host lap selection is frozen for the session
but is not yet consumed by finish validation.

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
it never silently drops simulation debt. Snapshots are emitted no more than once
per three advanced ticks, with no burst of obsolete intermediate frames. These
are server ticks, not client wall-clock times. Use them for interpolation and
future clock/prediction work. The current payload does not contain all hidden
controller state needed to restore deterministic prediction; reconciliation is a
separate implementation step.

Disconnect/session expiry closes the race, frees the world, clears all readiness
and unlocks the room. Loading failures, cancellation and room disposal also free
the world, including asynchronous factories that resolve after cancellation.
The development session has a ten-minute tick limit and inherits the lobby's
30-minute expiry. There is no reconnect/DNF/rematch/result persistence yet.

`LobbyClient` exposes start/cancel/load-ack/input commands, caps outgoing controls
at 30 Hz and stores only the latest ordered snapshot for the active race. Race
changes/leave/logout clear snapshot/sequence state. The browser adapter renders the shared simulation separately from offline race
rules and never presents local results as server-verified results.

## Verification

```sh
npm run test:race-transport
npm run test:multiplayer
npm run server:build
npm run build
npm run lint
npm test
```

Unit tests cover exact countdown ticks, server/peer loading order, incorrect
versions/fingerprints/identities, malformed and spoofed inputs, sequence/rate
limits, input copying/expiry, bounded catch-up, loading timeout/failure and late
resource disposal. The integration test uses two real Colyseus SDK connections
and the shipped Nürburgring/Porsche simulation, checks equal snapshots at the same
tick, ownership and acknowledgements, admission/configuration lock, host permissions,
disconnect cleanup and reuse after cancellation. Client tests check frame ordering,
race isolation, command sequencing, send pacing and cleanup.

These checks do not replace two physical devices, real Supabase session lifecycle
acceptance, device/network measurements or staging production-image profiling.
