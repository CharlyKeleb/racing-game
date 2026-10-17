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

## Docs

- [Architecture](docs/ARCHITECTURE.md): layers, frame lifecycle, vehicle model,
  conventions and roadmap
- [Asset pipeline](docs/ASSET_PIPELINE.md): the GLB and `vehicle-config.json`
  contract for cars and tracks
- [Prepare a car with Blender MCP](docs/blender/PREPARE_CAR_WITH_BLENDER_MCP.md):
  hand this to Claude to turn the McLaren `.blend` into a game-ready GLB
