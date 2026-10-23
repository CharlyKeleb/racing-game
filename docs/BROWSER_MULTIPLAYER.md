# Browser online practice (#120)

The optional local race backend can now launch two browser racers into the same
Nürburgring practice session. The host readies both racers and selects **Launch
practice**. Both browsers load the stock models/circuit and acknowledge the same
built asset package before the shared countdown. Each browser draws both cars
from authoritative server snapshots and sends only driving controls.

This is a practice milestone with server-timed ordered checkpoints, laps and
shared session results. The HUD shows lap count, race time, next gate and finish
status alongside speed/gear, nitro, countdown and connection state. The results
dialog shows the same server-confirmed places, race times and best laps for both
racers, including ties and DNF. The optional [result storage path](ONLINE_PRACTICE_HISTORY.md) can save them to
private profile history after server-only storage is configured; otherwise they
remain session-only. Competitive validation and progression remain pending. The deployed Fly entrypoint still
advertises lobby-only capability; this change does not deploy or resize it.

## Run with real accounts locally

Set up `server/.env.local` as in [the transport guide](RACE_TRANSPORT.md), then:

```sh
npm ci
npm --prefix server ci
npm run server:race-dev
# In another terminal:
VITE_MULTIPLAYER_URL=http://127.0.0.1:2568 npm run dev
```

Use two signed-in racer accounts, create/join a lobby, ready both and launch from
the host. The one-world/two-racer local gate and existing Fly capacity profiling
requirements still apply. This is not the two-physical-device acceptance gate;
the local runner intentionally binds loopback only.

`predev` and `prebuild` run the simulation export. Only the small generated
`public/multiplayer/manifest.json` compatibility descriptor goes into the browser
build; collision JSON stays in the ignored local cache. The browser checks race
protocol, simulation version, fingerprint, track and supported stock cars before
acknowledging loading. Missing/old assets fail back to the lobby. No local garage
performance builds are sent or used as authoritative physics configuration.

## Presentation and lifecycle

`OnlineRaceScene` shares the existing renderer, asset cache, streamed track,
environment and audio. It owns separate visual car roots/material copies and a
chase camera. While online, `Game` skips all local physics, race/lap rules,
recovery, finish cameras and progression. It temporarily switches the loaded
circuit if necessary, then restores the saved circuit, car/build, weather,
lighting, camera and scene on exit. Saved settings are not rewritten to force the
online session. Garage/settings changes arriving during the session are deferred
until return. Async cancellation disposes late-loaded visuals before restoring
the menu. Network asset requests have bounded fetch deadlines.

`SnapshotBuffer` holds at most 32 ordered frames from the active race. Both cars
render 100 ms behind the latest estimated server tick, with shortest-path
quaternion interpolation and no more than 33 ms of velocity extrapolation. A
longer gap freezes presentation. After 500 ms without a valid frame, controls
are released and the HUD reports the delayed connection. The server independently
neutralizes stale input after 250 ms. Returning from a hidden tab discards old
interpolation history. Invalid/foreign/out-of-order frames cannot replace it.

This is **not rollback prediction**: the local car is also interpolated from
server poses, so input response includes network/interpolation delay. There is
no claim of deterministic reconciliation or persisted competitive results. Controller state capture/replay and measured latency work remain next.
Remote engines, richer driving effects, cockpit camera and car reset/recovery
are also follow-ups; chase/rear view, keyboard, standard gamepad and touch driving
are supported. Online gearbox is automatic regardless of the offline preference.

Esc opens a focus-trapped race menu while the server keeps racing. Driving input
becomes neutral while it is open. Finished racers release driving controls while
waiting for the result. The final results dialog supports keyboard/controller
focus and host-only return of the crew to the lobby; either racer can leave. Hiding the tab stops local rendering/audio and
releases controls; it never pauses the server. Explicit leave disposes the online view and returns the remaining seat to the
lobby with readiness reset. Unexpected drops on the optional local backend now
get [bounded authenticated recovery](RACE_RECONNECT.md): the scene remains,
controls are released and the server clock keeps running. Final timeout still
aborts the race.
Starting an offline race explicitly leaves any lobby seat first.

## Browser smoke fixture

A disposable synthetic-account fixture lives under `tests/browser`, outside the
production build. It uses the real WebSocket/physics transport with an injected
test authenticator in a **separate** loopback-only test backend. Neither server
entrypoint imports it, and the production image has no test-auth flag.

```sh
npm run build:simulation
node --import ./server/node_modules/tsx/dist/loader.mjs tests/browser/race-server.ts
# Another terminal:
VITE_MULTIPLAYER_URL=http://127.0.0.1:2569 npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

Open these two paths on `http://127.0.0.1:5174`:

- `/tests/browser/online-smoke.html?player=one`
- `/tests/browser/online-smoke.html?player=two`

Use the fixture buttons to create/join, then the normal Online lobby UI to ready
and launch. The fixture refuses to run outside Vite development or against any
other endpoint. Its tokens and identities are synthetic. This tests browser
composition, not Supabase authentication or physical-device networking.

Recorded local smoke: both browsers loaded the grid; host reached 118 km/h in
third and guest reached 107 km/h in third. Esc opened the online menu; guest exit
returned both to the menu/lobby with readiness cleared. Scene/buffer unit tests
cover pose interpolation, bounded extrapolation, validation, return after an
alternate selected circuit and cancellation while visuals are still loading.

For a fast results UI check, start the test backend with `--scripted-results`.
This **test-only** mode substitutes a short synthetic server route for physics;
it exercises the normal countdown, checkpoint/lap rules, results transport and
browser dialog without a human driving a full lap. It is not evidence of actual
Nürburgring completion, stock-car driving, Supabase auth or physical-device
acceptance. Browser smoke confirmed both result tables matched and host return
restored the lobby with both readiness flags cleared.

Run `npm test`, both builds and lint before review. Next: full controller-state
prediction/reconciliation, competitive track-limit validation and
staging/device/memory/network acceptance and hosted persistence verification.

The smoke fixture also has **Drop test connection** for inspecting bounded recovery
with a synthetic offline event and a three-second synthetic token delay. This is
not real network-loss or hosted-auth acceptance. See [reconnect rules](RACE_RECONNECT.md).
