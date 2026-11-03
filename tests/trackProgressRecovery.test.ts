import { expect, it } from 'vitest'
import { TrackProgress } from '../src/racing/TrackProgress'

// A 1.6 km oval of 400 points, 4 m apart.
const line = Array.from({ length: 400 }, (_, i) => {
  const a = i / 400 * Math.PI * 2
  return { x: Math.cos(a) * 255, y: 0, z: Math.sin(a) * 255 }
})

it('finds the car again after a jump it was not told about', () => {
  const progress = new TrackProgress(line)
  // Started before the car was placed: locked onto the line near the origin.
  progress.update(0, 0)
  // A server reset moves the car half a lap on; the windowed search alone never got there.
  const far = line[200]
  expect(progress.update(far.x, far.z)).toBe(200)
})

it('keeps following nearby motion without a full search', () => {
  const progress = new TrackProgress(line)
  progress.update(line[10].x, line[10].z)
  expect(progress.update(line[14].x + 3, line[14].z)).toBe(14)
})
