import type { ResultRecord } from '../../server/src/ResultRecord'
export const resultPlayers = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002']
export function savedRace(id = '20000000-0000-4000-8000-000000000001'): ResultRecord {
  return { schema: 1, protocol: 2, ruleset: 'online-practice-v1', fingerprint: 'a'.repeat(64), simulationVersion: 1, result: {
    raceId: id, track: 'nurburgring', laps: 2, tickRate: 60, completedTick: 400, reason: 'all-finished', racers: [
      { id: resultPlayers[0], carId: 'porsche911', status: 'finished', rank: 1, finishTicks: 200, lapTicks: [100, 100] },
      { id: resultPlayers[1], carId: 'diablo', status: 'finished', rank: 2, finishTicks: 220, lapTicks: [110, 110] },
    ],
  } }
}
