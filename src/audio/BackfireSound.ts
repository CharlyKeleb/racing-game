import { BANG, type PopKind } from '../vehicles/Backfire'
import { makeThumpPCM } from './ImpactPCM'
import { DEFAULT_VOICE, type PopStyle, type PopVoice } from './EngineVoice'

/** Where each recorded pop sits in backfire-bank.wav (scripts/audio/build-backfire-bank.mjs writes it). */
export interface BackfireBankIndex {
  rate: number
  kinds: { crackle?: { source: string; start: number; length: number }[]; bang?: { source: string; start: number; length: number }[] }
}

interface Pop {
  source: string
  buffer: AudioBuffer
}

interface Bank {
  crackle: Pop[]
  bang: Pop[]
  /** Low "POOO" under a bang: the recordings are short on body. */
  thump: AudioBuffer
}
const banks = new WeakMap<BaseAudioContext, Bank>()

/** Cut the decoded bank into one buffer per pop (positions scaled if the browser resampled it). */
export function sliceBackfireBank(ctx: BaseAudioContext, decoded: AudioBuffer, index: BackfireBankIndex): Bank {
  const scale = decoded.sampleRate / index.rate
  const data = decoded.getChannelData(0)
  const cut = (list: { source: string; start: number; length: number }[] = []) => list.map(({ source, start, length }) => {
    const from = Math.round(start * scale), n = Math.max(1, Math.min(data.length - from, Math.round(length * scale)))
    const buffer = ctx.createBuffer(1, n, decoded.sampleRate)
    buffer.copyToChannel(data.subarray(from, from + n), 0)
    return { source, buffer }
  })
  const pcm = makeThumpPCM(1, ctx.sampleRate)
  const thump = ctx.createBuffer(1, pcm.length, ctx.sampleRate)
  thump.copyToChannel(pcm, 0)
  return { crackle: cut(index.kinds.crackle), bang: cut(index.kinds.bang), thump }
}

/**
 * Load the recorded exhaust pops (CC0 Freesound, see public/audio/backfire/CREDITS.md).
 * Until they arrive, pops are silent (the flames still show).
 */
export async function loadBackfireRecordings(ctx: BaseAudioContext, base = '/audio/backfire/'): Promise<boolean> {
  if (banks.has(ctx)) return true
  try {
    const [wav, index] = await Promise.all([
      fetch(base + 'backfire-bank.wav').then((r) => { if (!r.ok) throw new Error(`backfire bank: HTTP ${r.status}`); return r.arrayBuffer() }),
      fetch(base + 'backfire-bank.json').then((r) => { if (!r.ok) throw new Error(`backfire index: HTTP ${r.status}`); return r.json() as Promise<BackfireBankIndex> }),
    ])
    banks.set(ctx, sliceBackfireBank(ctx, await ctx.decodeAudioData(wav), index))
    return true
  } catch {
    return false
  }
}

/**
 * Mix level of a crackle and of a bang at full strength: loud, a supercar's pops are.
 * The engine bed runs hot into the master limiter (about −5 dBFS RMS at full throttle),
 * so pops need this much, plus the engine duck in AudioManager.backfire, to stand out
 * instead of being squashed into it. At 1.2 / 2.2 players barely heard them.
 */
const CRACKLE_GAIN = 2.4
const BANG_GAIN = 3.6
/** The sub thump under a bang, relative to it: the chest-thump of the "POOO". */
const THUMP_GAIN = 1.3
const MAX_VOICES = 8
/** Presence lift on every pop (dB at 2.5 kHz). */
const POP_PRESENCE_DB = 6

/**
 * How each pop style is made: which recordings it draws on (by source name in the bank),
 * how they're pitched (on top of the car's own `pitch`) and levelled, and the darkest its
 * exhaust tone may be. Bangs on a burble car are rounder thuds, not cannon shots.
 */
const STYLES: Record<PopStyle, { crackle: string[]; bang: string[]; crackleRate: [number, number]; bangRate: [number, number]; crackleGain: number; bangGain: number; toneMaxHz: number }> = {
  antilag: { crackle: ['antilag'], bang: ['engine'], crackleRate: [0.95, 1.2], bangRate: [0.95, 1.1], crackleGain: 1, bangGain: 0.8, toneMaxHz: 16000 },
  supercar: { crackle: ['supercar', 'antilag'], bang: ['engine', 'deep'], crackleRate: [0.9, 1.12], bangRate: [0.86, 1], crackleGain: 1, bangGain: 1, toneMaxHz: 16000 },
  // Burble and muscle were pitched and filtered so dark (a 2.6 kHz ceiling, crackles at ~0.6× speed)
  // that laptop and phone speakers lost them: still the deeper, rounder styles, but audible.
  burble: { crackle: ['supercar', 'antilag'], bang: ['deep'], crackleRate: [0.72, 0.88], bangRate: [0.78, 0.9], crackleGain: 1, bangGain: 0.85, toneMaxHz: 6000 },
  muscle: { crackle: ['supercar'], bang: ['vintage', 'deep'], crackleRate: [0.7, 0.85], bangRate: [0.76, 0.9], crackleGain: 0.95, bangGain: 1.15, toneMaxHz: 6500 },
}

/** The recordings a style draws on, or all of that kind when the bank has none of them. */
function pick(list: Pop[], sources: string[]): Pop[] {
  const mine = list.filter((p) => sources.includes(p.source))
  return mine.length ? mine : list
}

/**
 * One car's exhaust pops: the sharp crackle of the overrun and the big "POOO"
 * of a supercar upshift, nitro lighting or a burnout, from real recordings,
 * varied in pitch so a burst never repeats itself, and voiced per car (see
 * EngineVoice.pops): a muscle car's deep, muffled thud, a race car's sharp
 * crack. Plays into `destination` (the player's effects bus, or a rival's 3D panner).
 */
export class BackfireSound {
  private readonly ctx: BaseAudioContext
  /** The car's exhaust tone: every pop goes through it. */
  private readonly tone: BiquadFilterNode
  private readonly out: BiquadFilterNode
  private readonly voices = new Set<AudioBufferSourceNode>()
  private variant = 0
  private voice: PopVoice = DEFAULT_VOICE.pops
  /** The style's recordings, picked once per bank and voice (not per pop). */
  private picked: { bank: Bank; crackle: Pop[]; bang: Pop[] } | null = null

  constructor(ctx: BaseAudioContext, destination: AudioNode) {
    this.ctx = ctx
    this.tone = ctx.createBiquadFilter()
    this.tone.type = 'lowpass'
    this.tone.Q.value = 0.7
    this.tone.frequency.value = this.voice.toneHz
    // The crack of a pop lives in the presence band: lift it so small speakers carry it.
    const presence = ctx.createBiquadFilter()
    presence.type = 'peaking'
    presence.frequency.value = 2500
    presence.Q.value = 0.8
    presence.gain.value = POP_PRESENCE_DB
    this.tone.connect(presence).connect(destination)
    this.out = presence
  }

  /** The car's pops (see EngineVoice.pops). */
  setVoice(voice: PopVoice): void {
    this.voice = voice
    this.picked = null
    this.tone.frequency.value = Math.min(voice.toneHz, STYLES[voice.style ?? 'supercar'].toneMaxHz)
  }

  /** Level a pop of this kind and strength plays at (before distance), for tests and the engine duck. */
  static level(kind: PopKind, strength: number): number {
    const s = Math.max(0, Math.min(1, strength))
    return (kind === BANG ? BANG_GAIN : CRACKLE_GAIN) * (0.55 + 0.45 * s)
  }

  /** @returns whether it played (false before the recordings load, or with too many voices going). */
  pop(kind: PopKind, strength: number): boolean {
    const bank = banks.get(this.ctx)
    if (!bank || kind === 0 || this.voices.size >= MAX_VOICES) return false
    const v = this.voice
    const style = STYLES[v.style ?? 'supercar']
    if (this.picked?.bank !== bank) this.picked = { bank, crackle: pick(bank.crackle, style.crackle), bang: pick(bank.bang, style.bang) }
    const list = kind === BANG ? this.picked.bang : this.picked.crackle
    if (!list.length) return false
    const at = this.ctx.currentTime
    const bang = kind === BANG
    const level = BackfireSound.level(kind, strength) * (bang ? v.bang * style.bangGain : v.crackle * style.crackleGain)
    // Scattered across the style's range, around the car's own pitch, so a burst never repeats.
    const [lo, hi] = bang ? style.bangRate : style.crackleRate
    const rate = v.pitch * (lo + Math.random() * (hi - lo))
    this.play(list[this.variant++ % list.length].buffer, rate, level, at)
    if (bang) this.play(bank.thump, Math.sqrt(v.pitch) * (0.9 + Math.random() * 0.15), level * THUMP_GAIN * v.thump, at)
    return true
  }

  private play(buffer: AudioBuffer, rate: number, level: number, at: number): void {
    const source = this.ctx.createBufferSource(), gain = this.ctx.createGain()
    source.buffer = buffer
    source.playbackRate.value = rate
    gain.gain.value = level
    source.connect(gain).connect(this.tone)
    this.voices.add(source)
    source.onended = () => { source.disconnect(); gain.disconnect(); this.voices.delete(source) }
    source.start(at)
  }

  dispose(): void {
    for (const source of this.voices) { source.onended = null; source.stop(); source.disconnect() }
    this.voices.clear()
    this.tone.disconnect()
    this.out.disconnect()
  }
}

