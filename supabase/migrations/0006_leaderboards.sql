-- Global Time Trial and Drift boards. See docs/LEADERBOARDS.md.
-- Scores are reported by the player's browser, so these are community boards:
-- nothing here is server-authoritative or linked to online practice results.
begin;
create table public.leaderboard_scores (
  board text not null check (board ~ '^(trial:[a-z0-9-]{1,32}|drift:[a-z0-9-]{1,32}:[a-z]{1,16})$'),
  player_id uuid not null references public.profiles(id) on delete cascade,
  -- Time Trial keeps one best per car; drift records have no car, so one per board ('').
  car_id text not null,
  build_key text,
  -- Time Trial: lap in ms, lower is better. Drift: points, higher is better.
  score integer not null check (score > 0),
  rank_key integer generated always as (case when board like 'trial:%' then score else -score end) stored,
  set_at timestamptz not null default clock_timestamp(),
  primary key (board, player_id, car_id),
  check ((board like 'trial:%' and car_id <> '' and build_key is not null)
    or (board like 'drift:%' and car_id = '' and build_key is null))
);
create index leaderboard_scores_rank on public.leaderboard_scores(board, rank_key, set_at);
alter table public.leaderboard_scores enable row level security;
-- No direct access for anyone: the two functions below are the only way in or out.
revoke all on public.leaderboard_scores from public, anon, authenticated, service_role;

-- The caller's own bests, always from auth.uid(). Only ever improves a score. A bad
-- entry is skipped, not fatal, so one stale or unknown record can't block the others.
create function public.submit_leaderboard_scores(entries jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  entry jsonb;
  track text;
  points integer;
  floor_ms integer;
  is_trial boolean;
  accepted integer := 0;
  rejected integer := 0;
begin
  if me is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if jsonb_typeof(entries) is distinct from 'array' or jsonb_array_length(entries) > 64 then
    raise exception 'invalid_leaderboard_batch' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = me) then
    raise exception 'racer_profile_required' using errcode = '22023';
  end if;
  for entry in select value from jsonb_array_elements(entries) loop
    track := entry->>'track';
    -- 150 m/s average around the lap (540 km/h): no car gets near it, garbage can't beat it.
    floor_ms := case track
      when 'nurburgring' then 34000 when 'singapore' then 33000 when 'drift-park' then 8000
      when 'u2city' then 16000 when 'city' then 10000 when 'canyon' then 20000 when 'test-circuit' then 7000
    end;
    is_trial := entry->>'kind' = 'trial';
    if floor_ms is null or jsonb_typeof(entry->'score') is distinct from 'number'
      or coalesce(entry->>'score', '') !~ '^[1-9][0-9]{0,8}$' then
      rejected := rejected + 1;
      continue;
    end if;
    points := (entry->>'score')::integer;
    if is_trial then
      if coalesce(entry->>'car', '') not in ('porsche911','koenigsegg','bmw','diablo','amg','charger')
        or coalesce(entry->>'build', '') !~ '^e[0-3]-t(street|sport|race)-s(stock|sport|race)-w[0-2]-b[0-2]$'
        or points not between floor_ms and 3600000 then
        rejected := rejected + 1;
        continue;
      end if;
      insert into public.leaderboard_scores as saved (board, player_id, car_id, build_key, score)
      values ('trial:' || track, me, entry->>'car', entry->>'build', points)
      on conflict (board, player_id, car_id) do update
        set score = excluded.score, build_key = excluded.build_key, set_at = clock_timestamp()
        where excluded.score < saved.score;
    elsif entry->>'kind' = 'drift' then
      if coalesce(entry->>'event', '') not in ('flow','sprint','endurance') or points > 10000000 then
        rejected := rejected + 1;
        continue;
      end if;
      insert into public.leaderboard_scores as saved (board, player_id, car_id, build_key, score)
      values ('drift:' || track || ':' || (entry->>'event'), me, '', null, points)
      on conflict (board, player_id, car_id) do update
        set score = excluded.score, set_at = clock_timestamp()
        where excluded.score > saved.score;
    else
      rejected := rejected + 1;
      continue;
    end if;
    accepted := accepted + 1;
  end loop;
  return jsonb_build_object('accepted', accepted, 'rejected', rejected);
end;
$$;
revoke all on function public.submit_leaderboard_scores(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.submit_leaderboard_scores(jsonb) to authenticated;

-- Public read: the top 50, plus the caller's own row when it's further down. A player
-- counts once, on their best car. Exposes the display name only: no ids, no handles.
-- Definer rights because profiles are owner-only under RLS. Equal scores: first to set it leads.
create function public.leaderboard_top(board_id text, car_filter text default null)
returns table (rank bigint, entrants bigint, display_name text, car_id text, build_key text, score integer, set_at timestamptz, is_me boolean)
language sql stable security definer set search_path = '' as $$
  with best as (
    select distinct on (s.player_id) s.player_id, s.car_id, s.build_key, s.score, s.rank_key, s.set_at
    from public.leaderboard_scores s
    where s.board = board_id and (car_filter is null or s.car_id = car_filter)
    order by s.player_id, s.rank_key, s.set_at
  ), ranked as (
    select b.*, row_number() over (order by b.rank_key, b.set_at, b.player_id) as place, count(*) over () as total
    from best b
  )
  select r.place, r.total, p.display_name, r.car_id, r.build_key, r.score, r.set_at, r.player_id is not distinct from (select auth.uid())
  from ranked r join public.profiles p on p.id = r.player_id
  where r.place <= 50 or r.player_id = (select auth.uid())
  order by r.place;
$$;
revoke all on function public.leaderboard_top(text, text) from public, anon, authenticated, service_role;
grant execute on function public.leaderboard_top(text, text) to anon, authenticated;
commit;
