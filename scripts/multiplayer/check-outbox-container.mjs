// Local offline recovery drill: ephemeral Docker volume, synthetic result/key, no network.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
const image = process.argv[2] ?? 'racing-practice-staging'
const suffix = randomUUID(), volume = `practice-outbox-${suffix}`, name = `practice-outbox-check-${suffix}`
const docker = args => {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 35_000 })
  if (result.error) throw result.error
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
const record = { schema: 1, protocol: 2, ruleset: 'online-practice-v1', fingerprint: 'a'.repeat(64), simulationVersion: 1,
  result: { raceId: randomUUID(), track: 'nurburgring', laps: 2, tickRate: 60, completedTick: 400, reason: 'all-finished',
    racers: [ { id: randomUUID(), carId: 'porsche911', status: 'finished', rank: 1, finishTicks: 200, lapTicks: [100, 100] },
      { id: randomUUID(), carId: 'diablo', status: 'finished', rank: 2, finishTicks: 220, lapTicks: [110, 110] } ] } }
const bytes = JSON.stringify(record), hash = createHash('sha256').update(bytes).digest('hex')
const filename = `${record.result.raceId}.json`
const isolation = ['--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '512m', '--cpus', '1']
const mount = ['--mount', `type=volume,source=${volume},target=/outbox`]
const reports = []
let volumeCreated = false, running = false
try {
  docker(['volume', 'create', volume]); volumeCreated = true
  // Root only initializes the new disposable volume; server containers run as node.
  docker(['run', '--rm', '--network', 'none', '--read-only', '--user', '0:0', ...mount, image, 'node', '--input-type=module', '-e', `
    import fs from 'node:fs';
    fs.chmodSync('/outbox',0o700); fs.chownSync('/outbox',1000,1000);
    const file='/outbox/'+${JSON.stringify(filename)};
    fs.writeFileSync(file,${JSON.stringify(bytes)},{mode:0o600}); fs.chownSync(file,1000,1000);`])
  for (let boot = 1; boot <= 2; boot++) {
    docker(['run', '-d', '--name', name, ...isolation, ...mount,
      '-e', 'PRACTICE_SERVER_ENABLED=1', '-e', 'SUPABASE_URL=https://staging.example.test',
      '-e', 'SUPABASE_PUBLISHABLE_KEY=synthetic-public-key', '-e', 'ALLOWED_ORIGINS=https://game.example.test',
      '-e', 'SUPABASE_RESULT_SECRET_KEY=sb_secret_synthetic_offline_check', '-e', 'RESULT_OUTBOX_DIR=/outbox', image]); running = true
    const report = JSON.parse(docker(['exec', name, 'node', '--input-type=module', '-e', `
      import fs from 'node:fs'; import assert from 'node:assert/strict'; import {createHash} from 'node:crypto';
      assert.equal(process.getuid(),1000);
      let ready=false;
      for(let i=0;i<50;i++) {
        try {const response=await fetch('http://127.0.0.1:2567/readyz'); ready=response.ok && (await response.json()).ready; if(ready) break;} catch {}
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      assert.equal(ready,true);
      await new Promise(resolve=>setTimeout(resolve,1500));
      assert.deepEqual(fs.readdirSync('/outbox'),[${JSON.stringify(filename)}]);
      assert.equal(fs.statSync('/outbox').mode&0o777,0o700);
      assert.equal(fs.statSync('/outbox/'+${JSON.stringify(filename)}).mode&0o777,0o600);
      const hash=createHash('sha256').update(fs.readFileSync('/outbox/'+${JSON.stringify(filename)})).digest('hex');
      assert.equal(hash,${JSON.stringify(hash)});
      console.log(JSON.stringify({uid:process.getuid(),ready,pendingFiles:1,exactRecordHash:hash,directoryMode:'0700',recordMode:'0600'}));`]))
    if (boot === 1) docker(['kill', '--signal', 'KILL', name])
    else docker(['stop', '--time', '25', name])
    const state = JSON.parse(docker(['inspect', name]))[0].State
    assert.equal(state.ExitCode, boot === 1 ? 137 : 0, 'Crash exits 137; a durable queued record permits clean graceful shutdown')
    assert.equal(state.OOMKilled, false)
    if (boot === 2) assert.match(docker(['logs', name]), /Practice shutdown/)
    reports.push({ boot, ...report, termination: boot === 1 ? 'SIGKILL' : 'SIGTERM', shutdownExitCode: state.ExitCode })
    docker(['rm', name]); running = false
  }
} finally {
  if (running) docker(['rm', '-f', name])
  if (volumeCreated) docker(['volume', 'rm', volume])
}
console.info(JSON.stringify({ recordedAt: new Date().toISOString(), check: 'offline-container-outbox-restart',
  imageId: JSON.parse(docker(['image', 'inspect', image]))[0].Id, boots: reports,
  network: 'none', externalPorts: false, volumeRemoved: true,
  scope: 'Same exact pending synthetic record retained across SIGKILL and a fresh container process on one local disposable volume, followed by graceful shutdown. No live DB outage, real result key, authenticated race, successful HTTP commit or hosted storage tested.' }, null, 2))
