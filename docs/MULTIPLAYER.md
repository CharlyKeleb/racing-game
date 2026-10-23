# Private multiplayer lobbies (#120)

The hosting target is **Fly.io**, replacing Railway in the original epic.
The lobby pilot was deployed on 2026-10-23 with explicit approval for paid hosting:

- Organization: **Charly** (`charly-27`)
- App: `charly-racing-multiplayer`
- Endpoint: `https://charly-racing-multiplayer.fly.dev`
- One always-on shared CPU / 256 MiB machine in Johannesburg (`jnb`)
- Machine: `87154ea0445128`; shared public IPv4, HTTPS/WSS
- Release image: `registry.fly.io/charly-racing-multiplayer:deployment-01M5MJWQACAEF5HTPV6Y84TZG3`

Public health/readiness checks pass; unsigned admission and disallowed browser
origins are rejected. An authenticated racer created a private room through the
local game over the deployed HTTPS/WSS endpoint. The local frontend `.env.local`
points to this Fly backend.
The production frontend still needs its multiplayer code published and
`VITE_MULTIPLAYER_URL` configured when that frontend release is approved.

## Delivered scope

The menu's **Online lobby** opens a private lobby panel. Signed-in racers with a
completed Supabase profile can create or join an eight-character room code.
Up to four racers share a roster, stock car selection, host-selected lap count,
and ready states. Changing the car clears that racer's ready state; changing lap
count clears everyone's ready state. The next connected racer becomes host when
the host leaves. The pilot track is Nürburgring GP. Lobby codes expire with the
room, after at most 30 minutes. Closing the panel keeps the seat; leaving the
room/page, signing out, expiry or a network drop releases it.

**The deployed pilot is a lobby milestone.** Its production entrypoint does not
launch online races. The optional [local browser practice](BROWSER_MULTIPLAYER.md)
now exercises server simulation, two-car presentation and server-timed session results. Reconnect grace,
matchmaking, public room listing, verified results, leaderboards and live ping
measurement are still pending. The panel explains this rather than
starting separate local races and presenting them as multiplayer. Local racing
and cloud saves continue to work independently.

## Ownership and authentication

`server/` is an independent Node/TypeScript package. Colyseus 0.18 owns rooms and
WebSockets. Express owns bounded `/rooms` admission. Clients send their current
Supabase access token via the Authorization header. The backend calls the configured
project's Auth `getUser` endpoint to verify it, then checks issuer, audience, expiry
and matching UUID. This handles both JWKS-based and legacy signing keys without
storing a JWT secret. Auth and profile calls have an eight-second timeout.

The profile is read with the same player's token and RLS; UUID/handle/display name
from request bodies or editable Auth metadata are ignored. No service-role key is
needed. The HTTP endpoint injects verified identity into a short-lived Colyseus
seat reservation. Direct SDK matchmaking is denied by the room's static auth hook.
Room codes, seats and bearer tokens must not be logged or placed in share URLs.

Admissions are limited to 20/minute/IP, one admitted seat per player and 100
rooms/process. Maximum payload: 2 KiB HTTP body / 10 KiB WebSocket (to fit bounded JWT refreshes). Colyseus limits each client to
10 messages/second. Fly deployments use Fly's overwritten `Fly-Client-IP` header;
local runs use the socket IP. Browser HTTP and WebSocket origins are allowlisted.
Nonbrowser clients still require valid authentication and a reserved seat.

Tokens are refreshed from the browser's existing Supabase session every 30
seconds. The server verifies refreshes for the same UUID and removes seats at
token expiry. Profile changes/moderation, immediate revocation and bans are not
pushed into existing rooms yet; those need a dedicated lifecycle policy before
public online racing. There is no automatic reconnect or persisted room state.

## Local setup

From the repository root:

```sh
npm ci
npm --prefix server ci
cp server/.env.example server/.env.local
```

Set the server's public Supabase key in `server/.env.local`:

```dotenv
SUPABASE_URL=https://uqxxdjxiqczgigyifldl.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_public_anon_or_publishable_key
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
PORT=2567
```

Run the server with `npm run server:dev`. Add
`VITE_MULTIPLAYER_URL=http://localhost:2567` to the frontend `.env.local`, then run
`npm run dev -- --port 5173`. Without the frontend URL, the panel displays a
preparation message. Without required backend variables, the server refuses to
start. The local server can access Supabase over the network; its public key is
not a privileged DB credential. Never copy a `service_role` key into browser env.

## Fly.io deployment

`server/fly.toml` records the deployed single-machine pilot in Johannesburg.
Capacity and device latency are still unmeasured. Use separate apps and origin
lists for staging; PR previews must not alter the production service.

Use one machine only: room codes, player admission and Colyseus room state live
in that process. Multi-machine routing requires shared presence/driver and
room-aware routing before adding replicas. Auto-stop is disabled so idle/active
lobbies aren't silently lost. `--ha=false` avoids Fly's default redundancy; it
also means there is no failover. Machine restarts/redeploys close all lobbies.

To redeploy this existing app from `server/` (redeploys disconnect lobbies):

```sh
fly config validate
fly deploy --remote-only --ha=false --strategy immediate
fly status
fly checks list
```

The app is already provisioned; do not recreate it. It uses shared public IPv4.
Fly CLI 0.4.59 failed its initial automatic IPv6 allocation; shared IPv4 was
successfully allocated with `fly ips allocate-v4 --shared --app charly-racing-multiplayer`.
No dedicated IPv4 or second machine was provisioned.

The pilot origin allowlist is `https://racing-game-jade.vercel.app`,
`http://localhost:5173` and `http://127.0.0.1:5173` for explicit local testing.
No wildcard Vercel preview origins are permitted. Keep staging origin lists
separate and remove localhost from the production allowlist when the pilot ends.
Set frontend `VITE_MULTIPLAYER_URL=https://charly-racing-multiplayer.fly.dev` and
rebuild to use it. HTTPS/WSS are provided by Fly's proxy; the process listens on
`0.0.0.0:2567` internally. Supabase connection settings were imported through
Fly secrets without privileged keys.

The Docker build copies only server code and its own lockfile—no car/track assets,
frontend env or privileged secrets. It runs as the unprivileged `node` user.
The base image follows Node 24 LTS; pin a reviewed image digest in release CI
when establishing image-update policy. `GET /healthz` exposes protocol health;
`GET /readyz` returns 503 during shutdown. SIGTERM stops admission and disconnects
lobbies within the configured 25-second deadline. Health checks are not external
continuous monitoring. Add monitoring, spend alerts and a rollback drill before
public rollout. Rollback the image with Fly's release tooling; clients from an
incompatible lobby protocol must refresh. This slice introduces no DB migration.

## Verification and remaining acceptance

```sh
npm run server:build
npm run typecheck
npm run lint
npm run test:multiplayer
npm run build
fly config validate --config server/fly.toml
```

The tests run two/four real Colyseus SDK clients against a local HTTP/WebSocket
backend with an injected test authenticator. There is no test-auth environment
switch in the deployed server. Separate tests cover verified token claim checks,
Auth rejection, missing profiles and metadata spoofing. Integration checks cover
origin/protocol validation, closed public matchmaking, room capacity, simultaneous
admission, host permission/transfer, ready resets, expiry and shutdown admission.

The production container was built and started successfully through Fly/Depot.
A real two-account, two-device Supabase/Fly test remains an acceptance gate. Test
room creation, cross-device code join, readiness, logout/token refresh, host
exit, offline/network drop and redeploy. Latency, memory and four-racer load must
be measured on the actual chosen Fly machine before public launch.

The [headless simulation spike](HEADLESS_SIMULATION.md) extracts the shared chassis
and provides a versioned track/stock-car export, two-car ghost simulation tests
and a local CPU/memory benchmark. It is not wired into deployed lobbies.

The [local race transport](RACE_TRANSPORT.md) now exercises loading/countdown,
sequenced inputs and authoritative snapshots through two SDK clients. It is
explicitly gated behind a local simulation factory; the deployed entrypoint
remains lobby-only. The [browser adapter](BROWSER_MULTIPLAYER.md) now supports
local two-racer practice with server-pose interpolation.

Practice now includes ordered checkpoint/lap validation, a finish window, DNF
deadlines, identical session results and host return to the lobby. Next: full
prediction/reconciliation, production-image profiling, competitive track limits
and hosted persistence verification. Optional server-owned [practice history](ONLINE_PRACTICE_HISTORY.md) now includes atomic writes, durable retry and private owner reads. Never upload browser lap records as verified
competition data.

References: [Fly configuration](https://fly.io/docs/reference/configuration/),
[Colyseus authentication](https://docs.colyseus.io/auth/room),
[Colyseus WebSocket transport](https://docs.colyseus.io/server/transport/ws),
[Supabase JWTs](https://supabase.com/docs/guides/auth/jwts).

The optional local race backend now supports [15-second authenticated reconnect](RACE_RECONNECT.md)
while preserving simulation state. The deployed lobby pilot remains unchanged;
reload recovery, disconnect DNF and hosted acceptance remain separate gates.

Post-race [rematch voting](RACE_REMATCH.md) requires fresh consent from both original racers.

[Draining and shutdown](MULTIPLAYER_SHUTDOWN.md) stops new races and bounds in-flight finish/durable enqueue work.
