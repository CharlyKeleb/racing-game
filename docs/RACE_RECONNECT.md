# Bounded practice reconnect (#120)

The optional local race backend now holds a dropped seat for up to **15 seconds**.
The running browser reconnects automatically through the SDK's supported manual
reconnect API. This preserves the same authenticated seat, car, simulation,
checkpoint progress, nitro, input history and server clock. It does not restart
or pause the race. The production lobby-only entrypoint still removes dropped
seats immediately and advertises no reconnect capability.

## Server authority

Local factory-backed rooms advertise `reconnectGraceSeconds: 15`. Unexpected
1001/1005/1006 closes and the SDK's 4010 offline close may hold a seat. Explicit
leave, session rejection, server errors and room disposal do not get grace.
Auth expiry caps the window, and repeated drops before successful reauthentication
do not extend the original deadline. Host ownership and the single-player seat
claim stay reserved during recovery; ordinary admission cannot claim that UUID.

`RaceSession.setConnected(false)` immediately clears the latest-input mailbox to
neutral. The body coasts under server physics; stale throttle/nitro is never
replayed. Physics, countdown and lap time keep advancing. Finished cars retain
held controls. Loading loses that seat's asset acknowledgement and needs a new
ack after recovery; loading cannot advance with a disconnected seat. Lobby drops
clear that racer's ready flag, and disconnected seats cannot launch.

The Colyseus reconnection secret restores **only the transport**. On reconnect,
all controls except `refresh` are rejected until the backend verifies a fresh
Supabase token for the same immutable racer UUID. The existing Auth verification
checks signatures/session, issuer, audience, expiry and required profile. The
original verified lease and original grace deadline must still be valid. An
in-flight old-socket refresh cannot authorize or close the replacement socket.
Refresh requests are limited to one in flight per physical client, alongside the
existing command/room rate budgets.

Successful reauthentication sends the current lobby + race snapshot, followed by
`resumed { raceId, nextInputSequence }`. That sequence comes from the server's last
accepted command, including any accepted but unapplied command. Client-side
sequence guesses cannot strand the car behind the maximum-jump check. Recovery
never resets accepted sequences, controller state, charge or progress.

A held or reauthenticating seat expires at the earlier of auth expiry and the
grace deadline. Timers locate the current socket by session ID rather than closing
a stale client reference. Final departure releases admission ownership, transfers
host if needed. Final departures during racing now produce a terminal DNF for
that racer while the rival continues. Loading/countdown departures still abort
without a result. See [retirement rules](RACE_RETIREMENTS.md). Already accepted durable result writes remain independent of room
lifetime, as described in [practice history](ONLINE_PRACTICE_HISTORY.md).

Local race transport uses one-second WebSocket heartbeat intervals and three
missed-pong retries to detect stale sockets sooner; the production lobby-only
transport retains its six-second interval. Detection happens before the server's
grace window begins, and a client can time out sooner on an unhealthy network.
These are provisional development settings, not measured production SLAs.

## Browser lifecycle

The application keeps its race scene and last snapshot while showing Reconnecting.
Driving, ready/settings/start/cancel/return commands are suppressed while offline
or awaiting reauthentication. Outgoing SDK buffering is disabled, so old driving
and menu commands cannot flush after reconnect. Ready UI shows disconnected peers.
The menu still permits leaving immediately.

The app owns bounded retries using `Client.reconnect()`, with only one handshake
in flight and a 500 ms delay after failure. One 15-second deadline covers the
handshake and fresh-token acquisition/verification. A new socket's listeners are
installed before sending fresh Auth. Only the server's matching `resumed` reply
restores connected status and driving. The interpolation buffer resynchronizes to
the newest server frame; it does not replay the disconnected interval. If loading
visuals already completed, their asset acknowledgement is resent.

Logout, account change, explicit leave, HMR/disposal and timeout invalidate the
recovery generation. Late handshakes are left immediately and cannot reinstall a
room or send fresh Auth. SDK automatic retries remain disabled, so a scheduled
SDK retry cannot resurrect a deliberately left room. The SDK's manual handshake
has no abort parameter; an outstanding handshake may settle later, at which point
that generation guard releases it. A drop during reauthentication ends the local
attempt rather than starting nested recovery loops.

Recovery secrets stay in the live room/closure only: no localStorage,
sessionStorage, share URL or application log stores them. Page reload, browser
restart, app termination, server restart/redeploy and cross-device seat takeover
are **not supported recovery paths**. A reloaded page must wait for the old held
seat to expire, then join normally. Reconnect does not implement rollback
prediction, reset/recovery, rematch voting or competitive validation.

## Verification

Run `npm run test:race-reconnect`, both builds, lint and `npm test`.

Real SDK tests use the shipped Nürburgring/Porsche physics and cover:

- Same seat/car/progress and advancing clock after a drop; neutral controls while
  absent; no world disposal/recreation and a correctly rebased next input.
- Rejection of input before fresh Auth, a different user's token even with the
  valid seat secret, old-secret replay, and duplicate ordinary admission.
- Original auth expiry, lobby readiness clearing and new admission after expiry.
- A full 15-second timeout retiring one racer while the rival keeps the same world.

Unit tests cover loading acknowledgement loss, preserved sequence history, client
queue suppression, snapshot retention, fresh-auth gating, logout cancellation,
late handshake disposal, deadline and lobby-only compatibility, plus scene-buffer
resynchronization without reloading assets or changing saved settings.

For browser composition, use the [ordinary local physics smoke fixture](BROWSER_MULTIPLAYER.md)
and its **Drop test connection** button after launching. It dispatches a synthetic
offline event to the normal SDK and delays only the synthetic fixture's next token
by three seconds so the reconnect state can be inspected. The race continues;
the same view returns after fresh authentication. This is not a physical network
outage, real Supabase auth, multi-device acceptance or a latency/jitter/loss matrix.
Neither shipped backend entrypoint imports that fixture.

The local two-browser smoke check on 2026-10-23 showed the reconnect banner,
then restored both racers on the same lap with the server clock advancing from
15.967 to 26.717 seconds. After recovery, keyboard driving reached 63 km/h in
second gear. Browser logs contained only the expected synthetic-offline warning.
The full suite passed 3,161 tests; the final focused reconnect run passed 24 tests.

Hosted staging persistence remains unconfigured in the current workspace: no
staging target, server result secret or persistent outbox path is present. Setup
and acceptance gates are recorded in [the storage guide](ONLINE_PRACTICE_HISTORY.md).
No live migration, deployment, paid capacity or production behavior is changed.
