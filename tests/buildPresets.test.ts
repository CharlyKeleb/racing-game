import { describe, expect, it } from 'vitest'
import { addPreset, deletePreset, duplicatePreset, nextPresetName, PRESET_NAME_MAX, PRESET_SLOTS, presetName, previewPreset, renamePreset, sameBuild, sanitizePresets, type BuildPreset } from '../src/vehicles/BuildPresets'
import { DEFAULT_BUILD, type CarBuild } from '../src/vehicles/CarBuild'

const tuned: CarBuild = { ...DEFAULT_BUILD, engine: 3, tires: 'race', paint: '#123456' }

describe('garage build presets (#35)', () => {
  it('saves up to the slot limit with sensible default names', () => {
    let list: BuildPreset[] = []
    for (let i = 0; i < PRESET_SLOTS + 2; i++) list = addPreset(list, `id${i}`, '', tuned)
    expect(list).toHaveLength(PRESET_SLOTS)
    expect(PRESET_SLOTS).toBeGreaterThanOrEqual(3)
    expect(list.map((p) => p.name)).toEqual(Array.from({ length: PRESET_SLOTS }, (_, i) => `Setup ${i + 1}`))
    expect(nextPresetName(deletePreset(list, 'id1'))).toBe('Setup 2')
  })

  it('renames, duplicates next to the original and deletes', () => {
    let list = addPreset([], 'a', 'Grip', tuned)
    list = addPreset(list, 'b', 'Drag', DEFAULT_BUILD)
    list = renamePreset(list, 'a', '  Wet   race  ')
    expect(list[0].name).toBe('Wet race')
    list = duplicatePreset(list, 'a', 'c')
    expect(list.map((p) => [p.id, p.name])).toEqual([['a', 'Wet race'], ['c', 'Wet race copy'], ['b', 'Drag']])
    expect(list[1].build).toEqual(list[0].build)
    expect(deletePreset(list, 'c').map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('names are trimmed, capped and never empty; renaming to blank keeps the old name', () => {
    expect(presetName('x'.repeat(60)).length).toBe(PRESET_NAME_MAX)
    expect(presetName('   ')).toBe('Setup')
    expect(renamePreset(addPreset([], 'a', 'Keep', tuned), 'a', '  ')[0].name).toBe('Keep')
  })

  it('cleans stored data: bad entries dropped, builds sanitized, cars kept apart', () => {
    const raw = {
      porsche911: [{ id: 'a', name: 'Good', build: tuned }, { nope: true }, { id: 'a', name: 'Dup', build: tuned }, { id: 'b', name: 7, build: { engine: 99 } }],
      bmw: 'broken',
      koenigsegg: [{ id: 'k', name: 'Track', build: DEFAULT_BUILD }],
    }
    const clean = sanitizePresets(raw)
    expect(clean.porsche911.map((p) => p.id)).toEqual(['a', 'b'])
    expect(clean.porsche911[1].build.engine).toBe(DEFAULT_BUILD.engine)
    expect(clean.bmw).toBeUndefined()
    expect(clean.koenigsegg[0].name).toBe('Track')
    expect(sanitizePresets(null)).toEqual({})
  })

  it('previews class, rank and stat changes before applying', () => {
    const preview = previewPreset(DEFAULT_BUILD, tuned)
    expect(preview.rankDelta).toBeGreaterThan(0)
    expect(preview.stats.find((s) => s.key === 'power')!.delta).toBeGreaterThan(0)
    expect(previewPreset(tuned, tuned).rankDelta).toBe(0)
    expect(sameBuild(tuned, { ...tuned })).toBe(true)
    expect(sameBuild(tuned, DEFAULT_BUILD)).toBe(false)
  })
})
