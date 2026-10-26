-- Phase 14: dashboards, notifications, backup and purge (PLAN.md E3 row 14).
--  * Notification rules: per type, push to the phone and/or email (the bell always shows it).
--  * Daily summary: an evening email (and bell entry) for the admins.
--  * Storage meter + nightly housekeeping (old logs, GPS chunks, keys) + storage alerts.
--  * Backup centre: the admin's browser copies files into a folder, the server records each
--    verified SHA-256; a full database export; a weekly reminder.
--  * Purge: heavy media leaves the cloud only after a verified backup (refused otherwise).
--  * Sales targets (optional) and the admin dashboard (one call).

------------------------------------------------------------------------------
-- Notification rules
------------------------------------------------------------------------------
create table public.notification_rules (
  type text primary key check (type ~ '^[a-z_]+$'),
  push boolean not null default true,
  email boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.notification_rules enable row level security;
grant select, insert, update on public.notification_rules to authenticated;
create policy notification_rules_select on public.notification_rules for select to authenticated
  using ((select private.has_role('admin')));
create policy notification_rules_insert on public.notification_rules for insert to authenticated
  with check ((select private.has_role('admin')));
create policy notification_rules_update on public.notification_rules for update to authenticated
  using ((select private.has_role('admin'))) with check ((select private.has_role('admin')));
create trigger notification_rules_touch before update on public.notification_rules
  for each row execute function private.touch_updated();
create trigger notification_rules_audit after insert or update or delete on public.notification_rules
  for each row execute function private.audit_row();

-- Channels for one type: the admin's rule, else the default (same as packages/shared notifications.ts).
create function private.notification_channels(p_type text)
returns table (push boolean, email boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(r.push, d.push), coalesce(r.email, d.email)
  from (select p_type <> 'daily_summary' as push, p_type in ('storage_alert', 'backup_reminder') as email) d
  left join public.notification_rules r on r.type = p_type;
$$;

-- A saved notification rings the phone (push-send) and/or emails (notify-email) by its rule.
-- locate_now is a command to the phone: always pushed, never emailed.
create or replace function private.push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_push boolean;
  v_email boolean;
begin
  select c.push, c.email into v_push, v_email from private.notification_channels(new.type) c;
  if (v_push or new.type = 'locate_now')
     and exists (select 1 from public.device_tokens d where d.staff_id = new.recipient_id and d.platform = 'android') then
    perform private.call_edge('push-send', jsonb_build_object('id', new.id));
  end if;
  if v_email and new.type <> 'locate_now'
     and exists (select 1 from public.staff s where s.id = new.recipient_id and s.active and s.email is not null) then
    perform private.call_edge('notify-email', jsonb_build_object('id', new.id));
  end if;
  return new;
end;
$$;

-- What notify-email sends for one notification.
create function public.email_payload(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', n.id, 'type', n.type, 'title', n.title, 'body', coalesce(n.body, ''), 'link', n.link,
    'to_email', s.email, 'to_name', s.full_name,
    'clinic', (select c.name from public.clinic_settings c order by c.branch_code = 'main' desc limit 1))
  from public.notifications n join public.staff s on s.id = n.recipient_id and s.active
  where n.id = p_id;
$$;

-- Server functions log their runs here (failures for support, "last sent" for the admin).
create function public.job_run_log(p_job text, p_ok boolean, p_detail jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.job_runs (job, finished_at, ok, detail)
  values (p_job, now(), coalesce(p_ok, false), coalesce(p_detail, '{}'::jsonb));
$$;

------------------------------------------------------------------------------
-- Storage meter and nightly housekeeping
------------------------------------------------------------------------------
create function private.storage_usage()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with lim as (
    select (private.setting('storage', 'db_limit_mb', '500'))::bigint * 1048576 as db,
           (private.setting('storage', 'files_limit_gb', '5'))::bigint * 1073741824 as files,
           (private.setting('storage', 'monthly_writes_limit', '10000'))::bigint as writes
  ), used as (
    select pg_database_size(current_database()) as db,
           (select coalesce(sum(f.size_bytes), 0) from public.files f where f.status = 'uploaded') as files,
           (select coalesce(sum(u.value), 0) from public.usage_counters u
             where u.metric = 'tigris_writes' and u.month = date_trunc('month', private.ist(now()))::date) as writes
  ), pct as (
    select round(100.0 * used.db / greatest(lim.db, 1), 1) as db,
           round(100.0 * used.files / greatest(lim.files, 1), 1) as files,
           round(100.0 * used.writes / greatest(lim.writes, 1), 1) as writes
    from used, lim
  )
  select jsonb_build_object(
    'db_bytes', used.db, 'db_limit_bytes', lim.db, 'db_pct', pct.db,
    'files_bytes', used.files, 'files_limit_bytes', lim.files, 'files_pct', pct.files,
    'writes_month', used.writes, 'writes_limit', lim.writes, 'writes_pct', pct.writes,
    'pct', greatest(pct.db, pct.files, pct.writes),
    'level', case when greatest(pct.db, pct.files, pct.writes) >= 95 then 'critical'
                  when greatest(pct.db, pct.files, pct.writes) >= 85 then 'serious'
                  when greatest(pct.db, pct.files, pct.writes) >= 70 then 'warning' else 'good' end,
    'by_purpose', coalesce((
      select jsonb_agg(jsonb_build_object('purpose', x.purpose, 'files', x.n, 'bytes', x.bytes) order by x.bytes desc)
      from (select f.purpose::text as purpose, count(*) as n, sum(f.size_bytes) as bytes
            from public.files f where f.status = 'uploaded' group by f.purpose) x), '[]'::jsonb))
  from used, lim, pct;
$$;

create function public.storage_meter()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  return private.storage_usage();
end;
$$;

-- 02:00 IST. Bulky logs only; clinical records are never deleted (PLAN.md F6).
create function private.housekeeping()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (private.ist(now()))::date;
  v_detail jsonb := '{}'::jsonb;
  v_n integer;
  v_usage jsonb;
begin
  delete from public.job_runs where started_at < now() - interval '90 days';
  get diagnostics v_n = row_count;
  v_detail := v_detail || jsonb_build_object('job_runs', v_n);
  -- A finished day keeps its summary and its trips' route lines; the raw GPS goes after 30 days.
  delete from public.location_chunks c using public.bdm_days d
   where c.day_id = d.id and d.ended_at is not null and d.work_date < v_today - 30;
  get diagnostics v_n = row_count;
  v_detail := v_detail || jsonb_build_object('location_chunks', v_n);
  delete from public.idempotency_keys where created_at < now() - interval '7 days';
  get diagnostics v_n = row_count;
  v_detail := v_detail || jsonb_build_object('idempotency_keys', v_n);
  delete from public.client_errors where at < now() - interval '30 days';
  get diagnostics v_n = row_count;
  v_detail := v_detail || jsonb_build_object('client_errors', v_n);
  delete from public.notifications where read_at is not null and created_at < now() - interval '180 days';
  get diagnostics v_n = row_count;
  v_detail := v_detail || jsonb_build_object('notifications', v_n);

  -- Storage alerts at 70 / 85 / 95 %, once per level per month.
  v_usage := private.storage_usage();
  if v_usage ->> 'level' <> 'good' then
    perform private.notify_admins('storage_alert',
      format('Storage %s%% full', v_usage ->> 'pct'),
      'Back up and purge old recordings, or raise the plan. Admin → Backup centre.',
      '/admin/backup',
      format('storage:%s:%s', v_usage ->> 'level', to_char(v_today, 'YYYY-MM')));
  end if;
  v_detail := v_detail || jsonb_build_object('storage_pct', v_usage -> 'pct');
  insert into public.job_runs (job, finished_at, ok, detail) values ('housekeeping', now(), true, v_detail);
  return v_detail;
end;
$$;

------------------------------------------------------------------------------
-- Backups (files into the admin's folder; full database export)
------------------------------------------------------------------------------
create table public.backup_batches (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('files', 'database')),
  scope jsonb not null default '{}'::jsonb,
  status text not null default 'running' check (status in ('running', 'done', 'abandoned')),
  total_items integer not null default 0,
  total_bytes bigint not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid references public.staff (id)
);
-- One files backup at a time: starting again resumes it.
create unique index backup_batches_one_running on public.backup_batches (kind) where status = 'running';
create index backup_batches_recent on public.backup_batches (kind, started_at desc);

create table public.backup_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.backup_batches (id) on delete cascade,
  file_id uuid references public.files (id),
  table_name text,
  rel_path text check (length(rel_path) <= 400),
  size_bytes bigint not null default 0,
  row_count bigint,
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (batch_id, file_id),
  check ((file_id is null) <> (table_name is null))
);
create index backup_items_pending on public.backup_items (batch_id, id) where verified_at is null;
create index backup_items_file on public.backup_items (file_id) where file_id is not null;

alter table public.files
  add constraint files_backup_item_fk foreign key (backup_item_id) references public.backup_items (id) on delete set null;

alter table public.backup_batches enable row level security;
alter table public.backup_items enable row level security;
grant select on public.backup_batches, public.backup_items to authenticated;
create policy backup_batches_select on public.backup_batches for select to authenticated using ((select private.has_role('admin')));
create policy backup_items_select on public.backup_items for select to authenticated using ((select private.has_role('admin')));

create function private.backup_card(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id, 'kind', b.kind, 'scope', b.scope, 'status', b.status,
    'total_items', b.total_items, 'total_bytes', b.total_bytes,
    'done_items', (select count(*) from public.backup_items i where i.batch_id = b.id and i.verified_at is not null),
    'done_bytes', (select coalesce(sum(i.size_bytes), 0) from public.backup_items i where i.batch_id = b.id and i.verified_at is not null),
    'failed_items', (select count(*) from public.backup_items i where i.batch_id = b.id and i.verified_at is null and i.error is not null),
    'started_at', b.started_at, 'finished_at', b.finished_at,
    'by', (select s.full_name from public.staff s where s.id = b.created_by))
  from public.backup_batches b where b.id = p_id;
$$;

-- Files with a verified copy in some backup (purge may remove them from the cloud).
create function private.file_backed_up(p_file public.files)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.backup_items i where i.id = p_file.backup_item_id and i.verified_at is not null);
$$;

-- Start (or resume) copying files of these kinds stored before a date into the backup folder.
create function public.backup_plan(p_purposes text[], p_before date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['admin']::public.staff_role[]);
  v_id uuid;
  v_n integer;
  v_bytes bigint;
  v_allowed text[] := array['prescription', 'document', 'registration_form', 'patient_photo', 'doctor_signature', 'pdf',
                            'call_recording', 'visit_recording', 'voice_note', 'punch_photo', 'selfie'];
begin
  select b.id into v_id from public.backup_batches b where b.kind = 'files' and b.status = 'running';
  if v_id is not null then
    return private.backup_card(v_id) || jsonb_build_object('resumed', true);
  end if;
  if coalesce(cardinality(p_purposes), 0) = 0 or not (p_purposes <@ v_allowed) then
    perform private.fail('invalid_input', 'purposes');
  end if;
  insert into public.backup_batches (kind, scope, created_by)
  values ('files', jsonb_build_object('purposes', to_jsonb(p_purposes), 'before', p_before), v_me)
  returning id into v_id;
  insert into public.backup_items (batch_id, file_id, size_bytes)
  select v_id, f.id, f.size_bytes
  from public.files f
  where f.status = 'uploaded' and f.purpose::text = any (p_purposes)
    and (p_before is null or f.created_at < private.ist_at(p_before, '00:00'))
    and not private.file_backed_up(f);
  get diagnostics v_n = row_count;
  select coalesce(sum(size_bytes), 0) into v_bytes from public.backup_items where batch_id = v_id;
  update public.backup_batches
     set total_items = v_n, total_bytes = v_bytes,
         status = case when v_n = 0 then 'done' else 'running' end,
         finished_at = case when v_n = 0 then now() end
   where id = v_id;
  return private.backup_card(v_id) || jsonb_build_object('resumed', false);
end;
$$;

-- The next files still to copy (keyset on the item id), with a label for the file name.
create function public.backup_items_page(p_batch_id uuid, p_after uuid default null, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  select coalesce(jsonb_agg(x.j order by x.id), '[]'::jsonb) into v_items
  from (
    select i.id, jsonb_build_object(
      'id', i.id, 'file_id', f.id, 'purpose', f.purpose, 'mime', f.mime, 'size_bytes', f.size_bytes,
      'created_at', f.created_at, 'sha256', f.sha256,
      'label', coalesce(p.full_name || ' (' || p.uhid || ')', l.name, s.full_name)) as j
    from public.backup_items i
    join public.files f on f.id = i.file_id
    left join public.patients p on p.id = f.patient_id
    left join public.leads l on l.id = f.lead_id
    left join public.staff s on s.id = f.owner_staff_id
    where i.batch_id = p_batch_id and i.verified_at is null and (p_after is null or i.id > p_after)
    order by i.id
    limit v_limit
  ) x;
  return jsonb_build_object('items', v_items,
    'next', case when jsonb_array_length(v_items) = v_limit then v_items -> (v_limit - 1) ->> 'id' end);
end;
$$;

-- The browser wrote these files and read them back: record each SHA-256. A file whose stored
-- checksum differs is not counted as backed up.
create function public.backup_mark_verified(p_batch_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_x jsonb;
  v_sha text;
  v_ok integer := 0;
  v_bad integer := 0;
  v_left integer;
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then
    perform private.fail('invalid_input', 'items');
  end if;
  for v_x in select * from jsonb_array_elements(p_items) loop
    select i.id, i.file_id, f.sha256 as file_sha into v_item
    from public.backup_items i join public.files f on f.id = i.file_id
    where i.id = (v_x ->> 'id')::uuid and i.batch_id = p_batch_id;
    if v_item.id is null then
      perform private.fail('not_found', 'backup item');
    end if;
    v_sha := lower(v_x ->> 'sha256');
    if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' or (v_item.file_sha is not null and v_item.file_sha <> v_sha) then
      update public.backup_items set error = 'sha_mismatch', verified_at = null where id = v_item.id;
      v_bad := v_bad + 1;
      continue;
    end if;
    update public.backup_items
       set sha256 = v_sha, rel_path = left(v_x ->> 'path', 400), verified_at = now(), error = null
     where id = v_item.id;
    update public.files set sha256 = coalesce(sha256, v_sha), backup_item_id = v_item.id where id = v_item.file_id;
    v_ok := v_ok + 1;
  end loop;
  select count(*) into v_left from public.backup_items where batch_id = p_batch_id and verified_at is null;
  if v_left = 0 then
    update public.backup_batches set status = 'done', finished_at = now() where id = p_batch_id and status = 'running';
  end if;
  return jsonb_build_object('verified', v_ok, 'mismatched', v_bad, 'remaining', v_left);
end;
$$;

-- A file that couldn't be downloaded or written: noted, left for the next try.
create function public.backup_item_failed(p_batch_id uuid, p_item_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  update public.backup_items set error = left(coalesce(p_error, 'failed'), 200)
   where id = p_item_id and batch_id = p_batch_id and verified_at is null;
end;
$$;

-- Re-read the copies in the folder: any file that changed or went missing loses its "backed up"
-- mark (so purge refuses it and the next backup copies it again).
create function public.backup_recheck(p_batch_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_x jsonb;
  v_id uuid;
  v_sha text;
  v_ok integer := 0;
  v_bad integer := 0;
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then
    perform private.fail('invalid_input', 'items');
  end if;
  for v_x in select * from jsonb_array_elements(p_items) loop
    v_id := (v_x ->> 'id')::uuid;
    v_sha := lower(v_x ->> 'sha256');
    if exists (select 1 from public.backup_items i
               where i.id = v_id and i.batch_id = p_batch_id and i.verified_at is not null and i.sha256 = v_sha) then
      v_ok := v_ok + 1;
    else
      update public.backup_items set verified_at = null, error = case when v_sha is null then 'missing' else 'changed' end
       where id = v_id and batch_id = p_batch_id and verified_at is not null;
      if found then
        update public.files set backup_item_id = null where backup_item_id = v_id;
        v_bad := v_bad + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('ok', v_ok, 'bad', v_bad);
end;
$$;

-- The verified copies of a batch, for re-checking the folder (keyset on the item id).
create function public.backup_verified_page(p_batch_id uuid, p_after uuid default null, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'path', x.rel_path, 'sha256', x.sha256) order by x.id), '[]'::jsonb)
    into v_items
  from (select i.id, i.rel_path, i.sha256 from public.backup_items i
        where i.batch_id = p_batch_id and i.verified_at is not null and i.file_id is not null
          and (p_after is null or i.id > p_after)
        order by i.id limit v_limit) x;
  return jsonb_build_object('items', v_items,
    'next', case when jsonb_array_length(v_items) = v_limit then v_items -> (v_limit - 1) ->> 'id' end);
end;
$$;

create function public.backup_abandon(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  update public.backup_batches set status = 'abandoned', finished_at = now() where id = p_batch_id and status = 'running';
  return private.backup_card(p_batch_id);
end;
$$;

create function public.backup_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  return jsonb_build_object(
    'running', (select private.backup_card(b.id) from public.backup_batches b where b.kind = 'files' and b.status = 'running'),
    'batches', coalesce((
      select jsonb_agg(private.backup_card(x.id) order by x.started_at desc)
      from (select b.id, b.started_at from public.backup_batches b order by b.started_at desc limit 10) x), '[]'::jsonb),
    'last_files_at', (select max(i.verified_at) from public.backup_items i where i.file_id is not null),
    'last_export_at', (select max(b.finished_at) from public.backup_batches b where b.kind = 'database' and b.status = 'done'),
    'not_backed_up', coalesce((
      select jsonb_agg(jsonb_build_object('purpose', x.purpose, 'files', x.n, 'bytes', x.bytes) order by x.bytes desc)
      from (select f.purpose::text as purpose, count(*) as n, sum(f.size_bytes) as bytes
            from public.files f
            where f.status = 'uploaded' and f.purpose <> 'thumbnail' and not private.file_backed_up(f)
            group by f.purpose) x), '[]'::jsonb),
    'storage', private.storage_usage());
end;
$$;

-- Full export: every public table (estimated rows for the progress bar).
create function public.export_tables()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  return coalesce((
    select jsonb_agg(jsonb_build_object('table', c.relname, 'rows', greatest(c.reltuples, 0)::bigint) order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')), '[]'::jsonb);
end;
$$;

-- One page of a table, in storage order (keyset on the row's physical position).
create function public.export_table_page(p_table text, p_after text default null, p_limit integer default 1000)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 1000);
  v_rows jsonb;
  v_last text;
  v_n integer;
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname = p_table) then
    perform private.fail('invalid_input', 'table');
  end if;
  if p_after is not null and p_after !~ '^\(\d+,\d+\)$' then
    perform private.fail('invalid_input', 'cursor');
  end if;
  execute format(
    'select coalesce(jsonb_agg(r.j order by r.ctid), ''[]''::jsonb), (array_agg(r.ctid order by r.ctid desc))[1]::text, count(*)
       from (select t.ctid, to_jsonb(t) as j from public.%I t
              where $1::tid is null or t.ctid > $1::tid order by t.ctid limit $2) r', p_table)
    into v_rows, v_last, v_n using p_after, v_limit;
  return jsonb_build_object('rows', v_rows, 'next', case when v_n = v_limit then v_last end);
end;
$$;

-- The browser finished writing the export: record it (the weekly reminder counts from here).
create function public.export_record(p_stamp text, p_tables jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['admin']::public.staff_role[]);
  v_id uuid;
begin
  if jsonb_typeof(p_tables) <> 'array' or jsonb_array_length(p_tables) = 0 or jsonb_array_length(p_tables) > 500 then
    perform private.fail('invalid_input', 'tables');
  end if;
  insert into public.backup_batches (kind, scope, status, finished_at, created_by, total_items, total_bytes)
  values ('database', jsonb_build_object('stamp', left(p_stamp, 40)), 'done', now(), v_me,
          jsonb_array_length(p_tables), (select coalesce(sum((x ->> 'bytes')::bigint), 0) from jsonb_array_elements(p_tables) x))
  returning id into v_id;
  insert into public.backup_items (batch_id, table_name, rel_path, size_bytes, row_count, sha256, verified_at)
  select v_id, left(x ->> 'table', 63), left(x ->> 'path', 400), coalesce((x ->> 'bytes')::bigint, 0), (x ->> 'rows')::bigint,
         case when lower(x ->> 'sha256') ~ '^[0-9a-f]{64}$' then lower(x ->> 'sha256') end, now()
  from jsonb_array_elements(p_tables) x;
  return private.backup_card(v_id);
end;
$$;

-- Monday 10:00 IST: a week without a full export → remind the admins (once per week).
create function private.backup_reminder()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last timestamptz := (select max(b.finished_at) from public.backup_batches b where b.kind = 'database' and b.status = 'done');
begin
  if not (private.setting('storage', 'backup_reminder', 'true'))::boolean then
    return;
  end if;
  if v_last is null or v_last < now() - interval '7 days' then
    perform private.notify_admins('backup_reminder', 'Time for the weekly backup',
      case when v_last is null then 'No full export has been made yet.'
           else 'The last full export was on ' || to_char(private.ist(v_last), 'DD/MM/YYYY') || '.' end
      || ' Admin → Backup centre → Export the database.',
      '/admin/backup', 'backup:' || to_char(private.ist(now()), 'IYYY-IW'));
  end if;
end;
$$;

------------------------------------------------------------------------------
-- Purge (only what has a verified backup; heavy media only)
------------------------------------------------------------------------------
create function private.purgeable(p_purpose public.file_purpose)
returns boolean
language sql
immutable
as $$
  select p_purpose in ('call_recording', 'visit_recording', 'voice_note', 'punch_photo', 'selfie');
$$;

create function private.purge_scope(p_purposes text[], p_before date)
returns void
language plpgsql
immutable
as $$
begin
  if coalesce(cardinality(p_purposes), 0) = 0
     or not (p_purposes <@ array['call_recording', 'visit_recording', 'voice_note', 'punch_photo', 'selfie']) then
    perform private.fail('not_purgeable');
  end if;
  if p_before is null then
    perform private.fail('invalid_input', 'before');
  end if;
end;
$$;

create function public.purge_preview(p_purposes text[], p_before date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  perform private.purge_scope(p_purposes, p_before);
  return coalesce((
    select jsonb_agg(jsonb_build_object('purpose', x.purpose, 'ready_files', x.ready_n, 'ready_bytes', x.ready_bytes,
                                        'blocked_files', x.blocked_n, 'blocked_bytes', x.blocked_bytes) order by x.purpose)
    from (
      select f.purpose::text as purpose,
             count(*) filter (where private.file_backed_up(f)) as ready_n,
             coalesce(sum(f.size_bytes) filter (where private.file_backed_up(f)), 0) as ready_bytes,
             count(*) filter (where not private.file_backed_up(f)) as blocked_n,
             coalesce(sum(f.size_bytes) filter (where not private.file_backed_up(f)), 0) as blocked_bytes
      from public.files f
      where f.status = 'uploaded' and f.purpose::text = any (p_purposes) and f.created_at < private.ist_at(p_before, '00:00')
      group by f.purpose
    ) x), '[]'::jsonb);
end;
$$;

create function public.purge_candidates(p_purposes text[], p_before date, p_limit integer default 100)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  perform private.purge_scope(p_purposes, p_before);
  return array(
    select f.id from public.files f
    where f.status = 'uploaded' and f.purpose::text = any (p_purposes) and f.created_at < private.ist_at(p_before, '00:00')
      and private.file_backed_up(f)
    order by f.created_at
    limit least(greatest(coalesce(p_limit, 100), 1), 100));
end;
$$;

-- Marks the files deleted and hands back their keys (files-sign removes the objects). The whole
-- call is refused if any file lacks a verified backup or is a clinical record.
create function public.files_purge(p_ids uuid[])
returns table (id uuid, object_key text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  if coalesce(cardinality(p_ids), 0) = 0 or cardinality(p_ids) > 100 then
    perform private.fail('invalid_input', 'ids');
  end if;
  if exists (select 1 from public.files f where f.id = any (p_ids) and not private.purgeable(f.purpose)) then
    perform private.fail('not_purgeable');
  end if;
  if exists (select 1 from unnest(p_ids) x (fid)
             left join public.files f on f.id = x.fid
             where f.id is null or f.status <> 'uploaded' or not private.file_backed_up(f)) then
    perform private.fail('not_backed_up');
  end if;
  perform set_config('app.reason', 'purged after a verified backup', true);
  return query
    update public.files f set status = 'deleted', archived_at = now()
    where f.id = any (p_ids)
    returning f.id, f.object_key;
end;
$$;

------------------------------------------------------------------------------
-- Sales targets (optional; Admin → Settings → Sales → targets)
------------------------------------------------------------------------------
create table public.sales_targets (
  staff_id uuid not null references public.staff (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  metric text not null check (metric in ('converted', 'agreed_paise', 'calls')),
  target bigint not null check (target > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (staff_id, month, metric)
);
alter table public.sales_targets enable row level security;
grant select on public.sales_targets to authenticated;
create policy sales_targets_select on public.sales_targets for select to authenticated
  using ((select private.has_role('admin', 'sales_manager')) or staff_id = (select private.my_staff_id()));
create trigger sales_targets_touch before update on public.sales_targets
  for each row execute function private.touch_updated();
create trigger sales_targets_audit after insert or update or delete on public.sales_targets
  for each row execute function private.audit_row();

-- Target vs actual for one person and month (actuals as in the sales dashboards).
create function private.sales_target_progress(p_staff uuid, p_month date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with b as (select private.ist_at(p_month, '00:00') as lo, private.ist_at((p_month + interval '1 month')::date, '00:00') as hi),
  actual as (
    select
      (select count(*) from public.leads l, b where l.assigned_to = p_staff and l.deleted_at is null
         and l.converted_at >= b.lo and l.converted_at < b.hi) as converted,
      (select coalesce(sum(l.amount_finalised_paise), 0) from public.leads l, b where l.assigned_to = p_staff and l.deleted_at is null
         and l.amount_finalised_at >= b.lo and l.amount_finalised_at < b.hi) as agreed_paise,
      (select count(*) from public.call_logs c, b where c.staff_id = p_staff and c.started_at >= b.lo and c.started_at < b.hi) as calls
  )
  select jsonb_build_object(
    'month', p_month,
    'converted', jsonb_build_object('target', (select t.target from public.sales_targets t where t.staff_id = p_staff and t.month = p_month and t.metric = 'converted'), 'actual', a.converted),
    'agreed_paise', jsonb_build_object('target', (select t.target from public.sales_targets t where t.staff_id = p_staff and t.month = p_month and t.metric = 'agreed_paise'), 'actual', a.agreed_paise),
    'calls', jsonb_build_object('target', (select t.target from public.sales_targets t where t.staff_id = p_staff and t.month = p_month and t.metric = 'calls'), 'actual', a.calls))
  from actual a;
$$;

create function public.set_sales_target(p_staff_id uuid, p_month date, p_metric text, p_target bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month::timestamp)::date;
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  if p_month is null or p_metric not in ('converted', 'agreed_paise', 'calls') or p_target < 0 then
    perform private.fail('invalid_input');
  end if;
  if not exists (select 1 from public.staff s where s.id = p_staff_id and s.role in ('sales_executive', 'sales_manager')) then
    perform private.fail('not_found');
  end if;
  if coalesce(p_target, 0) = 0 then
    delete from public.sales_targets where staff_id = p_staff_id and month = v_month and metric = p_metric;
  else
    insert into public.sales_targets (staff_id, month, metric, target) values (p_staff_id, v_month, p_metric, p_target)
    on conflict (staff_id, month, metric) do update set target = excluded.target;
  end if;
  return private.sales_target_progress(p_staff_id, v_month);
end;
$$;

-- Everyone in sales with their targets and progress for a month (admin sets, manager watches).
create function public.sales_targets_month(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', coalesce(p_month, (private.ist(now()))::date)::timestamp)::date;
begin
  perform private.require_staff(array['admin', 'sales_manager']::public.staff_role[]);
  return jsonb_build_object(
    'month', v_month,
    'enabled', (private.setting('sales', 'targets_enabled', 'false'))::boolean,
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('staff_id', s.id, 'name', s.full_name, 'role', s.role)
                       || private.sales_target_progress(s.id, v_month) order by s.full_name)
      from public.staff s where s.active and s.role in ('sales_executive', 'sales_manager')), '[]'::jsonb));
end;
$$;

-- Sales executive "My day": now with this month's targets when the clinic uses them.
create or replace function public.dashboard_sales_exec(p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['sales_executive', 'sales_manager']::public.staff_role[]);
  v_today date := (private.ist(now()))::date;
  v_from date := coalesce(p_from, date_trunc('month', v_today::timestamp)::date);
  v_to date := coalesce(p_to, v_today);
  v_lo timestamptz := private.ist_at(v_today, '00:00');
  v_hi timestamptz := private.ist_at(v_today + 1, '00:00');
begin
  perform private.check_range(v_from, v_to);
  return jsonb_build_object(
    'date', v_today, 'from', v_from, 'to', v_to,
    'today', (
      select jsonb_build_object(
        'calls', count(*), 'connected', count(*) filter (where c.outcome = 'connected'),
        'talk_s', coalesce(sum(c.duration_s), 0))
      from public.call_logs c where c.staff_id = v_me and c.started_at >= v_lo and c.started_at < v_hi)
      || jsonb_build_object(
        'followups_due', (select count(*) from public.followups f where f.assigned_to = v_me and f.status = 'open' and f.due_date = v_today),
        'followups_overdue', (select count(*) from public.followups f where f.assigned_to = v_me and f.status = 'open' and f.due_date < v_today),
        'booked', (select count(*) from public.appointments a
                   where a.booked_by = v_me and a.created_at >= v_lo and a.created_at < v_hi and a.rescheduled_from_id is null),
        'pending_confirmations', (select count(*) from public.appointments a
                                  where a.status = 'pending_confirmation' and a.slot_start > now()
                                    and a.lead_id in (select l.id from public.leads l where l.assigned_to = v_me and l.deleted_at is null))),
    'month', private.sales_tiles(v_from, v_to, array[v_me]),
    'target', case when (private.setting('sales', 'targets_enabled', 'false'))::boolean
                   then private.sales_target_progress(v_me, date_trunc('month', v_today::timestamp)::date) end,
    'calls_per_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'calls', coalesce(x.calls, 0), 'connected', coalesce(x.connected, 0))
                       order by d.day)
      from (select (v_today - g)::date as day from generate_series(0, 13) g) d
      left join (
        select (private.ist(c.started_at))::date as day, count(*) as calls, count(*) filter (where c.outcome = 'connected') as connected
        from public.call_logs c
        where c.staff_id = v_me and c.started_at >= private.ist_at(v_today - 13, '00:00') and c.started_at < v_hi
        group by 1
      ) x on x.day = d.day), '[]'::jsonb),
    'funnel', private.lead_funnel(v_from, v_to, array[v_me]));
end;
$$;

------------------------------------------------------------------------------
-- Admin dashboard (PLAN.md B6): one call, tiles vs the previous period, every section.
------------------------------------------------------------------------------
-- Money and activity for a range: closed days from the rollup, today live (private.kpi_range).
create function private.admin_kpis(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with k as materialized (select * from private.kpi_range(p_from, p_to)),
  b as (select private.ist_at(p_from, '00:00') as lo, private.ist_at(p_to + 1, '00:00') as hi),
  m as (select metric, sum(value) as v from k where dim_kind = 'clinic' group by metric),
  wa as (
    select count(*) filter (where w.status in ('sent', 'delivered', 'read')) as sent,
           count(*) filter (where w.status in ('delivered', 'read')) as delivered,
           count(*) filter (where w.status = 'read') as read,
           coalesce(sum(w.est_cost_paise) filter (where w.status in ('sent', 'delivered', 'read')), 0) as cost
    from public.wa_messages w, b
    where w.direction = 'outbound' and w.created_at >= b.lo and w.created_at < b.hi
  )
  select jsonb_build_object(
    'revenue_paise', coalesce((select v from m where metric = 'revenue_paise'), 0),
    'collected_paise', coalesce((select v from m where metric = 'collected_paise'), 0),
    'refunds_paise', coalesce((select v from m where metric = 'refunds_paise'), 0),
    'discount_paise', coalesce((select v from m where metric = 'discount_paise'), 0),
    'bills', coalesce((select sum(value) from k where metric = 'bills_count'), 0),
    'new_patients', coalesce((select v from m where metric = 'new_patients'), 0),
    'returning_patients', (
      select count(distinct a.patient_id) from public.appointments a join public.patients p on p.id = a.patient_id, b
      where a.appt_date between p_from and p_to and a.arrived_at is not null and p.created_at < b.lo),
    'appointments', coalesce((select v from m where metric = 'appointments_count'), 0),
    'no_shows', coalesce((select v from m where metric = 'no_show_count'), 0),
    'admissions', coalesce((select v from m where metric = 'admissions_count'), 0),
    'discharges', coalesce((select v from m where metric = 'discharges_count'), 0),
    'stay_days', coalesce((select v from m where metric = 'stay_days'), 0),
    'pharmacy_sales_paise', coalesce((select v from m where metric = 'pharmacy_sales_paise'), 0),
    'pharmacy_margin_paise', coalesce((select v from m where metric = 'pharmacy_taxable_paise'), 0)
                             - coalesce((select v from m where metric = 'pharmacy_cogs_paise'), 0),
    'wa_sent', wa.sent, 'wa_delivered', wa.delivered, 'wa_read', wa.read, 'wa_cost_paise', wa.cost,
    'by_bill_type', coalesce((select jsonb_agg(jsonb_build_object('key', k.dim_id, 'paise', k.value) order by k.value desc)
                              from k where k.metric = 'revenue_paise' and k.dim_kind = 'bill_type'), '[]'::jsonb),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object('key', k.dim_id, 'label', c.label, 'paise', k.value) order by k.value desc)
      from k left join public.lookup_values c on c.kind = 'bill_category' and (c.code = k.dim_id or c.id::text = k.dim_id)
      where k.metric = 'revenue_paise' and k.dim_kind = 'category'), '[]'::jsonb),
    'by_mode', coalesce((
      select jsonb_agg(jsonb_build_object('key', k.dim_id, 'label', md.label, 'paise', k.value) order by k.value desc)
      from k left join public.lookup_values md on md.kind = 'payment_mode' and (md.code = k.dim_id or md.id::text = k.dim_id)
      where k.metric = 'collected_paise' and k.dim_kind = 'mode'), '[]'::jsonb),
    'by_doctor', coalesce((
      select jsonb_agg(jsonb_build_object('doctor_id', d.id, 'name', coalesce(d.display_name, d.full_name),
                                          'appointments', coalesce(ap.value, 0), 'revenue_paise', coalesce(rv.value, 0))
                       order by coalesce(rv.value, 0) desc, coalesce(ap.value, 0) desc)
      from public.doctors d
      left join k ap on ap.metric = 'appointments_count' and ap.dim_kind = 'doctor' and ap.dim_id = d.id::text
      left join k rv on rv.metric = 'revenue_paise' and rv.dim_kind = 'doctor' and rv.dim_id = d.id::text
      where ap.value is not null or rv.value is not null), '[]'::jsonb))
  from wa;
$$;

-- Agreed (Amount finalised) vs billed for leads converted in a window, per salesperson (as in
-- dashboard_sales_manager).
create function private.agreed_vs_billed(p_lo timestamptz, p_hi timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with conv as (
    select distinct on (l.patient_id) l.patient_id, l.assigned_to, l.amount_finalised_paise, l.created_at
    from public.leads l
    where l.converted_at >= p_lo and l.converted_at < p_hi and l.deleted_at is null and l.patient_id is not null
    order by l.patient_id, l.converted_at desc
  ), billed as (
    select c.patient_id, sum(b.total_paise) as paise
    from conv c join public.bills b on b.patient_id = c.patient_id and b.status = 'finalized' and b.bill_at >= c.created_at
    group by c.patient_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('staff_id', x.assigned_to, 'name', s.full_name, 'agreed_paise', x.agreed,
                                               'billed_paise', x.billed, 'patients', x.n) order by x.agreed desc), '[]'::jsonb)
  from (
    select c.assigned_to, sum(coalesce(c.amount_finalised_paise, 0)) as agreed, sum(coalesce(bl.paise, 0)) as billed, count(*) as n
    from conv c left join billed bl on bl.patient_id = c.patient_id
    group by c.assigned_to
  ) x left join public.staff s on s.id = x.assigned_to;
$$;

create function public.dashboard_admin(p_from date, p_to date, p_compare boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_bucket text;
  v_today date := (private.ist(now()))::date;
  v_lo timestamptz;
  v_hi timestamptz;
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  perform private.check_range(p_from, p_to);
  v_days := p_to - p_from + 1;
  v_bucket := case when v_days <= 31 then 'day' when v_days <= 120 then 'week' else 'month' end;
  v_lo := private.ist_at(p_from, '00:00');
  v_hi := private.ist_at(p_to + 1, '00:00');
  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'bucket', v_bucket,
    'kpis', private.admin_kpis(p_from, p_to),
    'previous', case when p_compare then private.admin_kpis(p_from - v_days, p_from - 1) - array['by_bill_type', 'by_category', 'by_mode', 'by_doctor'] end,
    -- Revenue and collections per day / week / month (closed days from the rollup, today live).
    'trend', (
      with days as (
        select d.day, d.metric, d.value from public.kpi_daily d
        where d.day between p_from and least(p_to, v_today - 1) and d.dim_kind = 'clinic'
          and d.metric in ('revenue_paise', 'collected_paise')
        union all
        select v_today, c.metric, c.value from private.kpi_compute_day(v_today) c
        where v_today between p_from and p_to and c.dim_kind = 'clinic' and c.metric in ('revenue_paise', 'collected_paise')
      ), buckets as (
        select g::date as bucket from generate_series(date_trunc(v_bucket, p_from::timestamp), p_to::timestamp, ('1 ' || v_bucket)::interval) g
      )
      select jsonb_agg(jsonb_build_object(
               'bucket', bk.bucket,
               'revenue_paise', coalesce((select sum(x.value) from days x where x.metric = 'revenue_paise'
                                            and date_trunc(v_bucket, x.day::timestamp)::date = bk.bucket), 0),
               'collected_paise', coalesce((select sum(x.value) from days x where x.metric = 'collected_paise'
                                              and date_trunc(v_bucket, x.day::timestamp)::date = bk.bucket), 0))
             order by bk.bucket)
      from buckets bk),
    -- Who owes money now, by the age of the oldest bill not yet covered by payments.
    'outstanding', (
      with billed as (
        select b.patient_id, b.bill_at, sum(b.total_paise) over (partition by b.patient_id order by b.bill_at, b.id) as running
        from public.bills b where b.status = 'finalized'
      ), received as (
        select p.patient_id, sum(case when p.kind = 'refund' then -p.amount_paise else p.amount_paise end) as paid
        from public.payments p where p.cancelled_at is null group by p.patient_id
      ), owing as (
        select bl.patient_id, max(bl.running) - coalesce(max(r.paid), 0) as due,
               min(bl.bill_at) filter (where bl.running > coalesce(r.paid, 0)) as oldest
        from billed bl left join received r on r.patient_id = bl.patient_id
        group by bl.patient_id
      ), aged as (
        select o.due, case when v_today - (private.ist(o.oldest))::date <= 30 then '0_30'
                           when v_today - (private.ist(o.oldest))::date <= 60 then '31_60'
                           when v_today - (private.ist(o.oldest))::date <= 90 then '61_90' else '90_plus' end as bucket
        from owing o where o.due > 0
      )
      select jsonb_build_object(
        'total_paise', coalesce((select sum(due) from aged), 0),
        'patients', (select count(*) from aged),
        'ageing', (select jsonb_agg(jsonb_build_object('bucket', bk, 'paise', coalesce((select sum(a.due) from aged a where a.bucket = bk), 0),
                                                       'patients', (select count(*) from aged a where a.bucket = bk)) order by ord)
                   from unnest(array['0_30', '31_60', '61_90', '90_plus']) with ordinality u (bk, ord)))),
    -- Sessions planned in the range: on time (within 3 days), late, missed, overdue, upcoming.
    'sessions', (
      select jsonb_build_object(
        'on_time', count(*) filter (where s.status = 'done' and s.actual_date <= s.planned_date + 3),
        'late', count(*) filter (where s.status = 'done' and s.actual_date > s.planned_date + 3),
        'missed', count(*) filter (where s.status in ('missed', 'skipped')),
        'overdue', count(*) filter (where s.status in ('planned', 'booked') and s.planned_date < v_today),
        'upcoming', count(*) filter (where s.status in ('planned', 'booked') and s.planned_date >= v_today))
      from public.treatment_sessions s where s.planned_date between p_from and p_to),
    -- Billed revenue by where the patient first came from (their lead's source).
    'by_source', coalesce((
      select jsonb_agg(jsonb_build_object('source_id', x.source_id, 'label', lv.label, 'paise', x.paise, 'patients', x.n)
                       order by x.paise desc)
      from (
        select ls.source_id, sum(b.total_paise) as paise, count(distinct b.patient_id) as n
        from public.bills b
        join public.patients p on p.id = b.patient_id
        left join lateral (
          select l.source_id from public.leads l
          where (l.id = p.lead_id or l.patient_id = p.id) and l.deleted_at is null
          order by (l.id = p.lead_id) desc, l.created_at limit 1
        ) ls on true
        where b.status = 'finalized' and b.bill_at >= v_lo and b.bill_at < v_hi
        group by ls.source_id
      ) x left join public.lookup_values lv on lv.id = x.source_id), '[]'::jsonb),
    'funnel', private.lead_funnel(p_from, p_to, null),
    'agreed_vs_billed', private.agreed_vs_billed(v_lo, v_hi),
    'top_medicines', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', x.item_id, 'name', it.name, 'qty', x.qty, 'paise', x.paise) order by x.paise desc)
      from (
        select i.pharmacy_item_id as item_id, sum(i.qty) as qty, sum(i.total_paise) as paise
        from public.bills b join public.bill_items i on i.bill_id = b.id and i.kind = 'pharmacy'
        where b.status = 'finalized' and b.bill_at >= v_lo and b.bill_at < v_hi
        group by i.pharmacy_item_id order by sum(i.total_paise) desc limit 10
      ) x left join public.pharmacy_items it on it.id = x.item_id), '[]'::jsonb),
    'pharmacy_stock', (
      select jsonb_build_object(
        'stock_value_paise', coalesce(sum(round(qty_on_hand * purchase_price_paise)) filter (where expiry_date >= v_today), 0),
        'near_expiry_value_paise', coalesce(sum(round(qty_on_hand * purchase_price_paise))
          filter (where expiry_date >= v_today and expiry_date <= v_today + 90), 0))
      from public.item_batches where qty_on_hand > 0),
    'bdm', jsonb_build_object(
      'on_duty', (select count(*) from public.bdm_days d where d.work_date = v_today and d.ended_at is null),
      'total', (select count(*) from public.staff s where s.role = 'bdm' and s.active),
      'people', coalesce((
        select jsonb_agg(jsonb_build_object('staff_id', s.id, 'name', s.full_name, 'days', x.days, 'visits', x.visits,
                                            'leads', x.leads, 'km', round(x.metres / 1000.0, 1)) order by x.visits desc, s.full_name)
        from (
          select d.staff_id, count(*) as days,
                 sum((select count(*) from public.site_visits v where v.day_id = d.id and v.completed_at is not null)) as visits,
                 sum((select count(*) from public.site_visits v where v.day_id = d.id and v.lead_id is not null)) as leads,
                 sum(coalesce((coalesce(d.summary, private.bdm_day_summary(d.id)) ->> 'distance_m')::numeric, 0)) as metres
          from public.bdm_days d where d.work_date between p_from and p_to
          group by d.staff_id
        ) x join public.staff s on s.id = x.staff_id), '[]'::jsonb)),
    'storage', private.storage_usage(),
    'backup', jsonb_build_object(
      'last_files_at', (select max(i.verified_at) from public.backup_items i where i.file_id is not null),
      'last_export_at', (select max(b.finished_at) from public.backup_batches b where b.kind = 'database' and b.status = 'done')),
    'integrations', coalesce((
      select jsonb_agg(jsonb_build_object('integration', i.integration, 'state', i.state, 'last_ok_at', i.last_ok_at,
                                          'last_error', i.last_error, 'checked_at', i.checked_at) order by i.integration)
      from public.integration_status i), '[]'::jsonb));
end;
$$;

------------------------------------------------------------------------------
-- Daily summary (evening email + a bell entry for the admins)
------------------------------------------------------------------------------
create function private.daily_summary_data(p_day date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with k as materialized (select * from private.kpi_compute_day(p_day)),
  b as (select private.ist_at(p_day, '00:00') as lo, private.ist_at(p_day + 1, '00:00') as hi)
  select jsonb_build_object(
    'date', p_day,
    'revenue_paise', coalesce((select sum(value) from k where metric = 'revenue_paise' and dim_kind = 'clinic'), 0),
    'collected_paise', coalesce((select sum(value) from k where metric = 'collected_paise' and dim_kind = 'clinic'), 0),
    'bills', coalesce((select sum(value) from k where metric = 'bills_count'), 0),
    'by_mode', coalesce((
      select jsonb_agg(jsonb_build_object('label', coalesce(m.label, k.dim_id), 'paise', k.value) order by k.value desc)
      from k left join public.lookup_values m on m.kind = 'payment_mode' and (m.code = k.dim_id or m.id::text = k.dim_id)
      where k.metric = 'collected_paise' and k.dim_kind = 'mode'), '[]'::jsonb),
    'appointments', coalesce((select sum(value) from k where metric = 'appointments_count' and dim_kind = 'clinic'), 0),
    'arrived', coalesce((select sum(value) from k where metric = 'arrived_count'), 0),
    'no_shows', coalesce((select sum(value) from k where metric = 'no_show_count'), 0),
    'new_patients', coalesce((select sum(value) from k where metric = 'new_patients'), 0),
    'pharmacy_sales_paise', coalesce((select sum(value) from k where metric = 'pharmacy_sales_paise'), 0),
    'admissions', coalesce((select sum(value) from k where metric = 'admissions_count'), 0),
    'new_leads', (select count(*) from public.leads l where l.lead_date = p_day and l.deleted_at is null),
    'converted', (select count(*) from public.leads l, b where l.converted_at >= b.lo and l.converted_at < b.hi and l.deleted_at is null),
    'bdm_days', (select count(*) from public.bdm_days d where d.work_date = p_day),
    'bdm_visits', (select count(*) from public.site_visits v, b where v.completed_at >= b.lo and v.completed_at < b.hi),
    'followups_overdue', (select count(*) from public.followups f where f.status = 'open' and f.due_date < p_day),
    'stock_alerts', (select count(*) from public.stock_alerts a where a.cleared_at is null),
    'storage_pct', (private.storage_usage() ->> 'pct')::numeric);
$$;

create function public.daily_summary_payload(p_day date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'data', private.daily_summary_data(p_day),
    'clinic', (select c.name from public.clinic_settings c order by c.branch_code = 'main' desc limit 1),
    'recipients', coalesce((
      select jsonb_agg(distinct jsonb_build_object('email', lower(x.email), 'name', x.name))
      from (
        select s.email, s.full_name as name from public.staff s where s.role = 'admin' and s.active and s.email is not null
        union all
        select e, null from jsonb_array_elements_text(private.setting('notifications', 'extra_recipients', '[]')) e
      ) x), '[]'::jsonb));
$$;

-- Every 15 minutes: once the summary time has passed today, send it (once a day).
create function private.daily_summary_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamp := private.ist(now());
  v_day date := v_now::date;
  v_run bigint;
  v_data jsonb;
begin
  if not (private.setting('notifications', 'daily_summary_enabled', 'true'))::boolean
     or to_char(v_now, 'HH24:MI') < private.setting('notifications', 'daily_summary_time', '"20:00"') #>> '{}' then
    return;
  end if;
  -- One per day (the row is the lock; concurrent ticks wait on it).
  perform pg_advisory_xact_lock(hashtext('daily-summary'));
  if exists (select 1 from public.job_runs j where j.job = 'daily-summary' and j.started_at >= private.ist_at(v_day, '00:00')) then
    return;
  end if;
  insert into public.job_runs (job, detail) values ('daily-summary', jsonb_build_object('date', v_day)) returning id into v_run;
  v_data := private.daily_summary_data(v_day);
  insert into public.notifications (recipient_id, type, title, body, link, dedupe_key)
  select s.id, 'daily_summary', 'Today at the clinic',
         format('Billed ₹%s · collected ₹%s · %s patients seen · %s new leads',
                to_char((v_data ->> 'revenue_paise')::numeric / 100, 'FM99,99,99,990.00'),
                to_char((v_data ->> 'collected_paise')::numeric / 100, 'FM99,99,99,990.00'),
                v_data ->> 'arrived', v_data ->> 'new_leads'),
         '/dashboard', 'daily_summary:' || v_day || ':' || s.id
  from public.staff s where s.role = 'admin' and s.active
  on conflict (dedupe_key) do nothing;
  perform private.call_edge('daily-summary', jsonb_build_object('date', v_day, 'run_id', v_run));
end;
$$;

create function public.daily_summary_done(p_run_id bigint, p_ok boolean, p_detail jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.job_runs set finished_at = now(), ok = coalesce(p_ok, false), detail = detail || coalesce(p_detail, '{}'::jsonb)
  where id = p_run_id and job = 'daily-summary';
$$;

------------------------------------------------------------------------------
-- Privileges and schedules (pg_cron runs in UTC)
------------------------------------------------------------------------------
revoke execute on function public.email_payload(uuid), public.job_run_log(text, boolean, jsonb),
  public.daily_summary_payload(date), public.daily_summary_done(bigint, boolean, jsonb)
from public, anon, authenticated;
grant execute on function public.email_payload(uuid), public.job_run_log(text, boolean, jsonb),
  public.daily_summary_payload(date), public.daily_summary_done(bigint, boolean, jsonb)
to service_role;

-- 02:00 IST housekeeping; every 15 min the daily-summary check; Monday 10:00 IST backup reminder.
select cron.schedule('housekeeping', '30 20 * * *', $$select private.housekeeping()$$);
select cron.schedule('daily-summary', '*/15 * * * *', $$select private.daily_summary_tick()$$);
select cron.schedule('backup-reminder', '30 4 * * 1', $$select private.backup_reminder()$$);

alter default privileges revoke execute on functions from public;
select private.lock_down_public_functions();
