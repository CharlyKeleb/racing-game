-- #120: additive retirement history; retain v1 outbox replay and existing receipts.
-- Apply before deploying a protocol-3 backend. No competitive eligibility changes.
begin;
alter table public.online_practice_history
  drop constraint online_practice_history_reason_check,
  drop constraint online_practice_history_race_protocol_check,
  drop constraint online_practice_history_ruleset_check,
  add column retired_ticks integer,
  add column dnf_reason text,
  add constraint online_practice_reason check (reason in ('all-finished','finish-window','time-limit','all-resolved')),
  add constraint online_practice_version check (
    (race_protocol = 2 and ruleset = 'online-practice-v1' and reason <> 'all-resolved' and retired_ticks is null and dnf_reason is null)
    or (race_protocol = 3 and ruleset = 'online-practice-v2')),
  add constraint online_practice_retirement check (
    (retired_ticks is null and dnf_reason is null)
    or (status = 'dnf' and retired_ticks is not null and retired_ticks between 1 and 36000
      and dnf_reason is not null and dnf_reason in ('left','connection-lost','auth-expired')));

create or replace function public.record_online_practice(race_record jsonb)
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
  retired integer := 0;
  last_terminal integer := 0;
  retired_at integer;
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
    or not ((race_record->>'ruleset' = 'online-practice-v1' and race_record->>'protocol' = '2')
      or (race_record->>'ruleset' = 'online-practice-v2' and race_record->>'protocol' = '3'))
    or race_record->>'ruleset' is null or race_record->>'protocol' is null
    or coalesce(race_record->>'fingerprint','') !~ '^[a-f0-9]{64}$'
    or coalesce(race_record->>'simulationVersion','') !~ '^[1-9][0-9]{0,6}$'
    or (race_record->>'simulationVersion')::integer > 1000000
    or coalesce(r->>'raceId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (r->>'track') is distinct from 'nurburgring' or (r->>'tickRate') is distinct from '60'
    or coalesce(r->>'laps','') !~ '^(10|[1-9])$'
    or coalesce(r->>'completedTick','') !~ '^[0-9]{1,5}$'
    or coalesce(r->>'reason','') not in ('all-finished','finish-window','time-limit','all-resolved')
    or (r->>'reason' = 'all-resolved' and race_record->>'protocol' <> '3')
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
    retired_at := null;
    if participant ? 'retiredTicks' or participant ? 'dnfReason' then
      if race_record->>'protocol' <> '3' or participant->>'status' is distinct from 'dnf'
        or jsonb_typeof(participant->'retiredTicks') is distinct from 'number'
        or coalesce(participant->>'retiredTicks','') !~ '^[1-9][0-9]{0,4}$'
        or coalesce(participant->>'dnfReason','') not in ('left','connection-lost','auth-expired') then
        raise exception 'invalid_retirement' using errcode = '22023';
      end if;
      retired_at := (participant->>'retiredTicks')::integer;
      if retired_at > elapsed then raise exception 'invalid_retirement_time' using errcode = '22023'; end if;
      retired := retired + 1;
      last_terminal := greatest(last_terminal, retired_at);
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
    if cardinality(lap_values) > target_laps or lap_sum > coalesce(retired_at, elapsed) then raise exception 'invalid_lap_sum' using errcode = '22023'; end if;
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
      last_terminal := greatest(last_terminal, lap_sum);
    elsif participant->>'status' = 'dnf' then
      if (participant->'finishTicks') is distinct from 'null'::jsonb or (participant->'rank') is distinct from 'null'::jsonb
        or cardinality(lap_values) >= target_laps then raise exception 'invalid_dnf' using errcode = '22023'; end if;
    else raise exception 'invalid_practice_status' using errcode = '22023'; end if;
  end loop;
  if (r->>'reason' = 'all-resolved' and (retired = 0 or retired + finished <> 2 or elapsed <> last_terminal))
    or (r->>'reason' = 'all-finished' and (finished <> 2 or elapsed <> last_finish))
    or (r->>'reason' = 'finish-window' and (finished <> 1 or elapsed <> first_finish + 3600))
    or (r->>'reason' = 'time-limit' and (elapsed <> 36000 or finished = 2)) then
    raise exception 'invalid_finish_reason' using errcode = '22023';
  end if;
  insert into public.online_practice_races(race_id, record) values (race_uid, race_record) returning recorded_at into saved_at;
  for participant in select value from jsonb_array_elements(r->'racers') loop
    select coalesce(array_agg(value::text::integer), '{}') into lap_values from jsonb_array_elements(participant->'lapTicks');
    insert into public.online_practice_history(race_id, player_id, recorded_at, track, laps, car_id, status, rank, finish_ticks,
      lap_ticks, reason, fingerprint, simulation_version, race_protocol, ruleset, retired_ticks, dnf_reason)
    values (race_uid, (participant->>'id')::uuid, saved_at, r->>'track', target_laps, participant->>'carId', participant->>'status',
      (participant->>'rank')::integer, (participant->>'finishTicks')::integer, lap_values, r->>'reason',
      race_record->>'fingerprint', (race_record->>'simulationVersion')::integer, (race_record->>'protocol')::integer, race_record->>'ruleset',
      (participant->>'retiredTicks')::integer, participant->>'dnfReason');
  end loop;
  return jsonb_build_object('raceId', race_uid, 'savedAt', saved_at);
end;
$$;
revoke all on function public.record_online_practice(jsonb) from public, anon, authenticated;
grant execute on function public.record_online_practice(jsonb) to service_role;

commit;
