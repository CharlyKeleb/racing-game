# Operational measurements (#120)

Backend metrics are off by default. Set server-only `MULTIPLAYER_METRICS=1` to emit
one `Multiplayer metrics` JSON report per minute and a final report on shutdown.
`0` disables it; other values fail configuration validation without echoing their
contents. The local runner supports the same opt-in. There is no public metrics
endpoint, browser key, user label, room code, UUID, bearer/reconnect token or pose
in this numeric report. Deployment and external log retention/alerting remain
operator-controlled and are not configured by this chunk.

For trusted local harnesses, `createBackend({ metrics: { report, intervalMs } })`
accepts a reporter and a bounded 1–300 second interval; `getMetrics()` returns a
snapshot or null when disabled. Reporter failures are caught and cannot affect
authority, admission, results or shutdown. The report timer is unreferenced and
cleared on Colyseus shutdown. Never attach arbitrary user labels to downstream
metrics; the fixed schema deliberately avoids that cardinality/privacy problem.

## What is measured

The schema-1 report contains process uptime, lifetime counters and histograms:

- Admission success/rejection in the private admission handler, plus its 429s.
  Early origin/JSON middleware failures are not counted as handler rejections.
- Accepted/rejected input messages, held-seat recovery starts, fresh-Auth recovery
  success and terminal failed recoveries. These are events, not unique users.
- Race starts (including loading), earned finalization and aborts. Room closure
  counts as abort, never as a fabricated result.
- Changes into pending/saved/failed persistence state; repeated identical state
  notifications do not inflate counts. Finalization latency spans enqueue through
  first saved/failed notification. Pending forever has no completed latency sample.
- Simulation-callback work duration, including the room's frame/publish work, and
  callback gap in milliseconds. Async world creation is not included as work;
  its event-loop effects can appear in callback gaps.
- JSON snapshot bytes and maximum age of accepted input mailboxes, sampled once
  per simulated second per race. Input age is **not RTT** or input-to-display delay.
  This is JSON size, not MessagePack/WebSocket overhead or measured egress.

Gauges are current rooms, admitted racers (including held seats), held-seat subset,
active loading/countdown/racing sessions, tracked admission claims, unconfirmed
durable enqueues, process RSS and heap MiB. Admission claims can include recently
consumed seats until their existing sixteen-second check completes. Pending enqueues
are not the same as durable outbox jobs waiting on a database retry; DB queue depth
is not measured here. Memory is process-wide, including warmed WASM/runtime caches.

Histogram observations allocate no objects and storage never grows with traffic.
Size sampling stringifies an existing frame once per simulated second only when
enabled; measuring it has a small cost that must be included in capacity trials. Keep
reporters quick: a slow synchronous exporter can still block the event loop and
trigger the existing server-stall abort policy.
Reports allocate fresh bounded copies. `p95Upper` is a conservative bucket bound,
not an exact percentile. A null bound with positive count means the percentile
exceeds the final bucket; `max` remains available. With zero observations, mean,
max and percentile are null. Counters/histograms accumulate over process lifetime;
use successive reports for rate calculations. Restart resets them.

## Verification and limits

Run `npm run test:multiplayer-metrics`. Tests check constant histogram shape,
conservative quantiles/overflow, invalid observations, detached report copies,
explicit configuration, real SDK admission/rate limits/input/reconnect/results,
identifier-free reports, persistence de-duplication, abort counting and a throwing
reporter. The existing shipped-physics grid/driving test also runs with metrics on.

These are observability prerequisites, not evidence that the 256 MiB Fly pilot can
host physics. No production capacity, sustained room count, RTT/jitter/loss matrix,
client reconciliation correction, actual bandwidth, long-session memory bound or
external continuous monitor is established here. Those require staging/device/load
measurements. The earlier local headless spike's RSS already exceeded the pilot's
memory budget; production remains lobby-only and no resource purchase is included.
