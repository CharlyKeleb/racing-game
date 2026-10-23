-- Cloud save (docs/ACCOUNTS.md): one row per player, written from the browser.
-- Row-level security means a player's anon-key session can only touch their own row.

create table if not exists public.player_saves (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  -- Settings, builds, presets and records are a few KB; cap a row well above that.
  constraint player_saves_size check (pg_column_size(data) < 262144)
);

alter table public.player_saves enable row level security;

drop policy if exists "Players read their own save" on public.player_saves;
create policy "Players read their own save" on public.player_saves
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Players create their own save" on public.player_saves;
create policy "Players create their own save" on public.player_saves
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Players update their own save" on public.player_saves;
create policy "Players update their own save" on public.player_saves
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Players delete their own save" on public.player_saves;
create policy "Players delete their own save" on public.player_saves
  for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.player_saves to authenticated;
