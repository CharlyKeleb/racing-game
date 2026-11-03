-- Paris replaces Station District ('city'): its 2.58 km lap gets the same 150 m/s floor as the
-- others. Old 'city' rows stay in the table but no new ones are accepted.
-- The caller's own bests, always from auth.uid(). Only ever improves a score. A bad
-- entry is skipped, not fatal, so one stale or unknown record can't block the others.
create or replace function public.submit_leaderboard_scores(entries jsonb)
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
      when 'u2city' then 16000 when 'paris' then 17000 when 'canyon' then 20000 when 'test-circuit' then 7000
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
