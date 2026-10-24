# Local browser prediction smoke — 2026-10-23

The opt-in path was exercised in two in-app browser tabs against the test-only
real-physics server on loopback. Both used synthetic racer identities, stock
Porsches and the real Nürburgring assets. Supabase variables were explicitly
empty in the frontend; no real account, production admission or history write
was involved. This is browser smoke evidence, not physical-device acceptance.

## Reproduce

After `npm run build:simulation`, start:

```sh
node --import ./server/node_modules/tsx/dist/loader.mjs tests/browser/race-server.ts --prediction
```

In another terminal, run the fixture frontend with all cloud variables empty:

```sh
VITE_MULTIPLAYER_URL=http://127.0.0.1:2569 VITE_ONLINE_PREDICTION=1 \
VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= NEXT_PUBLIC_SUPABASE_URL= \
NEXT_PUBLIC_SUPABASE_ANON_KEY= NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= \
npm exec vite -- --host 127.0.0.1 --port 5174 --strictPort
```

Open `/tests/browser/online-smoke.html?player=one&prediction=1` and the same
fixture with `player=two`. Use Create test lobby / Join test lobby, open the
Online lobby panel, ready both and launch. The optional fixture overlay reads
development-only engine diagnostics without stepping physics. It shows enabled,
ready/disabled, exact predicted tick, lead, subscription state and rendered
position. Apply/Release test throttle uses the existing development input command.
It is not in the production entrypoint or player HUD.

## Observations

Both clients reached `enabled:true, ready:true, disabled:false, leadTicks:6` with
an open correction stream after the synchronized countdown. Applying local
throttle drove the own car; the rendered HUD reached 114 km/h in the inspected
view while prediction remained ready. The remote car and shared race timing
remained visible. Opening the race menu showed controls released and diagnostics
`ready:false, streamOpen:false`; returning reopened the stream and prediction.

The first drop exposed a lifecycle bug: RTT is deliberately cleared during
reconnect, but the scene treated that missing sample as infinite measured RTT
and disabled prediction for the race. The fix checks connection/sample availability
before evaluating the lead budget. A new unit regression checks disconnected,
connected-without-sample, fresh sample/base, and an actual over-budget RTT.

After reloading both fixtures with the fix, the second race showed ready
prediction before the drop. During the injected drop, the reconnect HUD appeared
and diagnostics read `ready:false, disabled:false, streamOpen:false`. After the
synthetic fresh-auth handshake and RTT sample, the same race resumed
`ready:true, disabled:false, streamOpen:true`; server race time continued.
Both racers then left through the menu and the owned test servers were stopped.

Evidence was saved locally as `.cache/multiplayer/prediction-driving-smoke.png`
and `.cache/multiplayer/prediction-recovered-smoke.png`; the
[observation record](measurements/browser-prediction-2026-10-23.json) pins the
fixture/engine source hashes. The final full suite passes 3,270 tests across 507
suites, including the reconnect regression. The first run also
returned to the lobby with the explicit server-behind abort during development
work. Its underlying scheduling cause was not isolated; do not treat it as a
successful uninterrupted load/capacity run.

Remaining acceptance includes real accounts and saved history, two physical
devices, shaped 30/100/200 ms networks, Safari/iOS/Android as available,
long-session memory/frame-time/GC, actual container/hosted headroom and recovery
under real packet transport failures. This smoke does not establish those gates.
