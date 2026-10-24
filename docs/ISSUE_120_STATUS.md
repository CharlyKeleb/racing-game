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

The subsequent responsiveness fix enables local own-car prediction with scheduled
server inputs, deferred initialization and recoverable RTT/correction fallback.
See [the response check](MULTIPLAYER_RESPONSIVENESS.md). The launch receipt below
preserves the earlier snapshot-only baseline rather than rewriting its history.

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
  replay history and experimental prediction/scheduled inputs. The original hosted
  baseline had both disabled; the responsiveness follow-up enables them.
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
  checks pass after restore. With explicit approval, an exact existing genuine
  record was then queued on the hosted volume and replayed across idle SIGTERM
  restart: the original save time and two history rows stayed unchanged, the
  outbox cleared and the private temporary record file was removed.
- Two real accounts joined/readied and launched one lap on separate physical Macs.
  The user explicitly reported both finished with matching saved results. Server
  metrics ultimately show four finalized/saved results and no pending writes. The
  user also reports owner history, rematch, menu and hidden-tab checks passed. The
  agent did not independently inspect the finished standings/history rows. One
  reconnect started but timed out. The user explicitly confirmed the same car
  resumed in the same running race after the brief interruption; that need not
  close the WebSocket. A forced hosted socket replacement was not independently
  observed, and the failed counter cannot be attributed to that user check.
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

## Launch acceptance and limits

The requested desktop private-racing checks are complete within the evidence
above: two physical Macs, finished matching saved results, owner history,
user-confirmed same-car/same-race recovery, rematch/menu/tab behavior, measured
bounded resources, public monitoring, rollback/restore and exact genuine-record
replay after hosted restart. The final receipt contains no private race payload.

- Forced hosted WebSocket replacement was not independently observed. Local
  socket tests cover authenticated held-seat recovery, immutable identity,
  recovery timeouts and expiry; a short network stall may preserve its socket.
- Natural live JWT expiry/revocation was not observed. Admission/refresh verifies
  identity and JWT expiry, and logout releases the local seat. Local tests cover
  terminal expiry. Immediate remote ban propagation is deferred with #144.
- This is a two-Mac desktop pilot at about 237 ms observed RTT. Mobile and real
  TCP shaping at 30/100/200 ms are unverified; synthetic prediction tests do not
  establish those claims. Peak capacity and a hard spending cap are not claimed.
- The genuine-record drill proves restart replay/idempotence on hosted storage;
  it did not induce a live database outage. Earlier isolated tests cover bounded
  retry/failure paths without disrupting the shared project.

#150 carries the final launch evidence and closes #120 after required CI passes.
Deferred epics #143–#147 remain open and are not declared implemented by this launch.
