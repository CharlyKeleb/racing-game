import { afterEach, expect, it, vi } from 'vitest'
import { AssetManager } from '../src/engine/AssetManager'

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => vi.unstubAllGlobals())

it('retries a download that failed on the network instead of reporting the file missing', async () => {
  const fetch = vi.fn()
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(json({ ok: 1 }, 503))
    .mockResolvedValueOnce(json({ id: 'canyon' }))
  vi.stubGlobal('fetch', fetch)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(await new AssetManager().loadJson('/models/tracks/canyon/track.json')).toEqual({ id: 'canyon' })
  expect(fetch).toHaveBeenCalledTimes(3)
}, 10_000)

it('does not retry a file that is not there', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response('nope', { status: 404 }))
    .mockResolvedValueOnce(new Response('<html></html>', { headers: { 'content-type': 'text/html' } }))
  vi.stubGlobal('fetch', fetch)
  const assets = new AssetManager()
  expect(await assets.loadJson('/missing.json')).toBeNull()
  expect(await assets.loadBinary('/spa-fallback.bin')).toBeNull()
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('gives up after the retries and reports it, rather than hanging', async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
  vi.stubGlobal('fetch', fetch)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(await new AssetManager().loadBinary('/chunk.glb')).toBeNull()
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(warn).toHaveBeenCalled()
}, 10_000)
