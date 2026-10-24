# Original comprehensive multiplayer roadmap

Snapshot before the approved private-racing launch scope split on 2026-10-24.
This historical checklist is not the current #120 closure contract.

## Goal and agreed stack

Build a polished online racing foundation with persistent racer identities, private races, verified results, leaderboards and a path to public competition and social features. “NFS standard” means a coherent racer profile, garage identity, party/lobby flow, race presentation and progression—not a claim of parity with a particular NFS release.

**Agreed:** Fly.io hosts our multiplayer backend; Supabase provides Postgres and Auth. Use self-hosted open-source Colyseus on Fly.io, without a Colyseus Cloud subscription. Keep the existing browser game/static asset deployment independent. This issue is the implementation epic. The user separately approved the paid single-machine Fly.io lobby pilot on 2026-10-23; further capacity or service purchases still need their own scope/budget decision.

**First playable milestone:** two authenticated players on separate devices create/join a private room, complete the same race, and see identical server-verified results saved to their profiles. Start with 2–4 racers and ghost collisions. Capacity, regions and tick/snapshot rates require measurement before broader launch.

## Status — 2026-10-24

**Local two-player online practice is implemented and tested; the hosted Fly pilot remains lobby-only. The first playable release milestone is still open.** All completed work is pushed in [PR #142](https://github.com/CharlyKeleb/racing-game/pull/142), including eleven previously unpublished commits. Publication is not a hosted deployment or a claim that all epic requirements are met.

### Completed and verified

- [x] Supabase Google/email magic-link sign-in, cloud saves, racer onboarding/editing, immutable Auth identity, canonical unique handles and separately normalized display names. Offline play remains available.
- [x] Authenticated private lobby and two-racer ghost practice: stock cars, host controls, readiness, asset handshake, synchronized grid/countdown, authoritative 60 Hz physics and bounded inputs, 20 Hz snapshots and remote interpolation.
- [x] Shared headless physics and versioned/checksummed collision, checkpoint, spawn and stock-car assets; local CPU, correction payload and container memory measurements. These measurements do not establish hosted race capacity.
- [x] Full controller checkpoints, bounded replay history, own-seat correction stream and experimental scheduled-input prediction/reconciliation. Prediction and scheduled capability remain opt-in and disabled by default.
- [x] Server-owned ordered checkpoint/lap/finish timing, ties and shared results; reconnect/reauthentication grace, retirements/DNF, consensual rematch, menu behavior and bounded graceful draining. Hosted failure/rollback acceptance remains separate.
- [x] Idempotent private practice result RPC, durable bounded retry outbox and owner-only history; practice records remain competitively ineligible.
- [x] Complete rename events from audit start, honest baselines for existing identities, no-cooldown reservations and owner-only paginated name-history UI. Older rename events are not invented; public search/redirects remain later work.
- [x] Approved live history, retirement and identity-audit migrations applied to the existing Supabase project; migration history and schema checked. Six rollback-only live SQL role/result tests and nine public HTTP access probes pass.
- [x] Two real Chrome/Safari accounts on one Mac joined, drove and retired from one practice; each independently read matching private saved DNF history. Normal real-session refresh and admission also pass. This does not prove a finished-lap race or two physical devices.
- [x] Real physics completion check: both AI cars finish three laps, 24 ordered gates each, positive lap times, correct finish sums and ranks, without resets or teleports. Synthetic seats never write to Supabase.
- [x] Standalone compact-asset staging container, health/readiness, local boot/shutdown and offline durable-outbox SIGKILL/restart acceptance. No race backend, hosted storage or new paid capacity was deployed.
- [x] Latest local validation: **3,278 tests / 510 files**, frontend/backend builds, strict staging types and lint pass. Real loopback two-tab prediction/recovery smoke and synthetic latency checks also pass; real device/network shaping remains open.

Current implementation, limits and evidence: [delivery status](https://github.com/CharlyKeleb/racing-game/blob/codex/issue-120-transport-benchmark/docs/ISSUE_120_STATUS.md), [full-race acceptance](https://github.com/CharlyKeleb/racing-game/blob/codex/issue-120-transport-benchmark/docs/FINISHED_RACE_ACCEPTANCE.md), [Supabase HTTP acceptance](https://github.com/CharlyKeleb/racing-game/blob/codex/issue-120-transport-benchmark/docs/SUPABASE_HTTP_ACCEPTANCE.md) and [staging runbook](https://github.com/CharlyKeleb/racing-game/blob/codex/issue-120-transport-benchmark/docs/PRACTICE_STAGING.md). The existing Fly lobby pilot is still one shared CPU / 256 MiB machine in Johannesburg; it has not been accepted as race capacity.

### Next delivery steps, in order

1. [ ] Release the frontend multiplayer UI and configure `VITE_MULTIPLAYER_URL=https://charly-racing-multiplayer.fly.dev` in the production frontend environment. The current local game points to the local practice backend; production configuration remains unchanged. Main-branch code publication alone does not set the hosting environment variable.
2. [ ] Verify create/join, car selection, ready-up, host exit and session refresh using **two real accounts on two physical devices** against Fly. Record latency and memory; the current region/machine size is a pilot, not measured race capacity.
3. [x] Extract a headless simulation boundary and versioned track collision/checkpoint/spawn + approved stock car data. Prove a two-player server simulation and measure CPU before committing to tick/snapshot rates. **Implemented and measured locally; hosted capacity remains unverified.**
4. [x] Implement loading/readiness → synchronized grid/countdown → racing: bounded sequenced inputs, authoritative simulation, local prediction/reconciliation and remote-car interpolation. Start with two racers and ghost collisions. **Implemented locally; prediction is experimental/opt-in.**
5. [x] Implement authoritative checkpoint/lap/finish validation and idempotent private practice result storage. Both AI cars finish the normal three-lap distance; two real browser accounts have matching saved DNF history.
   - [ ] Complete a real finished-lap race on two physical devices, with identical saved results. Only then is the first playable milestone complete.
6. [x] Implement reconnect/DNF/rematch and bounded graceful draining; local protocol/browser and offline outbox crash/restart checks pass.
   - [ ] Verify hosted failure/redeploy/rollback behavior and implement verified competitive leaderboards. Public matchmaking, ranked/progression, friends/social and physical car contact remain later milestones.

Pending operational gates also include staging isolation, load/network/device tests, spend alerts, external monitoring, rollback/restore drills and production email delivery. All broader checklist items below remain open unless explicitly checked.

## Current code and integration points

- `src/engine/GameLoop.ts`: fixed 60 Hz simulation and separate rendering.
- `src/simulation/HeadlessSimulation.ts`, shared vehicle physics and exported versioned track/car bundles now provide the headless boundary. Rendering/audio remain browser-side.
- `server/src/RaceSession.ts` and `RaceProgress.ts` own online clock/countdown, ordered gates, laps and finishes; offline race rules remain separate.
- `src/multiplayer/OnlineRaceScene.ts` owns network presentation/interpolation and the opt-in prediction adapter; local AI remains separate.
- `src/stores/gameStore.ts`: garage/build presets and preferences currently use localStorage. Preserve offline play and explicitly migrate eligible cosmetic data rather than trusting local competitive results/progression.
- Existing HUD, minimap, rival labels, spatial rival audio, finish cameras and Alex/Camille commentary should consume the online race's confirmed events.

Related: #69 / #10 performance budgets; #9 car asset budget; #22 ghosts; #34 local career; #38 local daily challenge; #40 remappable controls; #85 finish replays. Online work extends these where appropriate rather than silently expanding their original offline scope.

## 1. Services, ownership and environments

- [ ] Fly.io `multiplayer` persistent Node/TypeScript service: Colyseus rooms + authenticated HTTP endpoints, matchmaking/lobby orchestration, authoritative racing and result submission. For the pilot, one process/replica in one measured region, no sleep while accepting races.
- [ ] Supabase project: Auth, Postgres, SQL migrations/RPCs/RLS; Storage for avatar and bounded replay/ghost assets when implemented. Supabase Realtime may support social presence later; it is not the vehicle-physics transport.
- [ ] Production transactional email delivery for verification/reset: choose and configure SMTP provider, sender domain and delivery monitoring before public signup. OAuth providers need their own callback/client configuration.
- [ ] Redis is deferred for the single-process pilot. Before multiple room processes/replicas, implement shared Colyseus presence/driver and routing to the process that owns each room. Generic load balancing alone is insufficient.
- [ ] Background work: bounded result finalization/retries, leaderboard aggregation, retention and season rollover. Start with jobs appropriate to the workload; introduce a separate worker/durable queue when needed, documenting ownership and failure recovery.
- [ ] Separate local, staging and production configuration, data and credentials. Production must not be modified by PR preview deployments. Seed staging with synthetic racers.
- [ ] Deploy with explicit Node/package versions, lockfile, reproducible image, server collision assets, `PORT`/`0.0.0.0`, HTTPS/WSS, allowed client origins, public multiplayer hostname and health/readiness endpoints.
- [x] Document environment variables: frontend Supabase URL + publishable key and multiplayer URL; backend issuer/JWKS/auth configuration, scoped DB credentials/server-only secrets, origin allowlist, protocol/physics version, region, room limits and optional Redis URL. No secrets in `VITE_*`, source control, logs or client bundles.
- [ ] Budget CPU/RAM/egress, database/storage/connections and email volume; configure spend alerts/resource caps. A low subscription minimum does not establish the cost of sustained 60 Hz physics.

## 2. Accounts, authentication and session lifecycle

- [ ] Supabase email/password signup with verification, login/logout, forgotten-password/reset flow, useful errors and accessible loading states. Google OAuth is a proposed follow-up, not required to prove the race loop.
- [ ] Allow offline play without signing in; require a completed account/profile for online race entry and verified leaderboard participation. Browsing public safe leaderboard/profile fields can be anonymous.
- [x] Verify access-token signatures, issuer, audience and expiry on the backend and room admission. Derive player UUID from verified identity, never a client-supplied `userId` or editable user metadata.
- [ ] Handle session refresh during long sessions; define reauthentication/reconnect tokens, expiry, duplicate login/connection policy, logout and immediate removal for bans/session revocation where required. Never log bearer/reconnect tokens or put them in share URLs.
- [ ] Rate-limit signup/login-related application endpoints, username searches, room admission and recovery attempts. Use Supabase's own auth protections plus application controls; avoid exposing private account existence.
- [ ] Account settings: email/password changes through proper authenticated flows, linked-provider handling, logout, account deletion and data export/support path. Define retention/anonymization of historical competition records before deletion ships.

## 3. Racer identity and usernames

Implemented launch identity rules are recorded above; broader profile/search/moderation requirements remain below:

- [x] Immutable racer ID is the Auth UUID. Unique handle is independent of email and display name. Canonical handle: 3–20 ASCII characters, starting with a letter, then letters/digits/underscore; case-insensitive uniqueness. Example: `NightShift_7`, public handle `nightshift_7`.
- [x] Normalize and validate on the server and enforce a unique index/constraint in Postgres. Availability UI is advisory; final reservation/claim must be atomic so concurrent signups cannot take the same name.
- [x] Display name can use supported international characters with a separate length limit (proposed 2–24), safe rendering, Unicode normalization and control/bidi character restrictions. Clearly distinguish nonunique display name from unique handle in search/results.
- [ ] Reject reserved staff/system impersonation names and maintain a moderation policy for offensive names. Staff badges must be server-controlled, not typed name decorations. Escape names everywhere, including HUD, invites, profiles and leaderboard links.
- [x] First-login “Create your racer” flow, immediate collision/validation feedback and sensible suggestions. Do not derive a public name from an email address.
- [x] No-cooldown rename transaction, complete audit from migration start, permanent old-handle reservation for the same owner and owner-only history UI. Room/grid identity is frozen at verified admission; rejoin to refresh names. Historical results keep immutable racer IDs.
- [ ] Public old-handle redirects/search, cache convergence and broader moderation policy. These are not provided by the private rename audit.
- [ ] Profile: portrait/preset avatar, display name + handle, public racer card, selected showcase car/livery, race starts/finishes/wins/podiums, best laps and later rank/season badges. Keep email, provider IDs, sessions and moderation notes private.
- [ ] Avatar upload limits, MIME/signature validation, storage quotas and owner-scoped object paths; start with preset avatars if uploads would delay launch.

## 4. Supabase schema and access boundaries

Deliver migrations, generated TypeScript types, constraints/indexes, rollback/restore notes, seed data and automated RLS tests. Exact schema can evolve; each responsibility below must have an owner.

- [ ] `profiles`: UUID FK to `auth.users`, canonical unique handle, display name, public avatar reference, timestamps, profile schema version. Separate private account/preference/moderation data and restrict columns, not only row ownership.
- [x] `username_history` permanent reservations plus `racer_identity_events` audit from migration start, honest baseline events for existing profiles and no rename cooldown. The constrained profile RPC/transaction owns writes; owner-only bounded history reads and UI are implemented.
- [ ] `player_settings`, `garage_builds`, `build_presets`: owner-controlled validated cloud saves, revisions and migration versions. Devices retain device-specific graphics/input preferences unless deliberately synced.
- [ ] `race_rulesets`, track/car/physics manifest versions: approved configuration, eligibility and hashes used to validate the room and interpret historical results.
- [ ] `race_sessions` and `race_participants`: immutable race ID, region, ruleset, lifecycle/status, membership, approved car/build snapshot, start/finish times, result status, DNF/disconnect/disqualification reasons. Private room codes are not public profile fields.
- [ ] `race_results` and `lap_records`: server-authored finish order, authoritative timing, checkpoint/lap validity, penalties, result verification state and provenance. Unique constraints prevent duplicate race/player/lap writes.
- [ ] `leaderboard_bests` or indexed/materialized views, `seasons` and `rating_events`: stable partition keys, deterministic ordering and idempotent aggregation. Keep a result audit trail so disqualifications can be recalculated.
- [ ] Later: `friendships`, `party_members`, `invites`, `blocks`, `reports`, `moderation_actions`, `ghost_metadata`, `progression_events`/reward ledger and account-deletion jobs.
- [x] Current profile, reservation, private practice and identity-audit access boundaries: live role tests cover owner/other/anon/backend, forbidden direct mutations and RPC grants. No server result key was found in the frontend build; Storage/social/competitive schema policies remain future work.
- [ ] Enable RLS on exposed tables. Owners may edit permitted profile/settings/build fields only. Verified times, ranks, stats, balances, entitlements, staff flags and bans cannot be changed through browser writes, RPC misuse or user metadata.
- [ ] Public views expose safe racer-card/leaderboard fields without leaking email, tokens, private parties, raw IPs or moderation data. Restrict search/enumeration and paginate responses.
- [ ] Use narrow backend DB permissions or carefully scoped transactional functions. Supabase secret/service-role credentials bypass RLS: keep them server-side and enforce authorization explicitly. Review `SECURITY DEFINER` functions, `search_path` and execution grants.
- [ ] Storage policies enforce ownership/type/size and sharing policy; replay uploads do not become trusted competitive evidence just because they are stored.

## 5. Headless authoritative simulation and netcode

- [x] Extract simulation from `Game`, rendering, DOM/audio and visual model loading. Server loads versioned collision/surface/checkpoint/spawn data without GLTF rendering, textures or camera objects. Prove server/client collision data and car configurations agree.
- [ ] Server owns race clock, countdown, grid, car/build eligibility, checkpoints, lap validity, resets, nitro/resource use, finish order, penalties and result finalization. Clients send bounded, sequenced control inputs—not authoritative positions, lap times or results.
- [ ] Initial targets to benchmark: 60 Hz fixed simulation, ~20 Hz snapshots, input batching with sequence/tick acknowledgements. Document per-room CPU/physics/memory/bandwidth and catch-up behavior; these are targets, not unmeasured guarantees.
- [x] Predict the local player's controls immediately, reconcile from authoritative snapshots, replay unacknowledged inputs, and smooth visual corrections. Restore the full necessary controller state (including nitro/drift/transmission/launch timers), not just position/velocity. **Experimental opt-in implementation; device/network acceptance remains open.**
- [x] Interpolate remote cars with bounded extrapolation and recovery from stale/out-of-order packets. Sync wheels, steering, braking, nitro and essential effects without streaming full render objects.
- [x] Validate input rate, ranges, sequence monotonicity, build/config hashes and server-time budgets. Pin protocol, physics and track versions; incompatible clients cannot race together.
- [ ] Do not assume Rapier determinism alone makes the entire game deterministic. Prove initialization, creation order, simulation logic and numerical operations; server results remain authoritative regardless.
- [x] Start with non-colliding player cars. Physical online car-to-car contact is a separate milestone with prediction, collision ownership, lag compensation, recovery and griefing acceptance tests. **Two-racer ghost physics implemented.**

## 6. Private rooms, parties and complete race lifecycle

- [ ] Online entry: Create race / Join by code, connection/region/ping display and clear errors. Room codes are short-lived, unguessable enough for the use case and protected against brute-force enumeration; identity/auth checks still apply.
- [ ] Lobby: host + roster, portraits/handles, ready states, player count, approved cars/builds, track, laps, weather/time, assists, collision policy and room visibility. Lock configuration/late joins at the appropriate lifecycle stage.
- [x] Server validates assets/config readiness before a synchronized grid/countdown. A slow or failed client gets bounded waiting, retry and removal behavior rather than blocking everyone indefinitely.
- [x] Explicit state machine: lobby → loading → countdown → racing → finishing → results → rematch/closed. Timeouts, cancellation and allowed actions are server-owned.
- [x] UI host can control lobby settings; it is not the authoritative physics host. Reassign lobby ownership or close the room predictably if the host leaves.
- [x] Reconnect grace window and authenticated seat recovery; no duplicate cars or duplicated results. Disconnect behavior is explicit: ghost/neutral controls, timeout then DNF. Reconnect must not award extra nitro or reset progress.
- [x] Online pause/menu never pauses everyone else. Define safe controls while menus are open or a browser is backgrounded; explain that the race continues.
- [ ] Server-validated recovery/reset cannot skip checkpoints, teleport past rivals for advantage or reset competitive timing.
- [x] One player finishing does not finish all other players. Authoritative first-finish window/max race duration determines remaining finishers/DNFs; results show pending racers, final standings, rematch votes and return-to-lobby actions.
- [ ] Spectate after finish/leave is proposed after the core race loop; joining a race in progress initially means spectating rather than spawning competitively mid-lap.
- [ ] Retain personal settings and presentation: camera, accessibility, audio and narration remain local; authoritative events feed player-specific HUD, rival labels and commentary without duplicated announcements.

## 7. Results, leaderboards and integrity

- [x] Private practice result finalization is server-authored, transactional and idempotent. Duplicate/conflicting retries are checked, and successful live saving plus isolated owner reads are verified. Practice results are not eligible for competitive ranks/rewards.
- [ ] Only the game server can finalize verified results. Make finalization transactional and idempotent across retries/reconnects; rank, stats and rewards derive from one accepted race record.
- [x] Database outage policy: show results pending, retry with bounds/backoff, acknowledge persistence only after commit, and document durable outbox/queue support where needed. An unrecoverable interrupted race is explicitly aborted/unverified; never invent ranks or rewards after a server crash. **Policy/code and offline outbox crash/restart tested; an actual live DB outage and hosted recovery drill remain open in section 10.**
- [ ] Initial leaderboard: verified best lap for a controlled online ruleset, track and approved car/build/conditions. Store track/physics/ruleset versions with every result. Add total race time and drift score boards only once their validation path exists.
- [ ] Partition rules must make comparisons fair: mode, track/layout version, lap count where relevant, competitive car specification/class, assists, collision policy and weather/time rules. Store exact build/config provenance; cosmetic paint changes must not create separate boards. Avoid an unbounded board for every arbitrary cosmetic/build combination.
- [ ] UI: global board, own rank + nearby racers, top results, racer profiles, filters and stable cursor pagination. Friends/weekly/seasonal boards follow after social and season infrastructure.
- [ ] Stable ties: value (ascending time / descending score), authoritative achievement time, then immutable ID. One best eligible entry per racer per partition, with clear DNF/invalid/unverified exclusion.
- [ ] Ranked/rating work is separate from best-lap boards: choose a rating model, placement races, minimum activity requirements, disconnect/DNF treatment, matchmaking bounds, seasonal reset/carry rules and abuse handling before launching ranked.
- [ ] Daily challenge integration with #38 uses server-selected UTC events/rules and verified attempts for online boards; local completion remains separate. Never upload existing localStorage bests as verified records.
- [ ] Detect impossible checkpoint sequences, invalid resets, unapproved builds, excessive input rates, duplicate sessions and impossible simulation states. Flag suspicious records, quarantine them from boards and provide reviewed disqualification/recalculation rather than trusting client screenshots.
- [ ] Optional ghosts/replays reuse #22 / #85: versioned bounded data, signed upload intent, integrity hash, storage/retention limits, and no client-authored replay accepted as proof of a valid ranked time.

## 8. NFS-style identity, progression and social roadmap

- [ ] Racer cards, recognizable usernames/avatars, showcased garage cars, lobby introductions, podium/results presentation, personal race history and earned statistics.
- [ ] Cloud garage/preset sync with conflict resolution, revision checks, size bounds and offline import confirmation. Existing local cars/builds remain playable; locally editable saves do not grant server-owned unlocks or balances.
- [ ] Friends, user search, invitations, private parties, presence/privacy and blocking. Validate invite ownership/expiry/recipient; invites cannot bypass room restrictions. Player-controlled presence should not publish private room codes.
- [ ] XP/REP, levels, unlocks and cosmetic rewards need an explicit progression design and server-authored append-only grant ledger before implementation. Exactly-once grants; no negative/overflow balances, duplicate replayed rewards or trusting a local career save. Payments/trading are excluded unless separately designed and approved.
- [ ] Crews, public playlists, ranked seasons, richer post-race statistics and curated online events are later milestones with their own designs and acceptance criteria.
- [ ] Text/voice chat is deferred until moderation, reporting, muting/blocking, privacy and operational capacity exist. Social launch can use invites/preset communications without unrestricted chat.
- [ ] Do not imply licensed NFS branding/assets, or include pursuit police, open-world traffic, a global shared world or every NFS mode in the first release. These are separate game-system projects.

## 9. Operations, moderation and release safety

- [ ] Protocol/schema version negotiation and backwards-compatible DB deployments. Test old/new clients during rollout; give unsupported clients a clear refresh/update path.
- [x] Bounded room draining and explicit interrupted-race policy implemented; local process/signal suites and container shutdown pass. Hosted rollback/termination drills below remain open.
- [ ] Graceful room draining: stop new admission before shutdown, let active races finish where the platform window permits, otherwise apply an explicit aborted-match policy. Do not assume redeploying or adding replicas preserves in-memory rooms. Drill rollback and process termination.
- [x] Bounded private operational aggregate metrics and own-connection RTT/variation UI implemented. Broader production telemetry/alerts remain open.
- [ ] Structured logs and metrics: active rooms/players, tick duration/backlog, RTT/jitter, input age, reconciliation corrections, snapshot sizes, disconnects, reconnect success, room join failures, DB errors and finalization latency. Redact identities/tokens where appropriate and bound retention.
- [ ] Readiness checks plus external continuous monitoring/alerts. Fly.io deployment health checks alone are not continuous uptime monitoring.
- [ ] Backups and a tested restore procedure; retention/lifecycle policies for results, logs, avatars and ghosts. Clear incident response and account/data deletion handling.
- [ ] Small authenticated admin surface/CLI with role checks and audit logs for user sanctions, offensive names, reports and record disqualification. Clients cannot assign their own moderator role.
- [ ] Limits for room creation, message size/rate, leaderboard reads, friend search and uploads. Bound rooms, cars, inputs, snapshots and queues so one client cannot exhaust the service.
- [ ] Feature flags/kill switches let us disable matchmaking, ranked submissions or uploads while keeping offline racing available.

## 10. Verification and acceptance gates

- [ ] Unit/integration coverage: username canonicalization + simultaneous claim conflicts; unauthorized profile/stat writes; JWT expiry/rotation/invalid issuer; reconnect ownership; room transitions; input limits; checkpoint/reset validity; ties; duplicate result/reward submissions; bans and leaderboard invalidation.
- [ ] Browser/device test: at least two physical devices/accounts through signup, lobby, racing, finish, saved history, leaderboard and rematch. Test desktop Chrome plus Safari/iOS/Android as available; two tabs alone are insufficient acceptance.
- [ ] Network matrix: proposed 30/100/200 ms RTT, jitter and packet loss/disconnect simulations. Measure input responsiveness, visible correction, result agreement and recovery, not just whether sockets remain connected.
- [ ] Load-test the actual server collision assets and chosen cars at four racers/room, then increasing rooms. Publish sustainable room count for the purchased Fly.io resources and measured reference region; expand player count only after client/server budgets pass.
- [ ] Long-session, hidden-tab, refresh, player/host exit, late loading, auth expiry, DB outage and rolling restart/termination tests. No duplicated cars, unverifiable leaderboard entries, leaked rooms or unbounded memory.
- [ ] Validate RLS with anon, owner, other player and privileged backend roles, including column-level edits, RPCs and Storage policies. Verify the frontend bundle contains no privileged credentials.
- [ ] Maintain local single-player behavior, saves, assists, controller/touch support, accessible UI and #69 performance expectations.

## Delivery sequence / child-issue checklist

Create linked implementation issues from these slices; completion of this epic means their acceptance gates pass, not merely that accounts exist.

- [ ] P0: confirm launch rules, regions/budget, username policy and competitive configuration; implement shared simulation spike and measure one server race.
- [ ] P1: Supabase projects/migrations/RLS/Auth + racer onboarding/profile + Fly.io persistent service/CI/secrets/observability.
- [ ] P2: private 2-player room, prediction/interpolation, readiness/countdown, checkpoint-verified finish and persisted results; extend to four players after measurements.
- [ ] P3: disconnect/reconnect, DNF/rematch, operational draining/failure handling, verified best-lap leaderboard and account/racer history.
- [ ] P4: cloud garage sync, friends/parties/invites and public casual matchmaking with region/ping restrictions.
- [ ] P5: ranked ratings/seasons, verified drift/daily boards, server progression/rewards, crews and moderation expansion.
- [ ] P6: online contact collisions, richer spectators/ghosts/replays and additional modes only after their separate validation.

### Decisions still to record

Fly.io pilot is confirmed in Charly (`charly-27`), Johannesburg, one shared CPU / 256 MiB machine; Supabase is in Frankfurt (`eu-central-1`). Measure device latency and establish sustained race capacity/cost ceiling before expansion. Username/display-name rules and no-cooldown renames are confirmed above; the live private rename audit is now implemented; broader moderation remains open. Remaining decisions: signup methods and SMTP provider; approved launch track/car/ruleset; guest-public-read policy; acceptance of implemented reconnect/finish timeouts; chosen rating/progression models; moderation/retention/deletion policy. Defaults above are proposals, not already implemented guarantees.

## Official references

- [Fly.io app configuration](https://fly.io/docs/reference/configuration/), [Node apps](https://fly.io/docs/js/), [WebSockets](https://fly.io/docs/networking/websockets/), [health checks](https://fly.io/docs/reference/health-checks/).
- [Supabase Auth](https://supabase.com/docs/guides/auth), [profile/user data](https://supabase.com/docs/guides/auth/managing-user-data), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [JWT verification in React](https://supabase.com/docs/guides/auth/quickstarts/react). The backend must verify tokens as well; frontend verification is not server authorization.
- [Colyseus deployment and multi-process requirements](https://docs.colyseus.io/deployment), [state synchronization](https://docs.colyseus.io/state).
- [Rapier JavaScript determinism and its prerequisites](https://rapier.rs/docs/user_guides/javascript/determinism/).
