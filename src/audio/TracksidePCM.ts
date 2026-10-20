/** Original soft wind, fabric flutter and pit fan. No voices, music or recordings. */
export function makeTracksidePCM(pit: boolean, sampleRate = 22050): Float32Array {
  const data = new Float32Array(sampleRate * 6)
  let seed = pit ? 677 : 1339, low = 0, air = 0
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const noise = seed / 2147483648 - 1, t = i / sampleRate
    low += (noise - low) * .025
    air += (noise - air) * .23
    const gust = .55 + .22 * Math.sin(t * 1.7) + .13 * Math.sin(t * 3.2)
    const flutter = Math.max(0, Math.sin(t * 27 + Math.sin(t * 2.1) * 3)) ** 8
    const fan = pit ? Math.sin(t * Math.PI * 2 * 62) * .018 + Math.sin(t * Math.PI * 2 * 124) * .008 : 0
    const edge = Math.min(1, i / (sampleRate * .15), (data.length - 1 - i) / (sampleRate * .15))
    data[i] = (low * gust * .5 + (noise - air) * flutter * .035 + fan) * edge
  }
  return data
}
