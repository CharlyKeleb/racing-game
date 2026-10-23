# Player accounts and cloud save

Players can sign in from the menu (the chip at the top right) with **Google** or a
**magic link** sent by email. While they're signed in, their progress follows them
to any device. Guests keep playing as before, with everything saved in this browser.

## What syncs

The cloud save mirrors the localStorage keys the game already writes:

| Key | What | Merge on sign-in |
| --- | --- | --- |
| `racing-game:settings` | Settings, minus device ones (`quality`, `renderer`, `postfx`, `motionBlur`) | Cloud wins |
| `racing-game:builds` | Garage build per car | Combined per car, cloud wins for a car both sides have |
| `racing-game:presets` | Named build presets | Combined by preset id, cloud first |
| `racing-game:trial:*` | Time Trial best laps | Faster lap wins |
| `racing-game:drift:*` | Drift records | Higher score wins |

localStorage stays the source the game reads, so nothing in the engine changed.
After a player signs in, `cloud/CloudSave.ts` pulls their row, merges it into
localStorage and calls `gameStore.reloadSaved()`. From then on, any change uploads
2 seconds after it lands, and again on `pagehide`. Cloud data only applies in the
menu or garage, so a sign-in that completes mid-race waits until the race ends.
If this device last synced a *different* player, their cloud save replaces the
local progress instead of merging into it. Signing out keeps the device's
progress for guest play.

Code: `src/cloud/saveData.ts` (pure snapshot and merge rules, tested in
`tests/cloudSave.test.ts`), `src/cloud/CloudSave.ts` (Supabase client, lazy-loaded),
`src/stores/accountStore.ts` (state for the UI) and `src/ui/Account.tsx`. The UI calls
`Game.signInWithGoogle()`, `Game.sendSignInLink(email)` and `Game.signOut()`.

## Backend: Supabase

The project is `https://uqxxdjxiqczgigyifldl.supabase.co`. It isn't provisioned
through the Vercel Marketplace, because that Supabase account had hit the 2 free
projects limit. The browser talks to Supabase directly with the public anon key, and
row-level security limits each player to their own `player_saves` row.

### Environment variables

| Variable | Where |
| --- | --- |
| `VITE_SUPABASE_URL` | Project URL |
| `VITE_SUPABASE_ANON_KEY` | Public anon or publishable key (Project Settings → API Keys) |

Put them in `.env.local` (git-ignored) for `npm run dev`, and in the Vercel
project's environment variables (Production and Preview) for deploys. Vite also
reads `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, the names Vercel's Supabase integration
uses. **Never** set the service_role or secret key under any of these prefixes:
it would end up in the bundle. Without the variables, the game is local-only.

### One-time setup

1. **Table.** Run `supabase/migrations/0001_player_saves.sql` in the SQL Editor.
2. **URLs.** Authentication → URL Configuration: set the Site URL to the
   production domain, and add redirect URLs for `http://localhost:5179/**`,
   `http://localhost:5173/**` and the Vercel preview domain
   (`https://*-charlykelebs-projects.vercel.app/**`).
3. **Magic link.** This works out of the box with Supabase's built-in email, which
   is rate-limited to a few emails an hour. Add custom SMTP for real traffic. The
   link has to be opened in the same browser that requested it (PKCE).
4. **Google.** Authentication → Sign In / Providers → Google: create an OAuth
   client in Google Cloud (type "Web application", authorised redirect URI
   `https://uqxxdjxiqczgigyifldl.supabase.co/auth/v1/callback`), then paste its
   client ID and secret into Supabase. Until this is done, the Google button
   shows Supabase's "provider is not enabled" error.
