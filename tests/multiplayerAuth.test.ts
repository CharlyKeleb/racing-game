import { afterEach, expect, it, vi } from 'vitest'
import { supabaseAuthenticator } from '../server/src/auth'
const id = '00000000-0000-0000-0000-000000000001'
const url = 'https://racer-test.supabase.co'
function token(claims: Record<string, unknown> = {}) {
  return [Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: id, iss: `${url}/auth/v1`, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 60, ...claims })).toString('base64url'), 'fake-test-signature'].join('.')
}
function authFetch(validSignature: boolean, hasProfile = true) {
  const mock = vi.fn(async (input: string | URL | Request) => {
    const path = String(input)
    if (path.includes('/auth/v1/user')) return new Response(JSON.stringify(validSignature ? { id, aud: 'authenticated', role: 'authenticated', user_metadata: { handle: 'admin' }, app_metadata: {}, created_at: '' } : { msg: 'Invalid JWT', code: 'bad_jwt' }), { status: validSignature ? 200 : 401, headers: { 'Content-Type': 'application/json' } })
    return new Response(JSON.stringify(hasProfile ? { id, handle: 'real_racer', display_name: 'Real Racer' } : null), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', mock)
  return mock
}
afterEach(() => vi.unstubAllGlobals())
it('rejects a signature rejected by Supabase without loading a profile', async () => {
  const mock = authFetch(false)
  await expect(supabaseAuthenticator(url, 'public-key')(token())).rejects.toMatchObject({ status: 401 })
  expect(mock).toHaveBeenCalledTimes(1)
})
it.each([{ iss: 'https://other.supabase.co/auth/v1' }, { aud: 'service_role' }, { sub: 'another-user' }, { exp: 1 }])('checks verified token issuer, audience, UUID and expiry: %j', async (claims) => {
  authFetch(true)
  await expect(supabaseAuthenticator(url, 'public-key')(token(claims))).rejects.toMatchObject({ status: 401 })
})
it('requires a completed profile', async () => {
  authFetch(true, false)
  await expect(supabaseAuthenticator(url, 'public-key')(token())).rejects.toMatchObject({ status: 403 })
})
it('uses server-read identity rather than user metadata and scopes profile fetch to the verified UUID', async () => {
  const mock = authFetch(true)
  const result = await supabaseAuthenticator(url, 'public-key')(token())
  expect(result).toMatchObject({ id, handle: 'real_racer', displayName: 'Real Racer' })
  expect(String(mock.mock.calls[1][0])).toContain(`id=eq.${id}`)
})
it('rejects a token that expires while its owner profile is loading', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)
  const signed = token()
  const fetch = authFetch(true)
  const base = fetch.getMockImplementation()!
  fetch.mockImplementation(async input => {
    const response = await base(input)
    if (String(input).includes('/rest/v1/profiles')) clock.mockReturnValue(1_800_000_060_000)
    return response
  })
  try { await expect(supabaseAuthenticator(url, 'public-key')(signed)).rejects.toMatchObject({ status: 401 }) }
  finally { clock.mockRestore() }
})
