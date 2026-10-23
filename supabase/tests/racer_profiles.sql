-- Run with psql -v ON_ERROR_STOP=1 against a disposable migrated Supabase DB.
begin;
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select public.save_racer_profile('NightShift_7', 'Night Shift');
do $$ begin
  if not exists(select 1 from public.profiles where handle = 'nightshift_7') then raise exception 'canonicalization failed'; end if;
  begin
    update public.profiles set handle = 'bypass';
    raise exception 'direct update allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_racer_profile('ADMIN', 'Admin');
    raise exception 'reserved handle allowed';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.save_racer_profile('1bad', 'Racer');
    raise exception 'invalid handle allowed';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.save_racer_profile('valid_name', U&'Bad\202Ename');
    raise exception 'bidi name allowed';
  exception when invalid_parameter_value then null; end;
end $$;
-- Immediate rename and display-only edits are allowed; old handle retained.
select public.save_racer_profile('renamed', U&'Cafe\0301');
select public.save_racer_profile('renamed', 'New Display');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
do $$ begin
  if exists(select 1 from public.profiles) then raise exception 'other owner profile leaked'; end if;
  begin
    perform public.save_racer_profile('NIGHTSHIFT_7', 'Other Racer');
    raise exception 'old handle stolen';
  exception when unique_violation then null; end;
  begin
    perform public.save_racer_profile('RENAMED', 'Other Racer');
    raise exception 'duplicate handle allowed';
  exception when unique_violation then null; end;
end $$;
set local role anon;
do $$ begin
  begin
    perform public.save_racer_profile('anonymous', 'Anonymous');
    raise exception 'anonymous claim allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.profiles;
    raise exception 'anonymous read allowed';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
