# Leaderboards

The **Ranks** tab in the menu shows public boards, and the Time Trial and Drift
results screens show where the run leaves the player.

## What's on a board

| Board | Key | Ranks by | Rows |
| --- | --- | --- | --- |
| Time Trial, per circuit | `trial:<track>` | Lap ms, lower wins | One per player per car, tagged with its build |
| Drift, per circuit and event | `drift:<track>:<event>` | Points, higher wins | One per player |

"All cars" counts each player once, on their best car. The car filter shows one
car. Equal scores rank by who set it first. Anyone can read the top 50; a signed-in
player also gets their own row if it's further down. Weather and time of day aren't
part of a board, matching the personal bests (rain is visual, it doesn't change
handling).

## How scores get there

`localStorage` stays the source, as with the cloud save. `cloud/Leaderboards.ts`
reads the synced Time Trial and drift keys, works out what the server hasn't had
this session and posts it. That runs 2 seconds after a new record, after the cloud
save merges, when a racer profile appears, and before any board loads. So a lap set
as a guest or offline posts later, and existing bests post on first sign-in. A
failed post retries on the next trigger.

Nothing posts until the player has a racer profile and their cloud save has merged,
so a previous player's records on a shared device don't post under the new account.

Code: `cloud/leaderboardData.ts` (pure), `cloud/Leaderboards.ts`,
`stores/leaderboardStore.ts`, `ui/Leaderboards.tsx`, `ui/LeaderboardResult.tsx`. The
UI calls `Game.loadLeaderboard(query)`.

## Schema

`supabase/migrations/0006_leaderboards.sql` adds a table that no role can touch
directly, and two functions:

- `submit_leaderboard_scores(entries)`: authenticated only, player from `auth.uid()`,
  needs a racer profile, at most 64 entries. It only ever improves a score, and it
  skips an invalid entry rather than failing the batch.
- `leaderboard_top(board_id, car_filter)`: public, at most 51 rows. Returns the
  display name, never the player id or handle.

Deleting a profile removes its scores.

To deploy, run the migration in the project's SQL Editor, or `supabase db push` as in
`docs/SUPABASE_CLI.md` (its version is in `supabase/existing-project-migrations.json`).
If you use the SQL Editor and the CLI later, record it with
`supabase migration repair 20261102120000 --status applied`. Until it's applied, the
tab shows a retry message, posts wait, and nothing else in the game is affected.

**Adding a circuit or car:** the migration has allow-lists, and a new circuit needs
a lap floor. Add them in a new migration. `tests/leaderboardDatabase.test.ts` fails
until you do. Until then that circuit's scores are skipped, not lost.

## Limits

**Scores are reported by the browser, so a determined player can post a fake one.**
These are community boards, not competitive results. Only signed-in players can post,
only to their own name, and a lap under a 540 km/h average is refused, which stops
garbage rather than cheating. Server-verified results would need the server to run
Time Trial sessions.

There is no ban or report flow yet. To remove a score, use the SQL editor:

```sql
delete from public.leaderboard_scores where player_id = '<uuid>' and board = 'trial:nurburgring';
```

The player's browser posts its best again on its next session unless the record is
also gone, so this removes a mistake, not a persistent cheater.

Physics changes aren't versioned: old laps stay on the board after a handling
change. Clearing a board is a `delete` as above.

## Verify

`npx vitest run tests/leaderboard.test.tsx tests/leaderboardDatabase.test.ts` runs the
real migration in embedded Postgres (ranking, keep-best, access rules, allow-lists)
and the client logic. Not covered by those: hosted Auth and PostgREST.

Rollback: revert the frontend first. Scores can stay, as nothing reads them. Dropping
the table and both functions removes the feature's data for good.
