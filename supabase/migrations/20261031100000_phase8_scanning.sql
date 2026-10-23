-- Pearl CRM — Phase 8: prescription / document scanning (PLAN.md E3 phase 8, C3 "files",
-- "public_links", "documents", D2 "Documents", D3 "phone-scan").
-- Pages are cleaned up in the browser (edges, straightening, document mode, compression,
-- multi-page PDF, thumbnail). The database adds:
--   * source hashes on documents, so the same photo or PDF is flagged as a duplicate even
--     after it was compressed or merged into a PDF;
--   * phone-scan sessions: a QR link that works on ONE phone (the first to open it), for a
--     limited time, until the desk saves or cancels; the pages it sends reach the desk live
--     (Realtime on scan_pages);
--   * clean-up of page files that were merged into a PDF (files_discard).

------------------------------------------------------------------------------
-- Documents: SHA-256 of every source file a document was made from.
------------------------------------------------------------------------------
create function private.all_sha256(p text[])
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(cardinality(p), 0) <= 100
     and not exists (select 1 from unnest(coalesce(p, '{}'::text[])) h where h !~ '^[0-9a-f]{64}$');
$$;

alter table public.documents
  add column source_sha256 text[] not null default '{}'
  constraint documents_source_sha256_check check (private.all_sha256(source_sha256));

-- files_discard and the duplicate check look these up; both stay index-only per row.
create index documents_thumbnail on public.documents (thumbnail_file_id) where thumbnail_file_id is not null;
create index files_linked on public.files (linked_id) where linked_id is not null;

------------------------------------------------------------------------------
-- Phone scanning (PLAN.md D3 phone-scan). One session per QR link.
------------------------------------------------------------------------------
create table public.scan_sessions (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null unique references public.public_links (id),
  patient_id uuid not null references public.patients (id),
  created_by uuid not null references public.staff (id),
  -- SHA-256 of the secret the first phone made up; every later call must carry it.
  device_hash text check (device_hash ~ '^[0-9a-f]{64}$'),
  claimed_at timestamptz,
  closed_at timestamptz,
  page_count integer not null default 0 check (page_count between 0 and 30),
  created_at timestamptz not null default now()
);
create index scan_sessions_patient on public.scan_sessions (patient_id);
create index scan_sessions_creator on public.scan_sessions (created_by, created_at desc);

create table public.scan_pages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.scan_sessions (id) on delete cascade,
  page_no integer not null check (page_no between 1 and 30),
  file_id uuid not null unique references public.files (id),
  width integer check (width between 1 and 20000),
  height integer check (height between 1 and 20000),
  created_at timestamptz not null default now(),
  unique (session_id, page_no)
);

alter table public.scan_sessions enable row level security;
alter table public.scan_pages enable row level security;
grant select on public.scan_sessions, public.scan_pages to authenticated;
-- Reception and admin (the desk that shows the QR). Phones never read tables: they go
-- through the phone-scan Edge Function, which calls the server-only functions below.
create policy scan_sessions_select on public.scan_sessions for select to authenticated
  using ((select private.has_role('receptionist', 'admin')));
create policy scan_pages_select on public.scan_pages for select to authenticated
  using ((select private.has_role('receptionist', 'admin')));

-- The desk listens for new pages (and for "phone connected") on its own session only.
alter publication supabase_realtime add table public.scan_sessions, public.scan_pages;

------------------------------------------------------------------------------
-- Desk side
------------------------------------------------------------------------------
-- Reception starts a phone scan for a patient: a single-use link (token returned ONCE,
-- only its hash is kept) plus the session the pages are collected in.
create function public.start_phone_scan(p_patient_id uuid, p_minutes integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_expires timestamptz := now() + make_interval(mins => least(greatest(coalesce(p_minutes, 30), 5), 120));
  v_link uuid;
  v_session uuid;
begin
  if not exists (select 1 from public.patients where id = p_patient_id and merged_into_id is null) then
    perform private.fail('not_found');
  end if;
  insert into public.public_links (kind, token_hash, patient_id, created_by, expires_at, max_uses)
  values ('phone_scan', encode(extensions.digest(v_token, 'sha256'), 'hex'), p_patient_id, v_staff, v_expires, 1)
  returning id into v_link;
  insert into public.scan_sessions (link_id, patient_id, created_by)
  values (v_link, p_patient_id, v_staff)
  returning id into v_session;
  return jsonb_build_object('session_id', v_session, 'token', v_token, 'expires_at', v_expires);
end;
$$;

-- What the desk shows: waiting for the phone / connected / closed / expired, and the pages so far (≤ 30).
create function public.scan_session_state(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.scan_sessions;
  v_expires timestamptz;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select * into v from public.scan_sessions where id = p_session_id;
  if not found then
    perform private.fail('not_found');
  end if;
  select expires_at into v_expires from public.public_links where id = v.link_id;
  return jsonb_build_object(
    'session_id', v.id,
    'patient_id', v.patient_id,
    'status', case when v.closed_at is not null then 'closed'
                   when v_expires < now() then 'expired'
                   when v.claimed_at is not null then 'connected'
                   else 'waiting' end,
    'expires_at', v_expires,
    'page_count', v.page_count,
    'pages', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'page_no', p.page_no, 'file_id', p.file_id,
                                          'width', p.width, 'height', p.height) order by p.page_no)
      from public.scan_pages p where p.session_id = v.id), '[]'::jsonb));
end;
$$;

-- The desk saved or cancelled: the link stops working at once.
create function public.close_phone_scan(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link uuid;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  update public.scan_sessions set closed_at = coalesce(closed_at, now())
   where id = p_session_id
  returning link_id into v_link;
  if not found then
    perform private.fail('not_found');
  end if;
  update public.public_links set expires_at = least(expires_at, now()) where id = v_link;
end;
$$;

------------------------------------------------------------------------------
-- Phone side: called ONLY by the phone-scan Edge Function (service role), with the
-- token from the QR and the phone's own secret ("device key").
------------------------------------------------------------------------------
-- The session behind a token, checked: not expired, not closed, and (once claimed) the
-- same phone. Locks the session row so page numbers are handed out one at a time.
create function private.scan_session_for(p_token text, p_device_key text)
returns public.scan_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.scan_sessions;
  v_expires timestamptz;
begin
  if p_device_key is null or p_device_key !~ '^[0-9a-f]{32,128}$' then
    perform private.fail('invalid_input', 'device key');
  end if;
  select s.* into v
    from public.public_links l join public.scan_sessions s on s.link_id = l.id
   where l.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and l.kind = 'phone_scan'
   for update of s;
  if not found then
    perform private.fail('link_expired');
  end if;
  select l.expires_at into v_expires from public.public_links l where l.id = v.link_id;
  if v.closed_at is not null or v_expires < now() then
    perform private.fail('link_expired');
  end if;
  if v.device_hash is not null and v.device_hash <> encode(extensions.digest(p_device_key, 'sha256'), 'hex') then
    perform private.fail('link_used');
  end if;
  return v;
end;
$$;

-- The phone opens the link. The first phone claims it; any other phone is refused.
create function public.phone_scan_open(p_token text, p_device_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.scan_sessions := private.scan_session_for(p_token, p_device_key);
begin
  if v.device_hash is null then
    update public.scan_sessions
       set device_hash = encode(extensions.digest(p_device_key, 'sha256'), 'hex'), claimed_at = now()
     where id = v.id;
    update public.public_links set uses = uses + 1 where id = v.link_id;
  end if;
  return jsonb_build_object(
    'session_id', v.id,
    'page_count', v.page_count,
    'max_pages', 30,
    'expires_at', (select expires_at from public.public_links where id = v.link_id),
    'uhid', (select uhid from public.patients where id = v.patient_id),
    'clinic', (select c.name from public.clinic_settings c where c.branch_code = 'main'));
end;
$$;

-- A page upload, step 1: same checks as files_begin_upload ('document' rules), owned by
-- the receptionist who started the scan. Retrying with the same client id is safe.
create function public.phone_scan_begin_page(
  p_token text, p_device_key text, p_mime text, p_size_bytes bigint, p_sha256 text, p_client_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.scan_sessions := private.scan_session_for(p_token, p_device_key);
  v_rule record;
  v_existing public.files;
  v_key text;
begin
  if v.device_hash is null then
    perform private.fail('link_expired'); -- open first
  end if;
  if p_client_id is null or (p_sha256 is not null and lower(p_sha256) !~ '^[0-9a-f]{64}$') then
    perform private.fail('invalid_input');
  end if;
  select * into v_existing from public.files where id = p_client_id;
  if found then
    if v_existing.linked_table is distinct from 'scan_sessions' or v_existing.linked_id is distinct from v.id then
      perform private.fail('not_allowed');
    end if;
    return jsonb_build_object('file_id', v_existing.id, 'object_key', v_existing.object_key, 'status', v_existing.status);
  end if;
  -- At most 30 pages, and a bounded number of unfinished tries, per session.
  if v.page_count >= 30
     or (select count(*) from public.files f where f.linked_id = v.id and f.linked_table = 'scan_sessions') >= 60 then
    perform private.fail('too_many_pages');
  end if;
  select * into v_rule from private.file_rule('document');
  if p_mime is null or p_mime not in ('image/webp', 'image/jpeg') then
    perform private.fail('file_type_not_allowed');
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > v_rule.max_bytes then
    perform private.fail('file_too_large', format('limit %s bytes', v_rule.max_bytes));
  end if;
  v_key := format('document/%s/%s.%s', to_char(private.ist(now()), 'YYYY/MM'), p_client_id,
                  case p_mime when 'image/webp' then 'webp' else 'jpg' end);
  insert into public.files (id, bucket, object_key, purpose, mime, size_bytes, sha256, owner_staff_id,
                            patient_id, linked_table, linked_id)
  values (p_client_id, 'private', v_key, 'document', p_mime, p_size_bytes, lower(p_sha256), v.created_by,
          v.patient_id, 'scan_sessions', v.id);
  return jsonb_build_object('file_id', p_client_id, 'object_key', v_key, 'status', 'pending');
end;
$$;

-- Step 2 needs the object's key and declared type to check the upload.
create function public.phone_scan_file(p_token text, p_device_key text, p_file_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.scan_sessions := private.scan_session_for(p_token, p_device_key);
  v_file public.files;
begin
  select * into v_file from public.files
   where id = p_file_id and linked_table = 'scan_sessions' and linked_id = v.id;
  if not found then
    perform private.fail('not_found');
  end if;
  return jsonb_build_object('object_key', v_file.object_key, 'mime', v_file.mime,
                            'size_bytes', v_file.size_bytes, 'status', v_file.status);
end;
$$;

-- Step 3: the Edge Function checked size and real type (magic bytes). OK → the page joins
-- the session (next number) and the desk sees it over Realtime. Not OK → the file is failed.
create function public.phone_scan_finish_upload(
  p_token text, p_device_key text, p_file_id uuid, p_ok boolean, p_size_bytes bigint,
  p_width integer default null, p_height integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.scan_sessions := private.scan_session_for(p_token, p_device_key);
  v_file public.files;
  v_page integer;
begin
  select * into v_file from public.files
   where id = p_file_id and linked_table = 'scan_sessions' and linked_id = v.id
   for update;
  if not found then
    perform private.fail('not_found');
  end if;
  select page_no into v_page from public.scan_pages where file_id = p_file_id;
  if found then
    return jsonb_build_object('page_no', v_page, 'page_count', v.page_count);
  end if;
  if not coalesce(p_ok, false) then
    update public.files set status = 'failed' where id = p_file_id and status = 'pending';
    return jsonb_build_object('page_no', null, 'page_count', v.page_count);
  end if;
  if v.page_count >= 30 then
    perform private.fail('too_many_pages');
  end if;
  update public.files
     set status = 'uploaded', uploaded_at = coalesce(uploaded_at, now()), size_bytes = p_size_bytes,
         width = p_width, height = p_height
   where id = p_file_id;
  if v_file.status = 'pending' then
    perform private.bump_usage('tigris_writes');
  end if;
  v_page := v.page_count + 1;
  insert into public.scan_pages (session_id, page_no, file_id, width, height)
  values (v.id, v_page, p_file_id, p_width, p_height);
  update public.scan_sessions set page_count = v_page where id = v.id;
  return jsonb_build_object('page_no', v_page, 'page_count', v_page);
end;
$$;

revoke execute on function
  public.phone_scan_open(text, text),
  public.phone_scan_begin_page(text, text, text, bigint, text, uuid),
  public.phone_scan_file(text, text, uuid),
  public.phone_scan_finish_upload(text, text, uuid, boolean, bigint, integer, integer)
from public, anon, authenticated;
grant execute on function
  public.phone_scan_open(text, text),
  public.phone_scan_begin_page(text, text, text, bigint, text, uuid),
  public.phone_scan_file(text, text, uuid),
  public.phone_scan_finish_upload(text, text, uuid, boolean, bigint, integer, integer)
to service_role;

------------------------------------------------------------------------------
-- Documents: create with source hashes, duplicate check, list, clean-up of merged pages
------------------------------------------------------------------------------
-- Same as Phase 2, plus: source_sha256 (the hashes of the photos / PDFs it was made from)
-- and a checked thumbnail.
create or replace function public.create_document(p_doc jsonb, p_client_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_file public.files;
  v_thumb public.files;
  v_patient uuid := (p_doc ->> 'patient_id')::uuid;
  v_sources text[];
begin
  if p_client_id is null then
    perform private.fail('invalid_input', 'client id');
  end if;
  if exists (select 1 from public.documents where id = p_client_id) then
    return p_client_id;
  end if;
  if jsonb_typeof(coalesce(p_doc -> 'source_sha256', '[]'::jsonb)) <> 'array' then
    perform private.fail('invalid_input', 'source_sha256');
  end if;
  select coalesce(array_agg(distinct lower(h)), '{}') into v_sources
    from jsonb_array_elements_text(coalesce(p_doc -> 'source_sha256', '[]'::jsonb)) h;
  if not private.all_sha256(v_sources) then
    perform private.fail('invalid_input', 'source_sha256');
  end if;
  select * into v_file from public.files where id = (p_doc ->> 'file_id')::uuid;
  if not found or v_file.status <> 'uploaded' then
    perform private.fail('upload_incomplete');
  end if;
  if v_file.owner_staff_id <> v_staff and not private.has_role('admin') then
    perform private.fail('not_allowed');
  end if;
  if p_doc ->> 'thumbnail_file_id' is not null then
    select * into v_thumb from public.files where id = (p_doc ->> 'thumbnail_file_id')::uuid;
    if not found or v_thumb.status <> 'uploaded' or v_thumb.purpose <> 'thumbnail' then
      perform private.fail('upload_incomplete', 'thumbnail');
    end if;
    if v_thumb.owner_staff_id <> v_staff and not private.has_role('admin') then
      perform private.fail('not_allowed');
    end if;
  end if;
  if not exists (select 1 from public.patients where id = v_patient and merged_into_id is null) then
    perform private.fail('not_found');
  end if;
  update public.files set patient_id = v_patient, linked_table = 'documents', linked_id = p_client_id
   where id in (v_file.id, v_thumb.id);
  insert into public.documents (id, patient_id, kind_id, title, doc_date, doctor_id, file_id, thumbnail_file_id,
                                page_count, source_sha256)
  values (p_client_id, v_patient, (p_doc ->> 'kind_id')::uuid,
          coalesce(nullif(btrim(p_doc ->> 'title'), ''), 'Document'),
          coalesce((p_doc ->> 'doc_date')::date, (private.ist(now()))::date),
          (p_doc ->> 'doctor_id')::uuid, v_file.id, v_thumb.id,
          (p_doc ->> 'page_count')::int, v_sources);
  perform private.library_used('lookup_values', (p_doc ->> 'kind_id')::uuid);
  return p_client_id;
end;
$$;

-- "Already saved for this patient": any of the given hashes matches a saved file or a
-- source the document was made from. Reads only this patient's documents (indexed).
create function public.find_duplicate_document(p_patient_id uuid, p_sha256 text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hashes text[];
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select coalesce(array_agg(distinct lower(h)), '{}') into v_hashes from unnest(coalesce(p_sha256, '{}'::text[])) h;
  if not private.all_sha256(v_hashes) then
    perform private.fail('invalid_input', 'sha256');
  end if;
  if cardinality(v_hashes) = 0 then
    return null;
  end if;
  return (
    select jsonb_build_object('document_id', d.id, 'title', d.title, 'doc_date', d.doc_date)
    from public.documents d join public.files f on f.id = d.file_id
    where d.patient_id = p_patient_id and not d.archived
      and (f.sha256 = any (v_hashes) or d.source_sha256 && v_hashes)
    order by d.created_at desc
    limit 1);
end;
$$;

-- The Documents tab: newest first, keyset on (doc_date, id), at most 50 a page.
create function public.patient_documents(p_patient_id uuid, p_cursor text default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_date date;
  v_id uuid;
  v_items jsonb;
  v_count integer;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  if p_cursor is not null then
    begin
      v_date := split_part(p_cursor, '|', 1)::date;
      v_id := split_part(p_cursor, '|', 2)::uuid;
    exception when others then
      perform private.fail('invalid_input', 'cursor');
    end;
  end if;
  with page as (
    select d.id, d.title, d.doc_date, d.file_id, d.thumbnail_file_id, d.page_count, d.created_at,
           l.label as kind, f.mime, f.size_bytes
    from public.documents d
    join public.files f on f.id = d.file_id
    left join public.lookup_values l on l.id = d.kind_id
    where d.patient_id = p_patient_id and not d.archived
      and (v_date is null or (d.doc_date, d.id) < (v_date, v_id))
    order by d.doc_date desc, d.id desc
    limit v_limit + 1
  )
  select coalesce(jsonb_agg(to_jsonb(page) order by page.doc_date desc, page.id desc), '[]'::jsonb), count(*)
    into v_items, v_count
  from page;
  if v_count > v_limit then
    v_items := v_items - v_limit;
    return jsonb_build_object('items', v_items,
      'next_cursor', format('%s|%s', v_items -> (v_limit - 1) ->> 'doc_date', v_items -> (v_limit - 1) ->> 'id'));
  end if;
  return jsonb_build_object('items', v_items, 'next_cursor', null);
end;
$$;

-- Page files that were merged into a PDF (or a scan that was cancelled) are deleted:
-- only the caller's own document / prescription / thumbnail files that no document uses.
-- Marks them deleted and returns their keys; the files-sign Edge Function removes the objects.
create function public.files_discard(p_ids uuid[])
returns table (id uuid, object_key text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
begin
  if cardinality(coalesce(p_ids, '{}'::uuid[])) > 100 then
    perform private.fail('invalid_input', 'at most 100 files');
  end if;
  return query
  update public.files f
     set status = 'deleted', archived_at = now()
   where f.id = any (p_ids)
     and f.owner_staff_id = v_staff
     and f.status in ('pending', 'uploaded', 'failed')
     and f.purpose in ('document', 'prescription', 'thumbnail')
     and (f.linked_table is null or f.linked_table = 'scan_sessions')
     and not exists (select 1 from public.documents d where d.file_id = f.id)
     and not exists (select 1 from public.documents d where d.thumbnail_file_id = f.id)
  returning f.id, f.object_key;
end;
$$;

grant execute on function
  public.start_phone_scan(uuid, integer),
  public.scan_session_state(uuid),
  public.close_phone_scan(uuid),
  public.find_duplicate_document(uuid, text[]),
  public.patient_documents(uuid, text, integer),
  public.files_discard(uuid[])
to authenticated;

alter default privileges revoke execute on functions from public;
select private.lock_down_public_functions();
