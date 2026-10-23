-- #120: owner-readable identities; all writes go through the constrained RPC.
begin;
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z][a-z0-9_]{2,19}$'),
  display_name text not null check (char_length(display_name) between 2 and 24),
  handle_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  schema_version integer not null default 1 check (schema_version = 1)
);
create table public.reserved_handles (handle text primary key);
insert into public.reserved_handles values
 ('admin'), ('administrator'), ('moderator'), ('mod'), ('staff'),
 ('support'), ('system'), ('official'), ('racing_game'), ('supabase');
-- Old handles remain reserved to their original owner; no redirects/search yet.
create table public.username_history (
  handle text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
alter table public.reserved_handles enable row level security;
alter table public.username_history enable row level security;
revoke all on public.profiles, public.reserved_handles, public.username_history from anon, authenticated;
grant select on public.profiles to authenticated;
create policy profiles_owner_read on public.profiles for select to authenticated
 using ((select auth.uid()) = id);

create function public.save_racer_profile(requested_handle text, requested_display_name text)
returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  canonical text := lower(btrim(requested_handle) collate "C");
  display text := normalize(btrim(requested_display_name), NFC);
  result public.profiles;
begin
  if uid is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  -- Serialize all claims/renames by this player, including concurrent first claims.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text, 0));
  if canonical is null or canonical !~ '^[a-z][a-z0-9_]{2,19}$' then
    raise exception 'invalid_handle' using errcode = '22023';
  end if;
  if exists (select 1 from public.reserved_handles where handle = canonical) then
    raise exception 'reserved_handle' using errcode = '22023';
  end if;
  -- C0/C1, formatting, bidi, line/paragraph separator and invisible controls.
  if display is null or char_length(display) not between 2 and 24
    or display ~ U&'[\0001-\001F\007F-\009F\00AD\0600-\0605\061C\06DD\070F\0890-\0891\08E2\180E\200B-\200F\2028-\202E\2060-\2064\2066-\206F\FEFF\FFF9-\FFFB\+0110BD\+0110CD\+013430-\+01343F\+01BCA0-\+01BCA3\+01D173-\+01D17A\+0E0001\+0E0020-\+0E007F]' then
    raise exception 'invalid_display_name' using errcode = '22023';
  end if;
  -- Unique history key makes reservations atomic across different players.
  insert into public.username_history(handle, user_id) values(canonical, uid)
    on conflict (handle) do nothing;
  if not exists (select 1 from public.username_history where handle = canonical and user_id = uid) then
    raise exception 'handle_taken' using errcode = '23505';
  end if;
  insert into public.profiles(id, handle, display_name) values(uid, canonical, display)
    on conflict (id) do update set handle = excluded.handle, display_name = excluded.display_name,
      handle_changed_at = case when profiles.handle <> excluded.handle then now() else profiles.handle_changed_at end,
      updated_at = now()
    returning * into result;
  return result;
end;
$$;
revoke all on function public.save_racer_profile(text, text) from public, anon;
grant execute on function public.save_racer_profile(text, text) to authenticated;
commit;
