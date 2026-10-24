# Supabase HTTP acceptance — 2026-10-24

The existing project remains `uqxxdjxiqczgigyifldl`. All six approved rollback-only
SQL-role/result tests passed; see the [SQL receipt](measurements/supabase-acceptance-2026-10-24.json).
The public gateway now also passes nine read-only probes, recorded in the
[HTTP receipt](measurements/supabase-public-http-2026-10-24.json).

```sh
npm run probe:supabase-public -- --live
```

The helper reads only local browser configuration from `.env.local`, pins HTTPS
to the reviewed project reference, rejects privileged keys before any request,
and refuses redirects. It accepts a publishable key or legacy anon key. It never
uses player sessions, outputs keys, prints provider/SQL messages or reads account
rows. Table probes request zero rows. RPC probes submit empty arguments; the
result RPC receives an invalid empty record so a permission regression cannot
save a fabricated result.

The nine checks confirm public-key/project reachability; anonymous SELECT denial
for raw practice races, private practice history and identity events; anonymous
execution denial for both history RPCs and the result writer; and rejection of
missing/forged sessions. All six PostgREST denials return SQLSTATE `42501` with
HTTP 401. This project's Auth gateway returns 401 for a missing session and 403
for the deliberately forged JWT. The helper checks an Auth error response as well
as its status, and does not treat network/server errors as successful rejection.

Three local regressions exercise the probe contract, key/project guards and
unexpected permission/error responses. Strict test types and lint pass. That probe chunk
passed 3,277 tests across 510 files. An earlier run overlapped 3D browser
initialization and had three timing-sensitive failures; the repeat after closing
the temporary tab passes. No gameplay logic or test timing thresholds changed.

## Acceptance still open

The user signed into the game in Chrome. A development-only lightweight fixture
at `http://127.0.0.1:5173/tests/browser/auth-session.html` then verified Auth `getUser`,
matching profile ownership, both private history RPCs and owner IDs on all returned
rows. Race history was empty; identity history returned one owned event. This does
not establish two real HTTP owners' isolation; the separate live SQL tests cover
that role behavior using synthetic rows.

The fixture's explicit refresh completed normally: the access token rotated and
expiry advanced from 13:15:35 UTC to 13:31:46 UTC. Subsequent reads passed. It keeps
credentials within the SDK and shows only non-secret checks/counts. The real token
has not been allowed to expire, so terminal expiry rejection remains open. No
system clock, signature or token claim was altered to simulate expiration.

The running local frontend initially lacked a multiplayer URL. Its ignored
`.env.local` now points to `http://127.0.0.1:2568`. The local practice runner uses
only the existing project's public admission key, exact localhost origins,
snapshot input mode and no result writer. Original and refreshed sessions each
created a room successfully. The first room stayed connected after refresh;
both rooms were left afterward. The temporary fixture tab was closed and the
user's original signed-in game tab remains open. The local backend is left
running for subsequent checks; it is not a hosted deployment.

The [real-session receipt](measurements/supabase-real-session-2026-10-24.json)
records sanitized outcomes. The proof image is retained only in ignored local
cache. No password, bearer/refresh token, email, UUID or history row payload is
written into the report. Revoked sessions, genuine expiry, two accounts/devices
and full two-device/finished-lap acceptance remain open. The subsequent real
retirement/save test is recorded below.

The local result writer is now configured with the existing server-only key in
an ignored 0600 backend file and a 0700 local outbox. The preflight and a subsequent
real two-account retirement race both passed. Chrome and Safari separately read
one owned DNF entry with the same SHA-256 race digest; the exact retirement ticks
were 7119 and 8775. The outbox cleared after the live HTTP commit. See the
[result-storage receipt](measurements/local-result-storage-2026-10-24.json).

Authentication now rechecks expiry after the asynchronous profile fetch. A token
expiring while that request was in flight previously returned a stale lease; the
new regression fails before the fix and passes with a 401 afterward. This is an
implementation fix with a controlled clock test, not a claim of natural token
expiry/revocation replay acceptance. Full suite: 3,278 tests / 510 files passes
with two workers; frontend/backend builds, strict helper types and lint pass.

Hosted result storage/capacity, a completed-lap race on separate physical devices,
and genuine expiry/revocation checks remain open. No key was created, no hosted
configuration was changed, and nothing was pushed to GitHub.
