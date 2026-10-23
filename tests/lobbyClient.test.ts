import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const sdk = vi.hoisted(() => ({ consume: vi.fn() }))
vi.mock('@colyseus/sdk', () => ({ Client: class { consumeSeatReservation = sdk.consume } }))
let lobby: typeof import('../src/multiplayer/LobbyClient')
let account: typeof import('../src/stores/accountStore')
function fakeRoom() {
  return { sessionId: 'seat', reconnection: { enabled: true }, connection: { isOpen: true }, send: vi.fn(), leave: vi.fn(async () => {}), onMessage: vi.fn(), onLeave: vi.fn(), onError: vi.fn() }
}
beforeEach(async () => {
  vi.resetModules()
  vi.stubEnv('VITE_MULTIPLAYER_URL', 'http://localhost:2567')
  account = await import('../src/stores/accountStore')
  account.accountStore.setState({ status: 'signedIn', player: { id: 'player1', email: null, name: null, avatarUrl: null } })
  lobby = await import('../src/multiplayer/LobbyClient')
  sdk.consume.mockReset()
})
afterEach(async () => { await lobby.leaveLobby(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })
it('requests a private seat with a bearer token and syncs after joining', async () => {
  const room = fakeRoom()
  sdk.consume.mockResolvedValue(room)
  const request = vi.fn(async () => new Response(JSON.stringify({ sessionId: 'seat' })))
  vi.stubGlobal('fetch', request)
  await lobby.enterLobby('create', '', 'porsche911', async () => 'test-token')
  expect(request.mock.calls[0]).toMatchObject(['http://localhost:2567/rooms', { headers: { Authorization: 'Bearer test-token' } }])
  expect(room.send).toHaveBeenCalledWith('sync')
  expect(room.reconnection.enabled).toBe(false)
  expect(lobby.lobbyStore.getState().status).toBe('connected')
  account.accountStore.setState({ player: null })
  expect(lobby.lobbyStore.getState().status).toBe('idle')
  expect(room.leave).toHaveBeenCalledTimes(1)
})
it('cancels admission if the account changes during the HTTP request', async () => {
  let finish!: (response: Response) => void
  vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => { finish = resolve }))
  const pending = lobby.enterLobby('create', '', 'porsche911', async () => 'test-token')
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  account.accountStore.setState({ player: null })
  finish(new Response(JSON.stringify({ sessionId: 'seat' })))
  await pending
  expect(lobby.lobbyStore.getState().status).toBe('idle')
  expect(sdk.consume).not.toHaveBeenCalled()
})
it('shows server errors and permits retry', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'Create your racer first.' }), { status: 403 }))
  await lobby.enterLobby('join', 'ABCDEFGH', 'porsche911', async () => 'test-token')
  expect(lobby.lobbyStore.getState()).toMatchObject({ status: 'idle', error: 'Create your racer first.' })
})
it('times out a stalled handshake and releases a seat that connects too late', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ sessionId: 'seat' })))
  let connect!: (room: ReturnType<typeof fakeRoom>) => void
  sdk.consume.mockImplementation(() => new Promise((resolve) => { connect = resolve }))
  const pending = lobby.enterLobby('create', '', 'porsche911', async () => 'test-token')
  await vi.advanceTimersByTimeAsync(10_001)
  await pending
  expect(lobby.lobbyStore.getState()).toMatchObject({ status: 'idle', error: expect.stringContaining('timed out') })
  const room = fakeRoom()
  connect(room)
  await vi.advanceTimersByTimeAsync(0)
  expect(room.leave).toHaveBeenCalledTimes(1)
})
