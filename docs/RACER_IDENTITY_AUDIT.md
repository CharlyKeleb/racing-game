# Private racer identity audit (#120)

Migration `0005_racer_identity_audit.sql` adds a transactionally written event for
each new profile and each actual handle/display-name change. Canonical no-op saves
create no event. Returning to a previously owned handle creates another event,
while the existing `username_history` table remains the permanent ownership
reservation. The no-cooldown rule and existing constrained profile-save RPC are
unchanged. Failed saves and rolled-back transactions leave no audit event.

The trigger derives old/new values from the profile row, never browser-supplied
audit fields, and runs in the same transaction as the profile/reservation write.
It uses a fixed search path and exposes no callable trigger function to browser or
service roles. An owner can read only their own events through RLS and the bounded
`my_racer_identity_history(before_at, before_id)` RPC. The response is at most 21
rows, ordered by `(recorded_at,event_id)` descending, for a client to display 20
and detect another page. Both cursor components must be supplied together. There
is no arbitrary owner argument, public rename search, email/provider metadata or
browser insert/update/delete access. Database administrators remain trusted.

For an existing profile, migration records a `baseline` containing its current
identity at audit start. The reservation table stores first claims, not the full
past rename sequence; that history is not invented or backdated. New profiles get
`created` and later changes get `renamed`, including display-name-only changes.
Events are removed by Auth user deletion through the FK cascade, matching the
current private profile/reservation policy. A broader account deletion/export or
competition-record anonymization flow is not implemented by this migration.

Apply after 0004 to an isolated staging database first. No live migration is part
of this change. Reverting the browser/backend does not require dropping the audit
table or trigger; retain the additive schema so audit continuity is preserved.
This is the storage/read-RPC chunk; an in-game name-history viewer, public profile
search, moderation audit tools and handle redirects remain separate work.

Names in admitted rooms and race-grid snapshots remain the identity verified on
admission. A profile rename does not change the immutable Auth UUID, take another
seat, rewrite a completed result or update an in-progress grid. Rejoin normally
to refresh the room identity. No competitive rewards/eligibility derive from these
name events.

## Verification

Embedded Postgres tests apply the real migration chain and cover repeated
handle/display changes and return-to-owned-handle without a cooldown; unchanged
canonical saves; rejected claims; transaction rollback; owner/other/anon/service
ACLs; denied direct writes/trigger execution; bounded tied-timestamp pagination;
invalid half cursors; and honest baseline migration of an existing project.
These are single-connection transaction/RLS tests, not hosted Auth/PostgREST or
multi-connection race tests. The existing profile RPC still serializes same-owner
updates using its advisory lock and keeps distinct-owner reservations unique.
