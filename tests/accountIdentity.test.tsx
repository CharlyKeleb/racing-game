import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { accountStore } from '../src/stores/accountStore'
import { AccountButton, AccountDialog } from '../src/ui/Account'

vi.mock('../src/ui/hooks', () => ({
  useAccount: (select: (s: ReturnType<typeof accountStore.getState>) => unknown) => select(accountStore.getState()),
}))
vi.mock('../src/ui/GameContext', () => ({ useGameInstance: () => null }))
afterEach(() => accountStore.setState(accountStore.getInitialState(), true))
const player = { id: 'player', email: 'private@example.com', name: 'Provider Name', avatarUrl: null }
it('shows onboarding without deriving a public identity from email', () => {
  accountStore.setState({ status: 'signedIn', player, profileStatus: 'ready' })
  const chip = renderToStaticMarkup(<AccountButton onOpen={() => {}} />)
  expect(chip).toContain('Create your racer')
  expect(chip).not.toContain(player.email)
  const dialog = renderToStaticMarkup(<AccountDialog onClose={() => {}} />)
  expect(dialog).toContain('Create racer')
  expect(dialog).toContain('Username')
})
it('renders stored identity safely and leaves renames available', () => {
  accountStore.setState({ status: 'signedIn', player, profileStatus: 'ready', profile: { id: player.id, handle: 'nightshift_7', display_name: '<Racer>', handle_changed_at: new Date().toISOString() } })
  const chip = renderToStaticMarkup(<AccountButton onOpen={() => {}} />)
  expect(chip).toContain('&lt;Racer&gt;')
  expect(chip).not.toContain(player.email)
  const dialog = renderToStaticMarkup(<AccountDialog onClose={() => {}} />)
  expect(dialog).toContain('@nightshift_7')
  expect(dialog).not.toContain('rename on')
  expect(dialog).toContain('Save racer')
})
it('offers retry when the profile cannot load', () => {
  accountStore.setState({ status: 'signedIn', player, profileStatus: 'error', profileError: 'Could not load your racer.' })
  expect(renderToStaticMarkup(<AccountDialog onClose={() => {}} />)).toContain('Retry racer profile')
})
it('offers private race history for an existing racer', () => {
  accountStore.setState({ status: 'signedIn', player, profileStatus: 'ready', profile: { id: player.id, handle: 'nightshift_7', display_name: 'Night Shift', handle_changed_at: new Date().toISOString() } })
  const dialog = renderToStaticMarkup(<AccountDialog onClose={() => {}} />)
  expect(dialog).toContain('Race history')
  expect(dialog).toContain('Your racer')
})
