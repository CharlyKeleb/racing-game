# Responsive multiplayer controls

The initial private-racing build drew the player's car from the same 100 ms
snapshot buffer as rivals. Input travelled to the server and the reply travelled
back before it became visible. With about 237 ms measured RTT, that adds roughly
337 ms plus input/snapshot scheduling. It explains delayed throttle and steering
without requiring a slow physics simulation.

The player's car now runs the matching stock physics locally at 60 Hz. A control
can affect the next fixed step (up to about 16.7 ms, plus rendering), then validated
server corrections reconcile it. Rivals retain buffered interpolation. The server
still owns simulation time, checkpoint order, laps and saved private results.

## Fallback fixes

- Missing RTT at scene creation defers initialization; a later sample can start it.
- The 18-tick ceiling excluded the reported 237 ms RTT plus 79 ms variation.
  The new ceiling is 24 ticks, with up to three spare ticks when allocating and
  at most 36 replay steps per correction.
- Growing RTT reseeds a larger bounded lead. An over-budget sample temporarily
  falls back; a later usable sample resumes prediction instead of disabling it
  for the whole race.
- An initial correction timeout retries after a one-second cooldown. Menus,
  reconnect, stale corrections and acknowledgements still release controls safely.

`VITE_ONLINE_PREDICTION=1` enables the production client (also the source default
when unset); `0` is a rollback switch. The Fly config uses
`MULTIPLAYER_SCHEDULED_INPUTS=1`, supported by the retained race image. Legacy
clients keep mailbox inputs. Protocol, simulation fingerprint and result schema
are unchanged, and no hardware/region/replica or database migration is required.

## Verification

The [receipt](measurements/responsive-controls-2026-10-24.json) records two rendered
synthetic racers using real Nürburgring/stock-car physics through an ordered
loopback TCP proxy with **150 ms delay in each direction**. Measured RTT stayed
around 301–305 ms; prediction stayed ready with 24-tick lead. Selected software
samples showed **29.1 ms throttle** and **13.7 ms steering** to the first changed
rendered state. Menu return and drop/fresh authentication/RTT recovery resumed
prediction. Both racers left and the owned browser tabs were closed afterward.

These are selected software samples, not percentiles or physical key-to-photon
measurements. The fixture uses synthetic identities and no database; it does not
replace real-account saved-result acceptance, WAN loss/jitter, mobile memory or
long-session performance checks. Network latency still affects remote cars and
authoritative confirmations; local prediction removes that wait from own controls.

Scene regressions verify the next local step changes throttle and steering
without a second server frame, preserves rival snapshots, handles 237+79 and
300+33 ms RTT/variation, late first samples, temporary high RTT, correction retry,
menu/reconnect cleanup and explicit rollback. Real-physics synthetic network tests
cover 33/100/200/300 ms RTT with bounded jitter and omitted messages.

## Reproduce the isolated delayed browser check

Run `npm run build:simulation`. Start the real-physics fixture and loopback proxy:

```sh
SMOKE_PORT=2570 node --import ./server/node_modules/tsx/dist/loader.mjs tests/browser/race-server.ts --prediction
node scripts/multiplayer/delay-proxy.mjs 2571 2570 150
```

Start Vite on 5176 with `VITE_MULTIPLAYER_URL=http://127.0.0.1:2571`,
`VITE_ONLINE_PREDICTION=1` and all Supabase browser variables explicitly empty.
Open `/tests/browser/online-smoke.html?player=one&prediction=1` and the corresponding
`player=two` page. Create/join, ready and launch. Apply test throttle/steering to
read the software response samples; use the menu/drop controls for recovery.
Never point this synthetic fixture at the hosted service.

## Rollback

Restore the preceding Vercel deployment to return to snapshot-only controls, or
set `VITE_ONLINE_PREDICTION=0` and rebuild/promote. The backend can keep advertising
scheduling while legacy clients use mailbox controls; disable its flag during an
idle restart if needed. Preserve the existing result volume and schema. Use the
launch runbook's idle/deployment checks before restarting the one-room service.
