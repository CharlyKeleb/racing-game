import { expect, it, vi } from 'vitest'
// @ts-expect-error CLI helper is plain JavaScript, exercised without adding it to the app build.
import { probeSupabasePublic } from '../scripts/multiplayer/probe-supabase-public.mjs'
const projectRef = 'abcdefghijklmnopqrst'
const url = `https://${projectRef}.supabase.co`
const key = 'sb_publishable_synthetic'
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
it('probes public access without reading rows, writing records or reporting credentials', async () => {
  const request = vi.fn(async (input: string, init: RequestInit) => {
    expect(init.redirect).toBe('error')
    if (input.endsWith('/settings')) return json(200, { external: {} })
    if (input.endsWith('/user')) return json(init.headers && 'Authorization' in init.headers ? 403 : 401, { code: init.headers && 'Authorization' in init.headers ? 403 : 401, message: 'private provider diagnostic' })
    if (input.includes('/rest/v1/rpc/')) expect(init.body).toBe(input.endsWith('/record_online_practice') ? '{"race_record":{}}' : '{}')
    else expect(input).toContain('limit=0')
    return json(401, { code: '42501', message: 'private SQL diagnostic' })
  })
  const report = await probeSupabasePublic({ projectRef, url, key, request })
  expect(report.checks).toHaveLength(9)
  expect(request).toHaveBeenCalledTimes(9)
  expect(JSON.stringify(report)).not.toContain(key)
  expect(JSON.stringify(report)).not.toContain('private')
  for (const [input, init] of request.mock.calls) {
    expect(input.startsWith(url)).toBe(true)
    expect(init.method).not.toMatch(/PATCH|DELETE|PUT/)
  }
})
it('rejects privileged keys and project/origin mismatch before sending requests', async () => {
  const request = vi.fn()
  for (const config of [
    { key: 'sb_secret_privileged' },
    { key: `e30.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature` },
    { url: 'https://other.example' }, { url: `${url}/?key=sensitive` },
  ]) await expect(probeSupabasePublic({ projectRef, url, key, request, ...config })).rejects.toThrow()
  expect(request).not.toHaveBeenCalled()
})
it('fails on gateway errors or an unexpectedly permitted anonymous operation', async () => {
  for (const response of [json(503, { code: '42501' }), json(200, []), json(401, { code: 'bad_jwt' })]) {
    const request = vi.fn().mockResolvedValueOnce(json(200, {})).mockResolvedValueOnce(response)
    await expect(probeSupabasePublic({ projectRef, url, key, request })).rejects.toThrow()
  }
})
