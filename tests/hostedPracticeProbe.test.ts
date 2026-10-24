import { expect, it, vi } from 'vitest'
// @ts-expect-error Operational probe is plain JavaScript, not part of the app build.
import { probeHostedPractice } from '../scripts/multiplayer/probe-hosted-practice.mjs'

const fingerprint = 'bb45039de6b0ee8539502ed6846b7d1368e647b602fee16c15322a5ce0ec35a8'
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
const healthy = async (url: string, init: RequestInit) => {
  if (url.endsWith('/healthz')) return json(200, { ok: true, protocol: 1 })
  if (url.endsWith('/readyz')) return json(200, { ready: true })
  if (url.endsWith('/manifest.json')) return json(200, { protocol: 3, simulationVersion: 1, fingerprint })
  return json((init.headers as Record<string, string>).Origin === 'https://untrusted.example' ? 403 : 401, {})
}
it('checks only public endpoints and never supplies Auth or creates an admitted seat', async () => {
  const request = vi.fn(healthy)
  const report = await probeHostedPractice(request)
  expect(report.checks).toHaveLength(5)
  for (const [url, init] of request.mock.calls) {
    expect(url).toMatch(/^https:\/\/(charly-racing-multiplayer\.fly\.dev|racing-game-jade\.vercel\.app)\//)
    expect(init.redirect).toBe('error')
    expect(init.headers).not.toHaveProperty('Authorization')
    expect(init.headers).not.toHaveProperty('apikey')
    if (init.method === 'POST') expect(url.endsWith('/rooms')).toBe(true)
  }
})
it('fails when readiness is false, a stale frontend is served or anonymous admission succeeds', async () => {
  for (const [path, response] of [
    ['/readyz', json(200, { ready: false })],
    ['/manifest.json', json(200, { protocol: 3, simulationVersion: 1, fingerprint: '0'.repeat(64) })],
    ['/rooms', json(200, { reservation: 'unexpected' })],
  ] as const) {
    await expect(probeHostedPractice((url: string, init: RequestInit) => url.endsWith(path) ? response.clone() : healthy(url, init))).rejects.toThrow()
  }
})
it('fails closed on redirect/gateway failures and network rejection', async () => {
  for (const status of [302, 503]) await expect(probeHostedPractice(() => Promise.resolve(json(status, {})))).rejects.toThrow()
  await expect(probeHostedPractice(() => Promise.reject(new Error('network unavailable')))).rejects.toThrow()
})
