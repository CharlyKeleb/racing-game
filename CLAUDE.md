# CLAUDE.md

Browser racing game. Read `docs/ARCHITECTURE.md` before structural changes.

## Rules
- `src/engine`, `src/vehicles`, `src/world`, `src/racing`, `src/camera`, `src/input`,
  `src/audio` and `src/effects` must **never import React**. React (`src/ui`, `App.tsx`)
  talks to the engine through `Game` command methods. It reads state only from
  `src/stores` (Zustand *vanilla* stores).
- Keep `TirePhysics`, `Suspension`, `Drivetrain`, `LapTimer` and `CheckpointManager`
  pure (numbers in, numbers out). They're unit tested and will be shared with a
  multiplayer server.
- Gameplay runs in `fixedUpdate` (60 Hz fixed). Visuals and camera run in `render(alpha)`.
- No allocation in per-tick hot paths. Reuse scratch vectors as in `VehicleController`.
- Coordinates are glTF: meters, +Y up, +Z forward, +X left.
- Car and track assets follow `docs/ASSET_PIPELINE.md`. Tune handling in
  `vehicle-config.json` / `DEFAULT_VEHICLE_CONFIG`, not in code.
- Tracks: never ship a source GLB. Run it through `scripts/track/build-track.mjs`
  (see `docs/TRACK_STREAMING.md`). Keep the Low preset at ≲150 draw calls and
  ≲200k triangles per frame, car included (`window.__game.debugStep()` in dev).

## Verify
- `npm run build` (includes `tsc -b`), `npm test`, `npm run lint`
- Drive it: `npm run dev`, Start race, then check speed and gear in the HUD. Key
  events can be dispatched on `window` (`KeyboardEvent` with `code`). The tab must
  be visible, or rAF stalls.

## Workflow
- Branch + PR per change. Don't push to `main` directly once the initial scaffold has landed.
