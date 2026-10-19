# Arcade handling: source review and implementation map

Reviewed 19 October 2026. Target: forgiving keyboard-led street racing with useful
cornering at speed, predictable countersteer, recoverable slides and explicit drift
entry. The arcade controller is now implemented from these concepts; the initial tune
has not been validated by driving. No tests, builds or gameplay validation were run.
No external implementation code has been copied into the game.

## References actually inspected

### Godot Easy Vehicle Physics — primary car-controller reference

Pinned commit: `c392257f54f6ca537dc10bc5badad0c060f18982`.

- [vehicle.gd](https://github.com/DAShoe1/Godot-Easy-Vehicle-Physics/blob/c392257f54f6ca537dc10bc5badad0c060f18982/addons/gevp/scripts/vehicle.gd#L657):
  process_steering smooths digital input, returns/countersteers faster, gates excess
  steering using measured wheel slip, shapes the steering response with an
  exponent, and adds a velocity-direction countersteer correction. It also slows
  steering with speed. Therefore copying this function alone would not establish
  the desired arcade cornering envelope.
- [wheel.gd](https://github.com/DAShoe1/Godot-Easy-Vehicle-Physics/blob/c392257f54f6ca537dc10bc5badad0c060f18982/addons/gevp/scripts/wheel.gd#L260):
  a modified brush model deliberately removes force falloff past peak grip. It
  adds lateral-slip grip assistance and extra braking grip, then limits forces
  to avoid reversing contact-patch motion in one tick. These are useful arcade
  design choices; the equations need adaptation to our tire-force units.
- [arcade_car.tscn](https://github.com/DAShoe1/Godot-Easy-Vehicle-Physics/blob/c392257f54f6ca537dc10bc5badad0c060f18982/addons/gevp/scenes/arcade_car.tscn#L346):
  arcade tuning increases grounded stability multiplier to 6 (script default 2),
  sets braking grip multiplier to 2, enables variable torque split, lowers the
  centre-of-gravity offset and specifies front/rear damping ratios of 0.6.
  Those raw numbers are not transferable to our larger cars and Rapier setup.
- vehicle.gd process_stability applies torque in response to body slip and yaw;
  wheel.gd uses collision normals for spring-force direction. Its grounded and
  airborne assistance are separate, a useful boundary for our implementation.
- [License](https://github.com/DAShoe1/Godot-Easy-Vehicle-Physics/blob/c392257f54f6ca537dc10bc5badad0c060f18982/addons/gevp/LICENSE):
  MIT; lists David Shoemaker, Dechode and Baron Wittman. Source also identifies
  portions originating with Dechode. Preserve the relevant notices in any port.
  The README recommends at least 120Hz; our implementation must remain designed
  for the existing 60Hz fixed timestep rather than copying timestep-sensitive gains.

### SuperTuxKart — arcade turning-envelope reference

Pinned commit: `2997f192e6876047909d909498dbb4810e5dbb8d`.

- [Kart::getMaxSteerAngle](https://github.com/supertuxkart/stk-code/blob/2997f192e6876047909d909498dbb4810e5dbb8d/src/karts/kart.cpp#L912):
  obtains steering from an authored speed-to-turn-radius interpolation, accounting
  for wheelbase. It does not simply remove all speed sensitivity. This is useful
  for designing turning ability around track/gameplay needs.
- [PlayerController::steer](https://github.com/supertuxkart/stk-code/blob/2997f192e6876047909d909498dbb4810e5dbb8d/src/karts/controller/player_controller.cpp#L280):
  separate full-steer and reset-steer times for digital controls. Our keyboard
  response patch already follows this general pattern, but leaves the restrictive
  turning envelope and tire limits unchanged.
- data/stk_config.xml explicitly uses very high Bullet friction-slip settings to
  suppress Bullet skidding. This shows intentional arcade grip; do not copy that
  number into our unrelated custom tire coefficient.
- Code is GPL-3.0-or-later. Use as a design reference for this proposal; no STK
  code or assets are included in the project.

### Trigger Rally — secondary steering-feedback reference

Pinned commit: `079ac53216b74598b652ce3bf11478beb5c6832b`.

- [vehicle.js](https://github.com/CodeArtemis/TriggerRally/blob/079ac53216b74598b652ce3bf11478beb5c6832b/server/public/scripts/game/vehicle.js#L602):
  wheel steering behaves as a damped response to desired position, with rate
  limiting and feedback from lateral tire force. It is a useful reference for
  responsive steering that settles rather than oscillates.
- It contains a separate wing/aerial controller as well as car handling. Its
  speed-dependent flight torques are not road-car steering assists.
- Source is GPLv3; its separate content license restricts redistribution of game
  assets. This proposal includes neither its code nor assets.

## What to retain from our game

Keep Three.js rendering, Rapier chassis/collisions, raycast suspension, the 60Hz
fixed loop, interpolation, track surfaces, drivetrain, input merging and camera.
There is no need to migrate engines or import complete Godot/Bullet controllers.
Adapt the coordinate signs (Godot car forward is -Z; ours is +Z) and force units:
Godot applies continuous forces/torques, whereas our Rapier controller mostly
applies impulses, so force-derived assistance must be multiplied by fixed dt.
Keep the keyboard-response patch as the input layer, while changing the actual
handling model underneath it. A controller should get the same arcade turning
ability even though analog input smoothing differs.

## Concrete implementation order

1. **One arcade turning envelope.** Add an explicit arcade profile in vehicle
   config with an authored speed-to-turn-radius curve. Replace the current
   combination of inverse-speed lock and grip-derived angular cap for this mode.
   Derive a shared requested yaw/curvature from input and speed. Player steering,
   AI input normalization and stability assistance must use that same envelope.
   Increasing wheel angle while leaving the old yaw cap intact will still fight
   the driver's cornering request.
2. **Arcade lateral grip and recovery.** Add a broad saturated lateral-force curve
   with a controllable post-peak plateau, plus bounded surface-aware slip recovery.
   Separate longitudinal and lateral grip tuning. Preserve force/impulse limits
   that prevent one-tick velocity reversal. This addresses actual path curvature,
   not merely the visible angle of the wheels.
3. **Grounded cornering/yaw assist.** Apply bounded yaw torque and lateral support
   toward the shared arcade target. Blend by grounded wheel contact and surface;
   reduce on grass/gravel, while airborne, after impacts and during explicit drift.
   Account for the tire force already supplied instead of adding a second complete
   cornering model. Replace/reconcile the existing yaw stability target so the two
   assists cannot pull in opposing directions. Use the road plane for support.
4. **Deliberate drift transition.** Normal cornering should keep arcade grip.
   Handbrake initiates a separate controllable slide with its own grip/assist
   blend. Existing guided drift must not also carve a competing trajectory while
   the new cornering assist is active. Drift Challenge can keep a stronger, explicit
   drift preset; normal keyboard brake taps should remain ordinary braking.
5. **Steering polish and secondary systems.** Borrow measured-slip feedback and
   countersteer ideas from Godot, with authority fading as the driver commands
   full lock. Then address contact normals, landing damping, brake assistance,
   differential/wheelspin detail and camera feedback as separate changes.

Initial curve/gain values will be an unvalidated tune until the user drives them.
Do not present this as a Forza/Motorfest physics port, use their undisclosed
parameters, or claim that a full-speed hairpin is guaranteed. The goal is a
forgiving response with enough authority to take the game's corners at arcade
speeds, rather than forcing simulator-style braking for ordinary bends.

## Owning files

- `src/vehicles/VehicleConfig.ts`: explicit profile, radius curve, grip/recovery
  strengths and assist limits; per-car JSON overrides.
- `src/vehicles/SteeringLimit.ts`: shared player/AI arcade steering envelope.
- `src/vehicles/TirePhysics.ts`: lateral plateau, combined grip and recovery limits.
- `src/vehicles/VehicleController.ts`: grounded assistance, unified yaw target,
  contact-plane mapping and mutually consistent drift blending.
- `src/vehicles/KeyboardSteering.ts`: input response only, not a fix for limited
  physical turning ability.
- `src/vehicles/Drift.ts`: explicit drift ownership/transition boundaries.
- `src/racing/AiDriver.ts`: use the shared envelope when normalizing requests;
  review corner speed planning when the new arcade envelope is introduced.

## Implemented behavior

`ArcadeHandling.ts` provides an authored speed/radius curve shared by player and
AI steering. `VehicleConfig.ts` enables it by default, with per-car overrides and
an `arcade.enabled = false` legacy opt-out. The initial radius is 22 m at 100 km/h
and 40 m at 160 km/h, subject to a 5.5 g ceiling and reduced surface traction.

`TirePhysics.ts` gives normal cornering a wider lateral friction ellipse and a
post-peak plateau without multiplying longitudinal acceleration or braking grip.
`VehicleController.ts` uses current supporting contact normals for bounded yaw
and lateral assistance, subtracting forces already delivered by the tires. It
requires at least three supporting wheels and forward travel, and fades with
drift amount; the handbrake disables it. Existing guided drifting remains separate.
AI shares the steering envelope and retains its conservative speed planner.

No tests, build, or gameplay checks were run, as requested. Refresh the local
development server to manually assess the initial tune.
