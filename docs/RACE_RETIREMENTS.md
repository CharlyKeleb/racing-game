# Practice departures (#120)

After green, a final departure retires only that racer. The other driver keeps the
same world, clock and ordered checkpoint progress, and must finish the prescribed
laps to receive a ranked finish. A departure never awards a free win. Held seats
inside reconnect grace still coast normally and can recover; only explicit leave,
Auth expiry/rejection or exhausted recovery grace is terminal.

A retirement records server racing ticks and one of `left`, `connection-lost` or
`auth-expired`. Its checkpoint/lap progress stops, controls are held neutral with
handbrake, and it cannot accept more driving input. Rank and finish time remain
null. Repeated departures cannot change the original retirement. A racer who
already finished keeps that earned finish even if they disconnect later.

When every original racer has finished or retired, the result finalizes as
`all-resolved`. Both retirements therefore produce two DNFs and no winner. The
world is freed once, even if the last socket leaves; result enqueue happens before
room disposal and is independent of it. If someone remains unfinished, the
existing 60-second finish window and ten-minute racing limit still bound the race.

Loading/countdown departure, simulation failure, room expiry/shutdown and server
restart abort without inventing a result. Process recovery and graceful draining
remain separate work. The original two-racer grid is retained in `raceRacers` for
names/car identity in the surviving browser's results. Current lobby membership
and host ownership still follow connected/held seats. Departed racers cannot join
the in-progress race; a later new race needs normal admission/readiness.

## Compatibility and storage

Race protocol is now **3**; the manifest and asset acknowledgement must match.
Lobby-only protocol remains 1. New result records use `online-practice-v2` and
optional paired `retiredTicks` / `dnfReason` participant fields. Finalization ticks
must match the last earned finish or retirement; retirement lap sums cannot
exceed their terminal time. Practice history remains permanently ineligible for
competitive boards.

Apply migration `0004_online_practice_retirements.sql` after 0003 **before** running
a protocol-3 writer. It adds nullable history fields and replaces the privileged
validation RPC without widening browser access. Existing v1/protocol-2 records
and exact-retry receipts still work, including disk outboxes from the older
backend. Do not roll back schema while protocol-3 records exist; roll back the
backend while retaining the additive schema. No live migration is part of this PR.

## Verification

Race-session tests cover continued rival progress, held retired controls, no
invented times/ranks, retained earned finishes, duplicate retirement and both
racer departures at green. The real SDK tests cover full reconnect expiry with
shipped physics, explicit host departure/host transfer, original-grid identity,
remaining-racer finish and durable owner history through the actual SQL RPC.
Record/parser/SQL tests reject invalid retirement metadata and preserve v1 replay.

The local two-browser check on 2026-10-23 showed the departed host as DNF
while the remaining driver continued at 46 km/h in first gear; no browser warnings
or errors appeared.

These local tests do not establish production race capacity, real-device latency,
physical network recovery or the real-account two-device acceptance gate. Rematch
voting and deterministic local prediction remain separate chunks.
