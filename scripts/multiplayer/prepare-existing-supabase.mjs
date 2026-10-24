// Local-only plan construction. Never authenticates, repairs history or applies SQL.
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const mapping = JSON.parse(await readFile(path.join(root, 'supabase/existing-project-migrations.json'), 'utf8'))
if (!/^[a-z]{20}$/.test(mapping.projectRef)) throw new Error('Invalid existing Supabase project reference')
const linked = path.join(root, '.cache/multiplayer/supabase-cli/supabase')
const workspace = path.join(root, '.cache/multiplayer/supabase-deploy')
const target = path.join(workspace, 'supabase')
const linkedProject = (await readFile(path.join(linked, '.temp/project-ref'), 'utf8')).trim()
if (linkedProject !== mapping.projectRef) throw new Error('Linked project does not match the reviewed migration map')
const names = new Set(), versions = new Set(), prepared = []
let previous = ''
for (const row of [mapping.legacyUntracked, ...mapping.migrations]) {
  if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(row.source) || !/^[a-f0-9]{64}$/.test(row.sha256)) throw new Error('Invalid migration source mapping')
  const bytes = await readFile(path.join(root, 'supabase/migrations', row.source))
  if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new Error(`Migration source changed: ${row.source}`)
  if (row === mapping.legacyUntracked) continue
  if (!/^\d{14}$/.test(row.version) || versions.has(row.version) || row.version <= previous) throw new Error('Migration versions must be distinct and increasing')
  versions.add(row.version); previous = row.version
  const filename = `${row.version}_${row.source.slice(row.source.indexOf('_') + 1)}`
  if (names.has(filename)) throw new Error('Duplicate migration filename')
  names.add(filename); prepared.push({ ...row, filename, bytes })
}
if (!prepared.length) throw new Error('Empty migration map')
await mkdir(path.join(target, 'migrations'), { recursive: true, mode: 0o700 })
for (const entry of await readdir(path.join(target, 'migrations'))) if (!names.has(entry)) throw new Error('Unexpected file in prepared migration directory')
for (const row of prepared) {
  const destination = path.join(target, 'migrations', row.filename)
  try {
    if (!(await readFile(destination)).equals(row.bytes)) throw new Error('Prepared migration was modified; inspect it before regenerating')
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  await writeFile(destination, row.bytes, { mode: 0o600 })
}
await cp(path.join(linked, 'config.toml'), path.join(target, 'config.toml'))
await cp(path.join(linked, '.temp'), path.join(target, '.temp'), { recursive: true })
const plan = { projectRef: mapping.projectRef, legacyUntracked: mapping.legacyUntracked,
  migrations: prepared.map(({ bytes: _bytes, ...row }) => row) }
await writeFile(path.join(workspace, 'plan.json'), JSON.stringify(plan, null, 2) + '\n', { mode: 0o600 })
console.info(JSON.stringify({ projectRef: mapping.projectRef, workspace, versions: [...versions], sourceHashesVerified: true,
  remoteChanges: false }, null, 2))
