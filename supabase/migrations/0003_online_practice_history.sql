-- #120: private server-authored practice history. Never eligible for competitive boards.
begin;
create table public.online_practice_races (
  race_id uuid primary key,
  record jsonb not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create table public.online_practice_history (
  race_id uuid not null references public.online_practice_races(race_id),
  player_id uuid not null references public.profiles(id) on delete cascade,
  recorded_at timestamptz not null,
  track text not null check (track = 'nurburgring'),
  laps integer not null check (laps between 1 and 10),
  car_id text not null check (car_id in ('porsche911','koenigsegg','bmw','diablo','amg','charger')),
  status text not null check (status in ('finished','dnf')),
  rank integer check (rank between 1 and 2),
  finish_ticks integer check (finish_ticks between 1 and 36000),
  lap_ticks integer[] not null,
  reason text not null check (reason in ('all-finished','finish-window','time-limit')),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  simulation_version integer not null check (simulation_version > 0),
  race_protocol integer not null check (race_protocol = 2),
  ruleset text not null check (ruleset = 'online-practice-v1'),
  leaderboard_eligible boolean generated always as (false) stored,
  primary key (race_id, player_id),
  check ((status = 'finished' and rank is not null and finish_ticks is not null and cardinality(lap_ticks) = laps)
    or (status = 'dnf' and rank is null and finish_ticks is null and cardinality(lap_ticks) < laps))
);
create index online_practice_history_owner_page on public.online_practice_history(player_id, recorded_at desc, race_id desc);
alter table public.online_practice_races enable row level security;
alter table public.online_practice_history enable row level security;
revoke all on public.online_practice_races, public.online_practice_history from public, anon, authenticated, service_role;
grant select on public.online_practice_history to authenticated;
create policy online_practice_owner_read on public.online_practice_history for select to authenticated
 using ((select auth.uid()) = player_id);

-- One transaction for the race and both participants. A retry must be byte-equivalent
-- as JSONB, including provenance. A conflicting reuse of a race ID is never an upsert.
create function public.record_online_practice(race_record jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := race_record->'result';
  participant jsonb;
  lap jsonb;
  race_uid uuid;
  uid uuid;
  seen uuid[] := '{}';
  lap_values integer[];
  lap_sum integer;
  target_laps integer;
  elapsed integer;
  finished integer := 0;
  first_finish integer := 36001;
  last_finish integer := 0;
  expected_rank integer;
  existing_record jsonb;
  saved_at timestamptz;
begin
  if race_record is null or pg_catalog.pg_column_size(race_record) > 16384
    or jsonb_typeof(race_record->'schema') is distinct from 'number'
    or jsonb_typeof(race_record->'protocol') is distinct from 'number'
    or jsonb_typeof(race_record->'simulationVersion') is distinct from 'number'
    or jsonb_typeof(r->'tickRate') is distinct from 'number'
    or jsonb_typeof(r->'laps') is distinct from 'number'
    or jsonb_typeof(r->'completedTick') is distinct from 'number'
    or (race_record->>'schema') is distinct from '1'
    or (race_record->>'ruleset') is distinct from 'online-practice-v1'
    or (race_record->>'protocol') is distinct from '2'
    or coalesce(race_record->>'fingerprint','') !~ '^[a-f0-9]{64}$'
    or coalesce(race_record->>'simulationVersion','') !~ '^[1-9][0-9]{0,6}$'
    or (race_record->>'simulationVersion')::integer > 1000000
    or coalesce(r->>'raceId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (r->>'track') is distinct from 'nurburgring' or (r->>'tickRate') is distinct from '60'
    or coalesce(r->>'laps','') !~ '^(10|[1-9])$'
    or coalesce(r->>'completedTick','') !~ '^[0-9]{1,5}$'
    or coalesce(r->>'reason','') not in ('all-finished','finish-window','time-limit')
    or jsonb_typeof(r->'racers') is distinct from 'array' then
    raise exception 'invalid_practice_record' using errcode = '22023';
  end if;
  if jsonb_array_length(r->'racers') <> 2 then raise exception 'invalid_practice_roster' using errcode = '22023'; end if;
  race_uid := (r->>'raceId')::uuid;
  target_laps := (r->>'laps')::integer;
  elapsed := (r->>'completedTick')::integer - 180;
  if elapsed not between 1 and 36000 then raise exception 'invalid_practice_time' using errcode = '22023'; end if;
  -- Same-race retries serialize before any inserts, including concurrent submissions.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(race_uid::text, 1));
  select record, recorded_at into existing_record, saved_at from public.online_practice_races where race_id = race_uid;
  if found then
    if existing_record <> race_record then raise exception 'practice_result_conflict' using errcode = '23505'; end if;
    return jsonb_build_object('raceId', race_uid, 'savedAt', saved_at);
  end if;
  for participant in select value from jsonb_array_elements(r->'racers') loop
    if coalesce(participant->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(participant->>'carId','') not in ('porsche911','koenigsegg','bmw','diablo','amg','charger')
      or jsonb_typeof(participant->'lapTicks') is distinct from 'array' then
      raise exception 'invalid_practice_participant' using errcode = '22023';
    end if;
    uid := (participant->>'id')::uuid;
    if uid = any(seen) then raise exception 'duplicate_practice_participant' using errcode = '22023'; end if;
    seen := array_append(seen, uid);
    lap_values := '{}'; lap_sum := 0;
    for lap in select value from jsonb_array_elements(participant->'lapTicks') loop
      if jsonb_typeof(lap) <> 'number' or lap::text !~ '^[1-9][0-9]{0,4}$' then raise exception 'invalid_lap_time' using errcode = '22023'; end if;
      lap_values := array_append(lap_values, lap::text::integer);
      lap_sum := lap_sum + lap::text::integer;
    end loop;
    if cardinality(lap_values) > target_laps or lap_sum > elapsed then raise exception 'invalid_lap_sum' using errcode = '22023'; end if;
    if participant->>'status' = 'finished' then
      if jsonb_typeof(participant->'finishTicks') is distinct from 'number'
        or jsonb_typeof(participant->'rank') is distinct from 'number'
        or cardinality(lap_values) <> target_laps or coalesce(participant->>'finishTicks','') !~ '^[1-9][0-9]{0,4}$'
        or (participant->>'finishTicks')::integer <> lap_sum then raise exception 'invalid_finish_time' using errcode = '22023'; end if;
      select 1 + count(*) into expected_rank from jsonb_array_elements(r->'racers') other
        where jsonb_typeof(other->'finishTicks') = 'number' and (other->>'finishTicks')::numeric < lap_sum;
      if (participant->>'rank') is distinct from expected_rank::text then raise exception 'invalid_finish_rank' using errcode = '22023'; end if;
      finished := finished + 1;
      first_finish := least(first_finish, lap_sum); last_finish := greatest(last_finish, lap_sum);
    elsif participant->>'status' = 'dnf' then
      if (participant->'finishTicks') is distinct from 'null'::jsonb or (participant->'rank') is distinct from 'null'::jsonb
        or cardinality(lap_values) >= target_laps then raise exception 'invalid_dnf' using errcode = '22023'; end if;
    else raise exception 'invalid_practice_status' using errcode = '22023'; end if;
  end loop;
  if (r->>'reason' = 'all-finished' and (finished <> 2 or elapsed <> last_finish))
    or (r->>'reason' = 'finish-window' and (finished <> 1 or elapsed <> first_finish + 3600))
    or (r->>'reason' = 'time-limit' and (elapsed <> 36000 or finished = 2)) then
    raise exception 'invalid_finish_reason' using errcode = '22023';
  end if;
  insert into public.online_practice_races(race_id, record) values (race_uid, race_record) returning recorded_at into saved_at;
  for participant in select value from jsonb_array_elements(r->'racers') loop
    select coalesce(array_agg(value::text::integer), '{}') into lap_values from jsonb_array_elements(participant->'lapTicks');
    insert into public.online_practice_history(race_id, player_id, recorded_at, track, laps, car_id, status, rank, finish_ticks,
      lap_ticks, reason, fingerprint, simulation_version, race_protocol, ruleset)
    values (race_uid, (participant->>'id')::uuid, saved_at, r->>'track', target_laps, participant->>'carId', participant->>'status',
      (participant->>'rank')::integer, (participant->>'finishTicks')::integer, lap_values, r->>'reason',
      race_record->>'fingerprint', (race_record->>'simulationVersion')::integer, 2, 'online-practice-v1');
  end loop;
  return jsonb_build_object('raceId', race_uid, 'savedAt', saved_at);
end;
$$;
revoke all on function public.record_online_practice(jsonb) from public, anon, authenticated;
grant execute on function public.record_online_practice(jsonb) to service_role;

-- Bounded keyset pagination; caller identity always comes from Auth + RLS.
create function public.my_online_practice_history(before_at timestamptz default null, before_id uuid default null)
returns setof public.online_practice_history language sql stable security invoker set search_path = '' as $$
  select * from public.online_practice_history
    where player_id = (select auth.uid())
      and ((before_at is null and before_id is null) or (recorded_at, race_id) < (before_at, before_id))
    order by recorded_at desc, race_id desc limit 21;
$$;
revoke all on function public.my_online_practice_history(timestamptz, uuid) from public, anon;
grant execute on function public.my_online_practice_history(timestamptz, uuid) to authenticated;
commit;
