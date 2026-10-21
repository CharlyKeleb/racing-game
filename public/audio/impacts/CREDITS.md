# Impact audio credits

Car and wall hits in `impact-bank.wav` are cut from the public preview MP3s of
these Freesound recordings by `scripts/audio/build-impact-bank.mjs`. The script
trims each one to its first transient, fades the tail and matches loudness per
tier. All are [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), so
no attribution is required. They're listed here anyway.

| Used for | Source | Author | License |
|---|---|---|---|
| Light wall / car hit | [Fast Collision](https://freesound.org/people/qubodup/sounds/332056/) | qubodup | CC0 1.0 |
| Light wall hit | [Metal Hit 2](https://freesound.org/people/dslrguide/sounds/321482/) | dslrguide | CC0 1.0 |
| Medium wall hit, heavy car hit | [Collision](https://freesound.org/people/qubodup/sounds/332058/) | qubodup | CC0 1.0 |
| Medium wall / car hit | [Clank Car Crash Collision](https://freesound.org/people/qubodup/sounds/151624/) | qubodup | CC0 1.0 |
| Heavy wall / car crash | [car crash long 1](https://freesound.org/people/Logicogonist/sounds/807437/) | Logicogonist | CC0 1.0 |
| Heavy wall crash | [Car Crash (with Glass)](https://freesound.org/people/magnuswaker/sounds/592388/) | magnuswaker | CC0 1.0 |
| Light car-to-car tap | [Car_Door_Hit.wav](https://freesound.org/people/mickyman5000/sounds/340539/) | mickyman5000 | CC0 1.0 |
| Medium car-to-car hit | [Hood Impact](https://freesound.org/people/LPA134/sounds/329516/) | LPA134 | CC0 1.0 |

Landings, kerb strikes and the wall scrape are still the procedural Foley in
`src/audio/ImpactPCM.ts` / `ImpactSound.ts`. Until the bank loads, or if it
fails to load, car and wall hits fall back to the procedural Foley too.
