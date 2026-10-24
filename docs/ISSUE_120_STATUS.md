# Issue 120 delivery status — 2026-10-24

Delivery branch: `codex/issue-120-transport-benchmark`, developed from
`5a906841edcc465ecece73a10f1fa990dc8365fd`. On 2026-10-24 the user authorized
publishing all completed work to GitHub and updating the epic checklist.
The work was developed in twenty local chunks; full file snapshots, dependency
manifests and sequential patches are retained outside the repository at
`/tmp/racing-game-issue120-local-chunks`. GitHub publication does not deploy the
frontend or the hosted race backend, or complete the remaining acceptance gates.

## Implemented locally

The earlier stacked work provides authoritative two-racer practice, shared
checkpoint/lap results, optional durable private history, authenticated recovery,
retirements, rematch, draining, identity audit and aggregate metrics. It is not all
on main or deployed. The deployed pilot remains lobby-only.

The subsequent local chunks add transport benchmarking, private name-history UI,
own-connection RTT/variation, controller checkpoints, exact input-application
metadata and fixed history, complete correction decoding, per-seat correction
streaming, bounded scheduled inputs, experimental own-car prediction, a separate
staging artifact/CI check, correction-cost measurements and compact collision
assets. Prediction and scheduled server capability remain explicitly opt-in.
The user selected the existing Supabase project; accounts and histories will be
shared by hosted testing. The three explicitly approved live history/retirement/audit migrations are now applied.
No hosted application or hosted secret configuration changed. The ignored local
frontend config now points to the localhost practice backend for real-session checks.
The local result writer now uses an existing server-only key in an ignored 0600
backend file and a private 0700 outbox. No new key or hosted credential was created.

## Verification

The full suite passed **3,278 tests across 510 suites** after local socket
permission became available. Earlier sandbox-only attempts had loopback/signal
failures; those suites now pass. A new large-geometry test initially timed out;
native exact byte comparison preserves all geometry checks and passes in the
full run. Frontend/backend builds, strict staging types, lint and the relocated
compiled artifact check pass. Compact assets have geometry/replay/corruption checks.

Synthetic 33/100/200 ms prediction checks and a mocked-stream scene test pass.
A [real-physics full-race check](FINISHED_RACE_ACCEPTANCE.md) now also passes:
two AI-controlled stock cars finish the normal three-lap distance through all
24 ordered gates each, with valid lap sums and ranks. It runs in CI and leaves
the normal countdown, input admission and race time limit intact. This is a
local unpaced session check with synthetic seats and no database writes;
finished-lap real-account browser saving remains unverified.
A [real loopback two-tab browser smoke](BROWSER_PREDICTION_SMOKE.md) also checks
active prediction, driving, menus and drop/reauthentication/RTT recovery. It exposed
and fixed permanent disablement when reconnect clears the RTT sample. Sixteen
affected tests and the then-full run of **3,270 tests / 507 suites** pass after
that fix. The browser racers are synthetic and Supabase was disabled.
The new correction benchmark covers 1,800 real-track session ticks and 600 fully
decoded/acknowledged corrections. It is unpaced and opens no sockets. Measured
JSON payload/capture costs and short compiled memory samples have separate
reports and fingerprints; none establishes hosted capacity.

## Launch scope update — 2026-10-24

The user approved completing #120 as the deployed, verified two-player private-
racing foundation. Deferred competitive/account/social/ranked/advanced systems
are tracked in #143–#147; they remain unfinished. See the
[launch contract and runbook](PRIVATE_RACING_LAUNCH.md) and preserved
[original roadmap](ISSUE_120_ORIGINAL_ROADMAP.md). The approved hosting target is
one shared CPU / 1 GiB machine plus a 1 GiB encrypted volume on the existing Fly
app, with a US$15/month budget target and no extra replica or region. Actual hosted
acceptance remains necessary before closing #120.

## Remaining gates and roadmap

- Run browser network shaping and the broader device matrix. Loopback socket/
  signal suites and the local two-tab prediction smoke now pass.
- The separate ARM64 container now builds and boots locally. Both physics modes,
  UID 1000, health/readiness and graceful shutdown pass with networking disabled.
  Choose and profile hosted practice capacity within an approved budget; the
  existing 256 MiB lobby allocation has not been approved as race capacity.
- Deploy and verify the writer with approved hosted persistent storage. Local
  saving now works: two real Chrome/Safari accounts drove and retired from one
  practice; both read their matching private DNF entries and the outbox cleared.
  See [the real-save receipt](measurements/local-result-storage-2026-10-24.json).
  The user approved
  and the CLI applied all three mapped practice-history, retirement and identity-
  audit migrations to the existing Supabase project. Post-apply schema metadata
  confirms the tables, retirement columns and RPCs. Migration history matches all four local versions and the dry run confirms no
  pending migrations. Live SQL lint reports one UUID-array initializer cast warning;
  the live result function now executes successfully. All six rollback-only
  SQL-role/result acceptance checks passed against the live database after explicit
  user approval. Both racers are isolated; anonymous/browser writes and backend
  direct mutations are denied. The transaction rolled back all synthetic data.
  Nine public HTTP probes also pass: the key/project is reachable, anonymous
  table/RPC access is denied and missing/forged sessions are rejected. Valid Auth
  token refresh and real owner reads now also pass in Chrome. The original and
  refreshed sessions each passed local room admission; both test rooms were left.
  Two real HTTP owners and a successful privileged result commit now pass locally.
  A late-profile-load expiry bug is fixed with a regression test. Genuine terminal
  expiry/revocation and the hosted/physical-device gates remain open. See [the real-session receipt](measurements/supabase-real-session-2026-10-24.json),
  [the HTTP report](SUPABASE_HTTP_ACCEPTANCE.md),
  [the live SQL receipt](measurements/supabase-acceptance-2026-10-24.json),
  [the CLI workflow](SUPABASE_CLI.md) and
  [deployment receipt](measurements/supabase-deployment-2026-10-24.json).
- Complete two-account/two-physical-device racing, matching saved results/private
  history, rematch and reconnect. A local offline container drill now preserves an
  exact queued record across SIGKILL and a fresh process, with 0600/0700 permissions.
  Exercise live DB outages, hosted process restart, rollback,
  long sessions and low-memory/mobile devices.
- Implement competitive track-limit/shortcut and recovery rules before verified
  leaderboards. Current practice history stays ineligible for competitive boards.
- Finish the separate account/email/password/reset and operational monitoring,
  backup/restore, retention/deletion and moderation work.
- The later public matchmaking, friends/parties/invites, cloud garage revision
  sync, ranked/season/progression design, rewards ledger, crews, contact
  collisions, spectating and replay projects remain open. Their acceptance and
  policy decisions have not been met by the current practice implementation.

The [local container report](measurements/practice-container-2026-10-24.json)
records the image ID, architecture, isolation limits and short memory samples.
The new local SQL acceptance test and strict types pass; lint passes. The final
full suite passes 3,278 tests across 510 files.
Nine live public HTTP probes and an offline packaged outbox SIGKILL/restart drill
also pass. The first full run overlapped browser initialization and had three
timing-sensitive failures; all tests passed on the repeat after the temporary
game tab was closed. No gameplay code or test timeouts changed in this chunk.

The epic is not complete. Local code and synthetic tests do not close its hosted,
physical-device or later-system acceptance gates.
