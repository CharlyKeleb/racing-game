import type { ImpactKind } from './ImpactModel'

/** Original procedural Foley: short body resonance, crushed panels and scattered
 * contact transients. No swept bass tone, long bell ring, or clipped output. */
export function makeImpactPCM(kind: ImpactKind, strength: number, seed = 1, sampleRate = 48000): Float32Array<ArrayBuffer> {
  const s = Math.max(0, Math.min(1, strength))
  const wheel = kind === 'curb', ground = kind === 'ground'
  const duration = wheel ? .16 : ground ? .28 : .26 + s * .24
  const pcm = new Float32Array(Math.ceil(duration * sampleRate))
  let rng = seed >>> 0 || 1
  const random = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296 }
  const bodyHz = (wheel ? 105 : ground ? 58 : kind === 'wall' ? 70 : 88) * (.93 + random() * .14)
  const decay = wheel ? .028 : ground ? .055 : .045 + s * .025
  let bass = 0, mid = 0, air = 0
  let peak = 0, mean = 0
  const aBass = 1 - Math.exp(-2 * Math.PI * 180 / sampleRate)
  const aMid = 1 - Math.exp(-2 * Math.PI * (wheel ? 1250 : 2100 + s * 1800) / sampleRate)
  const aAir = 1 - Math.exp(-2 * Math.PI * 6200 / sampleRate)
  // Secondary contacts have independent times/decays, rather than periodic ringing.
  const contacts = Array.from({ length: wheel || ground ? 2 : 5 + Math.round(s * 7) }, (_, i) => ({
    at: i === 0 ? 0 : .008 + random() * (.045 + s * .12),
    decay: .003 + random() * .013,
    gain: i === 0 ? 1 : (.12 + random() * .45) * s,
  }))
  for (let i = 0; i < pcm.length; i++) {
    const t = i / sampleRate, n = random() * 2 - 1
    bass += aBass * (n - bass); mid += aMid * (n - mid); air += aAir * (n - air)
    const attack = 1 - Math.exp(-t / .0008)
    const body = (Math.sin(t * bodyHz * Math.PI * 2) + .32 * Math.sin(t * bodyHz * 1.71 * Math.PI * 2))
      * Math.exp(-t / decay) * .32 + bass * Math.exp(-t / (decay * 1.3)) * 2.2
    let crush = 0
    for (const contact of contacts) if (t >= contact.at) crush += contact.gain * Math.exp(-(t - contact.at) / contact.decay)
    const texture = (air - bass) * crush * (wheel ? .16 : ground ? .12 : .75)
      + (mid - bass) * Math.exp(-t / (.025 + s * .055)) * (wheel ? .22 : ground ? .3 : .7)
    const fade = Math.min(1, (duration - t) / .025)
    pcm[i] = (body + texture) * attack * fade
    mean += pcm[i]
  }
  mean /= pcm.length
  for (let i = 0; i < pcm.length; i++) { pcm[i] -= mean * Math.sin(Math.PI * i / (pcm.length - 1)) ** 2 * 2; peak = Math.max(peak, Math.abs(pcm[i])) }
  // Peak-normalise the asset, not the live mix. Strength remains a playback gain.
  const gain = .82 / Math.max(peak, .001)
  for (let i = 0; i < pcm.length; i++) pcm[i] *= gain
  return pcm
}
