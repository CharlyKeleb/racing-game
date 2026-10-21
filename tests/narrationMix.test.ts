import { afterEach, describe, expect, it } from 'vitest'
import { attachNarrationDucking, narrationMix } from '../src/audio/narrationMix'

class Media extends EventTarget {
  paused = false
  ended = false
  muted = false
  volume = .8
  send(name: string) { this.dispatchEvent(new Event(name)) }
}
const connect = (audio: Media) => attachNarrationDucking(audio as unknown as HTMLAudioElement)
afterEach(() => narrationMix.setState({ voices: 0 }))
describe('narration ducking lifecycle', () => {
  it.each(['pause', 'ended', 'waiting', 'error', 'emptied'])('restores game audio on %s and can resume', event => {
    const a = new Media(), detach = connect(a)
    expect(narrationMix.getState().voices).toBe(0)
    a.send('playing')
    a.send('playing')
    expect(narrationMix.getState().voices).toBe(1)
    a.send(event)
    expect(narrationMix.getState().voices).toBe(0)
    a.send('playing')
    expect(narrationMix.getState().voices).toBe(1)
    detach(); detach()
    expect(narrationMix.getState().voices).toBe(0)
    a.send('playing')
    expect(narrationMix.getState().voices).toBe(0)
  })
  it('does not duck for muted speech, and follows live voice volume changes', () => {
    const a = new Media(), detach = connect(a)
    a.volume = 0; a.send('playing')
    expect(narrationMix.getState().voices).toBe(0)
    a.volume = 1; a.send('volumechange')
    expect(narrationMix.getState().voices).toBe(1)
    a.muted = true; a.send('volumechange')
    expect(narrationMix.getState().voices).toBe(0)
    detach()
  })
  it('waits for all playing narrators before restoring the game', () => {
    const a = new Media(), b = new Media(), stopA = connect(a), stopB = connect(b)
    a.send('playing'); b.send('playing')
    expect(narrationMix.getState().voices).toBe(2)
    stopA()
    expect(narrationMix.getState().voices).toBe(1)
    stopB()
    expect(narrationMix.getState().voices).toBe(0)
  })
})
