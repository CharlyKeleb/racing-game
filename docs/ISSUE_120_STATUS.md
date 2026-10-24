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
  was removed afterward, and readiness recovered. A later idle rollback to the
  retained lobby image and restore to the race image both passed; the five public
  checks pass after restore. Actual queued-result replay remains unproven.
- Two real accounts joined/readied and launched one lap on separate physical Macs.
  The user explicitly reported both finished with matching saved results. Server
  metrics ultimately show four finalized/saved results and no pending writes. The
  user also reports owner history, rematch, menu and hidden-tab checks passed. The
  agent did not independently inspect the finished standings/history rows. One
  reconnect started but timed out; no successful held-seat recovery is corroborated,
  so the reported recovery needs clarification.
- Short active samples around 295–299 MiB RSS and simulation work p95 bounded by
  2 ms. These are not peak/sustained capacity or a guarantee for other devices/
  networks; earlier counters include an aborted start whose cause is not attributed.

## Validation

The clean scoped suite passes **753 tests across 129 files**, matching GitHub CI
on #149. Earlier local totals of 3,278/510 included nested worktree tests and are
not unique coverage of this checkout. `vitest.config.ts` now restricts discovery
to `tests/` while retaining the Vite configuration. Frontend build and lint pass.
Earlier server/staging builds, real-physics three-lap AI checks, six approved
rollback-only live SQL tests and local container/outbox checks remain supporting
evidence within their stated scope.

The key-free hosted probe passes five live checks and three unit tests. Its
fifteen-minute workflow is merged in #149 and passed on main (run 40103971303).
See [the launch runbook](PRIVATE_RACING_LAUNCH.md) for scheduling, notification and
budget limits; this probe tests neither a player's race nor monthly spend.

## Remaining before closing #120

- Clarify the recovery discrepancy: one held-seat attempt timed out, despite the
  user reporting all checks passed. A successful same-car/same-race recovery is
  not yet independently corroborated.
- Complete exact genuine-record replay on the hosted volume. Automatic approval
  review requires explicit permission to temporarily copy a private existing
  record; the prepared check is pending that permission. No genuine payload has
  been read or exported by that check.
- Natural live JWT expiry/revocation was not observed. Local socket tests cover
  bounded expiry and rejection; admission/refresh verifies identity and JWT expiry,
  and logout releases the local seat. This is not immediate remote ban propagation.
- The accepted evidence is a two-Mac desktop pilot at about 237 ms observed RTT.
  Mobile and real TCP shaping at 30/100/200 ms remain unverified configurations;
  synthetic prediction tests do not establish those claims.

The hosted game is playable. These remaining checks must stay visible until
resolved; deferred epic features are not marked complete.
