import { BANG, type PopKind } from '../vehicles/Backfire'
import { makeThumpPCM } from './ImpactPCM'

/** Where each recorded pop sits in backfire-bank.wav (scripts/audio/build-backfire-bank.mjs writes it). */
export interface BackfireBankIndex {
  rate: number
  kinds: { crackle?: { source: string; start: number; length: number }[]; bang?: { source: string; start: number; length: number }[] }
}

interface Bank {
  crackle: AudioBuffer[]
  bang: AudioBuffer[]
  /** Low "POOO" under a bang: the recordings are short on body. */
  thump: AudioBuffer
}
const banks = new WeakMap<BaseAudioContext, Bank>()

/** Cut the decoded bank into one buffer per pop (positions scaled if the browser resampled it). */
export function sliceBackfireBank(ctx: BaseAudioContext, decoded: AudioBuffer, index: BackfireBankIndex): Bank {
  const scale = decoded.sampleRate / index.rate
  const data = decoded.getChannelData(0)
  const cut = (list: { start: number; length: number }[] = []) => list.map(({ start, length }) => {
    const from = Math.round(start * scale), n = Math.max(1, Math.min(data.length - from, Math.round(length * scale)))
    const buffer = ctx.createBuffer(1, n, decoded.sampleRate)
    buffer.copyToChannel(data.subarray(from, from + n), 0)
    return buffer
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

/** Mix level of a crackle and of a bang at full strength: loud, a supercar's pops are. */
const CRACKLE_GAIN = 1.2
const BANG_GAIN = 2.2
/** The sub thump under a bang, relative to it: the chest-thump of the "POOO". */
const THUMP_GAIN = 1.1
const MAX_VOICES = 8

/**
 * One car's exhaust pops: the sharp crackle of the overrun and the big "POOO"
 * of a supercar upshift, nitro lighting or a burnout, from real recordings,
 * varied in pitch so a burst never repeats itself. Plays into `destination`
 * (the player's effects bus, or a rival's 3D panner).
 */
export class BackfireSound {
  private readonly ctx: BaseAudioContext
  private readonly destination: AudioNode
  private readonly voices = new Set<AudioBufferSourceNode>()
  private variant = 0

  constructor(ctx: BaseAudioContext, destination: AudioNode) {
    this.ctx = ctx
    this.destination = destination
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
    const list = kind === BANG ? bank.bang : bank.crackle
    if (!list.length) return false
    const at = this.ctx.currentTime
    const level = BackfireSound.level(kind, strength)
    // Bangs a touch deeper, crackles scattered either side.
    const rate = kind === BANG ? 0.86 + Math.random() * 0.14 : 0.9 + Math.random() * 0.22
    this.play(list[this.variant++ % list.length], rate, level, at)
    if (kind === BANG) this.play(bank.thump, 0.9 + Math.random() * 0.15, level * THUMP_GAIN, at)
    return true
  }

  private play(buffer: AudioBuffer, rate: number, level: number, at: number): void {
    const source = this.ctx.createBufferSource(), gain = this.ctx.createGain()
    source.buffer = buffer
    source.playbackRate.value = rate
    gain.gain.value = level
    source.connect(gain).connect(this.destination)
    this.voices.add(source)
    source.onended = () => { source.disconnect(); gain.disconnect(); this.voices.delete(source) }
    source.start(at)
  }

  dispose(): void {
    for (const source of this.voices) { source.onended = null; source.stop(); source.disconnect() }
    this.voices.clear()
  }
}

