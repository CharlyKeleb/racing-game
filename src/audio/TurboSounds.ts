import type { EngineVoice } from './EngineVoice'

/**
 * Turbo one-shots on a lift, shared by your car (CarSound) and the rivals (OpponentAudio):
 * the blow-off valve's "pssh", or, on a car without one (EngineVoice.flutter), the
 * compressor surge "stuuu-stuuu-stuuu". `boost` is how much boost was dumped
 * (CarSoundModel.blowOff), `noise` any white-noise buffer, `out` where it plays.
 */
export function turboLift(ctx: BaseAudioContext, noise: AudioBuffer, out: AudioNode, when: number, boost: number, voice: EngineVoice, level = 1): void {
  if (boost <= 0 || voice.turbo <= 0) return
  const flutter = voice.flutter ?? 0
  const strength = boost * Math.min(voice.turbo, 1.6)
  if (flutter > 0) flutterAt(ctx, noise, out, when, strength * flutter, level)
  if (flutter < 1) blowOffAt(ctx, noise, out, when, strength * (1 - 0.8 * flutter), level)
}

/** Turbo blow-off valve: a bright "pssh" that fades over ~0.35 s. */
function blowOffAt(ctx: BaseAudioContext, noise: AudioBuffer, out: AudioNode, when: number, strength: number, level: number): void {
  const src = ctx.createBufferSource()
  src.buffer = noise
  const hp = biquad(ctx, 'highpass', 1800, 0.7, 0)
  const bp = biquad(ctx, 'bandpass', 4200, 0.9, 0)
  bp.frequency.setValueAtTime(4200, when)
  bp.frequency.exponentialRampToValueAtTime(2200, when + 0.35)
  const env = ctx.createGain()
  env.gain.setValueAtTime(0, when)
  env.gain.linearRampToValueAtTime(0.28 * strength * level, when + 0.012)
  env.gain.exponentialRampToValueAtTime(0.0001, when + 0.38)
  src.connect(hp).connect(bp).connect(env).connect(out)
  src.start(when, Math.random(), 0.4)
}

/**
 * Compressor surge ("stuuu-stuuu-stuuu"): with nowhere to vent, the boost chatters back
 * through the compressor in deep, breathy surges, about 11 a second slowing to 7 as the
 * pressure drains over a second or so (measured off an RB26's). More boost, longer and louder.
 */
function flutterAt(ctx: BaseAudioContext, noise: AudioBuffer, out: AudioNode, when: number, strength: number, level: number): void {
  const s = Math.min(strength, 1.6)
  const span = 0.7 + 0.6 * Math.min(s, 1)
  let at = when + 0.02
  let period = 0.085
  for (let i = 0; at < when + span; i++) {
    const fade = Math.max(0, 1 - (at - when) / span) ** 0.8
    const src = ctx.createBufferSource()
    src.buffer = noise
    // Each surge: a deep rush of air, its body around 150 Hz, its breath around 650 Hz.
    const bp = biquad(ctx, 'bandpass', (680 - 18 * i) * (0.92 + Math.random() * 0.16), 1.1, 0)
    const body = biquad(ctx, 'lowshelf', 180, 0.7, 9)
    const env = ctx.createGain()
    const len = period * 0.8
    env.gain.setValueAtTime(0, at)
    env.gain.linearRampToValueAtTime(0.75 * s * fade * level, at + 0.012)
    env.gain.exponentialRampToValueAtTime(0.0001, at + len)
    src.connect(bp).connect(body).connect(env).connect(out)
    src.start(at, Math.random() * 1.5, len + 0.01)
    at += period
    period *= 1.06
  }
}

/** Two seconds of white noise. */
export function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}

function biquad(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q: number, dB: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  f.gain.value = dB
  return f
}
