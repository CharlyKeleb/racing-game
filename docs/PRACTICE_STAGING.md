# Isolated online practice staging build (#120)

Current launch update (2026-10-24): the user approved promoting this race image
to the existing Fly app with one shared CPU / 1 GiB machine and a 1 GiB encrypted
result volume. The matching production frontend is promoted. See the
[launch runbook](PRIVATE_RACING_LAUNCH.md). Earlier build-only/no-deployment claims
below describe the original isolated packaging work. Real two-device completion
and remaining hosted acceptance gates are still open.

`Dockerfile.race` is a separate root-context image for the shared authoritative
physics adapter. It does not replace `server/Dockerfile`, `server/fly.toml`, or
the deployed 256 MiB lobby pilot. No app, machine, volume or secret has been created or changed by this work.
The three separately approved live Supabase migrations are now applied.

## Local artifact checks

```sh
npm ci
npm --prefix server ci
npm run check:race-staging
```

The build typechecks the cross-package entrypoint, exports trusted simulation
assets, packs the numeric collision data, and bundles shared Three/Rapier physics for Node. The server's six direct
runtime packages remain external, resolved from its own locked dependency tree.
The runtime image has only that pruned backend tree, the Node bundle and the
exported collision/config binary. It runs as the unprivileged `node` user.
The image-specific allowlist excludes environment files, Git, local caches and
dependencies from its input context. No browser environment values are injected
into the Node build.

The check relocates the artifact into a temporary directory with backend package
resolution, verifies startup refuses implicit enablement, then runs
`--check-assets` with synthetic configuration. That mode creates a real two-car
physics world, advances 12 ticks, checks finite output and frees it. Both
scheduled-input capability states must match the browser asset fingerprint.
It opens no listener or database connection. This is an offline artifact check,
not a container/hosted acceptance claim.

When a Docker daemon is available, the separate container build is:

```sh
docker build -f Dockerfile.race -t racing-practice-staging .
npm run check:practice-container
```

The Docker daemon was initially unavailable. On 2026-10-24 it was started and
the ARM64 image built successfully. `npm run check:practice-container` verifies
explicit enablement, both scheduling modes with two cars and twelve physics ticks,
UID 1000, health/readiness and graceful shutdown. The test uses no external
network, published ports or real credentials, with a read-only filesystem, one CPU
and a 512 MiB limit. See the [container report](measurements/practice-container-2026-10-24.json).
Its two short RSS samples were about 139 and 207 MiB; these are not peak memory,
steady race capacity or evidence that the lobby allocation can host practice.
The relocated Node artifact check also passed. Its earlier [JSON-asset startup samples](measurements/staging-assets-2026-10-23-json.json)
were about 283–285 MiB RSS after twelve physics steps, including asset parsing.
They are short local final samples, not steady/peak or hosted capacity measurements.
The [compact asset format](COMPACT_SIMULATION_ASSETS.md) removes numeric JSON
arrays from this runtime path; its measurements are recorded separately.

## Staging configuration

The user selected the existing Supabase project for hosted testing on
2026-10-23. Use that project's existing accounts and an independently hosted
frontend/backend. Auth, profile, rename-audit and practice-history data are
shared with the existing game; this is backend deployment isolation, not database
isolation. Supply configuration at runtime, never with Docker build arguments:

| Variable | Required value |
| --- | --- |
| `PRACTICE_SERVER_ENABLED` | `1` explicitly enables this entrypoint. |
| `SUPABASE_URL` | Existing project's HTTPS origin; no credentials, path or query. |
| `SUPABASE_PUBLISHABLE_KEY` | The same project's public admission key. |
| `ALLOWED_ORIGINS` | 1–8 exact HTTPS frontend origins, comma separated; no wildcard. |
| `PORT` | Optional integer 1024–65535, default 2567. |
| `PRACTICE_ASSET_FILE` | Absolute RGAS/1 file path; image default `/app/simulation-assets.bin`. |
| `MULTIPLAYER_SCHEDULED_INPUTS` | `0`/unset by default; `1` advertises experimental scheduling. |
| `MULTIPLAYER_METRICS` | `1` enables bounded aggregate metrics; `0`/unset disables them. |
| `SUPABASE_RESULT_SECRET_KEY` | Optional server-only result secret, paired with the outbox directory. |
| `RESULT_OUTBOX_DIR` | Optional absolute path on persistent storage, writable by UID/GID 1000; required with the result secret. |

Configuration checks URL/origin syntax, not whether a key belongs to that project.
Verify that URL, public key and result secret belong to the selected existing project.
Startup uses the real Supabase authenticator; there is no test-auth mode. One
room and one two-racer simulation are allowed per process. Run one replica;
in-memory seats, codes and reconnect leases are not shared between processes.
The existing backend health/readiness endpoints and origin/input/admission
limits apply. The runner registers signal handlers before listening and keeps
the 15-second drain/20-second hard deadline. Set the host termination window
above 20 seconds. Pending durable outbox records survive only on persistent
storage; process memory is never a recovery mechanism.

Check which migrations 0001–0005 already exist in the shared database before
applying pending migrations in order. They affect the existing project's schema;
the SQL permission/transaction checks already run locally against a separate test
database. Verify owner/other racer/anonymous/backend role checks without changing
unrelated accounts or histories. Add the test frontend's Auth redirect URLs
and use the existing Supabase URL/public key. Build that frontend from the
same source and lockfile so `/multiplayer/manifest.json` matches the server's
exported fingerprint. Set `VITE_MULTIPLAYER_URL` to its staging backend.
Keep `VITE_ONLINE_PREDICTION=0` for the initial snapshot-only baseline, then test
the [experimental prediction path](ONLINE_PREDICTION.md) separately.

## Acceptance still required

The existing Supabase project is selected. The local practice runner now has
server-only result credentials and a private outbox; a real two-account retirement
result was saved and read by both owners. Hosted credentials/volume, capacity and
budget have not yet been configured for this separate container runner.
The [CLI workflow](SUPABASE_CLI.md) now has access to the selected project. Baseline
SQL was inspected and the three mapped migrations were explicitly approved and
applied. Post-apply CLI metadata confirms tables, retirement columns and RPCs.
All six live SQL-role/result checks passed using synthetic data inside a rolled-back
transaction. Real profile/history HTTP reads, normal token refresh and local
original/refreshed room admission also pass for one real Chrome account. Genuine
expiry/revocation and separate physical devices remain open. A later two-account
local retirement test also completed a real privileged HTTP result commit; see the [real-session receipt](measurements/supabase-real-session-2026-10-24.json),
the [SQL receipt](measurements/supabase-acceptance-2026-10-24.json) and
[deployment receipt](measurements/supabase-deployment-2026-10-24.json).
The existing paced process measurement is not a server-only container memory
budget. Measure actual image memory, 60 Hz work/backlog and sustainable room count
on proposed resources before selecting capacity or changing the lobby pilot.

Two separate physical devices and authenticated accounts must complete the same
race, see identical results saved to private history, and complete rematch and
recovery flows. Check Chrome plus the available Safari/iOS/Android devices,
30/100/200 ms network conditions, hidden tabs, expiry and server termination.
Drill durable retries during a database outage and after a process restart.
Verify health/readiness, rollback, origin rejection, bundle secret exclusion,
outbox retention and deletion policies in the hosted environment. These gates
are not satisfied by the offline artifact or synthetic network checks.

## Local outbox process-death recovery

The [offline container drill](ONLINE_PRACTICE_HISTORY.md#packaged-offline-crashrestart-drill)
now verifies that an exact pending record survives SIGKILL and a fresh packaged
server on the same disposable volume. File/directory modes remain 0600/0700 and
the fresh process shuts down gracefully. No real credentials or external network
are used. Hosted storage, real database outages and successful HTTP commits remain
unverified by this drill.
