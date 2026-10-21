# Alex & Camille commentary

## Installed voice packs

Both narrators have 14 MP3 clips: introduction, welcome, countdown, start, overtake, lead, lostLead, finalLap, finish, quickTip, timeTrial, drift, freeRoam, and raceComplete.

Alex Carter is an American man. Camille Laurent is an English woman. Her installed portrait is Confident Pit Crew Portrait.png; her latest recording uses the ElevenLabs voice Mariva Viva Muse — Warm and Energetic. Camille has her own script for every event. Spoken captions live in `src/audio/narration.ts` and match the voice selected for that line.

The local recording manifests preserve source filenames, SHA-256 hashes, cut boundaries and automatic transcripts: `alex-recording.json`, `alex-finish-recording.json`, and `camille-recording.json`. Automatic transcription can miss punctuation or confuse homophones. Cut points were chosen inside pauses and checked against source-word timestamps.

Alex's original clips use +6 dB gain and Camille's +2 dB, with a 0.89 peak limiter. Camille's source was already louder. The original Downloads files are unchanged. Assets live in `src/assets/narrators/alex/` and `src/assets/narrators/camille/`; filenames match the event IDs exactly.

## Duo behavior

Settings → Audio → Commentary defaults to Alex & Camille. Earlier enabled single-narrator preferences migrate to duo once; Off remains Off. After this migration, Alex only and Camille only remain selectable and persist normally.

For each event, a director randomly selects a commentator with an installed recording. Either voice can handle any event. It permits occasional repeats but prevents more than two consecutive lines from one commentator when both clips exist. If only one recording exists, that voice handles the event. It selects once per event: caption updates never change the voice mid-line.

Each line keeps its chosen speaker, portrait, audio and wording together. One narrator audio element plays at a time; higher-priority race events can replace current commentary. These are recorded event reactions, not generated back-and-forth dialogue. Settings includes a single preview player with Alex/Camille selection in duo mode.

Game audio drops to 8% while audible narrator speech plays, then returns smoothly. Muted, missing, failed, paused or cancelled speech releases the ducking. Narrator volume respects master volume.

## Event timing and subtitles

Welcome plays during the race intro; countdown and start have their own cues. Time Trial, Drift and Free Roam get their own mode introduction. Quick Race has one driving tip after eight seconds unless race commentary takes precedence.

Race events use the existing sustained-position rules, priority and cooldowns. Finish commentary begins 3.8 seconds into the cinematic, after the result badge. Photo finishes use `finish.mp3`; other finishes use `raceComplete.mp3`. Both now have recordings for both voices. Skipping the cinematic or reaching results cancels the line.

Typing follows character progress against audio playback duration; it is approximate rather than word alignment. Reduced-motion mode displays complete subtitles immediately. The cinematic intro uses a lower-left card to avoid its title; racing uses a separate panel under the top-left HUD. Text uses the bold condensed racing font.

## Re-recording

Use the saved voice for the intended commentator. Generate the same event meanings using that speaker's wording from `src/audio/narration.ts`. Keep the source script and recording order together when exporting one combined MP3. Record introductions separately from short race events when practical. Bracketed performance cues are for generation and are never included in game captions.

ElevenLabs guidance: [speech prompting](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices), [Voice Design](https://elevenlabs.io/docs/eleven-creative/voices/voice-design/).
