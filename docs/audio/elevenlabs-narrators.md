# Alex & Camille commentary

## Installed voice packs

Both narrators have 14 base MP3 clips: introduction, welcome, countdown, start, overtake, lead, lostLead, finalLap, finish, quickTip, timeTrial, drift, freeRoam, and raceComplete.

Alex Carter is an American man. Camille Laurent is an English woman. Her installed portrait is Confident Pit Crew Portrait.png; her latest recording uses the ElevenLabs voice Mariva Viva Muse — Warm and Energetic. Camille has her own script for every event. Spoken captions live in `src/audio/narration.ts` and match the voice selected for that line.

The local recording manifests preserve source filenames, SHA-256 hashes, cut boundaries and automatic transcripts: `alex-recording.json`, `alex-finish-recording.json`, and `camille-recording.json`. Automatic transcription can miss punctuation or confuse homophones. Cut points were chosen inside pauses and checked against source-word timestamps.

Alex's original clips use +6 dB gain and Camille's +2 dB, with a 0.89 peak limiter. Camille's source was already louder. The original Downloads files are unchanged. Assets live in `src/assets/narrators/alex/` and `src/assets/narrators/camille/`; filenames match the event IDs exactly.

## Duo behavior

Settings → Audio → Commentary defaults to Alex & Camille. Earlier enabled single-narrator preferences migrate to duo once; Off remains Off. After this migration, Alex only and Camille only remain selectable and persist normally.

For each event, a director randomly selects a commentator with an installed recording. Either voice can handle any event. It permits occasional repeats but prevents more than two consecutive lines from one commentator when both clips exist. If only one recording exists, that voice handles the event. It selects once per event: caption updates never change the voice mid-line.

Each line keeps its chosen speaker, portrait, audio and wording together. One narrator audio element plays at a time. Ordinary events wait for playback and subtitle completion, followed by an 850 ms gap; ordinary starts are at least six seconds apart. Major events (lead changes, final lap and finish) can interrupt lower-priority lines. Opposite lead changes replace contradictory active lead commentary. Pending lines expire after four seconds, and newer position cues replace obsolete queued position calls. Timed countdown/start cues remain immediate. Occasional recorded exchanges are available for overtakes, taking the lead and normal finishes. They play Alex’s turn then Camille’s reply with a 350 ms handoff, and switch portrait and subtitle for the reply. Solo-only modes never use exchanges. The first eligible exchange in each race is guaranteed. Once Camille’s reply actually begins playing, later exchanges use a 24% chance and 45-second cooldown, avoiding a third consecutive Alex turn. If an exchange was interrupted or never occurred, the finish uses the paired flag exchange as a fallback, including photo finishes. Major events cancel the remaining reply when they interrupt. Settings includes a single preview player with Alex/Camille selection in duo mode.

Game audio drops to 8% while audible narrator speech plays, then returns smoothly. Muted, missing, failed, paused or cancelled speech releases the ducking. Narrator volume respects master volume.

## Event timing and subtitles

Welcome plays during the race intro; countdown and start have their own cues. Time Trial, Drift and Free Roam get their own mode introduction. Quick Race has one driving tip after eight seconds unless race commentary takes precedence.

Race events use the existing sustained-position rules, priority and cooldowns. Finish commentary begins 3.8 seconds into the cinematic, after the result badge. Photo finishes use `finish.mp3`; other finishes use `raceComplete.mp3`. Both now have recordings for both voices. Skipping the cinematic or reaching results cancels the line.

Typing follows character progress against audio playback duration; it is approximate rather than word alignment. Reduced-motion mode displays complete subtitles immediately. The cinematic intro uses a lower-left card to avoid its title; racing uses a separate panel under the top-left HUD. Text uses the bold condensed racing font.

## Re-recording

Use the saved voice for the intended commentator. Generate the same event meanings using that speaker's wording from `src/audio/narration.ts`. Keep the source script and recording order together when exporting one combined MP3. Record introductions separately from short race events when practical. Bracketed performance cues are for generation and are never included in game captions.

ElevenLabs guidance: [speech prompting](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices), [Voice Design](https://elevenlabs.io/docs/eleven-creative/voices/voice-design/).

## Additional variations

Two new takes per voice are installed for overtake, lead, lostLead, finalLap, finish and raceComplete. See `alex-variations-script.md` and `camille-variations-script.md` for the two 12-paragraph combined recording packs. Their intended clip names are `<event>-v1.mp3` and `<event>-v2.mp3` in the speaker’s existing folder.

Only installed recordings enter random selection. The 24 new solo takes are installed from the two new packs, giving three takes per voice for each expanded event. A speaker avoids repeating the same take on consecutive occurrences of that event when alternatives exist. Each selected take stays attached to its exact text, voice and portrait.

`joint-commentary-script.md` contains the three paired exchanges now installed. Each recording has been split at its speaker handoff. Source hashes, cut boundaries and per-clip level adjustments are preserved in `commentary-expansion-recordings.json`. The expansion adds 24 solo takes and six exchange turns (30 clips total). Each new clip was balanced toward a -16 dB mean level with the same peak limiter, without changing its Downloads source.

## Quiet mid-race stretches

Quick Race and Time Trial use short focus/rhythm coaching during quiet driving. After at least 14 seconds of racing, 12 seconds without speech, and above 25 km/h, a coaching line can play; coaching starts are at least 22 seconds apart. Drift Challenge selects a slide-continuity line while scoring and initiation advice otherwise. Free Roam keeps its quiet exploration behavior. Non-Quick-Race finite lap events also announce the final lap; Quick Race retains its existing callout trigger.

Eight short clips for these contexts were cut from the original Alex/Camille recordings, with exact subtitles and source boundaries in `mid-race-recordings.json`. These are not new synthesized performances. Race events take precedence over background coaching.
