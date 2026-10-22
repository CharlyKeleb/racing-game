# Driving feedback

This pass changes presentation, not vehicle forces, tyre grip or suspension
physics. Camera, sound and body response use the same driving/contact signals.

## Camera and body

The chase camera widens smoothly from 35 to 260 km/h, adds up to 65 cm of
speed pull-back, and retains the existing acceleration surge, corner bank and
nitro kick. Continuous speed/nitro shake is reduced; suspension travel activity
adds a small road vibration. Contacts add a bounded spring impulse that settles
rather than sustaining random shake. Cockpit impulses are attenuated. Respawn,
camera snap and showroom framing clear the contact springs.

Body pitch/roll use better-damped springs, with bounded substeps for frame
hitches. The wheels still follow the actual interpolated suspension. Signed
mean compression speed adds a small, spring-filtered body heave (target capped
at -3.5/+2.5 cm). Spawn settling is excluded. Presentation freezes with dt=0;
none of this moves the Rapier body or changes the collider.

## Sound

`ImpactPCM` generates original procedural one-shots: body resonance, a dry
transient and irregular short crunch contacts. It replaces the pitch-dropping
sine, long panel ring, glass ticks and strong waveshaper saturation. Car, wall,
landing and kerb strikes have different envelopes and spectra. Three intensity
tiers and three variants per kind are cached once per audio context, including
for rivals. At playback, severity scales gain with slight pitch variation.

Only the strongest chassis contact in an audio frame plays. Short retrigger
suppression and a six-voice limit prevent contact chatter; a kerb cannot suppress
a subsequent crash. Finished voices and all nodes owned by the new layers are
disconnected. Wall scraping is quieter. Crash ducking is shorter and peaks at
about 8 dB instead of 14 dB, and rejected hits do not retrigger the duck.

`DrivingSound` adds a filtered wind/rolling bed below the engine. Speed builds
the wind; wheel contact, surface pavement share and suspension activity shape
rolling noise. The cockpit is quieter and more muffled. Airborne wheels stop
the rolling layer; stopped cars have no rolling/wind bed. The layers use the
existing car/master mixer, volume and audio-context pause/resume lifecycle, and
are gated out of menus/countdowns. No downloaded or third-party sounds are used.

## Verification and audition

- `npm run build`, `npm run lint`, `npm test`.
- `/src/dev/driving-audio.html` plays the live collision sequence and checks the
  actual impact and driving classes through the master limiter offline. This
  is a headroom/signal check, not a listening judgment about the full engine mix.
- `node --experimental-strip-types scripts/audio/preview-impacts.mjs /tmp/impacts.wav`
  generates an audition WAV: light/medium/heavy wall, car, landing, kerb.
- Drive from low to high speed, brake/accelerate, cross a kerb and hit a barrier.
  Compare chase/cockpit, pause, reset and returning to the menu. Headphone,
  speaker and controller/device acceptance still benefits from listening and
  driving on the intended hardware.
