import type { ExhaustKit, TurboKit } from '../vehicles/CarBuild'
import type { EngineVoice } from './EngineVoice'

/**
 * Garage sound mods: the car's own voice with a different exhaust and turbo fitted.
 * Pure (voice in, voice out). Stock keeps the car exactly as voiced in carRegistry.
 *
 * Exhausts, quietest to loudest:
 *  - cat-back: a sportier back box, a bit more body and rasp, more crackle.
 *  - resonator delete: the raspy one, more mid-range bite and top end.
 *  - X-pipe: the banks merge, so a V8's burble smooths into a higher, exotic note.
 *  - straight pipe: nothing in the way, deep, loud, raw, pops and flames on every lift.
 * Turbos:
 *  - big single: a loud, low single-scroll scream and a big "pssh" off boost.
 *  - twin-scroll: a smoother, higher whistle that spools early, a softer blow-off.
 *  - no BOV (flutter): the boost chatters back through the compressor, "stu-stu-stu".
 *  - e-turbo: an electric motor spins the compressor, a high futuristic whine.
 */
export function moddedVoice(voice: EngineVoice, exhaust: ExhaustKit, turbo: TurboKit): EngineVoice {
  return withTurbo(withExhaust(voice, exhaust), turbo)
}

function withExhaust(v: EngineVoice, kit: ExhaustKit): EngineVoice {
  const p = v.pops
  switch (kit) {
    case 'stock':
      return v
    case 'catback':
      return { ...v, boomDb: v.boomDb + 2, raspDb: v.raspDb + 1.5, drive: v.drive * 1.1,
        pops: { ...p, crackle: p.crackle * 1.3, bang: p.bang * 1.15 } }
    case 'resdelete':
      return { ...v, raspHz: v.raspHz * 1.15, raspDb: v.raspDb + 4, airDb: v.airDb + 2, drive: v.drive * 1.15,
        pops: { ...p, crackle: p.crackle * 1.4, toneHz: p.toneHz * 1.15 } }
    case 'xpipe':
      return { ...v, boomDb: v.boomDb + 1, raspHz: v.raspHz * 1.25, raspDb: v.raspDb + 1, airDb: v.airDb + 3,
        burble: v.burble * 0.4, pops: { ...p, crackle: p.crackle * 1.15, toneHz: p.toneHz * 1.2 } }
    case 'straight':
      return { ...v, boomDb: v.boomDb + 4, raspDb: v.raspDb + 4, drive: v.drive * 1.35, sub: v.sub * 1.3, airDb: v.airDb + 2,
        burble: Math.min(1, v.burble * 1.3 + 0.1),
        pops: { ...p, crackle: p.crackle * 1.8, bang: p.bang * 1.6, thump: p.thump * 1.3, toneHz: p.toneHz * 1.2 } }
  }
}

function withTurbo(v: EngineVoice, kit: TurboKit): EngineVoice {
  switch (kit) {
    case 'stock':
      return v
    case 'single':
      return { ...v, turbo: 1.6, flutter: 0, whistle: { lowHz: 1500, highHz: 3300, gain: 3 } }
    case 'twin':
      return { ...v, turbo: 1.1, flutter: 0, whistle: { lowHz: 2600, highHz: 5400, gain: 1.3 } }
    case 'flutter':
      return { ...v, turbo: 1.5, flutter: 1, whistle: { lowHz: 1700, highHz: 2500, gain: 4 } }
    case 'eturbo':
      return { ...v, turbo: 0.8, flutter: 0, whistle: { lowHz: 5200, highHz: 9500, gain: 2.5 } }
  }
}
