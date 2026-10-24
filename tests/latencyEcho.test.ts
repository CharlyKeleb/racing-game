import type { Client } from '@colyseus/core'
import { expect, it, vi } from 'vitest'
import { LobbyRoom } from '../server/src/LobbyRoom'

it('echoes bounded integers only for authenticated connected seats under the shared control budget', () => {
  const room = new LobbyRoom(), handlers = new Map<string, (client: Client, value: unknown) => void>()
  vi.spyOn(room, 'setPrivate').mockResolvedValue(undefined as never)
  vi.spyOn(room, 'onMessage').mockImplementation(((type: string, handler: (client: Client, value: unknown) => void) => {
    handlers.set(type, handler)
  }) as never)
  const client = { sessionId: 'seat', send: vi.fn() } as unknown as Client
  const now = vi.spyOn(performance, 'now').mockReturnValue(0)
  try {
    room.onCreate()
    expect(room.snapshot().latencyProbe).toBe(true)
    const echo = handlers.get('latency')!
    echo(client, 0)
    expect(client.send).not.toHaveBeenCalled()
    room.racers.set('seat', { sessionId: 'seat', id: 'owner', handle: 'racer', displayName: 'Racer', carId: 'porsche911', ready: false, connected: true })
    for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', {}, null]) {
      now.mockReturnValue(now() + 1000)
      echo(client, value)
    }
    expect(client.send).not.toHaveBeenCalled()
    now.mockReturnValue(now() + 1000)
    echo(client, Number.MAX_SAFE_INTEGER)
    expect(client.send).toHaveBeenLastCalledWith('latency', Number.MAX_SAFE_INTEGER)
    client.send = vi.fn()
    now.mockReturnValue(now() + 1000)
    for (let i = 0; i < 20; i++) echo(client, i)
    expect(client.send).toHaveBeenCalledTimes(10)
    now.mockReturnValue(now() + 1000)
    room.racers.get('seat')!.connected = false
    echo(client, 20)
    expect(client.send).toHaveBeenCalledTimes(10)
  } finally { room.onDispose(); room.clock.clear(); now.mockRestore(); vi.restoreAllMocks() }
})
