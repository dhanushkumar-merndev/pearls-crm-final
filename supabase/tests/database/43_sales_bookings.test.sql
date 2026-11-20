-- Sales "Bookings" list (owner, 20/11/2026): a salesperson's lead bookings in one place.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(18);

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
  ('43434343-0000-4000-a000-0000000000a1', 'b-mgr@staff.invalid'),
  ('43434343-0000-4000-a000-0000000000c1', 'b-s1@staff.invalid'),
  ('43434343-0000-4000-a000-0000000000c2', 'b-s2@staff.invalid'),
  ('43434343-0000-4000-a000-0000000000b1', 'b-rec@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('43434343-0000-4000-a000-0000000000a1', 'sales_manager', 'B Manager', 'bmgr'),
  ('43434343-0000-4000-a000-0000000000c1', 'sales_executive', 'B Priya', 'bs1'),
  ('43434343-0000-4000-a000-0000000000c2', 'sales_executive', 'B Other', 'bs2'),
  ('43434343-0000-4000-a000-0000000000b1', 'receptionist', 'B Rec', 'brec');
insert into public.doctors (id, full_name, slot_minutes, capacity_override) values
  ('43434343-3333-4000-a000-000000000001', 'Dr Book Test', 15, 1);
insert into public.leads (id, name, phone_e164, assigned_to) values
  ('43434343-5555-4000-a000-000000000001', 'Asha Book', '+919811443001', '43434343-0000-4000-a000-0000000000c1'),
  ('43434343-5555-4000-a000-000000000002', 'Bina Book', '+919811443002', '43434343-0000-4000-a000-0000000000c2');

-- A booking n days from today (IST) at 10:00 + m minutes.
create function pg_temp.book(p_n text, p_lead uuid, p_days integer, p_min integer, p_status text, p_auto boolean default false)
returns void language sql as $$
  insert into public.appointments (id, lead_id, doctor_id, appt_date, slot_start, slot_end, status, is_walk_in, auto_cancelled_at)
  select ('43434343-4444-4000-a000-0000000000' || p_n)::uuid, p_lead, '43434343-3333-4000-a000-000000000001', d,
         (d + time '10:00' + make_interval(mins => p_min)) at time zone 'Asia/Kolkata',
         (d + time '10:15' + make_interval(mins => p_min)) at time zone 'Asia/Kolkata',
         p_status::public.appt_status, false, case when p_auto then now() end
  from (select (now() at time zone 'Asia/Kolkata')::date + p_days as d) x
$$;
select pg_temp.book('01', '43434343-5555-4000-a000-000000000001', 1, 0, 'confirmed');
select pg_temp.book('02', '43434343-5555-4000-a000-000000000001', 0, 0, 'pending_confirmation');
select pg_temp.book('03', '43434343-5555-4000-a000-000000000001', 2, 0, 'cancelled', true);   -- auto-cancelled: needs a call
select pg_temp.book('04', '43434343-5555-4000-a000-000000000001', 3, 0, 'cancelled');         -- cancelled by someone: gone
select pg_temp.book('05', '43434343-5555-4000-a000-000000000001', 4, 0, 'rescheduled');       -- moved: the new one counts
select pg_temp.book('06', '43434343-5555-4000-a000-000000000001', -3, 0, 'done');
select pg_temp.book('07', '43434343-5555-4000-a000-000000000001', -1, 0, 'no_show');
select pg_temp.book('08', '43434343-5555-4000-a000-000000000001', -120, 0, 'done');           -- older than 90 days
select pg_temp.book('09', '43434343-5555-4000-a000-000000000002', 1, 30, 'pending_confirmation'); -- someone else's lead

create function pg_temp.ids(p jsonb)
returns text language sql as $$
  select coalesce(string_agg(right(e ->> 'id', 2), ',' order by o), '') from jsonb_array_elements(p -> 'items') with ordinality t(e, o)
$$;
grant execute on function pg_temp.ids(jsonb) to authenticated;

------------------------------------------------------------------------------
-- Who may read
------------------------------------------------------------------------------
select pg_temp.login('43434343-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.sales_bookings('upcoming') $$, 'P0001', 'not_allowed', 'reception uses Appointments, not this list');

------------------------------------------------------------------------------
-- A salesperson: own leads only
------------------------------------------------------------------------------
select pg_temp.login('43434343-0000-4000-a000-0000000000c1');
select is(pg_temp.ids(public.sales_bookings('upcoming')), '02,01,03', 'upcoming: today first; cancelled-by-someone and moved ones left out; auto-cancelled kept');
select is(pg_temp.ids(public.sales_bookings('confirm')), '02,03', 'to confirm: waiting + auto-cancelled');
select is(pg_temp.ids(public.sales_bookings('past')), '07,06', 'past: newest first, 90 days');
select is((public.sales_bookings('upcoming') -> 'items' -> 0 ->> 'lead_name'), 'Asha Book', 'the lead''s name');
select is((public.sales_bookings('upcoming') -> 'items' -> 0 ->> 'doctor'), 'Dr Book Test', 'the doctor');
select is((public.sales_bookings('upcoming') -> 'items' -> 2 ->> 'auto_cancelled')::boolean, true, 'auto-cancelled flagged');
select ok(not (public.sales_bookings('upcoming') -> 'items' -> 0) ? 'k', 'the sort key stays inside');

-- Pages
select is(pg_temp.ids(public.sales_bookings('upcoming', null, 2)), '02,01', 'page 1 of 2');
select is(pg_temp.ids(public.sales_bookings('upcoming', public.sales_bookings('upcoming', null, 2) ->> 'next_cursor', 2)), '03', 'page 2 carries on');
select is(public.sales_bookings('upcoming', public.sales_bookings('upcoming', null, 2) ->> 'next_cursor', 2) ->> 'next_cursor', null, 'no page 3');
select is(pg_temp.ids(public.sales_bookings('past', public.sales_bookings('past', null, 1) ->> 'next_cursor', 1)), '06', 'past pages go back in time');

-- Booked by me for someone else's lead counts too (same as the phone sync)
reset role;
update public.appointments set booked_by = '43434343-0000-4000-a000-0000000000c1' where id = '43434343-4444-4000-a000-000000000009';
select pg_temp.login('43434343-0000-4000-a000-0000000000c1');
select is(pg_temp.ids(public.sales_bookings('upcoming')), '02,01,09,03', 'a booking I made shows too');

select pg_temp.login('43434343-0000-4000-a000-0000000000c2');
select is(pg_temp.ids(public.sales_bookings('upcoming')), '09', 'the other salesperson sees only their lead');

------------------------------------------------------------------------------
-- A manager sees every lead booking (ours among them)
------------------------------------------------------------------------------
select pg_temp.login('43434343-0000-4000-a000-0000000000a1');
select ok((select count(*) from jsonb_array_elements(public.sales_bookings('upcoming', null, 100) -> 'items') e
           where e ->> 'id' like '43434343-4444-%') = 4, 'manager: all four upcoming test bookings');

------------------------------------------------------------------------------
-- Bad input
------------------------------------------------------------------------------
select throws_ok($$ select public.sales_bookings('later') $$, 'P0001', 'invalid_input', 'unknown scope');
select throws_ok($$ select public.sales_bookings('upcoming', 'nonsense') $$, 'P0001', 'invalid_input', 'bad cursor');
select is(jsonb_array_length(public.sales_bookings('upcoming', null, 1000) -> 'items') <= 100, true, 'never more than 100');

select * from finish();
rollback;
