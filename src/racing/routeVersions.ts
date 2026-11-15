/**
 * Tracks whose race route has changed since records were first kept. A lap of the old route
 * isn't comparable with one of the new (Bayview's grew from 2.4 to 3.0 km), so local records
 * (time trial bests and splits, drift scores, lap-record bonuses) and the online leaderboard are
 * kept under a new track key per route version (`u2city-v2`): the old ones stay, unused.
 */
export const ROUTE_VERSIONS: Readonly<Record<string, number>> = {
  u2city: 2,
}

/** The track id records and leaderboards are kept under: `u2city-v2` for a rerouted track. */
export function recordTrack(track: string): string {
  const v = ROUTE_VERSIONS[track]
  return v && v > 1 ? `${track}-v${v}` : track
}
