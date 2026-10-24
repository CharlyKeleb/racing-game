// Public operational checks only: no keys, player sessions, room codes or race writes.
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const backend = 'https://charly-racing-multiplayer.fly.dev'
const frontend = 'https://racing-game-jade.vercel.app'
const fingerprint = 'bb45039de6b0ee8539502ed6846b7d1368e647b602fee16c15322a5ce0ec35a8'

export async function probeHostedPractice(request = fetch) {
  const specs = [
    { name: 'health', url: backend + '/healthz', status: 200, validate: value => value.ok === true && value.protocol === 1 },
    { name: 'ready', url: backend + '/readyz', status: 200, validate: value => value.ready === true },
    { name: 'frontend-manifest', url: frontend + '/multiplayer/manifest.json', status: 200,
      validate: value => value.protocol === 3 && value.simulationVersion === 1 && value.fingerprint === fingerprint },
    { name: 'unsigned-admission-denied', url: backend + '/rooms', status: 401,
      method: 'POST', origin: frontend, body: { protocol: 1, action: 'create', carId: 'porsche911' } },
    { name: 'foreign-origin-denied', url: backend + '/rooms', status: 403,
      method: 'POST', origin: 'https://untrusted.example', body: {} },
  ]
  const checks = await Promise.all(specs.map(async spec => {
    const response = await request(spec.url, { method: spec.method ?? 'GET', redirect: 'error',
      signal: AbortSignal.timeout(8000), headers: { 'Cache-Control': 'no-cache',
        ...(spec.origin ? { Origin: spec.origin } : {}), ...(spec.body ? { 'Content-Type': 'application/json' } : {}) },
      ...(spec.body ? { body: JSON.stringify(spec.body) } : {}) })
    assert.equal(response.status, spec.status, `${spec.name}: unexpected HTTP status`)
    if (spec.validate) assert.ok(spec.validate(await response.json()), `${spec.name}: invalid public response`)
    return { name: spec.name, status: response.status }
  }))
  return { recordedAt: new Date().toISOString(), check: 'hosted-private-practice', checks,
    scope: 'Public health/readiness, pinned frontend manifest and unauthenticated/origin denials; not an authenticated race or spending check.' }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.deepEqual(process.argv.slice(2), ['--live'], 'Explicit --live is required')
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { console.info(JSON.stringify(await probeHostedPractice(), null, 2)); break }
    catch {
      // Remote bodies/network exception details are not included in operational logs.
      console.error(`Hosted private-practice check failed (attempt ${attempt}/3)`)
      if (attempt === 3) process.exitCode = 1
      else await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }
}
