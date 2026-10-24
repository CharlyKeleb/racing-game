# Existing game project through Supabase CLI

Use the existing game project `uqxxdjxiqczgigyifldl`, as selected by the user.
The installed CLI is 2.75.0. The user completed CLI verification and the login now
accesses **Racing-Simulator**, active in Frankfurt (`eu-central-1`). The earlier
account lacked access; that login issue is resolved.

The user requested CLI login. The command is:

```sh
supabase login --profile supabase --no-browser --name racing-game-cli
```

`--profile supabase` selects the built-in Supabase platform. In this CLI,
`--profile racing-game` does not create a separate account profile and fails
with `Unsupported Config Type`. `--name` labels the generated access token;
it is not an account namespace. Complete the CLI's login link with the account
owning the game project and enter its verification code at the CLI prompt.
No token, password or login URL belongs in committed files.

## Prepared local workspace

An ignored workspace is prepared at `.cache/multiplayer/supabase-cli`, containing
an initialized CLI config and exact copies of all five repository migrations.
`migration-sources.json` records each copied file's SHA-256. It is now linked to
the selected existing project. Source remains in `supabase/migrations`; rebuild the copies
after changing migration source. The ordinary repository CLI `.temp` metadata is
also ignored, while migration SQL remains tracked.

The account/project checks, link and remote migration history inspection succeeded:

```sh
supabase projects list --profile supabase
supabase link --profile supabase --project-ref uqxxdjxiqczgigyifldl --workdir .cache/multiplayer/supabase-cli
supabase migration list --profile supabase --linked --workdir .cache/multiplayer/supabase-cli
```

## Existing-project migration mapping

Before this rollout, the remote history contained `20261023134901_racer_profiles.sql`. Its fetched SQL
matches local migration 0002 after ignoring comments, whitespace and trailing
statement terminators. CLI type generation confirms the existing saves/profile/
handle tables and profile RPC; the three new history/audit tables were absent.
The existing saves table predates this recorded baseline.

`supabase/existing-project-migrations.json` maps canonical source files to this
project's timestamped migration history. It preserves the recorded profile version
and explicitly excludes replaying legacy migration 0001. No migration-history repair
or account-table replay is needed. This mapping is specific to the existing game
project; it is not a new-project bootstrap.

```sh
npm run supabase:prepare-existing
```

This local-only helper verifies the linked project and every source SHA-256, then
prepares `.cache/multiplayer/supabase-deploy`. It rejects changed source hashes,
duplicate/out-of-order versions, unexpected files or modified generated SQL.
It does not authenticate, apply SQL or repair history. The prepared migration
directory contains the recorded profile baseline plus three pending migrations.

```sh
supabase db push --profile supabase --linked --dry-run --workdir .cache/multiplayer/supabase-deploy
```

The dry run selects exactly the mapped practice-history, retirement and identity-
audit migrations. Twenty-two storage checks and five audit checks pass locally.
The audit transaction now locks profile writes while copying baselines and
installing its trigger, with a five-second lock acquisition timeout and 30-second
statement timeout. Reads remain available; a lock timeout aborts that migration.

The [reviewed plan](measurements/supabase-migration-plan-2026-10-24.json) preserves
pre-approval provenance. The user explicitly approved all three live migrations,
and CLI `db push` successfully applied versions `20261024111821`, `20261024111822`
and `20261024111823`. Post-apply CLI type generation confirms the practice race,
private history and identity audit tables, retirement columns and three RPCs.
See the [deployment receipt](measurements/supabase-deployment-2026-10-24.json).

Sequential follow-up checks confirm all four local/remote migration versions
match and the dry run reports the remote database is up to date. Initial concurrent
checks encountered temporary CLI-login authentication/circuit-breaker failures;
stopping those retries and checking sequentially resolved them.

Live SQL lint exits successfully with one warning in `record_online_practice`:
its `seen uuid[] := '{}'` initializer is reported as a text-to-UUID-array cast
(`42804`). Local result-storage SQL tests exercise this initializer successfully;
the live backend SQL-role RPC acceptance check now passes (six linked checks). No applied migration was
rewritten to silence the warning.

The six linked SQL checks now verify owner/other-racer/anonymous/backend access
and result saving in the live database. Real Auth profile/history reads and
normal refresh now also pass in Chrome. Genuine expiry/revocation and successful
privileged HTTP result commits remain open. The deployed server result writer
and persistent outbox remain unconfigured. No application hosting or secret
configuration changed.

## Transaction-only application-role acceptance

`supabase/tests/online_practice_acceptance.sql` contains six TAP checks, using two
random synthetic Auth/profile identities and one retirement result. It selects
`postgres` only for fixture setup/verification and switches to `service_role`,
`authenticated` and `anon` for application access checks. It tests backend result
creation, exact retry receipts, conflict rejection, atomic private history,
retirement metadata, both owners' isolation, anonymous denial and direct-write
restrictions. It never uses an existing account ID or reads existing account rows.

The script starts one transaction, uses five-second lock and thirty-second
statement timeouts, and ends with `ROLLBACK`. `ON_ERROR_STOP` terminates the client
on an error, so a failed test disconnects with an uncommitted transaction. Its
embedded-Postgres regression verifies all six checks and unchanged user/result
state after rollback. This validates the test locally, not hosted role behavior.

The first live attempt stopped at Auth fixture creation because the CLI temporary
login lacks Auth-schema permission. No fixture insert succeeded. Automatic approval
review initially rejected selecting `postgres` without specific approval. The user
then explicitly approved the rollback-only live test. The revised CLI run passed
all six checks and completed its final rollback. See the
[live acceptance receipt](measurements/supabase-acceptance-2026-10-24.json).
The live result function executed successfully despite its static initializer-cast
warning. No applied migration was changed.

The approved invocation was:

```sh
supabase test db /Users/charlykeleb/racing-game/supabase/tests/online_practice_acceptance.sql --linked --workdir .cache/multiplayer/supabase-deploy --profile supabase
```

This checks SQL roles and the live RPC implementation inside a rollback-only
transaction. The later real-account HTTP checks are recorded below; genuine
expiry/revocation and two-account acceptance remain open. The CLI runs its test
client in Docker; see the
[official testing guide](https://supabase.com/docs/guides/database/testing).

The separate [HTTP acceptance report](SUPABASE_HTTP_ACCEPTANCE.md) now adds nine
live public-key/anonymous-access and missing/forged-session checks. Real player
session/profile/history reads and normal refresh now also pass in Chrome, with
original/refreshed local room admission. Genuine terminal expiry and revocation
remain separate gates; see the [real-session receipt](measurements/supabase-real-session-2026-10-24.json).

The existing project's service-role key was retrieved through CLI for local
server configuration only. It is stored in ignored `server/.env.local` with 0600
permissions, never `VITE_*`, source, logs or proof images; no new key was created.
A real two-account retirement race subsequently committed via the HTTP writer and
was read separately by both owners. See the
[local result-storage receipt](measurements/local-result-storage-2026-10-24.json).
The deployed lobby and hosted secret configuration remain unchanged.
