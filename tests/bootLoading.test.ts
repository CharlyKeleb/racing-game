import { afterEach, describe, expect, it, vi } from 'vitest'
import { DriftChallenge } from '../src/racing/DriftChallenge'
import { Game } from '../src/engine/Game'
import { ProximityRadar } from '../src/racing/ProximityRadar'
import { gameStore } from '../src/stores/gameStore'

const savedSettings = gameStore.getState().settings

// Exercise command orchestration without constructing WebGL, audio or physics.
function loadingGame(loadVisuals: () => Promise<void>) {
  gameStore.setState({ settings: { ...savedSettings, opponents: 0 } })
  return Object.assign(Object.create(Game.prototype), {
    track: { loadVisuals, line: [{x:0,y:0,z:0},{x:0,y:0,z:100},{x:100,y:0,z:100},{x:100,y:0,z:0}], spawn: { heading: 0, position: { x: 0, y:0.6, z: 0 } }, isRoadCollider: () => true },
    physics: { groundHeight: () => 0 },
    vehicle: { respawn: vi.fn(), controller: { setDriftMode: vi.fn() } },
    camera: { snap: vi.fn() },
    progress: { reset: vi.fn(), update: vi.fn() },
    driftChallenge: new DriftChallenge(),
    opponents: [],
    opponentFlames: new Map(),
    playerPose: {},
    playerEntry: {},
    opponentToken: 0,
    carId: "bmw",
    publishTelemetry: vi.fn(),
    prepareRaceIntro: vi.fn(),
    trackVisuals: null,
    trackVisualsDone: false,
    trackProgress: 0,
    trackLoadToken: 0,
    raceQueued: false,
    raceLoadingTick: null,
    disposed: false,
    awareness:new ProximityRadar(),awarenessFrame:0,
    audio: { unlock: vi.fn(), playStart: vi.fn(), clearOpponents: vi.fn(), setOpponentCars: vi.fn(), clearSpotter:vi.fn() },
    resetCar: vi.fn(),
    effects: { clear: vi.fn() },
    sparks: { clear: vi.fn() },
    race: { start: vi.fn() },
  })
}

async function flush() {
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  await new Promise<void>((resolve) => queueMicrotask(resolve))
}

afterEach(() => {
  vi.useRealTimers()
  gameStore.setState({ error: null, phase: 'menu', carSwitching: false, settings: savedSettings })
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
    expect(game.prepareRaceIntro.mock.invocationCallOrder[0]).toBeLessThan(game.race.start.mock.invocationCallOrder[0])
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


describe('race cinematic handoff', () => {
  it('holds the previous frame and scene during race loading', () => {
    gameStore.setState({phase:'loading'})
    const game = Object.assign(Object.create(Game.prototype), {
      raceTransition:true,
      vehicle:{render:vi.fn()},
      renderer:{render:vi.fn()},
      showroom:{setActive:vi.fn()},
    })
    game.renderFrame(0.5,1/60)
    game.updateShowroom('loading')
    expect(game.vehicle.render).not.toHaveBeenCalled()
    expect(game.renderer.render).not.toHaveBeenCalled()
    expect(game.showroom.setActive).not.toHaveBeenCalled()
  })
  it('paints the first cinematic shot while the loading overlay is still present', () => {
    gameStore.setState({phase:'loading'})
    const order: string[] = []
    const game = Object.assign(Object.create(Game.prototype), {
      finish:{reset:vi.fn()},
      loop:{timeScale:.28},
      audio:{setFinishMix:vi.fn()},
      updateShowroom:()=>order.push('scene'),
      vehicle:{render:()=>order.push('player'),position:{},model:{root:{}},config:{engine:{idleRpm:900}}},
      playerRevs:{reset:()=>{}},
      launch:{setConfig:()=>{},reset:()=>{}},
      opponents:[{vehicle:{render:()=>order.push('rival'),model:{root:{}}}}],
      environment:{follow:()=>{}},
      physics:{world:{}},
      introCamera:{update:(progress:number)=>{expect(progress).toBe(0);order.push('cinematic')}},
      renderer:{render:()=>{expect(gameStore.getState().phase).toBe('loading');order.push('paint')}},
    })
    game.prepareRaceIntro()
    expect(order).toEqual(['scene','player','rival','cinematic','paint'])
    expect(game.loop.timeScale).toBe(1)
    expect(game.finish.reset).toHaveBeenCalledOnce()
    expect(game.audio.setFinishMix).toHaveBeenCalledWith(false)
  })
})
