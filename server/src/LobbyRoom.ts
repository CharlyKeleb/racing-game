import { randomInt } from 'node:crypto'
import { Room, ServerError, type Client } from '@colyseus/core'
import type { Authenticate, VerifiedRacer } from './auth.js'
import { isLobbyCar, LOBBY_PROTOCOL, type LobbyRacer, type LobbySnapshot } from './protocol.js'

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const lobbyDirectory = new Map<string, LobbyRoom>()
/** Single process ownership: one player can hold only one admitted seat. */
export const activePlayers = new Map<string, symbol>()
export function generateCode(): string {
  let code: string
  do { code = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('') } while (lobbyDirectory.has(code))
  return code
}
export class LobbyRoom extends Room {
  static authenticate: Authenticate
  racers = new Map<string, LobbyRacer>()
  code = ''
  hostId = ''
  laps = 3
  private expiry = new Map<string, ReturnType<typeof setTimeout>>()
  /** All HTTP SDK matchmake methods are denied. Only our verified /rooms endpoint reserves seats. */
  static async onAuth(): Promise<never> { throw new ServerError(403, 'Use private room admission.') }
  onCreate() {
    this.maxClients = 4
    this.maxMessagesPerSecond = 10
    this.seatReservationTimeout = 15
    void this.setPrivate(true)
    this.code = generateCode()
    lobbyDirectory.set(this.code, this)
    this.clock.setTimeout(() => { this.broadcast('notice', 'This lobby expired. Create another to continue.'); void this.disconnect() }, 30 * 60_000)
    this.onMessage('sync', (client) => client.send('lobby', this.snapshot()))
    this.onMessage('ready', (client, value: unknown) => {
      const racer = this.racers.get(client.sessionId)
      if (racer && typeof value === 'boolean') { racer.ready = value; this.publish() }
    })
    this.onMessage('car', (client, value: unknown) => {
      const racer = this.racers.get(client.sessionId)
      if (racer && isLobbyCar(value)) { racer.carId = value; racer.ready = false; this.publish() }
    })
    this.onMessage('laps', (client, value: unknown) => {
      const racer = this.racers.get(client.sessionId)
      if (racer?.id === this.hostId && Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 10) {
        this.laps = Number(value)
        for (const player of this.racers.values()) player.ready = false
        this.publish()
      }
    })
    this.onMessage('refresh', async (client, token: unknown) => {
      try {
        if (typeof token !== 'string') throw new Error('Invalid session')
        const verified = await LobbyRoom.authenticate(token)
        if (!this.clients.includes(client) || verified.id !== this.racers.get(client.sessionId)?.id) throw new Error('Invalid session')
        this.armExpiry(client, verified.expiresAt)
        client.send('refreshed')
      } catch { client.leave(4001, 'Sign in again to continue.') }
    })
  }
  onJoin(client: Client, options: { carId?: unknown }) {
    const racer = client.auth as VerifiedRacer | undefined
    if (!racer || racer.expiresAt <= Date.now() || [...this.racers.values()].some((r) => r.id === racer.id)) throw new ServerError(403, 'Invalid or duplicate racer session.')
    this.racers.set(client.sessionId, { sessionId: client.sessionId, id: racer.id, handle: racer.handle, displayName: racer.displayName, carId: isLobbyCar(options.carId) ? options.carId : 'porsche911', ready: false })
    if (!this.hostId) this.hostId = racer.id
    this.armExpiry(client, racer.expiresAt)
    this.publish()
  }
  onLeave(client: Client) {
    const racer = this.racers.get(client.sessionId)
    if (!racer) return
    activePlayers.delete(racer.id)
    this.racers.delete(client.sessionId)
    clearTimeout(this.expiry.get(client.sessionId))
    this.expiry.delete(client.sessionId)
    if (racer.id === this.hostId) this.hostId = this.racers.values().next().value?.id ?? ''
    this.publish()
  }
  onDispose() {
    lobbyDirectory.delete(this.code)
    for (const racer of this.racers.values()) activePlayers.delete(racer.id)
    for (const timer of this.expiry.values()) clearTimeout(timer)
  }
  private armExpiry(client: Client, expiresAt: number) {
    clearTimeout(this.expiry.get(client.sessionId))
    this.expiry.set(client.sessionId, setTimeout(() => client.leave(4001, 'Your session expired. Rejoin the lobby.'), Math.min(expiresAt - Date.now(), 2_147_483_647)))
  }
  snapshot(): LobbySnapshot {
    return { protocol: LOBBY_PROTOCOL, code: this.code, hostId: this.hostId, racers: [...this.racers.values()].map((r) => ({ ...r })), maxPlayers: 4, track: 'nurburgring', laps: this.laps, phase: 'lobby' }
  }
  private publish() { this.broadcast('lobby', this.snapshot()) }
}
