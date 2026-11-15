/**
 * What makes one car's engine and exhaust sound like that car and not
 * another. Only two cars ship their own recordings (the 911's flat-six and the
 * Koenigsegg's V8), so the others play one of those banks re-voiced: fired at
 * their own cylinder count, through their own exhaust (resonances, rasp,
 * drive), with the character their engine is known for (a crossplane V8's
 * burble, a supercharger's whine, a race car's straight-cut gears, turbos or
 * none) and their own exhaust pops. Set per car in vehicles/carRegistry.ts.
 */
export interface EngineVoice {
  /**
   * Recording pitch: the bank's rpm is multiplied by this. Firing a V8 bank as
   * a V12 is 6/4 = 1.5; a big, slow-revving V8 sits a little under 1.
   */
  pitch: number
  /** Exhaust body: resonance (Hz) and its boost (dB). Low and big for a V8, higher and tighter for a six. */
  boomHz: number
  boomDb: number
  /** Exhaust rasp: centre (Hz) and boost at full load and revs (dB). */
  raspHz: number
  raspDb: number
  /** How hard the exhaust is driven into the soft clip (1 = the 911). */
  drive: number
  /** Top end above 4 kHz, dB: a V12's shriek up, a muscle car's dark rumble down. */
  airDb: number
  /** Sub rumble (the engine's half order), relative to the 911. */
  sub: number
  /** Turbos: whistle, whoosh and blow-off, relative to the 911's twin turbos (0 = naturally aspirated). */
  turbo: number
  /**
   * Compressor surge, 0..1: lift off (or brake) on boost and, with no blow-off valve to vent it,
   * the air chatters back through the turbos, a deep "stuuu-stuuu-stuuu" that slows as the boost
   * drains (an RB26 Skyline). Replaces most of the blow-off "pssh". Omitted = 0.
   */
  flutter?: number
  /** Loudness of the car's lift-off recording (lift-off.mp3), relative to the 911's. Omitted = 1. */
  liftOff?: number
  /**
   * The turbo whistle's pitch on boost (Hz, from first boost to full) and its level relative to
   * the 911's. Omitted = 2600–6800 Hz at the `turbo` level. A big single-tone whistle that cuts
   * through the engine (an RB26 Skyline) sits lower and much louder.
   */
  whistle?: { lowHz: number; highHz: number; gain: number }
  /** Crossplane-V8 lope, 0..1: the exhaust pulses unevenly at the half order. */
  burble: number
  /**
   * A tone that follows the crank: a supercharger's whine or straight-cut gears (0 gain = none).
   * `scream`: a bright, buzzy wave instead of a hum. `air` (0..1): how much of it is rushing air
   * at the whine's pitch and octave rather than a pure tone; a twin-screw blower is mostly air,
   * straight-cut gears are pure tone (0, the default).
   */
  whine: { ratio: number; gain: number; scream?: boolean; air?: number }
  /** Exhaust pops and crackles. */
  pops: PopVoice
}

/**
 * What a car's pops are made of (BackfireSound picks recordings and shapes them by it):
 *  - antilag: a dry, sharp machine-gun rattle (a rally or time-attack car, an LM Skyline).
 *  - supercar: the crackle and "POOO" of an exotic on the overrun.
 *  - burble: soft, low, rapid pops under the exhaust (an AMG or RS V8 road car's sport exhaust).
 *  - muscle: few, slow, deep booms (a big American V8).
 */
export type PopStyle = 'antilag' | 'supercar' | 'burble' | 'muscle'

export interface PopVoice {
  /** Omitted = supercar. */
  style?: PopStyle
  /** Playback rate: under 1 is deeper and slower, over 1 sharper. */
  pitch: number
  /** Overrun crackle and bang levels, relative to the 911. */
  crackle: number
  bang: number
  /** Sub "POOO" under a bang, relative to the 911. */
  thump: number
  /** Low-pass on the pops, Hz: a muffled big-bore thud or a bright race-exhaust crack. */
  toneHz: number
}

/** The 911 Carrera 4S as tuned before voices existed: what every other car is relative to. */
export const DEFAULT_VOICE: EngineVoice = {
  pitch: 1,
  boomHz: 110,
  boomDb: 7,
  raspHz: 2400,
  raspDb: 4.5,
  drive: 1,
  airDb: 0,
  sub: 1,
  turbo: 1,
  burble: 0,
  whine: { ratio: 0, gain: 0 },
  pops: { pitch: 1, crackle: 1, bang: 1, thump: 1, toneHz: 9000 },
}
