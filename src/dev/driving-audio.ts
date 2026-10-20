import { ImpactSound } from '../audio/ImpactSound'
import { DrivingSound } from '../audio/DrivingSound'
import type { ImpactKind } from '../audio/ImpactModel'

const output = document.querySelector<HTMLOutputElement>('#status')!
let live: AudioContext | undefined, impacts: ImpactSound | undefined
let timers: ReturnType<typeof setTimeout>[] = []
function stop() {
  for (const timer of timers) clearTimeout(timer)
  timers = []
  impacts?.dispose(); impacts = undefined
  void live?.close(); live = undefined
}
document.querySelector('#stop')!.addEventListener('click', stop)
document.querySelector('#play')!.addEventListener('click', () => {
  stop()
  live = new AudioContext()
  const gain = live.createGain(); gain.gain.value = .9; gain.connect(live.destination)
  impacts = new ImpactSound(live, gain)
  const sequence: [ImpactKind, number][] = [['wall', .25], ['wall', .6], ['wall', 1], ['car', .8], ['ground', .7], ['curb', .6]]
  timers = sequence.map(([kind, strength], i) => setTimeout(() => impacts?.hit(kind, strength), i * 1000))
})
window.addEventListener('pagehide', stop)
async function check() {
  const ctx = new OfflineAudioContext(1, 48000 * 2, 48000)
  const master = ctx.createGain(); master.gain.value = .9
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -1.5; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = .001; limiter.release.value = .12
  master.connect(limiter).connect(ctx.destination)
  const hits = new ImpactSound(ctx, master), driving = new DrivingSound(ctx, master)
  hits.hit('wall', 1)
  // Max speed wind + road bed under the strongest impact, through the game limiter.
  driving.update(80, 0, 1, 1, false, true)
  const audio = await ctx.startRendering(), data = audio.getChannelData(0)
  let peak = 0, energy = 0
  for (const sample of data) { if (!Number.isFinite(sample)) throw new Error('Non-finite audio'); peak = Math.max(peak, Math.abs(sample)); energy += sample * sample }
  hits.dispose(); driving.dispose()
  if (peak >= 1 || energy < .01) throw new Error(`Invalid output: peak ${peak}`)
  output.textContent = `PASS · live audio classes render offline without clipping\nPeak ${(20 * Math.log10(peak)).toFixed(1)} dBFS · RMS ${(10 * Math.log10(energy / data.length)).toFixed(1)} dBFS\nThis checks the new layers through the master limiter; full engine/rival mix still needs in-game listening.`
}
void check().catch(error => { output.textContent = `FAIL · ${String(error)}` })
