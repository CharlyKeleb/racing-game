import { isAbsolute } from 'node:path'

export interface PracticeConfig {
  port: number
  supabaseUrl: string
  publishableKey: string
  origins: string[]
  assetFile: string
  scheduledInputs: boolean
  resultStorage?: { key: string; directory: string }
}

/** Explicit staging entrypoint configuration. Error messages never echo configuration values. */
export function practiceConfig(env: Record<string, string | undefined>): PracticeConfig {
  if (env.PRACTICE_SERVER_ENABLED !== '1') throw new Error('Explicitly enable the isolated practice server')
  let endpoint: URL
  try { endpoint = new URL(env.SUPABASE_URL ?? '') } catch { throw new Error('Set a valid staging Supabase HTTPS URL') }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || endpoint.pathname !== '/') throw new Error('Set a valid staging Supabase HTTPS URL')
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!publishableKey) throw new Error('Set a staging Supabase publishable key')
  const origins = (env.ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean)
  if (!origins.length || origins.length > 8 || origins.some(origin => {
    try { const url = new URL(origin); return url.protocol !== 'https:' || url.origin !== origin || !!url.username || !!url.password }
    catch { return true }
  })) throw new Error('Set up to eight explicit HTTPS frontend origins')
  const portText = env.PORT ?? '2567'
  const port = Number(portText)
  if (!/^\d{1,5}$/.test(portText) || port < 1024 || port > 65535) throw new Error('Set a port between 1024 and 65535')
  const assetFile = env.PRACTICE_ASSET_FILE ?? '/app/simulation-assets.bin'
  if (!isAbsolute(assetFile)) throw new Error('Practice assets require an absolute path')
  if (env.MULTIPLAYER_SCHEDULED_INPUTS !== undefined && !['0', '1'].includes(env.MULTIPLAYER_SCHEDULED_INPUTS)) throw new Error('Scheduled inputs must be 0 or 1')
  const key = env.SUPABASE_RESULT_SECRET_KEY?.trim(), directory = env.RESULT_OUTBOX_DIR?.trim()
  if (!!key !== !!directory || (directory && !isAbsolute(directory))) throw new Error('Set both a server result secret and absolute persistent outbox path, or neither')
  return { port, supabaseUrl: endpoint.origin, publishableKey, origins: [...new Set(origins)], assetFile,
    scheduledInputs: env.MULTIPLAYER_SCHEDULED_INPUTS === '1',
    ...(key && directory ? { resultStorage: { key, directory } } : {}) }
}
