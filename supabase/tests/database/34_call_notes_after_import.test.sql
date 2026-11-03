-- Call notes saved after the phone's call-log import (20261119110000): the imported row is filled in
-- with the person's outcome and notes, the stage and next call still apply, and the call counts once.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(11);

create function pg_temp.login(p_id uuid)
returns void
language plpgsql
as $$
begin
  reset role;
  if p_id is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
end;
$$;
grant execute on function pg_temp.login(uuid) to authenticated;

insert into auth.users (id, email) values
  ('34343434-0000-4000-a000-0000000000c1', 'cn-sales@staff.invalid'),
  ('34343434-0000-4000-a000-0000000000c2', 'cn-sales2@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('34343434-0000-4000-a000-0000000000c1', 'sales_executive', 'Notes Sales', 'cnsales'),
  ('34343434-0000-4000-a000-0000000000c2', 'sales_executive', 'Notes Sales Two', 'cnsales2');

select pg_temp.login('34343434-0000-4000-a000-0000000000c1');
select public.create_lead(jsonb_build_object('name', 'Notes Lead', 'phone', '+919811434001', 'force', true, 'via', 'android',
  'assigned_to', '34343434-0000-4000-a000-0000000000c1'), '34343434-1111-4000-a000-000000000001');

-- 1. The phone imports its call log first: an unanswered-looking call, no notes.
select is(public.import_call_log(jsonb_build_array(jsonb_build_object(
  'client_id', '34343434-2222-4000-a000-000000000001', 'device_call_key', 'cn-key-1', 'phone', '+919811434001',
  'direction', 'outgoing', 'started_at', '2031-04-01 05:00+00', 'duration_s', 0))) ->> 'inserted', '1', 'the call-log import saves the call');

-- 2. Then the notes sheet is saved (its own client id, the same call key).
select is((public.log_call(jsonb_build_object(
  'client_id', '34343434-2222-4000-a000-000000000002', 'lead_id', '34343434-1111-4000-a000-000000000001',
  'phone', '+919811434001', 'direction', 'outgoing', 'started_at', '2031-04-01 05:00+00', 'duration_s', 0,
  'outcome', 'connected', 'notes', '  Wants FUE. Asked about EMI.  ', 'stage', 'interested',
  'next_followup_at', '2031-04-02 06:00+00', 'device_call_key', 'cn-key-1')) ->> 'repeat')::boolean, false,
  'notes after the import are not a repeat');

select pg_temp.login(null);
select is((select count(*)::int from public.call_logs where device_call_key = 'cn-key-1'), 1, 'still one call');
select is((select outcome::text from public.call_logs where device_call_key = 'cn-key-1'), 'connected', 'the person''s outcome wins');
select is((select notes from public.call_logs where device_call_key = 'cn-key-1'), 'Wants FUE. Asked about EMI.', 'the notes are kept');
select is((select source from public.call_logs where device_call_key = 'cn-key-1'), 'app', 'marked as written by the person');
select is((select stage::text from public.leads where id = '34343434-1111-4000-a000-000000000001'), 'interested', 'the stage is set');
select is((select next_followup_at from public.leads where id = '34343434-1111-4000-a000-000000000001'), '2031-04-02 06:00+00'::timestamptz,
  'the next call is set');
select is((select count(*)::int from public.lead_activities where lead_id = '34343434-1111-4000-a000-000000000001' and kind = 'call'), 1,
  'the call shows once in the lead''s history');

-- 3. A second save for the same call (another sheet, a retry with a new id) is a repeat: nothing changes.
select pg_temp.login('34343434-0000-4000-a000-0000000000c1');
select is((public.log_call(jsonb_build_object(
  'client_id', '34343434-2222-4000-a000-000000000003', 'lead_id', '34343434-1111-4000-a000-000000000001',
  'phone', '+919811434001', 'direction', 'outgoing', 'outcome', 'no_answer', 'notes', 'second sheet',
  'device_call_key', 'cn-key-1')) ->> 'repeat')::boolean, true, 'a second save of the same call is a repeat');
select pg_temp.login(null);
select is((select notes from public.call_logs where device_call_key = 'cn-key-1'), 'Wants FUE. Asked about EMI.', 'the first notes stay');

select * from finish();
rollback;
