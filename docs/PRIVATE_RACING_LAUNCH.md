# Private-racing launch (#120)

The user approved narrowing #120 to working hosted two-player private racing on
2026-10-24. The complete prior roadmap is preserved in
[the historical checklist](ISSUE_120_ORIGINAL_ROADMAP.md). Deferred epics are:

- #143: competitive integrity, verified leaderboards and racer statistics.
- #144: expanded account lifecycle, public profiles, moderation and retention.
- #145: cloud garage, friends, parties and public casual matchmaking.
- #146: ranked seasons, progression, rewards and crews.
- #147: four-player scaling, contact collisions, spectating and replays.

The launch uses existing Google/magic-link accounts and completed racer profiles,
exactly two stock-car racers, Nürburgring GP, ghost collisions and private room
codes. Prediction and scheduled inputs remain disabled. Saved practice results
remain competitively ineligible. Existing account and private history security
requirements still apply; this scope split does not declare deferred work done.

## Approved hosting target

Reuse `charly-racing-multiplayer` in Johannesburg (`jnb`), with one shared CPU,
1 GiB RAM, one 1 GiB encrypted volume and one process/room. On 2026-10-24 the user
approved a US$15/month target. Usage billing is variable; this is not a provider-
enforced hard cap. Do not add replicas, regions or automatic volume growth.
Compute/storage/egress must be checked against [Fly pricing](https://fly.io/pricing/)
and the account billing dashboard; health checks do not constitute spend alerts.

`fly.practice.toml` uses the root-context `Dockerfile.race`, existing HTTPS
hostname, exact production frontend origin, 25-second host termination window,
explicit practice enablement and metrics. `/data/online-practice-outbox` is on the
persistent volume; the runtime stays UID 1000 and the outbox uses 0700/0600 modes.
Verify volume ownership and a real saved result after deployment. Existing
Supabase project `uqxxdjxiqczgigyifldl` is shared, as explicitly selected by the user.

The separate lobby-only `server/fly.toml` and image are retained for rollback.
Deploy from repository root, with exactly one process and no spare machine:

```sh
fly config validate --config fly.practice.toml
fly deploy --config fly.practice.toml --remote-only --ha=false --strategy immediate
fly status --app charly-racing-multiplayer
fly checks list --app charly-racing-multiplayer
```

Use Fly secrets for the existing project URL/public admission key and server-only
result key. Import secret values through stdin; never command arguments or build
arguments. The allowed-origin secret must agree with the config's exact production
origin because an existing secret can override `[env]`. No localhost or wildcard
preview origins are part of this hosted configuration. Do not run a synthetic Auth
bypass or publish the local test-server entrypoint.

## Frontend and rollback

Build the production frontend from the same source/lockfile, with the existing
public Supabase settings, `VITE_MULTIPLAYER_URL` set to the Fly HTTPS hostname and
`VITE_ONLINE_PREDICTION=0`. Check the frontend manifest against the server startup
fingerprint. Build/upload from tracked source and actual checked-out LFS assets;
exclude local `.env.local`, backend credentials and generated private caches.

The old lobby image is
`registry.fly.io/charly-racing-multiplayer:deployment-01M5MJWQACAEF5HTPV6Y84TZG3`.
Retain the previous machine config and frontend deployment ID before replacing
anything. A rollback/redeploy interrupts in-memory races; unfinished races remain
unverified and never become fabricated ranks/rewards. Preserve the result volume
and existing additive database migrations when reverting code. Do not destroy
queued records or roll back live SQL as part of an application rollback.

## Hosted verification — 2026-10-24

The race image and production frontend are deployed. [The hosted receipt](measurements/hosted-private-racing-2026-10-24.json) records the image digest, machine/volume, frontend deployment, matching fingerprint, five HTTP/origin/Auth checks, UID/mode checks, rejected invalid-record RPC preflight, aggregate idle metrics and controlled idle restart. A private non-record marker survived the restart and was removed; no synthetic race was written. This does not prove replay of an actual queued race or sustained race capacity. Two real accounts on separate Macs have joined and launched the same one-lap race. A short active sample shows about 295 MiB RSS and simulation work p95 bounded by 2 ms, with accepted controls and no rejected inputs. This is not peak/sustained capacity; The user subsequently reported that both Macs finished and showed matching saved results; hosted metrics confirm one finalized/saved race and no pending writes. The agent did not independently read the finished standings/history rows. Recovery/rematch and the remaining operational/device checks stay open.

## Acceptance

#120 remains open until hosted health/origin/Auth checks, capacity measurements,
a finished race on two real accounts and two physical devices, matching owner
history, reconnect/rematch/leave/menu/hidden-tab/expiry, durable restart/rollback,
and the documented device/network baseline pass. The local AI full-race check
and same-Mac real DNF save are supporting evidence, not that acceptance result.

## Operational ownership and public health checks

The owner is the existing Charly Fly account/repository owner. Keep the approved
US$15/month target under review in Fly billing; shared CPU, RAM, provisioned volume,
snapshots and egress are billed independently. No hard spending cap or billing
alert has been verified. Do not expand replicas, memory, regions or volume growth
without a new budget decision. The one-room/two-racer limit is a capacity boundary,
not a promise about the monthly bill.

`.github/workflows/multiplayer-health.yml` checks public health, readiness, the
current frontend protocol/fingerprint, unsigned admission denial and foreign-
origin denial every fifteen minutes (off the hour), on relevant changes and by
manual dispatch. It needs no Supabase/player credentials and cannot admit a seat.
The CLI helper retries transient failures three times, then exits unsuccessfully;
Actions exposes the failed run and GitHub notification delivery follows the
owner's notification settings. Update the pinned manifest fingerprint with any
approved physics/asset/protocol release.

This is a lightweight external check, not guaranteed continuous monitoring:
[GitHub schedules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
can be delayed/dropped and public-repository schedules disable after 60 days of
inactivity. It does not test sign-in, racing, private result history or spending.
Those checks still require the documented acceptance process and billing review.
