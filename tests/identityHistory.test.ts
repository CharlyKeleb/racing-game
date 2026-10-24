import { afterEach, expect, it, vi } from 'vitest'
import { IdentityHistory } from '../src/cloud/IdentityHistoryLoader'
import { parseIdentityHistoryPage, type IdentityHistoryEntry } from '../src/cloud/identityHistoryData'
import { accountStore } from '../src/stores/accountStore'
import { identityHistoryStore } from '../src/stores/identityHistoryStore'
const owners = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002']
const row = (index = 1): IdentityHistoryEntry => ({ event_id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  player_id: owners[0], recorded_at: '2026-10-23T20:00:00.123456+00:00', kind: 'renamed', old_handle: 'nightshift',
  old_display_name: 'Night Shift', new_handle: 'apex_runner', new_display_name: 'Étoile <Racer>' })
const loaders: IdentityHistory[] = []
const player = (id: string) => ({ id, email: null, name: null, avatarUrl: null })
afterEach(() => {
  for (const loader of loaders.splice(0)) loader.dispose()
  accountStore.setState(accountStore.getInitialState(), true)
  identityHistoryStore.setState(identityHistoryStore.getInitialState(), true)
  vi.useRealTimers()
})
function fixture(clientDelay?: Promise<unknown>) {
  accountStore.setState({ player: player(owners[0]) })
  const response = vi.fn(), rpc = vi.fn(() => ({ abortSignal: response }))
  const loader = new IdentityHistory(async () => { await clientDelay; return { rpc } as never }, () => accountStore.getState().player?.id ?? null)
  loaders.push(loader)
  return { loader, response, rpc }
}
it('pages with the exact microsecond cursor, bounds memory and retries the failed page', async () => {
  const f = fixture(), first = Array.from({ length: 21 }, (_, i) => row(i))
  f.response.mockResolvedValueOnce({ data: first, error: null })
  await f.loader.load()
  expect(identityHistoryStore.getState()).toMatchObject({ status: 'ready', rows: first.slice(0, 20), hasMore: true,
    cursor: { at: row(19).recorded_at, id: row(19).event_id } })
  f.response.mockResolvedValueOnce({ data: null, error: { message: 'private database details' } })
  await f.loader.load(true)
  expect(identityHistoryStore.getState()).toMatchObject({ status: 'error', rows: first.slice(0, 20), hasMore: true })
  expect(identityHistoryStore.getState().error).not.toContain('database details')
  f.response.mockResolvedValueOnce({ data: [row(20)], error: null })
  await f.loader.load(true)
  expect(f.rpc).toHaveBeenLastCalledWith('my_racer_identity_history', { before_at: row(19).recorded_at, before_id: row(19).event_id })
  expect(identityHistoryStore.getState()).toMatchObject({ status: 'ready', rows: [row(20)], hasMore: false })
  await f.loader.load(true)
  expect(f.rpc).toHaveBeenCalledTimes(3)
})
it('clears on A → B → A and cannot publish the old A response', async () => {
  const f = fixture()
  let finish!: (value: unknown) => void
  f.response.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = f.loader.load()
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  const signal = f.response.mock.calls[0][0] as AbortSignal
  accountStore.setState({ player: player(owners[1]) })
  expect(signal.aborted).toBe(true)
  expect(identityHistoryStore.getState()).toMatchObject({ playerId: owners[1], rows: [], status: 'idle' })
  accountStore.setState({ player: player(owners[0]) })
  finish({ data: [row()], error: null }); await pending
  expect(identityHistoryStore.getState()).toMatchObject({ rows: [], status: 'idle' })
  accountStore.setState({ player: null })
  expect(identityHistoryStore.getState().playerId).toBeNull()
})
it('does not send an old request when client initialization crosses an account switch', async () => {
  let finish!: () => void
  const f = fixture(new Promise<void>(resolve => { finish = resolve }))
  const pending = f.loader.load()
  accountStore.setState({ player: player(owners[1]) })
  finish(); await pending
  expect(f.rpc).not.toHaveBeenCalled()
  expect(identityHistoryStore.getState().status).toBe('idle')
})
it('refresh supersedes an earlier page and disposal clears private rows', async () => {
  const f = fixture()
  let finish!: (value: unknown) => void
  f.response.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const old = f.loader.load()
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  f.response.mockResolvedValueOnce({ data: [row(2)], error: null }); await f.loader.load()
  finish({ data: [row(1)], error: null }); await old
  expect(identityHistoryStore.getState().rows).toEqual([row(2)])
  f.loader.dispose()
  expect(identityHistoryStore.getState()).toMatchObject({ playerId: null, rows: [], status: 'idle' })
  await f.loader.load(); expect(f.rpc).toHaveBeenCalledTimes(2)
})
it('invalidates cached names and in-flight reads after a profile save', async () => {
  const f = fixture()
  f.response.mockResolvedValueOnce({ data: [row()], error: null }); await f.loader.load()
  let finish!: (value: unknown) => void
  f.response.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = f.loader.load()
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  f.loader.invalidate()
  finish({ data: [row()], error: null }); await pending
  expect(identityHistoryStore.getState()).toMatchObject({ status: 'idle', rows: [] })
})
it('fails closed on foreign, oversized, duplicate or malformed identity rows and strips unknown fields', () => {
  const changes = [{ player_id: owners[1] }, { event_id: 'bad' }, { kind: 'moderator' }, { recorded_at: 'tomorrow' },
    { new_handle: 'UPPER' }, { new_display_name: 'x\u202ey' }, { new_display_name: 'E\u0301toile' },
    { old_handle: null }, { old_handle: 'apex_runner', old_display_name: 'Étoile <Racer>' },
    { kind: 'created' }, { kind: 'baseline', old_handle: null }]
  for (const change of changes) expect(() => parseIdentityHistoryPage([{ ...row(), ...change }], owners[0])).toThrow()
  expect(() => parseIdentityHistoryPage([row(), row()], owners[0])).toThrow()
  expect(() => parseIdentityHistoryPage(Array(22).fill(row()), owners[0])).toThrow()
  for (const kind of ['baseline', 'created'] as const) expect(parseIdentityHistoryPage([{ ...row(), kind, old_handle: null, old_display_name: null }], owners[0])[0].kind).toBe(kind)
  const source = { ...row(), email: 'never copy private extras' }, parsed = parseIdentityHistoryPage([source], owners[0])
  source.new_display_name = 'Changed after parsing'
  expect(parsed[0].new_display_name).toBe('Étoile <Racer>')
  expect(parsed[0]).not.toHaveProperty('email')
})
it('does not display partial rows when the response contains a foreign owner', async () => {
  const f = fixture()
  f.response.mockResolvedValueOnce({ data: [row(), { ...row(2), player_id: owners[1] }], error: null })
  await f.loader.load()
  expect(identityHistoryStore.getState()).toMatchObject({ status: 'error', rows: [] })
})
