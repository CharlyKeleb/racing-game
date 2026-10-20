# Finish-line cinematic

The validated final checkpoint crossing still stops the player's race clock.
The engine then captures position/time and starts a 4.2-second presentation
clock. The race HUD yields to a chequered flag, outcome, placement and final
time; a short original musical sting plays while the car/road audio ducks.
The results card appears beside the car after the sequence.

The camera samples the exact position, view direction, roll and FOV at the
crossing. It follows the actual car through one continuous, eased move into a
low rear-quarter view. There are no shot/lens cuts. The car coasts first, then
brakes gently; final stop uses the handbrake instead of rolling into reverse.
Cockpit views stay inside the car rather than flying through the bodywork.
Static-obstruction raycasts limit exterior camera travel.

Slow motion eases in over 0.4 real seconds and returns smoothly to normal speed
by the results reveal. GameLoop scales only the time added to its accumulator:
Rapier, AI and race timers still advance in fixed 1/60 s ticks. The finish
presentation advances with unscaled render time. Player time is already stopped;
rivals keep their own clocks and can finish while results are visible. They
are shown as Racing, not DNF, until they cross.

Enter, Escape or View results skips the presentation and restores normal speed.
Restart/menu reset the presentation and audio duck. Hiding the tab stops the
loop without advancing the cinematic. Reduced-motion users get a 1.1-second
outcome reveal with their existing chase/cockpit view and normal simulation speed.
CSS reveals also respect reduced motion. Solo and drift runs have their own
copy; a solo run is not labelled a race victory.

## Verification

- `npm run build`, `npm run lint`, `npm test`.
- `/src/dev/race-finish.html` uses ephemeral procedural-track settings. Start a
  race, skip the intro, then use Cross finish (dev) to prime ordered checkpoint
  traversal and physically drive across the final gate. This exercises the
  production crossing and finish path; it is not a full driven lap. The helper
  is development-only. The fixture does not persist its settings overrides.
- Check natural completion, skip, restart, menu, reduced motion, cockpit and
  both renderer backends. Camera tests assert exact continuity at time zero
  and bounded position/orientation/FOV changes across the full move.
