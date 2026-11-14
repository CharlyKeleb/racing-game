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
   * Compressor surge, 0..1: lift off on boost and, with no blow-off valve to vent it, the air
   * chatters back through the turbos, "stu-tu-tu-tu" (an RB26 Skyline). Replaces most of the
   * blow-off "pssh". Omitted = 0.
   */
  flutter?: number
  /** Crossplane-V8 lope, 0..1: the exhaust pulses unevenly at the half order. */
  burble: number
  /**
   * A tone that follows the crank: a supercharger's whine or straight-cut gears (0 gain = none).
   * `scream`: a bright, buzzy wave for a big blower's shriek (a Hellcat or Demon) instead of a hum.
   */
  whine: { ratio: number; gain: number; scream?: boolean }
  /** Exhaust pops and crackles. */
  pops: PopVoice
}

export interface PopVoice {
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
