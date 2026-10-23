-- Phase 8: phone-scan links (single-use, one phone, expire), page uploads, duplicate
-- warnings by content hash, document list, clean-up of merged page files.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(49);

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
  ('88888888-0000-4000-a000-00000000000a', 'p8-admin@staff.invalid'),
  ('88888888-0000-4000-a000-0000000000b1', 'p8-rec@staff.invalid'),
  ('88888888-0000-4000-a000-0000000000b2', 'p8-rec2@staff.invalid'),
  ('88888888-0000-4000-a000-0000000000c1', 'p8-sales@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('88888888-0000-4000-a000-00000000000a', 'admin', 'P8 Admin', 'p8admin'),
  ('88888888-0000-4000-a000-0000000000b1', 'receptionist', 'P8 Rec', 'p8rec'),
  ('88888888-0000-4000-a000-0000000000b2', 'receptionist', 'P8 Rec Two', 'p8rec2'),
  ('88888888-0000-4000-a000-0000000000c1', 'sales_executive', 'P8 Sales', 'p8sales');

select pg_temp.login('88888888-0000-4000-a000-0000000000b1');
select lives_ok($$
  select public.register_patient('{"full_name":"Scan Patient","phone_e164":"+919845088801"}', 'new',
    p_client_id => '88888888-1111-4000-a000-000000000001');
  select public.register_patient('{"full_name":"Other Patient","phone_e164":"+919845088802"}', 'new',
    p_client_id => '88888888-1111-4000-a000-000000000002') $$, 'two patients registered');

------------------------------------------------------------------------------
-- Starting a phone scan (desk)
------------------------------------------------------------------------------
select pg_temp.login('88888888-0000-4000-a000-0000000000c1');
select throws_ok($$ select public.start_phone_scan('88888888-1111-4000-a000-000000000001') $$,
  'P0001', 'not_allowed', 'sales staff cannot start a phone scan');
select pg_temp.login('88888888-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.start_phone_scan('88888888-1111-4000-a000-0000000000ff') $$,
  'P0001', 'not_found', 'an unknown patient is refused');
create temp table scan on commit drop as
  select public.start_phone_scan('88888888-1111-4000-a000-000000000001', 1) as s;
grant select on scan to authenticated;
select ok((select s ->> 'token' ~ '^[0-9a-f]{48}$' from scan), 'the token comes back once, for the QR');
select ok((select (s ->> 'expires_at')::timestamptz between now() + interval '4 minutes' and now() + interval '6 minutes' from scan),
  'a link lasts at least 5 minutes even if asked for less');
select pg_temp.login(null);
select is((select max_uses from public.public_links l join public.scan_sessions x on x.link_id = l.id
            where x.id = (select (s ->> 'session_id')::uuid from scan)), 1, 'the link is single-use');
select is((select count(*)::int from public.public_links where token_hash = (select s ->> 'token' from scan)), 0,
  'only a hash of the token is stored');
select pg_temp.login('88888888-0000-4000-a000-0000000000b1');
select is(public.scan_session_state((select (s ->> 'session_id')::uuid from scan)) ->> 'status', 'waiting',
  'the desk waits for the phone');

select ok(not has_function_privilege('authenticated', 'public.phone_scan_open(text, text)', 'execute'),
  'staff logins cannot call the phone functions directly');
select ok(not has_function_privilege('anon', 'public.phone_scan_begin_page(text, text, text, bigint, text, uuid)', 'execute'),
  'nor can visitors (only the phone-scan Edge Function)');
select ok(has_function_privilege('service_role', 'public.phone_scan_finish_upload(text, text, uuid, boolean, bigint, integer, integer)', 'execute'),
  'the Edge Function can');

------------------------------------------------------------------------------
-- The phone opens the link (as the Edge Function: service role)
------------------------------------------------------------------------------
select pg_temp.login(null);
select throws_ok($$ select public.phone_scan_open((select s ->> 'token' from scan), 'short') $$,
  'P0001', 'invalid_input', 'a missing or short device key is refused');
select throws_ok($$ select public.phone_scan_open('not-a-real-token', repeat('a', 64)) $$,
  'P0001', 'link_expired', 'a made-up token is refused');
select is((public.phone_scan_open((select s ->> 'token' from scan), repeat('a', 64)) ->> 'page_count')::int, 0,
  'the first phone opens the link');
select is((select uses from public.public_links l join public.scan_sessions x on x.link_id = l.id
            where x.id = (select (s ->> 'session_id')::uuid from scan)), 1, 'the link is now used');
select lives_ok($$ select public.phone_scan_open((select s ->> 'token' from scan), repeat('a', 64)) $$,
  'the same phone may reload the page');
select throws_ok($$ select public.phone_scan_open((select s ->> 'token' from scan), repeat('b', 64)) $$,
  'P0001', 'link_used', 'a second phone is refused');
select pg_temp.login('88888888-0000-4000-a000-0000000000b1');
select is(public.scan_session_state((select (s ->> 'session_id')::uuid from scan)) ->> 'status', 'connected',
  'the desk sees the phone connected');

------------------------------------------------------------------------------
-- Pages
------------------------------------------------------------------------------
select pg_temp.login(null);
select throws_ok($$ select public.phone_scan_begin_page((select s ->> 'token' from scan), repeat('a', 64),
  'text/html', 100, null, '88888888-2222-4000-a000-000000000001') $$,
  'P0001', 'file_type_not_allowed', 'only JPEG / WebP pages');
select throws_ok($$ select public.phone_scan_begin_page((select s ->> 'token' from scan), repeat('a', 64),
  'image/jpeg', 50000000, null, '88888888-2222-4000-a000-000000000001') $$,
  'P0001', 'file_too_large', 'pages over the size cap are refused');
select throws_ok($$ select public.phone_scan_begin_page((select s ->> 'token' from scan), repeat('b', 64),
  'image/jpeg', 1000, null, '88888888-2222-4000-a000-000000000001') $$,
  'P0001', 'link_used', 'another phone cannot add pages');
select is(public.phone_scan_begin_page((select s ->> 'token' from scan), repeat('a', 64),
  'image/jpeg', 1000, repeat('1', 64), '88888888-2222-4000-a000-000000000001') ->> 'status', 'pending',
  'page 1 gets an upload slot');
select ok((select owner_staff_id = '88888888-0000-4000-a000-0000000000b1' and patient_id = '88888888-1111-4000-a000-000000000001'
              and purpose = 'document' and object_key like 'document/%/88888888-2222-4000-a000-000000000001.jpg'
             from public.files where id = '88888888-2222-4000-a000-000000000001'),
  'the page file belongs to the receptionist and the patient; no names in the key');
select is(public.phone_scan_begin_page((select s ->> 'token' from scan), repeat('a', 64),
  'image/jpeg', 1000, repeat('1', 64), '88888888-2222-4000-a000-000000000001') ->> 'object_key',
  (select object_key from public.files where id = '88888888-2222-4000-a000-000000000001'),
  'a retry gets the same slot');
select is(public.phone_scan_file((select s ->> 'token' from scan), repeat('a', 64), '88888888-2222-4000-a000-000000000001') ->> 'mime',
  'image/jpeg', 'the Edge Function reads the declared type to check the bytes');
select is((public.phone_scan_finish_upload((select s ->> 'token' from scan), repeat('a', 64),
  '88888888-2222-4000-a000-000000000001', true, 1000, 1200, 1600) ->> 'page_no')::int, 1, 'page 1 arrives');
select is((public.phone_scan_finish_upload((select s ->> 'token' from scan), repeat('a', 64),
  '88888888-2222-4000-a000-000000000001', true, 1000, 1200, 1600) ->> 'page_count')::int, 1,
  'confirming twice does not add a second page');
select lives_ok($$
  select public.phone_scan_begin_page((select s ->> 'token' from scan), repeat('a', 64), 'image/webp', 900, null,
                                      '88888888-2222-4000-a000-000000000002');
  select public.phone_scan_finish_upload((select s ->> 'token' from scan), repeat('a', 64),
                                         '88888888-2222-4000-a000-000000000002', false, 900) $$,
  'a page whose bytes were wrong is reported');
select ok((select status = 'failed' from public.files where id = '88888888-2222-4000-a000-000000000002')
          and not exists (select 1 from public.scan_pages where file_id = '88888888-2222-4000-a000-000000000002'),
  'it is marked failed and never becomes a page');
select is((public.phone_scan_begin_page((select s ->> 'token' from scan), repeat('a', 64), 'image/webp', 900, null,
             '88888888-2222-4000-a000-000000000003') ->> 'status'), 'pending', 'page 2 gets a slot');
select is((public.phone_scan_finish_upload((select s ->> 'token' from scan), repeat('a', 64),
  '88888888-2222-4000-a000-000000000003', true, 900) ->> 'page_no')::int, 2, 'and is numbered 2');

update public.scan_sessions set page_count = 30 where id = (select (s ->> 'session_id')::uuid from scan);
select throws_ok($$ select public.phone_scan_begin_page((select s ->> 'token' from scan), repeat('a', 64),
  'image/jpeg', 1000, null, '88888888-2222-4000-a000-000000000009') $$,
  'P0001', 'too_many_pages', 'at most 30 pages per scan');
update public.scan_sessions set page_count = 2 where id = (select (s ->> 'session_id')::uuid from scan);

select pg_temp.login('88888888-0000-4000-a000-0000000000b1');
select is(jsonb_array_length(public.scan_session_state((select (s ->> 'session_id')::uuid from scan)) -> 'pages'), 2,
  'the desk sees both pages, in order');
select is((select count(*)::int from public.scan_pages where session_id = (select (s ->> 'session_id')::uuid from scan)), 2,
  'reception can read the pages (Realtime)');
select pg_temp.login('88888888-0000-4000-a000-0000000000c1');
select is((select count(*)::int from public.scan_pages), 0, 'sales staff see no scan pages');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'scan_pages'),
  'new pages are pushed to the desk');

------------------------------------------------------------------------------
-- Expiry and closing
------------------------------------------------------------------------------
select pg_temp.login(null);
update public.public_links set expires_at = now() - interval '1 second'
 where id = (select link_id from public.scan_sessions where id = (select (s ->> 'session_id')::uuid from scan));
select throws_ok($$ select public.phone_scan_open((select s ->> 'token' from scan), repeat('a', 64)) $$,
  'P0001', 'link_expired', 'an expired link stops working, even on the phone that opened it');
update public.public_links set expires_at = now() + interval '10 minutes'
 where id = (select link_id from public.scan_sessions where id = (select (s ->> 'session_id')::uuid from scan));
select pg_temp.login('88888888-0000-4000-a000-0000000000b1');
select lives_ok($$ select public.close_phone_scan((select (s ->> 'session_id')::uuid from scan)) $$, 'the desk closes the scan');
select pg_temp.login(null);
select throws_ok($$ select public.phone_scan_begin_page((select s ->> 'token' from scan), repeat('a', 64),
  'image/jpeg', 1000, null, '88888888-2222-4000-a000-000000000008') $$,
  'P0001', 'link_expired', 'a closed scan takes no more pages');

------------------------------------------------------------------------------
-- Documents: source hashes, duplicate warning, list, discarding merged pages
------------------------------------------------------------------------------
insert into public.files (id, bucket, object_key, purpose, mime, size_bytes, sha256, status, owner_staff_id) values
  ('88888888-3333-4000-a000-000000000001', 'private', 'document/2026/10/p8-doc.pdf', 'document', 'application/pdf', 5000,
   repeat('c', 64), 'uploaded', '88888888-0000-4000-a000-0000000000b1'),
  ('88888888-3333-4000-a000-000000000002', 'private', 'thumbnail/2026/10/p8-thumb.webp', 'thumbnail', 'image/webp', 500,
   null, 'uploaded', '88888888-0000-4000-a000-0000000000b1'),
  ('88888888-3333-4000-a000-000000000003', 'private', 'document/2026/10/p8-rec2.jpg', 'document', 'image/jpeg', 500,
   null, 'uploaded', '88888888-0000-4000-a000-0000000000b2');
select pg_temp.login('88888888-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.create_document(jsonb_build_object('patient_id', '88888888-1111-4000-a000-000000000001',
    'file_id', '88888888-3333-4000-a000-000000000001', 'title', 'Rx', 'source_sha256', jsonb_build_array('nothex')),
    '88888888-4444-4000-a000-000000000001') $$,
  'P0001', 'invalid_input', 'source hashes must be SHA-256');
select throws_ok($$ select public.create_document(jsonb_build_object('patient_id', '88888888-1111-4000-a000-000000000001',
    'file_id', '88888888-3333-4000-a000-000000000001', 'title', 'Rx',
    'thumbnail_file_id', '88888888-2222-4000-a000-000000000001'),
    '88888888-4444-4000-a000-000000000001') $$,
  'P0001', 'upload_incomplete', 'a thumbnail must be an uploaded thumbnail file');
select is(public.create_document(jsonb_build_object('patient_id', '88888888-1111-4000-a000-000000000001',
    'file_id', '88888888-3333-4000-a000-000000000001', 'thumbnail_file_id', '88888888-3333-4000-a000-000000000002',
    'title', 'Prescription', 'page_count', 2,
    'source_sha256', jsonb_build_array(repeat('D', 64), repeat('e', 64), repeat('d', 64))),
    '88888888-4444-4000-a000-000000000001'),
  '88888888-4444-4000-a000-000000000001'::uuid, 'a two-page scan is saved');
select is((select source_sha256 from public.documents where id = '88888888-4444-4000-a000-000000000001'),
  array[repeat('d', 64), repeat('e', 64)], 'its source hashes are kept (lower case, once each)');
select is(public.find_duplicate_document('88888888-1111-4000-a000-000000000001', array[repeat('f', 64), repeat('E', 64)]) ->> 'title',
  'Prescription', 'the same photo again → duplicate warning, even though it was merged into a PDF');
select is(public.find_duplicate_document('88888888-1111-4000-a000-000000000001', array[repeat('c', 64)]) ->> 'title',
  'Prescription', 'the same saved file again → duplicate warning');
select ok(public.find_duplicate_document('88888888-1111-4000-a000-000000000002', array[repeat('e', 64)]) is null,
  'another patient''s copy is not a duplicate');

select is(public.patient_documents('88888888-1111-4000-a000-000000000001') -> 'items' -> 0 ->> 'page_count', '2',
  'the Documents tab lists it with its page count');

select is((select array_agg(id order by id) from public.files_discard(array[
    '88888888-2222-4000-a000-000000000003', '88888888-3333-4000-a000-000000000001',
    '88888888-3333-4000-a000-000000000003']::uuid[])),
  array['88888888-2222-4000-a000-000000000003'::uuid],
  'only the caller''s own page file that no document uses is discarded');
select is((select status::text from public.files where id = '88888888-2222-4000-a000-000000000003'), 'deleted',
  'it is marked deleted');

select * from finish();
rollback;
