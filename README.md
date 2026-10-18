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
| R | Reset car |
| Esc / P | Pause |

On phones and tablets, on-screen touch controls appear: drag to steer on the
left; Gas, Brake, N₂O and Drift are on the right.

Gamepads are supported: RT throttle, LT brake, left stick steer, A handbrake,
Y camera, B reset and Start pause.

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
`~/Downloads/drift_race_track_free.glb`. A run lasts two minutes and has no
opponents. Build speed, turn and tap **Space** (or the touch Drift button) to
start a slide. Link slides within 1.5 seconds to keep the chain alive; sustained
slides build a multiplier up to 5×. Straighten up to bank points. Resetting loses
the current chain, and the final chain is banked when time expires. Only grounded
slides on asphalt or kerbs score. Pausing freezes the clock.

The park uses the existing streamed-track loader, with two geometry/texture
quality tiers, road and guardrail collision, a surface map and a captured aerial.
Rebuild it from the source download with:

```bash
node scripts/track/build-track.mjs scripts/track/drift-park.config.mjs
node scripts/track/derive-from-chunks.mjs scripts/track/drift-park.config.mjs
```

Set `DRIFT_TRACK_SOURCE` to use a different path to the same GLB.
