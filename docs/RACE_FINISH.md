# Finish-line cinematic

The validated final checkpoint crossing still stops the player's race clock.
The engine then captures position and time and plays a 15.5-second cinematic
in real time, modelled on a modern open-world racer's finish: cuts between
shots, a handbrake slide to a stop in tyre smoke, a small result label, then
slow beauty shots of the parked car. The results card follows.

## Timeline (`src/racing/FinishSequence.ts`)

| s          | shot           | camera (`RaceFinishCamera`)                                   | car (`finishDrive`)            |
|------------|----------------|----------------------------------------------------------------|--------------------------------|
| 0–0.55     | line           | the chase camera carries on; letterbox bars slide in          | coasts                         |
| 0.55–1.6   | pass           | low roadside camera ahead, panning as the car blasts past     | brakes hard from 0.9 s         |
| 1.6–3.4    | slide          | wheel-height camera alongside, on the side the nose swings to | handbrake slide, ~95°, to a stop |
| 3.4–7.35   | stop           | still low front-quarter, slow push-in                          | parked (handbrake)             |
| 7.35–15.5  | beauty-front, beauty-rear, beauty-nose | three slow shots around the parked car | parked                     |

- The place badge with its ring swirl lands at 1.9 s; the result label
  ("FINISH TOP 3 ✓ · 1ST 2:04.051") at 3.8 s. A dip to black runs
  6.95–7.75 s, under the cut to the beauty shots.
- The slide is scripted (Game sets the body's velocity after the tyre
  forces, before the physics step), so it is the same every time. Physics
  still collides it, and the tyres smoke and squeal because the car really
  slides. It goes toward whichever side has more room, measured with rays at
  the line: a paved pit lane behind a pit wall looks like wide road.
- The pass and slide cameras stand inside that measured room (catch fences
  aren't always in the collision mesh). Every shot is checked for a wall
  between camera and car: pass and slide mirror to the other side; orbit
  shots step round the car (0, ±50°, ±100°, 180°); pulling in is the last
  resort.
- After the sequence, or a skip, the last shot keeps following the car
  behind the results.

There is no slow motion (the reference has none); `FinishSequence.timeScale`
stays 1 for GameLoop. Rivals keep their own clocks and can finish while
results are visible; they show as Racing, not DNF, until they cross.

Enter, Escape or Skip ends the cinematic. Restart and menu reset it and the
audio duck. Reduced-motion users get a 1.1-second outcome with their own
chase/cockpit view and the label straight away. Solo and drift runs have
their own label: "SOLO RUN" and "DRIFT CHALLENGE · points".

## Verification

- `npm run build`, `npm run lint`, `npm test` (`tests/raceFinish.test.tsx`
  covers the timeline, the slide, every shot keeping the car in frame and
  the camera clear of it, and the labels).
- `/src/dev/race-finish.html`, or `window.__game.debugFinishRace()` in a race,
  drives across the line. Let rivals get clear of the grid first, or the car
  lands among them.
