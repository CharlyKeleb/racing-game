# AI racers

Quick Race supports Solo, Duel or a four-car grid in Race setup. The player
starts at the back so the opponents are visible ahead. Three named rivals have different pace settings and cyan,
yellow and red map markers. They use a mixed selection of the other garage
models, each with its stock physical configuration and cached low-detail asset. They collide
with the player, each other and the track normally.

## Ownership

Read `ARCHITECTURE.md` first. `Game` owns loading, grid creation, fixed-step
ordering, disposal and publishing standings at 20 Hz. React only sends commands
and reads vanilla stores. No React imports belong in racing, audio or vehicles.

- `racing/AiDriver.ts`: pure numeric line/speed planning and reusable `InputState`.
  The ~4 m track centreline is the base racing line. A pure-pursuit steering
  feed-forward plus bounded PID trim accounts for the same steering falloff as
  `VehicleController`. Curvature sets corner speeds; backward braking passes
  cross the closed route seam. Drivers look ahead with speed, smoothly offset
  within measured road edges to pass traffic, and brake for a nearby slower car.
- `racing/Opponent.ts`: adapts the driver to a real `Vehicle` and `RaceManager`.
  Inputs are applied before the shared Rapier step; transforms and checkpoint
  timing are captured afterward. Poses are sampled for the entire field before
  any driver decides, avoiding order-dependent traffic decisions.
- `racing/RaceStandings.ts`: pure checkpoint-validated sector progress. Finish
  times rank ahead of running cars; ties break by stable racer ID. The grid
  behind gate zero cannot be counted as nearly a lap ahead. Continuous segment
  projection updates close overtakes between sampled points. Nearest line index
  alone cannot award a skipped sector.
- `audio/OpponentAudio.ts`: a lightweight engine graph per rival with 3D distance
  attenuation and stereo positioning relative to the active camera, including
  cinematic height, orientation and roll. Shares a decoded recording cache by audio
  URL, with each rival using its own model's engine bank and firing rate. Uses a
  synth while recordings are unavailable.

AI uses the same suspension, tires, brakes, gearbox, collisions and input path
as the player. Catch-up changes requested speed by at most 6%; it never changes
mass, grip, forces or position.

## Racecraft and difficulty

`racing/AiProfiles.ts` defines the three rivals and saved difficulty presets:

- Raven is a precision/grip driver with conservative braking and clean turns.
- Torque sacrifices some corner speed for straight-line pace and longer boosts.
- Viper takes more cornering risk and can use a brief handbrake rotation on a
  clear, medium-speed bend, using the same drift system as the player.

There are three difficulties: Legend (the default), Mythic and Impossible.
Each plans corners and braking at 95–98% of the car's tire grip, with no pace
variation. Personality, pace and catch-up still modify the plan. The raw braking
plan is capped by available brake force after the personality’s braking modifier.

Every tier also gives rivals' cars an edge over stock (`RIVAL_EDGE`: more
torque, grip and brakes), makes every rival a front-runner and never eases off
when ahead. Legend is +14% torque, +5% grip and +12% brakes. Mythic is
+24%/+8%/+18%, with harder catch-up. Impossible is +36%/+12%/+25%, with the
strongest catch-up and quickest reactions. Race pay is 2×, 2.6× and 3.5× the
base rate in `Economy.ts`.
Difficulty is chosen in Race setup and applied when the next field is created.

`racing/Overtaking.ts` owns follow/draft/pass/yield decisions. It holds a target
and passing side, checks road width and occupied corridors (including fast
approaching cars), and abandons an unsafe attempt by holding its current lane
and yielding. A driver can retry once space is available, rather than flipping
left/right every tick. It returns to the racing line after clearing its target.

`racing/Drafting.ts` supplies one shared numeric rule for all racers. Following
an aligned, moving car at 9–40 m within a 1.8 m lateral corridor builds nitro at
up to 10% tank/second. Parked, oncoming, distant or dangerously close cars do not
qualify. Nitro still requires speed and grounded tires; drafting cannot refill
an active burn. Existing tire-work, drift and airtime rewards remain intact.

AI spends earned charge on a clear overtake or corner exit; Torque can also
attack a clear straight. Boost decisions check braking, steering, traffic and
the next 1.5 seconds of road. No AI gets a free tank or unlimited boost. Exhaust
flames make rival boost use visible. Boosts, drift entries and passing state
all reset on recovery; retry creates fresh rivals.

## Race awareness

The leaderboard shows ordered racer names and **metres behind the leader**,
with a lap indicator for large gaps. Once racers finish, it can show their actual
finish-time differences. Metre gaps use validated sectors and route length,
not straight-line world distance or an invented time estimate.

Nameplates use camera projection, a 100 m distance limit and static-world
occlusion rays. Off-screen, obstructed and overlapping labels are hidden; HUD
areas are kept clear. Position, name and driving speciality are published through
the telemetry store at 20 Hz. The slipstream cue uses the same drafting value
that actually earns the player's nitro.

## Race opening and starting grid

`racing/StartingGrid.ts` samples staggered slots backward along the real route
from the authored pole spawn. The player takes the last slot. Slots are 6 m
apart longitudinally, alternate sides, respect measured road width, and use road
height queries for camber. Solo stays centred. No car starts beyond the pole
spawn or earns checkpoint progress from its grid position.

`camera/RaceIntroCamera.ts` runs a 4.8-second, three-shot sequence: an elevated
field reveal, a low player-car hero shot, and a move to the countdown view. Static
obstruction rays keep the camera out of track walls. `ui/RaceIntro.tsx` shows the
track, car and starting roster with letterboxing in the existing visual style.
This is our adaptation of pre-race presentation, not a replica of NFS camera code.

Enter, gamepad A or **Skip intro** advances the entire field to a fresh 3-second
countdown. Intro and countdown use fixed simulation time: all cars remain locked,
no lap time is recorded, and pause freezes both. Retry starts a fresh sequence.
The raised countdown camera frames opponents ahead and blends back to the normal
chase view over the first 1.5 seconds of racing. A selected cockpit view returns
at GO instead. Menus, track changes and disposal clear the field as usual.

Research references: [NFS Heat race and starting-line screenshots](https://www.mobygames.com/game/136553/nfs-heat/screenshots/)
and [EA's Unbound starting-grid and perfect-start notes](https://www.ea.com/security/news/vol7-1-0-patch-notes).

## Lifecycle and recovery

The field is built before the shared countdown. Pause freezes the simulation and
race clock. Retry rebuilds rivals and clears their progress. Returning to the
menu, changing track and disposing the game remove all rival bodies, scene
objects, owned materials and audio nodes. Shared GLTF geometry/textures stay in
the asset cache. Distant rivals are hidden beyond 300 m but keep simulating.

A stuck driver first attempts a short reverse manoeuvre. Sustained blockage or
leaving the course requests a return to the last validated checkpoint. A reset
waits until no other racer is within 8 m of its destination. Recovery awards no
sector or lap progress. Kill-floor failures use the same recovery path.

The race ends when the player finishes: the field and final standings freeze.
Unfinished rivals are marked DNF; there are no estimated finish times.

## Verification and tuning

Run `npm test`, `npm run build`, and `npm run lint`. Use `npm run test:ai`
to print each driver’s car, difficulty, two checkpoint-validated lap times and
actual recovery count. All fields must finish both laps with zero respawns.
The mixed-field presets exercise the same parked obstruction and starting grid.
AI tests include a complete
Papaya lap and three-car fields driving two Nürburgring laps for every selectable
handling configuration against the shipped collision mesh, including mixed
models, all three difficulties, the intro timing, the new starting slots and a
parked obstruction ahead of the grid. The checks require
complete laps, earned boost use, Viper drift entries and no recovery resets.
These use actual vehicle physics and ordered checkpoint timing.
Only procedural canvas textures are stubbed in the headless test. AI steering
normalisation uses `vehicles/SteeringLimit.ts`, the same grip-based envelope as
the player controller, so changing the steering cap does not silently change
what a partial AI steering input means.

Then drive both tracks: leave the grid stationary to check overtaking, race
beside rivals, brake in front of one, pause/resume, reset, retry and return to the
garage. Check position, map colours, final standings and nearby engine sound.

This is a circuit-racing foundation, not a claim of commercial NFS parity.
Authored apex lines, defensive positioning, rival tyre effects and long-term
rival progression remain future extensions. Keep numeric
planning separate from scene/physics adapters when adding them.
