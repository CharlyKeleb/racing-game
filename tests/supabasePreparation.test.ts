import { afterEach, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'supabase-plan-')); directories.push(root)
  const source = path.join(root, 'supabase/migrations'), scripts = path.join(root, 'scripts/multiplayer')
  const linked = path.join(root, '.cache/multiplayer/supabase-cli/supabase')
  await Promise.all([mkdir(source, { recursive: true }), mkdir(scripts, { recursive: true }), mkdir(path.join(linked, '.temp'), { recursive: true })])
  await cp(new URL('../scripts/multiplayer/prepare-existing-supabase.mjs', import.meta.url), path.join(scripts, 'prepare-existing-supabase.mjs'))
  await writeFile(path.join(linked, 'config.toml'), 'project_id = "fixture"\n')
  await writeFile(path.join(linked, '.temp/project-ref'), 'a'.repeat(20))
  const rows = []
  for (let i = 1; i <= 3; i++) {
    const filename = `000${i}_fixture.sql`, bytes = Buffer.from(`select ${i};\n`)
    await writeFile(path.join(source, filename), bytes)
    rows.push({ source: filename, sha256: createHash('sha256').update(bytes).digest('hex'), version: `2026102400000${i}` })
  }
  const mapping = { projectRef: 'a'.repeat(20), legacyUntracked: rows[0], migrations: rows.slice(1) }
  const saveMapping = () => writeFile(path.join(root, 'supabase/existing-project-migrations.json'), JSON.stringify(mapping))
  await saveMapping()
  const run = () => spawnSync(process.execPath, [path.join(scripts, 'prepare-existing-supabase.mjs')], { encoding: 'utf8', timeout: 10_000 })
  return { root, source, linked, mapping, saveMapping, run, target: path.join(root, '.cache/multiplayer/supabase-deploy/supabase/migrations') }
}
it('prepares exact hash-pinned SQL under existing timestamp versions and excludes the untracked legacy baseline', async () => {
  const f = await fixture(), result = f.run()
  expect(result.status, result.stderr).toBe(0)
  expect(JSON.parse(result.stdout)).toMatchObject({ projectRef: 'a'.repeat(20), sourceHashesVerified: true, remoteChanges: false })
  expect((await readdir(f.target)).sort()).toEqual(['20261024000002_fixture.sql', '20261024000003_fixture.sql'])
  expect(await readFile(path.join(f.target, '20261024000003_fixture.sql'), 'utf8')).toBe('select 3;\n')
  expect(f.run().status).toBe(0) // re-preparation is stable while the reviewed inputs remain unchanged
})
it('rejects the wrong linked project, changed source bytes and duplicate versions before preparing a deployment', async () => {
  const f = await fixture()
  await writeFile(path.join(f.linked, '.temp/project-ref'), 'b'.repeat(20))
  expect(f.run().stderr).toContain('Linked project does not match')
  await expect(readdir(f.target)).rejects.toMatchObject({ code: 'ENOENT' })
  await writeFile(path.join(f.linked, '.temp/project-ref'), 'a'.repeat(20))
  await writeFile(path.join(f.source, '0003_fixture.sql'), 'select 99;\n')
  expect(f.run().stderr).toContain('Migration source changed')
  await expect(readdir(f.target)).rejects.toMatchObject({ code: 'ENOENT' })
  await writeFile(path.join(f.source, '0003_fixture.sql'), 'select 3;\n')
  f.mapping.migrations[1].version = f.mapping.migrations[0].version; await f.saveMapping()
  expect(f.run().stderr).toContain('Migration versions must be distinct and increasing')
})
it('preserves and rejects unexpected or modified generated SQL instead of silently replacing it', async () => {
  const f = await fixture(); expect(f.run().status).toBe(0)
  const unexpected = path.join(f.target, 'unreviewed.sql')
  await writeFile(unexpected, 'select 123;\n')
  expect(f.run().stderr).toContain('Unexpected file')
  expect(await readFile(unexpected, 'utf8')).toBe('select 123;\n'); await rm(unexpected)
  const changed = path.join(f.target, '20261024000003_fixture.sql')
  await writeFile(changed, 'select 456;\n')
  expect(f.run().stderr).toContain('Prepared migration was modified')
  expect(await readFile(changed, 'utf8')).toBe('select 456;\n')
})
