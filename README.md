# Racing Game

A browser racing game: a McLaren on a beautiful circuit with arcade-style
driving physics. It aims to look like Need for Speed and run at 60 FPS in the
browser.

**Stack:** TypeScript · Vite · vanilla Three.js · Rapier 3D · React (menus/HUD
only) · Zustand · postprocessing · Web Audio/Howler

## Run

```bash
npm install
```

```bash
npm run dev
```

| Key | Action |
| --- | --- |
| W / ↑ | Throttle |
| S / ↓ | Brake. Hold at standstill to reverse |
| A D / ← → | Steer |
| Space | Handbrake |
| C | Chase / cockpit camera |
| Hold B | Look back; release to restore your camera |
| R | Reset car |
| Esc / P | Pause |

Keyboard steering builds progressively, with a quicker return through centre when
changing direction. In normal races, a short brake tap while turning no longer
activates guided drift on keyboard; use Space for a deliberate drift entry.

On phones and tablets, on-screen touch controls appear: drag to steer on the
left; Gas, Brake, N₂O and Drift are on the right.

Gamepads are supported: RT throttle, LT brake, left stick steer, A handbrake,
X or RB nitro, Y camera, B reset, Back restart, D-pad up/down to shift and
Start pause/resume. Hold the right stick button (R3) to look back. PlayStation
equivalents are R2/L2, left stick, Cross, Square or R1, Triangle, Circle, Share
and Options. Use the D-pad or left stick to move through menus, A/Cross to
select, and B/Circle to go back. Connect by USB or Bluetooth and press a button
while the game is focused; Settings → Controller shows connection status, a
live input test and every binding. Requires a controller exposed by the
browser with the standard Gamepad API mapping.
On touch devices, hold **Rear** above the Drift button; releasing restores your view.

Until `public/models/cars/mclaren/mclaren.glb` exists, the game drives a
placeholder car with the same node names and physics.

## Scripts

| | |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Typecheck and production build |
| `npm test` | Vitest (physics, race rules, loop) |
| `npm run lint` | oxlint |
| `npm run build:track` | Rebuild the streamed Nürburgring package from the source GLB |
| `npm run derive:track` | Re-trace the centreline and surface map from the shipped chunks (no source GLB needed) |
| `npm run build:car-lod` | Rebuild the low-poly Porsche for the Low preset |

## Docs

- [Architecture](docs/ARCHITECTURE.md): layers, frame lifecycle, vehicle model,
  conventions and roadmap
- [AI racers](docs/AI_RACERS.md): difficulty, rival personalities, drafting,
  overtaking, nitro strategy and race awareness
- [Asset pipeline](docs/ASSET_PIPELINE.md): the GLB and `vehicle-config.json`
  contract for cars and tracks
- [Track streaming](docs/TRACK_STREAMING.md): the Nürburgring pipeline,
  streaming runtime and mobile performance budgets
- [Prepare a car with Blender MCP](docs/blender/PREPARE_CAR_WITH_BLENDER_MCP.md):
  hand this to Claude to turn the McLaren `.blend` into a game-ready GLB

Track selection images: see [Adding and updating race previews](docs/TRACK_PREVIEWS.md).

## Drift Challenge

Select **Drift Challenge** in the main menu to load **Drift Park**, built from
`~/Downloads/drift_race_track_free.glb`. Choose Flow State (one lap), Speed Session (one lap with a 65 km/h scoring
minimum), or Marathon (two laps). Each has no time limit
and no opponents. Follow the route and pass every gate before crossing the
finish line. Flow State’s bronze, silver and gold targets are 2,000, 5,000 and 9,000 points;
personal bests are saved separately for each track and event. Drift setup retains
the event selector and time-of-day controls.

Build speed, turn and tap **Space** (or the touch Drift button) to start a slide.
Link slides within 2.5 seconds to keep the chain alive; sustained slides build
up to 5×. Straighten up to bank. Wall impacts, spins, sustained off-track driving
and resets lose the active chain. Cyan clipping zones boost scoring by 1.75×;
clean transitions add 250 base points. Forward slides on asphalt or kerbs need
the event’s minimum speed, three grounded wheels and 12° of angle to score. Crossing the
finish banks the final chain. Results show medals, best chain, longest drift,
clean transitions and broken chains.

The park uses the existing streamed-track loader, with two geometry/texture
quality tiers, road and guardrail collision, a surface map and a captured aerial.
Rebuild it from the source download with:

```bash
node scripts/track/build-track.mjs scripts/track/drift-park.config.mjs
node scripts/track/derive-from-chunks.mjs scripts/track/drift-park.config.mjs
```

Set `DRIFT_TRACK_SOURCE` to use a different path to the same GLB.

Normal driving uses arcade cornering assistance by default, including stronger steering at speed and sustained lateral grip. Handbrake drifting fades out this assistance. Per-car `arcade` tuning is merged over `DEFAULT_VEHICLE_CONFIG`; set `arcade.enabled` to `false` for the legacy handling.
