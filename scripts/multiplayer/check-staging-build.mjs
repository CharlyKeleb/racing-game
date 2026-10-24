// Relocated Node artifact check, with no listener, credentials, Supabase calls or writes.
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../../', import.meta.url))
const directory = await mkdtemp(path.join(tmpdir(), 'practice-build-'))
try {
  await cp(path.join(root, 'dist-race'), path.join(directory, 'dist-race'), { recursive: true })
  // The runtime image copies precisely this locked backend dependency tree after pruning dev packages.
  await symlink(path.join(root, 'server/node_modules'), path.join(directory, 'node_modules'), 'dir')
  const artifact = path.join(directory, 'dist-race/server.mjs')
  const environment = { PATH: process.env.PATH, NODE_ENV: 'test' }
  const disabled = spawnSync(process.execPath, [artifact], { env: environment, encoding: 'utf8', timeout: 10_000 })
  assert.equal(disabled.status, 1)
  assert.match(disabled.stderr, /Explicitly enable the isolated practice server/)
  for (const scheduled of ['0', '1']) {
    const checked = spawnSync(process.execPath, [artifact, '--check-assets'], { encoding: 'utf8', timeout: 30_000,
      env: { ...environment, PRACTICE_SERVER_ENABLED: '1', SUPABASE_URL: 'https://staging.example.test', SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key',
        ALLOWED_ORIGINS: 'https://game.example.test', PRACTICE_ASSET_FILE: path.join(root, '.cache/multiplayer/simulation-assets.bin'),
        MULTIPLAYER_SCHEDULED_INPUTS: scheduled } })
    assert.equal(checked.status, 0, checked.error?.message ?? checked.stderr)
    const report = JSON.parse(checked.stdout.trim())
    const manifest = JSON.parse(await readFile(path.join(root, 'public/multiplayer/manifest.json'), 'utf8'))
    assert.equal(report.check, 'practice-assets'); assert.equal(report.fingerprint, manifest.fingerprint)
    assert.equal(report.racers, 2); assert.equal(report.ticks, 12)
    assert.equal(report.correctionVersion, 1); assert.equal(report.scheduledInputVersion, scheduled === '1' ? 1 : null)
    console.info(JSON.stringify(report))
  }
} finally { await rm(directory, { recursive: true, force: true }) }
