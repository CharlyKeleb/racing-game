import { expect, it } from 'vitest'
import { practiceConfig } from '../server/src/PracticeConfig'

const base = { PRACTICE_SERVER_ENABLED: '1', SUPABASE_URL: 'https://staging.example.test', SUPABASE_PUBLISHABLE_KEY: 'public',
  ALLOWED_ORIGINS: 'https://game.example.test,https://game.example.test' }
it('requires explicit opt-in and validates configuration without echoing secrets', () => {
  expect(() => practiceConfig({})).toThrow('Explicitly enable')
  for (const overrides of [ { SUPABASE_URL: 'http://staging.example.test' }, { SUPABASE_URL: 'https://user:secret@staging.example.test' },
    { SUPABASE_URL: 'https://staging.example.test/path' }, { SUPABASE_PUBLISHABLE_KEY: '' }, { ALLOWED_ORIGINS: '*' },
    { ALLOWED_ORIGINS: 'https://game.example.test/path' }, { ALLOWED_ORIGINS: 'http://game.example.test' },
    { PORT: '-1' }, { PORT: '1e4' }, { PORT: '65536' }, { PRACTICE_ASSET_FILE: 'relative.json' }, { MULTIPLAYER_SCHEDULED_INPUTS: 'yes' },
    { SUPABASE_RESULT_SECRET_KEY: 'secret-do-not-echo' }, { RESULT_OUTBOX_DIR: '/data/outbox' },
    { SUPABASE_RESULT_SECRET_KEY: 'secret-do-not-echo', RESULT_OUTBOX_DIR: 'relative' } ]) {
    let error: unknown
    try { practiceConfig({ ...base, ...overrides }) } catch (caught) { error = caught }
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).not.toContain('secret-do-not-echo')
  }
})
it('defaults prediction off and supports paired durable storage configuration', () => {
  expect(practiceConfig(base)).toEqual({ port: 2567, supabaseUrl: base.SUPABASE_URL, publishableKey: 'public',
    origins: ['https://game.example.test'], assetFile: '/app/simulation-assets.bin', scheduledInputs: false })
  expect(practiceConfig({ ...base, MULTIPLAYER_SCHEDULED_INPUTS: '1', SUPABASE_RESULT_SECRET_KEY: 'secret', RESULT_OUTBOX_DIR: '/data/outbox' }))
    .toMatchObject({ scheduledInputs: true, resultStorage: { key: 'secret', directory: '/data/outbox' } })
})
