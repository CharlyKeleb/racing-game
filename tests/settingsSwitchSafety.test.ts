import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gameStore } from '../src/stores/gameStore'
import { initRapier, PhysicsWorld } from '../src/engine/PhysicsWorld'
import { Track } from '../src/world/Track'
import { TEST_CIRCUIT } from '../src/world/tracks'

describe('settings and track teardown safety', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('updateSettings coerces unknown values instead of storing them', () => {
    vi.stubGlobal('localStorage', { setItem: () => {} })
    const patch = { timeOfDay: 'day', weather: 'clear', mode: 'sprint' } as unknown as Parameters<ReturnType<typeof gameStore.getState>['updateSettings']>[0]
    gameStore.getState().updateSettings(patch)
    const s = gameStore.getState().settings
    expect(s.timeOfDay).toBe('golden')
    expect(s.weather).toBe('dry')
    expect(s.mode).toBe('quick')
    gameStore.getState().updateSettings({ timeOfDay: 'night' })
    expect(gameStore.getState().settings.timeOfDay).toBe('night')
  })

  it('disposing a track twice leaves the physics world usable', async () => {
    await initRapier()
    const physics = new PhysicsWorld()
    const texture = vi.spyOn(Track.prototype as unknown as { canvasTexture(): THREE.Texture }, 'canvasTexture').mockImplementation(() => new THREE.Texture())
    const track = new Track(TEST_CIRCUIT, physics.world)
    texture.mockRestore()
    track.dispose()
    // A game torn down mid track switch disposes the already-disposed old track.
    expect(() => track.dispose()).not.toThrow()
    expect(() => physics.step(1 / 60)).not.toThrow()
    physics.dispose()
  })
})
