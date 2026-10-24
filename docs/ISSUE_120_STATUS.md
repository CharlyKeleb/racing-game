# Issue 120 delivery status — 2026-10-24

## Current launch

The two-player private-racing foundation from #142 and #148 is merged on main.
The existing Fly app now runs the real race image, and the matching production
frontend is live at <https://racing-game-jade.vercel.app>. The older lobby-only
pilot is retained as a rollback image; it is no longer the active deployment.

The user approved narrowing #120 to this working hosted private-racing launch.
The full earlier scope is preserved in
[the original roadmap](ISSUE_120_ORIGINAL_ROADMAP.md). Deferred work remains open:
#143 competitive integrity/leaderboards/stats; #144 expanded account lifecycle,
moderation and retention; #145 garage/social/matchmaking; #146 ranked progression,
rewards and crews; #147 four-player scaling, contact, spectating and replays.

## Delivered

- Shared headless physics and versioned collision/checkpoint/stock-car assets;
  authoritative loading, countdown, bounded inputs, ghost racing, ordered laps
  and shared session results. Practice rooms now admit exactly two racers;
  lobby-only mode retains four seats.
- Verified admission, bounded reconnect/reauthentication, retirement/DNF, rematch
  consent, menu behavior, draining and aggregate operational metrics.
- Idempotent private result storage, durable bounded retry outbox, owner history,
  complete rename events from audit start and a private paginated name-history UI.
- Bounded RTT diagnostics, full controller checkpoints, correction streaming,
  replay history and experimental prediction/scheduled inputs. Both experimental
  capabilities remain disabled in the hosted baseline.
- Compact-asset production container, existing-project migration tooling,
  scoped acceptance receipts and documented launch/rollback configuration.

## Hosted evidence

The approved target is one shared CPU / 1 GiB machine in Johannesburg, one 1 GiB
encrypted persistent result volume, one process/room and two racers. The budget
is a US$15/month target, not a hard provider spending cap. Server secrets remain
server-only; the public frontend was uploaded from clean tracked source with
checked-out LFS assets and no local credential files.

The [hosted receipt](measurements/hosted-private-racing-2026-10-24.json) records:

- Deployed image digest, machine/volume and production frontend deployment ID;
  exact matching simulation fingerprint and prediction disabled.
- Health/readiness, unsigned-admission denial, foreign-origin denial and exact
  production CORS; private writable outbox owned by UID 1000 with 0700 permissions.
- Live rejected-invalid-result RPC preflight, writing no synthetic race record.
- Controlled idle SIGTERM restart: a private non-record volume marker survived,
  was removed afterward, and readiness recovered. This is not actual queued-result
  replay or a rollback drill.
- Two real accounts joined/readied and launched one lap on separate physical Macs.
  The user explicitly reported both finished with matching saved results. Server
  metrics corroborate one finalized/saved result and no pending writes. The agent
  did not independently inspect the finished standings/history rows.
- Short active samples around 295–299 MiB RSS and simulation work p95 bounded by
  2 ms. These are not peak/sustained capacity or a guarantee for other devices/
  networks; earlier counters include an aborted start whose cause is not attributed.

## Validation

The functional two-seat launch change passed 3,278 tests across 510 files, both
builds, staging types/artifact checks, lint and a real-physics three-lap AI check.
GitHub CI passed on #148. Six approved rollback-only live SQL role/result tests,
nine public HTTP probes, local container/outbox crash checks and the earlier
same-Mac real-account retirement/save test also pass within their stated scope.

The follow-up public menu wording build/lint passes. A new key-free hosted probe
passes five live operational checks and three unit tests; its fifteen-minute
GitHub Actions workflow is pending publication/activation on main. See
[the launch runbook](PRIVATE_RACING_LAUNCH.md) for notification/scheduling limits
and budget ownership. This probe does not test a player's race or monthly spend.

## Remaining before closing #120

- Finish the requested hosted recovery/rematch/menu/hidden-tab and owner-history
  confirmation. Record actual expiry/revocation behavior without claiming an
  immediate-ban system or unsupported refresh recovery.
- Complete a controlled rollback and actual pending-result replay check on the
  hosted volume while players are out of active rooms.
- Record the accepted device/network baseline and limits. Real two-Mac racing
  at about 235 ms observed desktop RTT is reported; mobile and real TCP shaping
  at 30/100/200 ms are not established by earlier synthetic prediction tests.
- Publish/activate the public health monitor and final evidence, and update the
  issue only for checks actually completed. #120 remains open until its remaining
  launch gates are resolved; the deferred epic features are not marked complete.
