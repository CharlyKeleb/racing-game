\set ON_ERROR_STOP on
-- CLI-linked acceptance: all synthetic identities, history and audit events roll back.
-- No existing account IDs or records are read. Run with supabase test db --linked.
begin;
set local role postgres;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
select '1..6';
create temporary table practice_acceptance_fixture (owner_id uuid, other_id uuid, race_id uuid, record jsonb, receipt jsonb);
insert into practice_acceptance_fixture(owner_id,other_id,race_id) values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
grant select on practice_acceptance_fixture to authenticated, service_role;
insert into auth.users(id) select owner_id from practice_acceptance_fixture union all select other_id from practice_acceptance_fixture;
insert into public.profiles(id,handle,display_name)
 select owner_id,'qa_' || left(replace(owner_id::text,'-',''),16),'Acceptance Owner' from practice_acceptance_fixture
 union all select other_id,'qa_' || left(replace(other_id::text,'-',''),16),'Acceptance Other' from practice_acceptance_fixture;
update practice_acceptance_fixture set record=jsonb_build_object(
 'schema',1,'protocol',3,'ruleset','online-practice-v2','fingerprint',repeat('a',64),'simulationVersion',1,
 'result',jsonb_build_object('raceId',race_id,'track','nurburgring','laps',1,'tickRate',60,'completedTick',380,'reason','all-resolved',
 'racers',jsonb_build_array(
 jsonb_build_object('id',owner_id,'carId','porsche911','status','finished','rank',1,'finishTicks',200,'lapTicks',jsonb_build_array(200)),
 jsonb_build_object('id',other_id,'carId','diablo','status','dnf','rank',null,'finishTicks',null,'lapTicks',jsonb_build_array(),'retiredTicks',100,'dnfReason','connection-lost'))));

set local role service_role;
do $$ declare r jsonb; a jsonb; b jsonb; begin
 select record into r from practice_acceptance_fixture;
 a:=public.record_online_practice(r); b:=public.record_online_practice(r);
 if a is distinct from b or a->>'raceId' is distinct from r->'result'->>'raceId' or a->>'savedAt' is null then raise exception 'Result receipt/retry mismatch'; end if;
 begin
  perform public.record_online_practice(jsonb_set(r,'{fingerprint}',to_jsonb(repeat('b',64))));
  raise exception 'Conflicting result unexpectedly accepted';
 exception when unique_violation then null; end;
end $$;
set local role postgres;
select 'ok 1 - backend saves retirement result and retries idempotently, rejects conflict';

do $$ declare f practice_acceptance_fixture; begin
 select * into f from practice_acceptance_fixture;
 if (select count(*) from public.online_practice_history where race_id=f.race_id)<>2
 or not exists(select 1 from public.online_practice_history where race_id=f.race_id and player_id=f.other_id and retired_ticks=100 and dnf_reason='connection-lost' and not leaderboard_eligible)
 then raise exception 'Result atomicity or retirement metadata mismatch'; end if;
end $$;
select 'ok 2 - both private rows and ineligible retirement metadata persist within transaction';

select set_config('request.jwt.claim.sub',owner_id::text,true) from practice_acceptance_fixture;
select set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true) from practice_acceptance_fixture;
set local role authenticated;
do $$ declare f practice_acceptance_fixture; begin
 select * into f from practice_acceptance_fixture;
 if (select count(*) from public.my_online_practice_history() where race_id=f.race_id)<>1
 or exists(select 1 from public.online_practice_history where race_id=f.race_id and player_id=f.other_id)
 or (select count(*) from public.my_racer_identity_history() where player_id=f.owner_id)<>1
 or exists(select 1 from public.racer_identity_events where player_id=f.other_id)
 then raise exception 'Owner history isolation failed'; end if;
end $$;
set local role postgres;
select 'ok 3 - owner sees own race and audit but cannot see the other racer';

select set_config('request.jwt.claim.sub',other_id::text,true) from practice_acceptance_fixture;
select set_config('request.jwt.claims',jsonb_build_object('sub',other_id,'role','authenticated')::text,true) from practice_acceptance_fixture;
set local role authenticated;
do $$ declare f practice_acceptance_fixture; begin
 select * into f from practice_acceptance_fixture;
 if (select count(*) from public.my_online_practice_history() where race_id=f.race_id)<>1
 or exists(select 1 from public.online_practice_history where race_id=f.race_id and player_id=f.owner_id)
 then raise exception 'Other racer isolation failed'; end if;
 begin perform public.record_online_practice(f.record); raise exception 'Browser result write allowed'; exception when insufficient_privilege then null; end;
 begin perform 1 from public.online_practice_races where race_id=f.race_id; raise exception 'Browser raw race read allowed'; exception when insufficient_privilege then null; end;
 begin update public.online_practice_history set rank=1 where false; raise exception 'Browser direct history write allowed'; exception when insufficient_privilege then null; end;
 begin delete from public.racer_identity_events where false; raise exception 'Browser audit deletion allowed'; exception when insufficient_privilege then null; end;
end $$;
set local role postgres;
select 'ok 4 - other racer isolated and browser writes/raw records denied';

set local role anon;
do $$ begin
 begin perform public.record_online_practice('{}'::jsonb); raise exception 'Anonymous result write allowed'; exception when insufficient_privilege then null; end;
 begin perform 1 from public.my_online_practice_history(); raise exception 'Anonymous history RPC allowed'; exception when insufficient_privilege then null; end;
 begin perform 1 from public.my_racer_identity_history(); raise exception 'Anonymous audit RPC allowed'; exception when insufficient_privilege then null; end;
 begin perform 1 from public.online_practice_history where false; raise exception 'Anonymous table access allowed'; exception when insufficient_privilege then null; end;
end $$;
set local role postgres;
select 'ok 5 - anonymous history, audit and result-writing access denied';

set local role service_role;
do $$ begin
 begin update public.online_practice_history set rank=1 where false; raise exception 'Backend direct history update allowed'; exception when insufficient_privilege then null; end;
 begin perform 1 from public.my_racer_identity_history(); raise exception 'Backend audit RPC allowed'; exception when insufficient_privilege then null; end;
end $$;
set local role postgres;
select 'ok 6 - backend is limited to result RPC, with direct mutation and audit access denied';
rollback;
