import type { RaceGate } from '../../server/src/RaceProgress'
export const gates: RaceGate[] = [
  { index: 0, position: [0, 0, 0], tangent: [0, 0, 1], radius: 2 },
  { index: 1, position: [0, 0, 4], tangent: [0, 0, 1], radius: 2 },
  { index: 2, position: [4, 0, 5], tangent: [1, 0, 0], radius: 2 },
  { index: 3, position: [5, 0, 2], tangent: [0, 0, -1], radius: 2 },
]
export const route = [[0, 5], [3, 5], [5, 5], [5, 3], [5, 1], [2, 1], [0, -1], [0, 1]]
