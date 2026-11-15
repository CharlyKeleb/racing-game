import { describe, expect, it } from 'vitest'
import { moddedVoice } from '../src/audio/SoundMods'
import { DEFAULT_VOICE } from '../src/audio/EngineVoice'
import { applyCarBuild, DEFAULT_BUILD, EXHAUST_KITS, sanitizeBuild, TURBO_KITS } from '../src/vehicles/CarBuild'
import { DEFAULT_VEHICLE_CONFIG } from '../src/vehicles/VehicleConfig'

describe('garage sound mods', () => {
  it('stock exhaust and turbo leave the car as voiced', () => {
    expect(moddedVoice(DEFAULT_VOICE, 'stock', 'stock')).toEqual(DEFAULT_VOICE)
  })

  it('a straight pipe is louder and pops more than stock', () => {
    const v = moddedVoice(DEFAULT_VOICE, 'straight', 'stock')
    expect(v.drive).toBeGreaterThan(DEFAULT_VOICE.drive)
    expect(v.raspDb).toBeGreaterThan(DEFAULT_VOICE.raspDb)
    expect(v.pops.crackle).toBeGreaterThan(DEFAULT_VOICE.pops.crackle)
  })

  it('every turbo gives a naturally aspirated car a turbo, and only no-BOV flutters', () => {
    const na = { ...DEFAULT_VOICE, turbo: 0 }
    for (const kit of TURBO_KITS.filter((k) => k !== 'stock')) {
      const v = moddedVoice(na, 'stock', kit)
      expect(v.turbo).toBeGreaterThan(0)
      expect(v.flutter ?? 0).toBe(kit === 'flutter' ? 1 : 0)
    }
  })

  it('the e-turbo whines higher than a big single', () => {
    expect(moddedVoice(DEFAULT_VOICE, 'stock', 'eturbo').whistle!.lowHz).toBeGreaterThan(moddedVoice(DEFAULT_VOICE, 'stock', 'single').whistle!.highHz)
  })

  it('a straight pipe pops and flames more; power is unchanged', () => {
    const stock = applyCarBuild(DEFAULT_VEHICLE_CONFIG, DEFAULT_BUILD)
    const piped = applyCarBuild(DEFAULT_VEHICLE_CONFIG, { ...DEFAULT_BUILD, exhaust: 'straight', turbo: 'single' })
    expect(piped.backfire.overrun).toBeGreaterThan(stock.backfire.overrun)
    expect(piped.backfire.flame).toBeGreaterThan(stock.backfire.flame)
    expect(piped.engine.torqueCurve).toEqual(stock.engine.torqueCurve)
  })

  it('saved builds keep known kits and drop unknown ones', () => {
    for (const exhaust of EXHAUST_KITS) expect(sanitizeBuild({ ...DEFAULT_BUILD, exhaust }).exhaust).toBe(exhaust)
    expect(sanitizeBuild({ ...DEFAULT_BUILD, exhaust: 'rocket', turbo: 7 })).toMatchObject({ exhaust: 'stock', turbo: 'stock' })
    expect(sanitizeBuild({ paint: '#000000' }).turbo).toBe('stock')
  })
})
