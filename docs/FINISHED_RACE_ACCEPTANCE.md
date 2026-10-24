# Local full-race acceptance

Run `npm run check:finished-race` for the default three-lap practice distance,
or `npm run check:finished-race -- 1` for a single lap. The command exports the
current simulation assets and writes `.cache/multiplayer/finished-lap.json`.
It exits unsuccessfully if either racer fails. CI runs the three-lap check after
building the staging artifact; its TypeScript is checked by `tsconfig.race.json`.

The check loads the real development race factory, stock Porsche configurations,
collision assets and racing line. Two synthetic seats acknowledge the exact
asset fingerprint and wait through the normal 180-tick countdown. AI drivers
send only analog control inputs through the ordinary rate-limited mailbox at
30 Hz; `RaceSession` advances the actual physics at 60 Hz. The server's existing
ordered swept-plane gates determine lap times and finishes. The check requires
every gate on every lap, both finished results, and lap-time sums equal to each
finish time. It rejects nonfinite positions, excessive vertical departure,
requested recovery, rejected inputs and incomplete races. It never resets or
teleports a car, supplies checkpoint positions or changes the ten-minute limit.

The [2026-10-24 three-lap receipt](measurements/finished-race-2026-10-24.json)
records 32,558 ticks including countdown, 24 gate crossings and about 15.4 km per
car. Finish times are 32,362 and 32,378 racing ticks (539.37 and 539.63 seconds),
with ranks one and two. All six lap times are positive and the race ends with
`all-finished`. The one-lap check also passed during preparation.

This is an unpaced local physics/session integration check. It opens no sockets,
uses no Auth account or result writer, and writes nothing to Supabase. It does
not establish browser controls, physical-device interoperability, real network
timing, hosted capacity, competitive track limits or persistence of a finished
real-account race. The separate real-account browser test established private
DNF saving; finished-lap browser saving remains an acceptance gate.
