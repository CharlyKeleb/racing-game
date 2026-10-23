# Practice rematches (#120)

Factory-backed rooms advertise `rematchEnabled: true`; older rooms do not show
the new action. The results dialog offers **Race again** when both original racers are still in
the room and authenticated. Either racer can opt in or cancel; both must consent.
A vote applies only to the current finished race ID. Duplicate requests do not
extend its sixty-second wall-clock deadline. Once both vote, the server creates
one new race ID with the same cars, course and lap count, clears votes, and runs
the normal fresh loading acknowledgement/countdown sequence. Old input, asset
acknowledgements, results and votes cannot carry into the next race.

The existing host action still returns the crew to the lobby for car/lap changes.
Leaving or any recoverable transport drop clears all votes. A recovered racer must
reauthenticate before either racer can vote again. A departed racer cannot be
replaced during results to bypass original-grid consent. If only one remains, the
host can return to the lobby and invite a new rival normally. Room expiry/Auth
expiry still apply; votes do not renew sessions or extend room lifetime.

The result outbox capacity gate applies to rematches too. Already enqueued results
continue independently of the new race. A late receipt for a prior race cannot
replace the current race's save status. The browser disposes its old scene before
loading the new lifecycle and preserves offline preferences/builds. Rematch votes
are in-memory only and cannot survive restart or a reload.

## Verification

`tests/raceRematch.test.ts` uses real local SDK clients and the test-only scripted
course to exercise consent/withdrawal, duplicate and stale commands, new IDs,
fresh loading acknowledgements, independent result submissions, transport loss,
reauthentication, departure, sixty-second expiry and storage capacity rejection.
The deadline callback is invoked directly in one test rather than waiting a real
minute. Browser lifecycle/client tests cover scene disposal, saved settings,
active-race command binding and offline suppression. Scripted-course tests are
not proof of Nürburgring driving or real-device/Supabase acceptance.

The browser smoke check showed the first vote waiting for its rival, then a fresh
zero-time countdown after acceptance. A hot reload interrupted the first attempt;
browser automation became unavailable during the clean rerun, so final rematch
results were not visually reverified. Independent result IDs/submissions are
covered by the real SDK test. Full regression: 484 files / 3,177 tests passed.
