import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { IdentityHistoryPanel } from '../src/ui/IdentityHistoryPanel'
import { identityHistoryStore } from '../src/stores/identityHistoryStore'
import { accountStore } from '../src/stores/accountStore'
const id = '10000000-0000-4000-8000-000000000001'
vi.mock('zustand', () => ({ useStore: (store: { getState(): unknown }) => store.getState() }))
vi.mock('../src/ui/hooks', () => ({ useAccount: (select: (s: ReturnType<typeof accountStore.getState>) => unknown) => select(accountStore.getState()) }))
vi.mock('../src/ui/GameContext', () => ({ useGameInstance: () => ({ loadIdentityHistory: vi.fn() }) }))
afterEach(() => {
  accountStore.setState(accountStore.getInitialState(), true)
  identityHistoryStore.setState(identityHistoryStore.getInitialState(), true)
})
function fixture() {
  accountStore.setState({ player: { id, email: 'private@example.com', name: null, avatarUrl: null } })
  identityHistoryStore.setState({ playerId: id, status: 'ready', rows: [{ event_id: id, player_id: id,
    recorded_at: '2026-10-23T20:00:00Z', kind: 'renamed', old_handle: 'before_name', old_display_name: '<Old racer>',
    new_handle: 'after_name', new_display_name: '<New racer>' }] })
}
it('escapes both names and displays old/new handles without account metadata', () => {
  fixture()
  const html = renderToStaticMarkup(<IdentityHistoryPanel />)
  expect(html).toContain('&lt;Old racer&gt;'); expect(html).toContain('&lt;New racer&gt;')
  expect(html).toContain('@before_name'); expect(html).toContain('@after_name')
  expect(html).toContain('Only you can see this history')
  expect(html).not.toContain('private@example.com')
})
it('hides another account’s rows immediately even before the loader clears its store', () => {
  fixture(); accountStore.setState({ player: { id: 'different', email: null, name: null, avatarUrl: null } })
  const html = renderToStaticMarkup(<IdentityHistoryPanel />)
  expect(html).not.toContain('Old racer'); expect(html).not.toContain('after_name')
})
it('labels a baseline honestly and exposes retry/empty states', () => {
  fixture()
  identityHistoryStore.setState({ rows: [{ ...identityHistoryStore.getState().rows[0], kind: 'baseline', old_handle: null, old_display_name: null }] })
  let html = renderToStaticMarkup(<IdentityHistoryPanel />)
  expect(html).toContain('Name tracking began'); expect(html).not.toContain('Previously')
  identityHistoryStore.setState({ rows: [], status: 'error', error: 'Could not load your name history. Please retry.' })
  html = renderToStaticMarkup(<IdentityHistoryPanel />)
  expect(html).toContain('role="alert"'); expect(html).toContain('Retry name history')
  identityHistoryStore.setState({ status: 'ready' })
  expect(renderToStaticMarkup(<IdentityHistoryPanel />)).toContain('No saved name changes yet.')
})
