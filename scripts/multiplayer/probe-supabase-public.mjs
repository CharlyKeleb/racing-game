// Read-only public gateway probes. No player sessions or privileged keys are accepted.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { pathToFileURL } from 'node:url'

export async function probeSupabasePublic({ projectRef, url, key, request = fetch }) {
  const endpoint = new URL(url)
  assert.match(projectRef, /^[a-z]{20}$/)
  assert.equal(endpoint.origin, `https://${projectRef}.supabase.co`)
  assert.equal(endpoint.pathname, '/')
  assert.ok(!endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash)
  let role
  if (!key.startsWith('sb_publishable_')) {
    try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role } catch { /* Reject below. */ }
    assert.equal(role, 'anon', 'Public gateway probes require a publishable/anon key')
  }
  const checks = []
  async function check(name, path, { method = 'GET', body, token, permission = false, auth = false } = {}) {
    const response = await request(`${endpoint.origin}${path}`, {
      method, headers: { apikey: key, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000), redirect: 'error',
    })
    let data
    try { data = await response.json() } catch { throw new Error(`Non-JSON gateway response: ${name}`) }
    if (permission) {
      assert.equal(response.status, 401, `${name}: expected anonymous denial`)
      assert.equal(data.code, '42501', `${name}: expected SQL permission denial`)
    } else if (auth) {
      assert.ok([401, 403].includes(response.status), `${name}: expected Auth denial`)
      assert.ok(data.code === response.status || ['bad_jwt', 'no_authorization', 'session_not_found'].includes(data.code), `${name}: unexpected Auth error response`)
    } else assert.equal(response.status, 200, `${name}: public key/project check failed`)
    checks.push({ name, status: response.status, ...((permission || auth) ? { code: data.code } : {}) })
  }
  await check('public-key-project-reachable', '/auth/v1/settings')
  for (const table of ['online_practice_races', 'online_practice_history', 'racer_identity_events']) {
    // limit=0 avoids reading account/history rows even if an ACL has regressed.
    await check(`anonymous-${table}-read-denied`, `/rest/v1/${table}?select=*&limit=0`, { permission: true })
  }
  for (const rpc of ['my_online_practice_history', 'my_racer_identity_history', 'record_online_practice']) {
    await check(`anonymous-${rpc}-denied`, `/rest/v1/rpc/${rpc}`, { method: 'POST', body: rpc === 'record_online_practice' ? { race_record: {} } : {}, permission: true })
  }
  // A malformed signature is never a valid session, even when its claims look current.
  const forged = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: '00000000-0000-4000-8000-000000000001', role: 'authenticated', aud: 'authenticated',
      iss: `${endpoint.origin}/auth/v1`, exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url'),
    Buffer.alloc(32).toString('base64url')].join('.')
  await check('missing-session-denied', '/auth/v1/user', { auth: true })
  await check('forged-session-denied', '/auth/v1/user', { auth: true, token: forged })
  return { recordedAt: new Date().toISOString(), projectRef, check: 'public-supabase-http-gateway', checks,
    scope: 'Public key, anonymous SQL permissions and missing/forged session rejection only. No valid player session, real token expiry, result write or physical device tested.' }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.deepEqual(process.argv.slice(2), ['--live'], 'Use --live to explicitly enable network probes')
  const root = new URL('../../', import.meta.url)
  const mapping = JSON.parse(await readFile(new URL('supabase/existing-project-migrations.json', root), 'utf8'))
  const env = parseEnv(await readFile(new URL('.env.local', root), 'utf8'))
  console.info(JSON.stringify(await probeSupabasePublic({ projectRef: mapping.projectRef, url: env.VITE_SUPABASE_URL,
    key: env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? '' }), null, 2))
}
