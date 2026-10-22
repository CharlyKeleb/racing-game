# Exhaust pop credits

The pops in `backfire-bank.wav` are cut from the public preview MP3s of these
Freesound recordings by `scripts/audio/build-backfire-bank.mjs`. The script
starts each cut on the pop's transient, fades the tail and matches loudness per
kind. All are [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), so
no attribution is required. They're listed here anyway.

| Used for | Source | Author | License |
|---|---|---|---|
| Crackle (overrun, anti-lag) | [Car Antilag (No cleanup, 32float)](https://freesound.org/people/modusmogulus/sounds/797835/) | modusmogulus | CC0 1.0 |
| Crackle (supercar pops on a rev) | [Supercar rev](https://freesound.org/people/richwise/sounds/478756/) | richwise | CC0 1.0 |
| Bang | [S012_Engine_Backfire_Mono.wav](https://freesound.org/people/P%C3%B3l/sounds/385935/) | Pól | CC0 1.0 |
| Bang | [S41-25 Car backfires; reverberant.wav](https://freesound.org/people/craigsmith/sounds/675723/) | craigsmith | CC0 1.0 |
| Bang | [BACKFIRE.ogg](https://freesound.org/people/CeebFrack/sounds/105351/) | CeebFrack | CC0 1.0 |

Bangs also get the synthesized sub thump from `src/audio/ImpactPCM.ts`
(`makeThumpPCM`) under them for the low "POOO".
