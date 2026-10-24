// Local Docker acceptance only: synthetic configuration, no external network or ports.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
const image = process.argv[2] ?? 'racing-practice-staging'
const name = `practice-check-${randomUUID()}`
const docker = (args, timeout = 30_000) => {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout })
  if (result.error) throw result.error
  return result
}
const checked = args => {
  const result = docker(args)
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
const isolation = ['--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '512m', '--cpus', '1']
const environment = ['-e', 'PRACTICE_SERVER_ENABLED=1', '-e', 'SUPABASE_URL=https://staging.example.test',
  '-e', 'SUPABASE_PUBLISHABLE_KEY=synthetic-public-key', '-e', 'ALLOWED_ORIGINS=https://game.example.test']
const metadata = JSON.parse(checked(['image', 'inspect', image]))[0]
assert.equal(metadata.Config.User, 'node')
const manifest = JSON.parse(await readFile(new URL('../../public/multiplayer/manifest.json', import.meta.url), 'utf8'))
const disabled = docker(['run', '--rm', ...isolation, image])
assert.equal(disabled.status, 1)
assert.match(disabled.stderr, /Explicitly enable the isolated practice server/)
const samples = []
for (const scheduling of ['0', '1']) {
  const report = JSON.parse(checked(['run', '--rm', ...isolation, ...environment, '-e', `MULTIPLAYER_SCHEDULED_INPUTS=${scheduling}`,
    image, 'node', 'dist-race/server.mjs', '--check-assets']))
  assert.equal(report.check, 'practice-assets')
  assert.equal(report.fingerprint, manifest.fingerprint)
  assert.equal(report.racers, 2); assert.equal(report.ticks, 12)
  assert.equal(report.correctionVersion, 1)
  assert.equal(report.scheduledInputVersion, scheduling === '1' ? 1 : null)
  samples.push(report)
}
let boot
try {
  checked(['run', '-d', '--name', name, ...isolation, ...environment, image])
  const probe = `
    if (process.getuid() !== 1000) throw new Error('Unexpected runtime UID');
    for (let i=0; i<50; i++) {
      try {
        const health=await fetch('http://127.0.0.1:2567/healthz');
        const ready=await fetch('http://127.0.0.1:2567/readyz');
        if (!health.ok || !ready.ok) throw new Error('Not ready');
        const h=await health.json(), r=await ready.json();
        if (!h.ok || !r.ready) throw new Error('Invalid health response');
        console.log(JSON.stringify({uid:process.getuid(),health:h,readiness:r})); process.exit(0);
      } catch { await new Promise(resolve=>setTimeout(resolve,100)); }
    }
    throw new Error('Container failed readiness');`
  boot = JSON.parse(checked(['exec', name, 'node', '--input-type=module', '-e', probe]))
  checked(['stop', '--time', '25', name])
  const state = JSON.parse(checked(['inspect', name]))[0].State
  assert.equal(state.ExitCode, 0); assert.equal(state.OOMKilled, false)
  assert.match(checked(['logs', name]), /Practice shutdown/)
} finally {
  const removed = docker(['rm', '-f', name])
  if (removed.status !== 0) console.error('Container cleanup failed:', name)
}
console.info(JSON.stringify({ recordedAt: new Date().toISOString(), check: 'isolated-practice-container',
  image: { id: metadata.Id, architecture: metadata.Architecture, os: metadata.Os, bytes: metadata.Size },
  limits: { memoryMiB: 512, cpus: 1, network: 'none', readOnly: true, externalPorts: false },
  implicitEnablementRejected: true, assetSamples: samples, boot, gracefulShutdownExitCode: 0,
  scope: 'Local image build/boot, two-car twelve-tick checks and idle health/shutdown only. No hosted capacity, authenticated race, physical device or production credentials tested.' }, null, 2))
