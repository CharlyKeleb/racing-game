# Racing Game multiplayer

Private Colyseus lobby backend, prepared for a single Fly.io machine.
See [the multiplayer setup and deployment guide](../docs/MULTIPLAYER.md).

- `npm ci` — install this server's locked dependencies
- `npm run dev` — local watch mode with `.env.local`
- `npm run build` / `npm start` — compile / run production server

The production entrypoint remains lobby-only. The optional
[local race transport](../docs/RACE_TRANSPORT.md) injects shared physics from the
repository root; browser networked racing and verified results remain pending.
