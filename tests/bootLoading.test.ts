import { afterEach, describe, expect, it, vi } from 'vitest'
import { Game } from '../src/engine/Game'
import { gameStore } from '../src/stores/gameStore'

// Exercise command orchestration without constructing WebGL, audio or physics.
function loadingGame(loadVisuals: () => Promise<void>) {
  return Object.assign(Object.create(Game.prototype), {
    track: { loadVisuals },
    trackVisuals: null,
    trackVisualsDone: false,
    trackProgress: 0,
    trackLoadToken: 0,
    raceQueued: false,
    raceLoadingTick: null,
    disposed: false,
    audio: { unlock: vi.fn(), playStart: vi.fn() },
    resetCar: vi.fn(),
    effects: { clear: vi.fn() },
    race: { start: vi.fn() },
  })
}

async function flush() {
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  await new Promise<void>((resolve) => queueMicrotask(resolve))
}

afterEach(() => {
  vi.useRealTimers()
  gameStore.setState({ error: null, phase: 'menu', carSwitching: false })
})

describe('background track loading', () => {
  it('starts an early race once, after visuals finish', async () => {
    vi.useFakeTimers()
    let finish!: () => void
    const game = loadingGame(() => new Promise<void>((resolve) => { finish = resolve }))
    game.startRace()
    game.startRace()
    expect(gameStore.getState().phase).toBe('loading')
    expect(game.race.start).not.toHaveBeenCalled()
    finish()
    await flush()
    expect(game.race.start).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports a failed early race and clears its progress timer', async () => {
    vi.useFakeTimers()
    const game = loadingGame(() => Promise.reject(new Error('Track download failed')))
    game.startRace()
    await flush()
    expect(gameStore.getState().error).toBe('Track download failed')
    expect(game.raceQueued).toBe(false)
    expect(game.race.start).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not mark a replacement track ready or start its race from a stale load', async () => {
    vi.useFakeTimers()
    let finish!: () => void
    const game = loadingGame(() => new Promise<void>((resolve) => { finish = resolve }))
    game.startRace()
    game.clearRaceLoading()
    game.trackLoadToken++
    // A switch keeps the disposed track reference until the replacement is ready.
    finish()
    await flush()
    expect(game.trackVisualsDone).toBe(false)
    expect(game.trackProgress).toBe(0)
    expect(game.race.start).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('streamed track disposal during boot', () => {
  it('stops loading before the backdrop when disposed during material loading', async () => {
    const { StreamedTrack } = await import('../src/world/StreamedTrack')
    let finish!: () => void
    const track = Object.assign(Object.create(StreamedTrack.prototype), {
      visuals: null,
      visualsReady: false,
      disposed: false,
      quality: 'high',
      loadMaterials: vi.fn(() => new Promise<void>((resolve) => { finish = resolve })),
      loadBackdrop: vi.fn(),
      preload: vi.fn(),
    })
    const loading = track.loadVisuals()
    track.disposed = true
    finish()
    await loading
    expect(track.loadBackdrop).not.toHaveBeenCalled()
    expect(track.preload).not.toHaveBeenCalled()
    expect(track.visualsReady).toBe(false)
  })
})
