# Server-owned online practice history (#120)

Completed local races can now be written atomically to Supabase and read from
**Your racer → Race history**. The result screen distinguishes saving, durable
pending retry, confirmed saved, failed and session-only results. This is practice
history, not competitive leaderboard eligibility: the authored gate rules still
allow shortcuts between gates. Offline saves, records and progression are never
used to create these rows.

## Schema and authority

Apply `supabase/migrations/0003_online_practice_history.sql` and then
`0004_online_practice_retirements.sql` before a protocol-3 backend, after migrations 0001
and 0002. It introduces two tables and two RPCs, without changing existing saves
or identities:

- `online_practice_races` privately retains the complete authoritative record and
  its first database receipt time. It has no browser SELECT/write grants.
- `online_practice_history` has one owner-readable row per race and participant.
  RLS limits authenticated reads to `auth.uid()`. No browser insert/update/delete
  grants exist, and `leaderboard_eligible` is generated as false.
- `record_online_practice(jsonb)` is a fixed-search-path SECURITY DEFINER RPC.
  Only `service_role` can execute it; ordinary authenticated/anonymous players
  cannot. Direct table mutation is also revoked from `service_role` for these
  new tables. The database owner remains privileged.
- `my_online_practice_history(before_at, before_id)` is SECURITY INVOKER and
  owner-scoped, returns at most 21 rows, and uses `(recorded_at, race_id)` keyset
  ordering. The UI displays 20 rows at a time, with Earlier/Latest controls; it
  retains only the current page. Same-timestamp rows are not skipped.

The server builds records from its final session result and frozen descriptor,
including race UUID, stock cars, protocol/physics versions, fingerprint and the
`online-practice-v2` ruleset (protocol 3), while retaining v1/protocol-2 replay. Both the outbox and SQL validate bounds, distinct
racer UUIDs, lap sums, finish/rank/tie/DNF consistency and finish reason. SQL writes
the race and both participant rows in one transaction. A missing profile rolls
back the entire result instead of saving half a race.

A transaction-scoped advisory lock serializes same-race writes. Repeating the
same JSONB record returns the original receipt; different content/provenance for
that UUID raises a conflict. No upsert changes an accepted result. No rewards or
stats are incremented, so retries cannot duplicate progression.

## Optional local runner configuration

The production entrypoint remains **lobby-only** and does not construct a writer.
The three history/retirement/audit migrations were subsequently explicitly
approved and applied to the existing Supabase project, and all six rollback-only
live SQL-role/result checks passed. See [the CLI receipt](SUPABASE_CLI.md).
An existing server credential is now configured locally in ignored
`server/.env.local` (0600), paired with a dedicated 0700 outbox directory. No new
key, hosted deployment, machine resize or paid volume was created.
The real-account local race runner enables persistence only when both of these
server-only values are present in `server/.env.local`:

```dotenv
SUPABASE_RESULT_SECRET_KEY= # server-side Supabase secret key; never VITE_/NEXT_PUBLIC_*
RESULT_OUTBOX_DIR=/absolute/path/on/persistent-storage/online-practice-outbox
```

Use a dedicated server secret key, or a legacy service-role key while supported.
It has privileged project access; it belongs only in the controlled backend,
never browser config, logs, profile metadata or committed files. This is not a
per-function-scoped API key. Browser admission continues to use the public key
and the player's own verified token. See [Supabase API key guidance](https://supabase.com/docs/guides/api/api-keys)
and [function permission guidance](https://supabase.com/docs/guides/database/functions).
An anon/publishable result-writing key is rejected at startup.

Without both settings, results explicitly remain session-only. Setting just one
fails startup. The URL must be HTTPS except loopback development. RPC fetches
have a five-second timeout. Apply the migration in a staging environment first;
only then supply the writer configuration to an authorized server environment.
Enabling local persistence does not prove Fly's 256 MiB pilot can run races.

## Durability, outages and restart

The optional `ResultOutbox` uses a dedicated absolute directory on storage that
survives the process. Files are 0600, directory 0700. Each validated record is
written to a temporary file, fsynced, renamed to its race UUID and followed by a
directory fsync before the UI may say pending. Writes are independent of room
lifetime: returning to the lobby, disconnecting or expiring the room does not
cancel an accepted durable record. A late write cannot update a new race's UI.

One worker retries with exponential backoff from one second to a 60-second cap.
It never reports saved before a matching database receipt. A confirmed save is
reported even if local file cleanup needs retry; the same record is safe to
replay after a lost response or crash. Shutdown stops retries and leaves pending
files for the next startup. The worker loads retained disk records before accepting new
ones on restart. A complete pre-rename temporary file is recovered.

The directory is capped at 100 retained records, including rejected records;
individual JSON payloads are capped at 16 KiB. A full outbox prevents another
race start. This assumes the current one-world/single-process development gate:
use one process per outbox directory. It is not a shared multi-host job queue.
Filesystem/disk-full failures are shown as failed, never as durable pending or
saved. There is an unavoidable interval between final physics and the first
durable write; a crash there is not a committed saved result.

Invalid/conflicting/missing-profile records are preserved as `.rejected` and shown
as failed. Configuration, permission, missing migration and network/database
outages remain pending for operator repair. Corrupt, oversized, unexpected or
conflicting startup files stop startup for inspection rather than silently being
dropped. Failed disk writes conservatively retain their capacity reservation
until restart. Monitor pending/rejected files and disk health before enabling a
hosted writer. Back up this directory with the database; ephemeral container
storage does not provide restart/redeploy durability. Do not share it with other
app files or delete it to clear an error without inspecting/backing up records.

The private raw record includes participant UUIDs. History rows cascade on profile
deletion, but the raw race record remains for idempotency. Account deletion,
retention/anonymization and legal deletion policy still need an explicit design
before public competition. No new account-deletion flow ships here.

## UI and read lifecycle

The history loader only reads the owner RPC through the existing authenticated
Supabase client. Requests have eight-second deadlines; refresh supersedes older
responses, and logout/account changes abort reads and immediately clear rows.
Another player's rows or an unexpected competitive ruleset are rejected. History
is not placed in localStorage or merged/uploaded by the offline cloud-save code.
Missing migrations/read failures offer retry without blocking account editing.
The saved message belongs to the active race; its status travels separately from
the immutable final physics snapshot, so same-tick snapshot deduplication does not
drop a later database acknowledgement.

## Verification

`npm test` runs real embedded Postgres via the dev-only PGlite dependency. Its
minimal Auth/role bootstrap tests the actual migrations, ACL/RLS, atomic writes,
conflicting/duplicate retries, malformed records, ties/DNF and keyset paging.
PGlite has one exclusive connection, so this does not establish multi-connection
advisory-lock behavior or hosted Supabase Auth/PostgREST acceptance. The SDK
integration exercises both seats through a simulated DB outage, durable pending,
commit, equal saved receipts and the matching two history rows. Outbox tests
cover restart replay, pre-rename recovery, corrupt startup, quota, permanent
quarantine, mismatched receipts and vanished-room callbacks.

For a disposable browser check, run the exporter **before** starting the fixture:

```sh
npm run build:simulation
node --import ./server/node_modules/tsx/dist/loader.mjs tests/browser/persistence-server.ts
# Another terminal:
VITE_MULTIPLAYER_URL=http://127.0.0.1:2569 npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

Open `/tests/browser/online-smoke.html?player=one&persistence=1` and the corresponding
`player=two` path. Create/join, ready and launch. This fixture uses a short scripted
server route and disposable Postgres/outbox, not stock physics or real identities.
It also exposes an owner-scoped test-only history reader on loopback port 2570 to
populate the production history UI after commit. That reader is separate from
the production CloudSave/Supabase route, whose read/cancellation behavior is unit
tested. Neither shipped server entrypoint nor the production image imports the fixture.

Recorded local browser smoke: both seats showed the same saved result; after
host return, the owner history views showed P1/1.167 s and P2/1.417 s respectively
from that synthetic race. These are intentionally artificial times.

Before public use: apply/verify the migration through staging, configure a
server-only key and truly persistent disk, profile the production image, prove
real Auth/PostgREST and two physical devices, and finish prediction, recovery,
competitive track limits, reconnect and operational failure drills. This work
does not complete the epic's first-playable acceptance gate by itself.

Rollback: remove writer configuration and revert UI/runner first, preserving
pending disk records. Keep accepted tables/records and identities for recovery.
Any schema/data removal needs a separate backup and retention decision.

## Packaged offline crash/restart drill

`npm run check:outbox-container` runs the locally built practice image against a
new disposable Docker volume, with a synthetic result and synthetic server key.
Both server processes run as UID 1000 with a read-only root filesystem, no external
network and no published ports. Root is used only to initialize ownership of this
new test volume; no host directory is mounted.

The first server confirms the exact pending file and its 0600 permissions inside
the 0700 outbox, then receives SIGKILL. A fresh server on the same volume retains
the identical SHA-256 record and remains ready. The second server handles SIGTERM
cleanly. A durable pending file is safe to replay and does not require a nonzero
exit; an unconfirmed enqueue is the separate shutdown error condition. All test
containers and the volume are removed. See the
[raw drill receipt](measurements/practice-outbox-restart-2026-10-24.json).

This tests local disk recovery after process death during an offline retry. It does
not exercise a real database outage, successful privileged HTTP write, live race
finalization or the hosting provider's persistent volume/termination behavior.

## Real local saving enabled — 2026-10-24

The local frontend points to `http://127.0.0.1:2568`. `npm run server:race-dev`
loads the ignored server configuration and now reports `resultStorage: true`.
Only one room/two-racer race is supported; shutdown handlers are installed before
listening. The preflight can be rerun without producing a race record:

```sh
npm run check:result-storage
```

It requires a writable private 0700 outbox and sends an intentionally invalid empty
record through the actual server writer. Success means the privileged RPC was
reached and rejected the invalid record at validation, rather than failing Auth or
permissions. It does not claim a successful save. Credential values never appear
in its output. The built frontend was scanned for the configured server key and
contained no match across 42 text artifacts. HEAD requests to both relative and
absolute filesystem routes for the backend credential file returned HTTP 403,
without reading a response body.

A subsequent real test did save: separate authenticated Chrome and Safari accounts
joined the same room, readied/launched and drove (50/57 km/h observed), then both
used Leave practice. The rival continued after the host retired. The authoritative
protocol-3 `all-resolved` result committed after the last client left. Each owner
then read exactly one private row with the same race UUID digest and its own
retirement tick (7119/8775), `dnfReason=left`, and competitive eligibility false.
The outbox had zero pending/rejected records afterward. No fake lap/finish was
submitted and this does not satisfy completed-lap or two-physical-device acceptance.
See the [sanitized live receipt](measurements/local-result-storage-2026-10-24.json).

The local directory survives local process restarts, but is under ignored cache;
it is not an approved hosted volume or a backup/retention guarantee. Hosted
writer/volume configuration and operational acceptance remain separate work.
