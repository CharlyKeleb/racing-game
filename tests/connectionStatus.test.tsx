import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { lobbyStore } from '../src/multiplayer/lobbyStore'
import { ConnectionStatus } from '../src/ui/ConnectionStatus'
vi.mock('zustand', () => ({ useStore: (store: typeof lobbyStore, select: (value: ReturnType<typeof lobbyStore.getState>) => unknown) => select(store.getState()) }))
afterEach(() => lobbyStore.setState(lobbyStore.getInitialState(), true))
it('shows supported connected RTT and clearly distinguishes variation and display latency', () => {
  lobbyStore.setState({ status: 'connected', snapshot: { latencyProbe: true } as never,
    connectionLatency: { rttMs: 85, variationMs: 12, samples: 8 } })
  const html = renderToStaticMarkup(<ConnectionStatus />)
  expect(html).toContain('85 ms RTT'); expect(html).toContain('12 ms variation')
  expect(html).toContain('not input-to-display latency')
  expect(html).not.toContain('Johannesburg')
})
it('hides unsupported/disconnected measurements and offers an initial measuring state', () => {
  expect(renderToStaticMarkup(<ConnectionStatus />)).toBe('')
  lobbyStore.setState({ status: 'connected', snapshot: {} as never })
  expect(renderToStaticMarkup(<ConnectionStatus />)).toBe('')
  lobbyStore.setState({ snapshot: { latencyProbe: true } as never })
  expect(renderToStaticMarkup(<ConnectionStatus />)).toContain('Measuring connection')
  lobbyStore.setState({ status: 'reconnecting', connectionLatency: { rttMs: 1, variationMs: 0, samples: 1 } })
  expect(renderToStaticMarkup(<ConnectionStatus />)).toBe('')
})
