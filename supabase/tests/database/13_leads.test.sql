-- Phase 9: leads — round-robin, who sees what, duplicates, stage automation, calls, the agreed
-- price lock, Meta Lead Ads idempotency, CSV import, phone sync, dashboards, search.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(82);

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

-- a admin · b1 reception · c1/c2 sales (in the pool) · c3 sales deactivated (in the pool)
-- · c4 sales switched off in the pool · d1 sales manager · e1 BDM
insert into auth.users (id, email) values
  ('bbbbbbbb-0000-4000-a000-00000000000a', 'p9-admin@staff.invalid'),
  ('bbbbbbbb-0000-4000-a000-0000000000b1', 'p9-rec@staff.invalid'),
  ('bbbbbbbb-0000-4000-a000-0000000000c1', 'p9-s1@staff.invalid'),
  ('bbbbbbbb-0000-4000-a000-0000000000c2', 'p9-s2@staff.invalid'),
  ('bbbbbbbb-0000-4000-a000-0000000000c3', 'p9-s3@staff.invalid'),
  ('bbbbbbbb-0000-4000-a000-0000000000c4', 'p9-s4@staff.invalid'),
  ('bbbbbbbb-0000-4000-a000-0000000000d1', 'p9-sm@staff.invalid'),
  ('bbbbbbbb-0000-4000-a000-0000000000e1', 'p9-bdm@staff.invalid');
insert into public.staff (id, role, full_name, username, active, deactivated_at) values
  ('bbbbbbbb-0000-4000-a000-00000000000a', 'admin', 'P9 Admin', 'p9admin', true, null),
  ('bbbbbbbb-0000-4000-a000-0000000000b1', 'receptionist', 'P9 Rec', 'p9rec', true, null),
  ('bbbbbbbb-0000-4000-a000-0000000000c1', 'sales_executive', 'P9 Sales One', 'p9s1', true, null),
  ('bbbbbbbb-0000-4000-a000-0000000000c2', 'sales_executive', 'P9 Sales Two', 'p9s2', true, null),
  ('bbbbbbbb-0000-4000-a000-0000000000c3', 'sales_executive', 'P9 Sales Gone', 'p9s3', false, now()),
  ('bbbbbbbb-0000-4000-a000-0000000000c4', 'sales_executive', 'P9 Sales Off', 'p9s4', true, null),
  ('bbbbbbbb-0000-4000-a000-0000000000d1', 'sales_manager', 'P9 Manager', 'p9sm', true, null),
  ('bbbbbbbb-0000-4000-a000-0000000000e1', 'bdm', 'P9 Bdm', 'p9bdm', true, null);
-- A clean pool for this test (rolled back), round-robin on.
delete from public.lead_pool;
insert into public.app_settings (section, value) values ('sales', '{"round_robin": true}')
  on conflict (section) do update set value = public.app_settings.value || '{"round_robin": true}';
insert into public.lead_pool (staff_id, active, sort) values
  ('bbbbbbbb-0000-4000-a000-0000000000c1', true, 1),
  ('bbbbbbbb-0000-4000-a000-0000000000c2', true, 2),
  ('bbbbbbbb-0000-4000-a000-0000000000c3', true, 0),
  ('bbbbbbbb-0000-4000-a000-0000000000c4', false, 0);
insert into public.patients (id, uhid, full_name, phone_e164) values
  ('bbbbbbbb-1111-4000-a000-000000000001', 'P9-1', 'P9 Known Patient', '+915000000099'),
  ('bbbbbbbb-1111-4000-a000-000000000002', 'P9-2', 'P9 Lead Patient', '+915000000098');
insert into public.doctors (id, full_name, slot_minutes, capacity_override) values
  ('bbbbbbbb-2222-4000-a000-00000000000a', 'Dr P9', 15, 3);
insert into public.doctor_schedules (doctor_id, weekday, start_time, end_time) values
  ('bbbbbbbb-2222-4000-a000-00000000000a', 1, '10:00', '11:00');

create function pg_temp.new_lead(p_id text, p_phone text, p_extra jsonb default '{}')
returns jsonb language sql as $$
  select public.create_lead(jsonb_build_object('name', 'P9 Lead ' || right(p_phone, 2), 'phone', p_phone) || p_extra, p_id::uuid);
$$;
grant execute on function pg_temp.new_lead(text, text, jsonb) to authenticated;
create function pg_temp.owner(p_id text)
returns uuid language sql as $$ select assigned_to from public.leads where id = p_id::uuid $$;

------------------------------------------------------------------------------
-- Round-robin and duplicates (reception adds walk-in leads)
------------------------------------------------------------------------------
select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000b1');
select pg_temp.new_lead('bbbbbbbb-3333-4000-a000-000000000001', '+915000000001');
select pg_temp.new_lead('bbbbbbbb-3333-4000-a000-000000000002', '+915000000002');
select pg_temp.new_lead('bbbbbbbb-3333-4000-a000-000000000003', '+915000000003');
select pg_temp.login(null);
select is(pg_temp.owner('bbbbbbbb-3333-4000-a000-000000000001'), 'bbbbbbbb-0000-4000-a000-0000000000c1'::uuid, 'round-robin: first lead → sales one');
select is(pg_temp.owner('bbbbbbbb-3333-4000-a000-000000000002'), 'bbbbbbbb-0000-4000-a000-0000000000c2'::uuid, 'second → sales two');
select is(pg_temp.owner('bbbbbbbb-3333-4000-a000-000000000003'), 'bbbbbbbb-0000-4000-a000-0000000000c1'::uuid,
  'third → sales one again: the deactivated exec and the one switched off in the pool are skipped');
select is((select created_via from public.leads where id = 'bbbbbbbb-3333-4000-a000-000000000001'), 'reception', 'made at the desk');
select ok(exists (select 1 from public.notifications where recipient_id = 'bbbbbbbb-0000-4000-a000-0000000000c1' and type = 'lead_assigned'),
  'the new owner is notified');
select is((select count(*)::int from public.followups where ref_table = 'leads' and ref_id = 'bbbbbbbb-3333-4000-a000-000000000001' and status = 'open'
             and assigned_to = 'bbbbbbbb-0000-4000-a000-0000000000c1'), 1, 'a new lead is a call-now follow-up for its owner');

select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000b1');
select throws_ok($$ select pg_temp.new_lead('bbbbbbbb-3333-4000-a000-000000000004', '5000000001') $$, 'P0001', 'invalid_input',
  'phone must be E.164');
select is((pg_temp.new_lead('bbbbbbbb-3333-4000-a000-000000000004', '+915000000001') ->> 'created')::boolean, false,
  'same number as an open lead: shows the duplicate instead of saving');
select is(jsonb_array_length(pg_temp.new_lead('bbbbbbbb-3333-4000-a000-000000000004', '+915000000001') -> 'duplicates'), 1, 'one duplicate listed');
select is((pg_temp.new_lead('bbbbbbbb-3333-4000-a000-000000000004', '+915000000001', '{"force": true}') -> 'lead' ->> 'duplicate_of_id'),
  'bbbbbbbb-3333-4000-a000-000000000001', 'saved anyway → linked to the earlier lead');
select is((pg_temp.new_lead('bbbbbbbb-3333-4000-a000-000000000004', '+915000000001', '{"force": true}') ->> 'repeat')::boolean, true,
  'retrying the same create returns the same lead');
select is((pg_temp.new_lead('bbbbbbbb-3333-4000-a000-000000000005', '+915000000099') -> 'lead' ->> 'patient_id'),
  'bbbbbbbb-1111-4000-a000-000000000001', 'a number that belongs to one patient links the lead to them');
select pg_temp.login(null);
select ok(exists (select 1 from public.lead_activities where lead_id = 'bbbbbbbb-3333-4000-a000-000000000001' and kind = 'duplicate'),
  'the earlier lead records the repeat enquiry');

------------------------------------------------------------------------------
-- Who sees what
------------------------------------------------------------------------------
select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000c1');
select is((select count(*)::int from public.leads where id in ('bbbbbbbb-3333-4000-a000-000000000001',
            'bbbbbbbb-3333-4000-a000-000000000002', 'bbbbbbbb-3333-4000-a000-000000000003')), 2,
  'a sales executive sees only their assigned leads');
select throws_ok($$ select public.lead_detail('bbbbbbbb-3333-4000-a000-000000000002') $$, 'P0001', 'not_allowed',
  'and cannot open someone else''s lead');
select ok((select bool_and((r ->> 'assigned_to')::uuid = 'bbbbbbbb-0000-4000-a000-0000000000c1')
           from jsonb_array_elements(public.leads_table('{}') -> 'rows') r), 'the leads table shows them only their own');
select throws_ok($$ select public.leads_table('{"from": "2020-01-01", "to": "2026-01-01"}') $$, 'P0001', 'invalid_input',
  'a lead-date range over a year is refused');
select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000e1');
select is((select count(*)::int from public.leads), 0, 'a BDM reads no leads directly');
select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000b1');
select is((select count(*)::int from public.leads), 0, 'reception reads leads only through search and linking');
select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000d1');
select is((select count(*)::int from public.leads where id::text like 'bbbbbbbb-3333-%'), 5, 'the sales manager sees every lead');

------------------------------------------------------------------------------
-- Stages, calls, follow-ups
------------------------------------------------------------------------------
select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000c1');
select throws_ok($$ select public.set_lead_stage('bbbbbbbb-3333-4000-a000-000000000001', 'lost') $$, 'P0001', 'reason_required',
  'lost needs a reason');
select is(public.set_lead_stage('bbbbbbbb-3333-4000-a000-000000000001', 'interested') ->> 'stage', 'interested', 'stage set by hand');

select is((public.log_call(jsonb_build_object('client_id', 'bbbbbbbb-4444-4000-a000-000000000001',
            'lead_id', 'bbbbbbbb-3333-4000-a000-000000000003', 'phone', '+915000000003', 'direction', 'outgoing',
            'duration_s', 120, 'outcome', 'connected', 'notes', 'wants a consultation',
            'next_followup_at', '2030-01-05 10:00+05:30')) ->> 'repeat')::boolean, false, 'call logged');
select is((public.log_call(jsonb_build_object('client_id', 'bbbbbbbb-4444-4000-a000-000000000001',
            'lead_id', 'bbbbbbbb-3333-4000-a000-000000000003', 'phone', '+915000000003', 'direction', 'outgoing',
            'duration_s', 120, 'outcome', 'connected')) ->> 'repeat')::boolean, true, 'the same call sent again (phone retry) is ignored');
select pg_temp.login(null);
select is((select count(*)::int from public.call_logs where lead_id = 'bbbbbbbb-3333-4000-a000-000000000003'), 1, 'exactly one call row');
select is((select stage::text from public.leads where id = 'bbbbbbbb-3333-4000-a000-000000000003'), 'contacted',
  'a connected call moves a new lead to contacted');
select isnt((select first_call_at from public.leads where id = 'bbbbbbbb-3333-4000-a000-000000000003'), null, 'first call time kept');
select is((select count(*)::int from public.followups where ref_table = 'leads' and ref_id = 'bbbbbbbb-3333-4000-a000-000000000003'
             and status = 'open' and due_at = '2030-01-05 10:00+05:30'), 1, 'the next follow-up replaces the old one (one open per lead)');

select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000c1');
select is(public.import_call_log(jsonb_build_array(
    jsonb_build_object('device_call_key', 'p9-k1', 'phone', '+915000000001', 'direction', 'incoming', 'started_at', now(), 'duration_s', 30),
    jsonb_build_object('device_call_key', 'p9-k2', 'phone', '+915999999999', 'direction', 'outgoing', 'started_at', now(), 'duration_s', 10),
    jsonb_build_object('device_call_key', 'p9-k3', 'phone', '+915000000002', 'direction', 'outgoing', 'started_at', now(), 'duration_s', 10))),
  '{"inserted": 1, "skipped": 2}'::jsonb, 'call-log import keeps only CRM numbers of the caller''s own leads');
select is(public.import_call_log(jsonb_build_array(
    jsonb_build_object('device_call_key', 'p9-k1', 'phone', '+915000000001', 'direction', 'incoming', 'started_at', now(), 'duration_s', 30))),
  '{"inserted": 0, "skipped": 1}'::jsonb, 're-importing the same call adds nothing');

------------------------------------------------------------------------------
-- Booking → consultation_booked → consulted; reception links the patient
------------------------------------------------------------------------------
select lives_ok($$ select public.book_appointment(jsonb_build_object('lead_id', 'bbbbbbbb-3333-4000-a000-000000000003',
    'doctor_id', 'bbbbbbbb-2222-4000-a000-00000000000a', 'slot_start', '2030-01-07 10:00+05:30', 'booked_from', 'android'),
    'bbbbbbbb-5555-4000-a000-000000000001') $$, 'sales book a consultation for their own lead');
select throws_ok($$ select public.book_appointment(jsonb_build_object('lead_id', 'bbbbbbbb-3333-4000-a000-000000000002',
    'doctor_id', 'bbbbbbbb-2222-4000-a000-00000000000a', 'slot_start', '2030-01-07 10:00+05:30'), gen_random_uuid()) $$,
  'P0001', 'not_allowed', 'but not for a lead assigned to someone else');
select is((select stage::text from public.leads where id = 'bbbbbbbb-3333-4000-a000-000000000003'), 'consultation_booked',
  'booking moves the lead to consultation booked');
select ok((select bool_and(e ->> 'lead_id' in ('bbbbbbbb-3333-4000-a000-000000000001', 'bbbbbbbb-3333-4000-a000-000000000003',
                                                'bbbbbbbb-3333-4000-a000-000000000005'))
           from jsonb_array_elements(public.needs_confirmation() -> 'items') e),
  '"needs confirmation" shows a sales executive only their leads'' bookings');
select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000b1');
select ok((select bool_or(c ->> 'lead_id' = 'bbbbbbbb-3333-4000-a000-000000000003' and (c ->> 'lead_only')::boolean)
           from jsonb_array_elements(public.slot_board('2030-01-07', array['bbbbbbbb-2222-4000-a000-00000000000a'::uuid]) -> 'doctors') d,
                jsonb_array_elements(d -> 'slots') sl, jsonb_array_elements(sl -> 'chips') c),
  'the slot board shows the lead''s booking (no patient yet)');
select lives_ok($$ select public.set_appointment_status('bbbbbbbb-5555-4000-a000-000000000001', 'arrived') $$, 'reception marks them arrived');
select pg_temp.login(null);
select is((select stage::text from public.leads where id = 'bbbbbbbb-3333-4000-a000-000000000003'), 'consulted', 'arrival → consulted');
select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000b1');
select is(public.link_lead_to_patient('bbbbbbbb-3333-4000-a000-000000000003', 'bbbbbbbb-1111-4000-a000-000000000002') ->> 'patient_id',
  'bbbbbbbb-1111-4000-a000-000000000002', 'reception links the lead to the patient record made for them');
select pg_temp.login(null);
select is((select patient_id from public.appointments where id = 'bbbbbbbb-5555-4000-a000-000000000001'),
  'bbbbbbbb-1111-4000-a000-000000000002'::uuid, 'their booking becomes the patient''s');
select is((select count(*)::int from public.visits where appointment_id = 'bbbbbbbb-5555-4000-a000-000000000001'), 1,
  'and the visit of the arrival is recorded');

------------------------------------------------------------------------------
-- Amount finalised → agreed price → locked for sales once the treatment starts
------------------------------------------------------------------------------
select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000c1');
select is((public.set_amount_finalised('bbbbbbbb-3333-4000-a000-000000000003', 5000000) ->> 'amount_finalised_paise')::bigint, 5000000::bigint,
  'sales set the amount finalised');
select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000b1');
select is((public.start_treatment(jsonb_build_object('patient_id', 'bbbbbbbb-1111-4000-a000-000000000002', 'name', 'P9 Rhinoplasty',
            'sessions', 1), 'bbbbbbbb-6666-4000-a000-000000000001') ->> 'agreed_price_paise')::bigint, 5000000::bigint,
  'starting the treatment takes the agreed price from the lead');
select pg_temp.login(null);
select is((select lead_id from public.patient_treatments where id = 'bbbbbbbb-6666-4000-a000-000000000001'),
  'bbbbbbbb-3333-4000-a000-000000000003'::uuid, 'the treatment is linked to the lead');
select is((select stage::text from public.leads where id = 'bbbbbbbb-3333-4000-a000-000000000003'), 'converted', 'the lead is converted');
select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000c1');
select throws_ok($$ select public.set_amount_finalised('bbbbbbbb-3333-4000-a000-000000000003', 6000000) $$, 'P0001', 'amount_locked',
  'after the treatment starts, the sales executive can no longer change the amount');
select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000d1');
select throws_ok($$ select public.set_amount_finalised('bbbbbbbb-3333-4000-a000-000000000003', 6000000) $$, 'P0001', 'amount_locked',
  'nor can the sales manager');
select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.set_amount_finalised('bbbbbbbb-3333-4000-a000-000000000003', 6000000) $$, 'P0001', 'reason_required',
  'reception needs a reason');
select lives_ok($$ select public.set_amount_finalised('bbbbbbbb-3333-4000-a000-000000000003', 6000000, 'extra graft agreed') $$,
  'and can with one');

------------------------------------------------------------------------------
-- Reassigning; phone sync
------------------------------------------------------------------------------
select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000c1');
select ok(jsonb_array_length(public.sync_pull('{"leads": null}') -> 'entities' -> 'leads' -> 'rows') >= 2, 'the phone pulls its leads');
select is((public.sync_pull('{"leads": null}', 1) -> 'entities' -> 'leads' ->> 'has_more')::boolean, true, 'in pages (has_more)');
select isnt(public.sync_pull(jsonb_build_object('leads', public.sync_pull('{"leads": null}', 1) -> 'entities' -> 'leads' ->> 'next'), 1)
              -> 'entities' -> 'leads' -> 'rows' -> 0 ->> 'id',
            public.sync_pull('{"leads": null}', 1) -> 'entities' -> 'leads' -> 'rows' -> 0 ->> 'id',
  'the next marker continues after the last row');
-- Call logs: only the last 60 days go to the phone (an old call, last changed long ago, is skipped).
select pg_temp.login(null);
insert into public.call_logs (id, staff_id, phone_e164, direction, started_at, duration_s, outcome, source, created_at, updated_at) values
  ('bbbbbbbb-5555-4000-a000-000000000001', 'bbbbbbbb-0000-4000-a000-0000000000c1', '+915000000091', 'outgoing',
   now() - interval '3 days', 60, 'connected', 'app', now() - interval '3 days', now() - interval '3 days'),
  ('bbbbbbbb-5555-4000-a000-000000000002', 'bbbbbbbb-0000-4000-a000-0000000000c1', '+915000000092', 'outgoing',
   now() - interval '90 days', 60, 'connected', 'app', now() - interval '90 days', now() - interval '90 days');
select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000c1');
select ok(public.sync_pull('{"call_logs": null}', 500) -> 'entities' -> 'call_logs' -> 'rows' @> '[{"id": "bbbbbbbb-5555-4000-a000-000000000001"}]',
  'the phone pulls this week''s calls');
select ok(not (public.sync_pull('{"call_logs": null}', 500) -> 'entities' -> 'call_logs' -> 'rows' @> '[{"id": "bbbbbbbb-5555-4000-a000-000000000002"}]'),
  'but not a call from three months ago');
select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000d1');
select is(public.assign_leads(array['bbbbbbbb-3333-4000-a000-000000000001'::uuid], 'bbbbbbbb-0000-4000-a000-0000000000c2', 'covering leave'), 1,
  'the manager reassigns a lead');
select throws_ok($$ select public.assign_leads(array['bbbbbbbb-3333-4000-a000-000000000001'::uuid], 'bbbbbbbb-0000-4000-a000-0000000000c3') $$,
  'P0001', 'invalid_input', 'not to a deactivated executive');
select pg_temp.login(null);
select is((select count(*)::int from public.followups where lead_id = 'bbbbbbbb-3333-4000-a000-000000000001' and status = 'open'
             and assigned_to = 'bbbbbbbb-0000-4000-a000-0000000000c2'), 1, 'its open follow-up moves to the new owner');
select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000c1');
select is((select count(*)::int from public.leads where id = 'bbbbbbbb-3333-4000-a000-000000000001'), 0, 'the old owner no longer sees it');
select ok(public.sync_pull('{"leads": "2000-01-01 00:00:00+00|00000000-0000-0000-0000-000000000000"}') -> 'entities' -> 'leads' -> 'removed'
            ? 'bbbbbbbb-3333-4000-a000-000000000001', 'and the old owner''s phone is told to drop it');
select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000c2');
select is(public.update_lead('bbbbbbbb-3333-4000-a000-000000000001', '{"surgery_date": "2030-02-01"}',
            (select version from public.leads where id = 'bbbbbbbb-3333-4000-a000-000000000001')) ->> 'stage',
  'surgery_scheduled', 'the new owner sets a surgery date → surgery scheduled');
select throws_ok($$ select public.update_lead('bbbbbbbb-3333-4000-a000-000000000001', '{"comments1": "x"}', 1) $$, 'P0001', 'stale_version',
  'an edit from an old copy is refused');
select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000e1');
select is(public.create_lead('{"name": "P9 Visit Lead", "phone": "+915000000070"}', 'bbbbbbbb-3333-4000-a000-000000000070') -> 'lead' ->> 'source_code',
  'bdm', 'a BDM''s lead gets the BDM visit source');
select ok(not ((public.sync_pull('{"leads": null}') -> 'entities' -> 'leads' -> 'rows' -> 0) ? 'amount_finalised_paise'),
  'and their phone gets only a few fields of the leads they made');

------------------------------------------------------------------------------
-- Meta Lead Ads (service role)
------------------------------------------------------------------------------
select pg_temp.login(null);
select is(public.meta_lead_received('p9lead1', 'page', 'form', 'ad', now()) ->> 'process', 'true', 'a new leadgen id is processed');
select is(public.meta_lead_create('p9lead1', '{"name": "P9 Meta", "phone": "+915000000050", "source_code": "facebook",
            "source_detail": {"form": "Rhinoplasty form"}}') ->> 'status', 'created', 'a lead is made from the form answers');
select is(public.meta_lead_received('p9lead1') ->> 'process', 'false', 'the same leadgen id again is ignored');
select is((select count(*)::int from public.leads where meta_leadgen_id = 'p9lead1'), 1, 'still one lead for it');
select is((select public.meta_lead_received('p9lead2') ->> 'process'), 'true', 'a second form fill is a new event');
select is(public.meta_lead_create('p9lead2', '{"name": "P9 Meta Again", "phone": "+915000000050", "source_code": "facebook"}') ->> 'status',
  'duplicate', 'same number as an open lead: no second lead…');
select ok(exists (select 1 from public.lead_activities a join public.leads l on l.id = a.lead_id
                  where l.meta_leadgen_id = 'p9lead1' and a.kind = 'enquired_again'), '…the open lead is told they enquired again');
select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000c1');
select throws_ok($$ select public.meta_lead_received('p9lead3') $$, '42501', null, 'staff cannot call the webhook functions');

------------------------------------------------------------------------------
-- Import, dashboards, search
------------------------------------------------------------------------------
select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000d1');
select is((public.import_leads(jsonb_build_array(
    jsonb_build_object('name', 'P9 Import', 'phone', '+915000000060', 'source', 'Facebook', 'assigned', 'p9s2'),
    jsonb_build_object('name', 'P9 Import Dup', 'phone', '+915000000002'),
    jsonb_build_object('name', '', 'phone', '+915000000061'),
    jsonb_build_object('name', 'P9 Import Lost', 'phone', '+915000000062', 'stage', 'lost')), true) - 'errors'),
  '{"ok": 1, "dry_run": true}'::jsonb, 'import dry run: one good row; duplicate, nameless and reason-less rows reported');
select is((select count(*)::int from public.leads where phone_e164 = '+915000000060'), 0, 'a dry run saves nothing');
select is((public.import_leads(jsonb_build_array(
    jsonb_build_object('name', 'P9 Import', 'phone', '+915000000060', 'source', 'Facebook', 'assigned', 'p9s2')), false) ->> 'ok')::int, 1,
  'import saves');
select is((select created_via || ':' || assigned_to from public.leads where phone_e164 = '+915000000060'),
  'import:bbbbbbbb-0000-4000-a000-0000000000c2', 'with its owner');
select throws_ok($$ select public.dashboard_sales_manager(current_date - 400, current_date) $$, 'P0001', 'invalid_input',
  'dashboard ranges over a year are refused');
select is((select (d -> 'funnel' -> 'steps' -> 0 ->> 'n')::int = (d -> 'tiles' ->> 'new_leads')::int
           from public.dashboard_sales_manager(current_date - 1, current_date + 1, array['bbbbbbbb-0000-4000-a000-0000000000c1'::uuid,
             'bbbbbbbb-0000-4000-a000-0000000000c2'::uuid]) d), true, 'the funnel starts with every new lead');
select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000c1');
select is((public.dashboard_sales_exec() -> 'today' ->> 'calls')::int, 2, '"My day" counts today''s calls');
select throws_ok($$ select public.dashboard_sales_manager(current_date, current_date) $$, 'P0001', 'not_allowed',
  'executives don''t see the team dashboard');
select ok(not exists (select 1 from jsonb_array_elements(public.global_search('+915000000002')) e
                      where e ->> 'id' = 'bbbbbbbb-3333-4000-a000-000000000002'), 'search hides other executives'' leads');
select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000b1');
select ok(exists (select 1 from jsonb_array_elements(public.global_search('+915000000002')) e
                  where e ->> 'id' = 'bbbbbbbb-3333-4000-a000-000000000002' and e ->> 'type' = 'lead'), 'reception finds leads by number');

-- Overdue next calls come first in either direction, then the rest (owner, 30/10/2026).
select pg_temp.login(null);
update public.leads set next_followup_at = null where id::text like 'bbbbbbbb-3333-%';
update public.leads set next_followup_at = now() - interval '1 hour'
  where id in ('bbbbbbbb-3333-4000-a000-000000000001', 'bbbbbbbb-3333-4000-a000-000000000003');
create function pg_temp.first_two(p_desc boolean)
returns text[]
language sql
as $$
  select (array_agg(r ->> 'id' order by o))[1:2]
  from jsonb_array_elements(public.leads_table('{"q": "P9 Lead"}', 'sl_no', p_desc, 0, 100) -> 'rows') with ordinality e(r, o)
  where r ->> 'id' like 'bbbbbbbb-3333-%';
$$;
grant execute on function pg_temp.first_two(boolean) to authenticated;
select pg_temp.login('bbbbbbbb-0000-4000-a000-0000000000d1');
select is(pg_temp.first_two(true), (select array_agg(id::text order by sl_no desc) from public.leads
            where id in ('bbbbbbbb-3333-4000-a000-000000000001', 'bbbbbbbb-3333-4000-a000-000000000003')),
  'newest first: overdue leads lead the table, newest of them first');
select is(pg_temp.first_two(false), (select array_agg(id::text order by sl_no) from public.leads
            where id in ('bbbbbbbb-3333-4000-a000-000000000001', 'bbbbbbbb-3333-4000-a000-000000000003')),
  'oldest first: overdue leads still lead the table, oldest of them first');

select * from finish();
rollback;
