import { afterEach, expect, it, vi } from 'vitest'
import { gameStore } from '../src/stores/gameStore'
import { lobbyStore } from '../src/multiplayer/LobbyClient'
import { onlineRaceStore } from '../src/multiplayer/onlineRaceStore'
import { OnlineRaceScene } from '../src/multiplayer/OnlineRaceScene'
import { makeTestGame } from './helpers/testGame'
import { RACE_PROTOCOL } from '../server/src/protocol'
const settings = gameStore.getState().settings
const lobby = { protocol: 1, phase: 'loading' as const, raceEnabled: true, track: 'nurburgring', race: { id: 'race', protocol: RACE_PROTOCOL, fingerprint: 'a'.repeat(64), simulationVersion: 1 }, racers: [{ id: 'one', sessionId: 'seat', carId: 'porsche911' }, { id: 'two', sessionId: 'peer', carId: 'diablo' }] }
function fixture() {
  gameStore.setState({ phase: 'menu', settings: { ...settings, track: 'drift-park' } })
  lobbyStore.setState({ snapshot: lobby as never, sessionId: 'seat', raceSnapshot: null, status: 'connected' })
  const game = makeTestGame({ track: { id: 'drift-park' }, onlineToken: 0, carId: settings.car, onlineScene: null, onlinePreparing: null,
    loadTrackVisuals: vi.fn(async () => {}), applySettings: vi.fn(), resetCar: vi.fn(),
    switchTrack: vi.fn(async (id: string) => { game.track = { id } }), race: { state: 'idle' } })
  const scene = { dispose: vi.fn(), push: vi.fn() }
  return { game, scene }
}
afterEach(() => {
  vi.restoreAllMocks()
  gameStore.setState({ settings, phase: 'menu' })
  lobbyStore.setState({ snapshot: null, sessionId: null, status: 'idle' })
  onlineRaceStore.setState({ active: false, loaded: false, menuOpen: false })
})
it('temporarily loads the online circuit and restores the saved circuit without modifying preferences', async () => {
  const f = fixture()
  const saved = gameStore.getState().settings
  vi.spyOn(OnlineRaceScene, 'load').mockResolvedValue(f.scene as never)
  f.game.syncOnlineLobby()
  await f.game.onlinePreparing
  expect(gameStore.getState().phase).toBe('online')
  expect(f.game.track.id).toBe('nurburgring')
  expect(gameStore.getState().settings).toBe(saved)
  lobbyStore.setState({ snapshot: null })
  f.game.syncOnlineLobby()
  await vi.waitFor(() => expect(f.game.onlineEnding).toBe(false))
  expect(f.scene.dispose).toHaveBeenCalledTimes(1)
  expect(f.game.track.id).toBe('drift-park')
  expect(gameStore.getState().phase).toBe('menu')
  expect(gameStore.getState().settings).toBe(saved)
})
it('disposes a late-loaded online scene after cancellation and never installs it over the restored menu', async () => {
  const f = fixture()
  let resolve!: (scene: OnlineRaceScene) => void
  const load = vi.spyOn(OnlineRaceScene, 'load').mockImplementation(() => new Promise(r => { resolve = r }))
  f.game.syncOnlineLobby()
  await vi.waitFor(() => expect(load).toHaveBeenCalled())
  lobbyStore.setState({ snapshot: null })
  f.game.syncOnlineLobby()
  resolve(f.scene as never)
  await vi.waitFor(() => expect(f.game.onlineEnding).toBe(false))
  expect(f.scene.dispose).toHaveBeenCalledTimes(1)
  expect(f.game.onlineScene).toBeNull()
  expect(f.game.track.id).toBe('drift-park')
  expect(onlineRaceStore.getState().active).toBe(false)
})

it('resynchronizes the retained scene after recovery without reloading cars or resetting local settings', async () => {
  const f = fixture()
  const buffer = { resync: vi.fn() }
  Object.assign(f.scene, { buffer })
  vi.spyOn(OnlineRaceScene, 'load').mockResolvedValue(f.scene as never)
  f.game.syncOnlineLobby(); await f.game.onlinePreparing
  lobbyStore.setState(s => ({ connectionEpoch: s.connectionEpoch + 1 }))
  f.game.syncOnlineLobby()
  expect(buffer.resync).toHaveBeenCalledTimes(1)
  expect(OnlineRaceScene.load).toHaveBeenCalledTimes(1)
  expect(f.scene.dispose).not.toHaveBeenCalled()
  expect(gameStore.getState().settings.track).toBe('drift-park')
})

it('disposes finished presentation before a fresh rematch and preserves saved settings', async () => {
  const f = fixture(), nextScene = { dispose: vi.fn(), push: vi.fn() }
  const saved = gameStore.getState().settings
  vi.spyOn(OnlineRaceScene, 'load').mockResolvedValueOnce(f.scene as never).mockResolvedValueOnce(nextScene as never)
  f.game.syncOnlineLobby(); await f.game.onlinePreparing
  lobbyStore.setState({ snapshot: { ...lobby, race: { ...lobby.race, id: 'rematch' } } as never })
  f.game.syncOnlineLobby()
  await vi.waitFor(() => expect(OnlineRaceScene.load).toHaveBeenCalledTimes(2))
  await f.game.onlinePreparing
  expect(f.scene.dispose).toHaveBeenCalledTimes(1)
  expect(f.game.onlineScene).toBe(nextScene)
  expect(f.game.onlineRaceId).toBe('rematch')
  expect(gameStore.getState().phase).toBe('online')
  expect(gameStore.getState().settings).toBe(saved)
  expect(f.game.race.state).toBe('idle')
})
