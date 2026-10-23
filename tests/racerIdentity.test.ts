import { describe, expect, it } from 'vitest'
import { validateRacer, profileError } from '../src/cloud/racerIdentity'

describe('racer identity validation', () => {
  it('accepts canonicalizable handles and international display names', () => {
    expect(validateRacer(' NightShift_7 ', '夜のレーサー')).toBeNull()
    expect(validateRacer('cafe', 'e\u0301a')).toBeNull()
  })
  it.each(['ab', '1racer', 'two words', 'éclair', 'a'.repeat(21), 'ADMIN'])('rejects invalid/reserved handle %s', (handle) => {
    expect(validateRacer(handle, 'Racer')).not.toBeNull()
  })
  it.each(['a', 'a'.repeat(25), 'Bad\u202ename', 'Bad\nname', 'Bad\u200bname'])('rejects invalid display name %s', (name) => {
    expect(validateRacer('racer', name)).not.toBeNull()
  })
  it('counts Unicode codepoints and rejects oversized names after normalization', () => {
    expect(validateRacer('racer', '😀'.repeat(24))).toBeNull()
    expect(validateRacer('racer', '😀'.repeat(25))).not.toBeNull()
  })
  it('gives useful collision errors without exposing database internals', () => {
    expect(profileError({ code: '23505', message: 'constraint detail' })).toContain('taken')
    expect(profileError({ message: 'SQL detail' })).not.toContain('SQL')
  })
})
