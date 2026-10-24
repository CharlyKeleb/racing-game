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

The race image and production frontend are deployed. The [hosted receipt](measurements/hosted-private-racing-2026-10-24.json)
records deployment identity, matching fingerprint, public denial/health checks,
private volume permissions and rejected-invalid-record RPC preflight. An idle
SIGTERM restart preserved a disposable private marker, which was then removed.
An idle rollback to the retained lobby image and restore to the race image both
passed; the restored service passes all five public probes. Neither test proves
replay of a real queued result, which remains a separate acceptance gate.

Two real accounts on separate physical Macs reported finished matching saved
results, owner history, rematch, menu and hidden-tab checks. Aggregate counters
show four finalized/saved results, no failed writes and no pending writes before
maintenance. One reconnect started and timed out, with zero successful recoveries;
clarification of same-car/same-race recovery is pending. The agent did not read
finished private history rows. Short active samples around 295–303 MiB RSS and
1–2 ms p95 simulation work support this bounded pilot, not sustained peak load.
One earlier aborted start is retained in the evidence without an attributed cause.

The device/network baseline is two physical Macs at about 237 ms observed RTT,
with Chrome directly observed on the local Mac. The other browser is unspecified.
Mobile and real TCP-shaped 30/100/200 ms checks are unverified; keep those outside
the verified pilot baseline. JWT expiry is terminal at the earlier lease deadline
unless a fresh same-identity session is verified. Local socket tests cover that
policy; natural live expiry/revocation has not been observed, and immediate remote
ban propagation is deferred with account lifecycle work in #144.

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
The workflow is active on main; push run 40103971303 passed after #149 merged.
