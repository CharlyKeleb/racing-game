-- #120: append-only owner identity events, independent of handle reservations.
begin;
create table public.racer_identity_events (
  event_id uuid primary key default gen_random_uuid(),
  player_id uuid not null references auth.users(id) on delete cascade,
  recorded_at timestamptz not null default clock_timestamp(),
  kind text not null check (kind in ('baseline','created','renamed')),
  old_handle text,
  old_display_name text,
  new_handle text not null check (new_handle ~ '^[a-z][a-z0-9_]{2,19}$'),
  new_display_name text not null check (char_length(new_display_name) between 2 and 24),
  check ((kind in ('baseline','created') and old_handle is null and old_display_name is null)
    or (kind = 'renamed' and old_handle is not null and old_display_name is not null
      and (old_handle <> new_handle or old_display_name <> new_display_name)))
);
create index racer_identity_events_owner_page on public.racer_identity_events(player_id, recorded_at desc, event_id desc);
alter table public.racer_identity_events enable row level security;
revoke all on public.racer_identity_events from public, anon, authenticated, service_role;
grant select on public.racer_identity_events to authenticated;
create policy racer_identity_events_owner_read on public.racer_identity_events for select to authenticated
 using ((select auth.uid()) = player_id);

-- Baselines describe the current identity when auditing begins. Historical rename
-- order cannot be inferred from the existing first-claim reservation table.
insert into public.racer_identity_events(player_id, kind, new_handle, new_display_name)
  select id, 'baseline', handle, display_name from public.profiles;

create function public.audit_racer_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.racer_identity_events(player_id,kind,new_handle,new_display_name)
      values(new.id,'created',new.handle,new.display_name);
  elsif old.handle is distinct from new.handle or old.display_name is distinct from new.display_name then
    insert into public.racer_identity_events(player_id,kind,old_handle,old_display_name,new_handle,new_display_name)
      values(new.id,'renamed',old.handle,old.display_name,new.handle,new.display_name);
  end if;
  return new;
end;
$$;
revoke all on function public.audit_racer_identity() from public, anon, authenticated, service_role;
create trigger racer_identity_audit after insert or update of handle, display_name on public.profiles
 for each row execute function public.audit_racer_identity();

create function public.my_racer_identity_history(before_at timestamptz default null, before_id uuid default null)
returns setof public.racer_identity_events language plpgsql stable security invoker set search_path = '' as $$
begin
  if (before_at is null) <> (before_id is null) then raise exception 'invalid_history_cursor' using errcode = '22023'; end if;
  return query select * from public.racer_identity_events
    where player_id = (select auth.uid())
      and ((before_at is null and before_id is null) or (recorded_at,event_id) < (before_at,before_id))
    order by recorded_at desc, event_id desc limit 21;
end;
$$;
revoke all on function public.my_racer_identity_history(timestamptz, uuid) from public, anon, service_role;
grant execute on function public.my_racer_identity_history(timestamptz, uuid) to authenticated;
commit;
