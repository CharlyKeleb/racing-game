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

## Acceptance

#120 remains open until hosted health/origin/Auth checks, capacity measurements,
a finished race on two real accounts and two physical devices, matching owner
history, reconnect/rematch/leave/menu/hidden-tab/expiry, durable restart/rollback,
and the documented device/network baseline pass. The local AI full-race check
and same-Mac real DNF save are supporting evidence, not that acceptance result.
