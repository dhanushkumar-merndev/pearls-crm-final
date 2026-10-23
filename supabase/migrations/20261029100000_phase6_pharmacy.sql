-- Phase 6: pharmacy and inventory (PLAN.md C2 "Pharmacy", C6 "Stock").
-- Stock = sum of movements. item_batches.qty_on_hand is a cache kept by a trigger on the
-- append-only stock_movements ledger and re-checked nightly.

create type public.stock_move_kind as enum (
  'opening', 'purchase', 'sale', 'sale_cancel', 'patient_return', 'damaged', 'expired', 'supplier_return', 'count_correction');

------------------------------------------------------------------------------
-- Suppliers (master data: reception and admin write directly; also a picker kind)
------------------------------------------------------------------------------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  gstin text check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  phone text check (length(phone) <= 40),
  contact_name text check (length(contact_name) <= 120),
  address text check (length(address) <= 400),
  active boolean not null default true,
  usage_count integer not null default 0,
  last_used_at timestamptz,
  created_on_the_fly boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create unique index suppliers_name on public.suppliers (lower(name));
create index suppliers_trgm on public.suppliers using gin (name extensions.gin_trgm_ops);
create index suppliers_rank on public.suppliers (usage_count desc, lower(name), id) where active;
create trigger suppliers_touch before update on public.suppliers for each row execute function private.touch_updated();
create trigger suppliers_audit after insert or update or delete on public.suppliers for each row execute function private.audit_row();

------------------------------------------------------------------------------
-- Batches and the stock ledger
------------------------------------------------------------------------------
-- Expiry is a month on the strip; stored as that month's last day (sellable through it).
create function private.month_end(p_date date)
returns date
language sql
immutable
parallel safe
as $$
  select (date_trunc('month', p_date) + interval '1 month - 1 day')::date;
$$;

create table public.item_batches (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.pharmacy_items (id),
  batch_no text not null check (length(btrim(batch_no)) between 1 and 40),
  expiry_date date not null check (expiry_date = private.month_end(expiry_date)),
  mrp_paise bigint not null default 0 check (mrp_paise >= 0),
  purchase_price_paise bigint not null default 0 check (purchase_price_paise >= 0),
  selling_price_paise bigint not null default 0 check (selling_price_paise >= 0),
  supplier_id uuid references public.suppliers (id),
  qty_on_hand numeric(12, 3) not null default 0,
  created_at timestamptz not null default now(),
  unique (item_id, batch_no, expiry_date)
);
-- FEFO lookups and expiry scans touch only batches that still hold stock.
create index item_batches_fefo on public.item_batches (item_id, expiry_date, created_at) where qty_on_hand > 0;
create index item_batches_expiry on public.item_batches (expiry_date) where qty_on_hand > 0;

alter table public.bill_items
  add constraint bill_items_batch_id_fkey foreign key (batch_id) references public.item_batches (id);
comment on constraint bill_items_batch_id_fkey on public.bill_items is 'merge:keep';
create index bill_items_batch on public.bill_items (batch_id) where batch_id is not null;
-- Cost of the units sold, frozen on the line (margin reports must not move when a batch is re-priced).
alter table public.bill_items add column unit_cost_paise bigint check (unit_cost_paise >= 0);

create table public.stock_movements (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.item_batches (id),
  kind public.stock_move_kind not null,
  qty numeric(12, 3) not null check (qty <> 0),
  ref_table text check (ref_table in ('bills', 'purchases', 'adjustments', 'import')),
  ref_id uuid,
  reason text check (length(reason) <= 300),
  client_id uuid unique,
  at timestamptz not null default now(),
  by_staff uuid default auth.uid(),
  -- The sign follows the kind; a count correction is the signed difference.
  check (kind = 'count_correction'
         or kind in ('opening', 'purchase', 'sale_cancel', 'patient_return') and qty > 0
         or kind in ('sale', 'damaged', 'expired', 'supplier_return') and qty < 0)
);
create index stock_movements_batch on public.stock_movements (batch_id, id desc);
create index stock_movements_ref on public.stock_movements (ref_id, batch_id) where ref_id is not null;

create function private.stock_ledger_guard()
returns trigger
language plpgsql
as $$
begin
  raise exception using errcode = 'P0001', message = 'not_allowed', detail = 'the stock ledger is append-only';
end;
$$;
create trigger stock_movements_append_only before update or delete on public.stock_movements
  for each row execute function private.stock_ledger_guard();
create trigger stock_movements_no_truncate before truncate on public.stock_movements
  for each statement execute function private.stock_ledger_guard();

create function private.stock_apply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.item_batches set qty_on_hand = qty_on_hand + new.qty where id = new.batch_id;
  return null;
end;
$$;
create trigger stock_movements_apply after insert on public.stock_movements
  for each row execute function private.stock_apply();

------------------------------------------------------------------------------
-- Purchases (supplier invoices). Posting turns lines into batches + movements.
------------------------------------------------------------------------------
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id),
  invoice_no text not null check (length(btrim(invoice_no)) between 1 and 60),
  invoice_date date not null,
  status text not null default 'draft' check (status in ('draft', 'posted')),
  total_paise bigint not null default 0,
  notes text check (length(notes) <= 500),
  version integer not null default 1,
  posted_at timestamptz,
  posted_by uuid references public.staff (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create unique index purchases_invoice on public.purchases (supplier_id, lower(invoice_no));
create index purchases_list on public.purchases (invoice_date desc, id);
create trigger purchases_touch before update on public.purchases for each row execute function private.touch_updated();
create trigger purchases_audit after insert or update or delete on public.purchases for each row execute function private.audit_row();

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases (id) on delete cascade,
  line_no smallint not null check (line_no >= 1),
  item_id uuid not null references public.pharmacy_items (id),
  batch_no text not null check (length(btrim(batch_no)) between 1 and 40),
  expiry_date date not null check (expiry_date = private.month_end(expiry_date)),
  qty numeric(12, 3) not null check (qty > 0),
  free_qty numeric(12, 3) not null default 0 check (free_qty >= 0),
  purchase_price_paise bigint not null check (purchase_price_paise >= 0), -- per unit, before GST
  mrp_paise bigint not null default 0 check (mrp_paise >= 0),
  selling_price_paise bigint not null default 0 check (selling_price_paise >= 0),
  gst_rate_bp integer not null default 0 check (gst_rate_bp between 0 and 4000),
  line_total_paise bigint not null default 0,
  batch_id uuid references public.item_batches (id),
  unique (purchase_id, line_no)
);
create index purchase_items_item on public.purchase_items (item_id);

------------------------------------------------------------------------------
-- Alerts: one open row per condition, so an alert fires once and clears on its own.
------------------------------------------------------------------------------
create table public.stock_alerts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.pharmacy_items (id),
  batch_id uuid references public.item_batches (id),
  alert text not null check (alert in ('low', 'near_expiry', 'expired')),
  threshold_days integer not null default 0,
  detail jsonb not null default '{}'::jsonb,
  fired_at timestamptz not null default now(),
  cleared_at timestamptz
);
create unique index stock_alerts_open on public.stock_alerts
  (item_id, coalesce(batch_id, '00000000-0000-0000-0000-000000000000'::uuid), alert, threshold_days) where cleared_at is null;
create index stock_alerts_open_list on public.stock_alerts (alert, fired_at desc) where cleared_at is null;

------------------------------------------------------------------------------
-- Row Level Security: pharmacy is reception + admin (PLAN.md C7). Only suppliers take
-- direct writes; everything else changes through the functions below.
------------------------------------------------------------------------------
alter table public.suppliers enable row level security;
alter table public.item_batches enable row level security;
alter table public.stock_movements enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.stock_alerts enable row level security;
grant select, insert, update on public.suppliers to authenticated;
grant select on public.item_batches, public.stock_movements, public.purchases, public.purchase_items, public.stock_alerts
  to authenticated;
create policy suppliers_select on public.suppliers for select to authenticated
  using ((select private.has_role('receptionist', 'admin')));
create policy suppliers_insert on public.suppliers for insert to authenticated
  with check ((select private.has_role('receptionist', 'admin')));
create policy suppliers_update on public.suppliers for update to authenticated
  using ((select private.has_role('receptionist', 'admin'))) with check ((select private.has_role('receptionist', 'admin')));
create policy item_batches_select on public.item_batches for select to authenticated
  using ((select private.has_role('receptionist', 'admin')));
create policy stock_movements_select on public.stock_movements for select to authenticated
  using ((select private.has_role('receptionist', 'admin')));
create policy purchases_select on public.purchases for select to authenticated
  using ((select private.has_role('receptionist', 'admin')));
create policy purchase_items_select on public.purchase_items for select to authenticated
  using ((select private.has_role('receptionist', 'admin')));
create policy stock_alerts_select on public.stock_alerts for select to authenticated
  using ((select private.has_role('receptionist', 'admin')));

------------------------------------------------------------------------------
-- Library registry: suppliers become a picker kind; pharmacy items show stock on hand.
------------------------------------------------------------------------------
create or replace function private.library_spec(p_kind text)
returns table (
  tbl text, label_col text, lookup_kind text,
  search_roles public.staff_role[], create_roles public.staff_role[]
)
language sql
immutable
as $$
  select s.tbl, s.label_col, s.lookup_kind, s.search_roles, s.create_roles
  from (values
    ('service', 'services', 'name', null::text,
      array['receptionist', 'admin']::public.staff_role[], array['receptionist', 'admin']::public.staff_role[]),
    ('treatment_template', 'treatment_templates', 'name', null,
      array['receptionist', 'sales_executive', 'sales_manager', 'bdm', 'admin']::public.staff_role[],
      array['receptionist', 'admin']::public.staff_role[]),
    ('room_type', 'room_types', 'name', null,
      array['receptionist', 'admin']::public.staff_role[], array['admin']::public.staff_role[]),
    ('pharmacy_item', 'pharmacy_items', 'name', null,
      array['receptionist', 'admin']::public.staff_role[], array['receptionist', 'admin']::public.staff_role[]),
    ('supplier', 'suppliers', 'name', null,
      array['receptionist', 'admin']::public.staff_role[], array['receptionist', 'admin']::public.staff_role[]),
    ('doctor', 'doctors', 'full_name', null,
      array['receptionist', 'sales_executive', 'sales_manager', 'admin']::public.staff_role[], '{}'::public.staff_role[])
  ) as s (kind, tbl, label_col, lookup_kind, search_roles, create_roles)
  where s.kind = p_kind
  union all
  select 'lookup_values', 'label', l.kind, l.search_roles, l.create_roles
  from (values
    ('lead_source', array['receptionist', 'sales_executive', 'sales_manager', 'bdm', 'admin']::public.staff_role[],
                    array['receptionist', 'sales_executive', 'sales_manager', 'admin']::public.staff_role[]),
    ('lost_reason', array['sales_executive', 'sales_manager', 'admin']::public.staff_role[],
                    array['sales_executive', 'sales_manager', 'admin']::public.staff_role[]),
    ('referral_name', array['receptionist', 'sales_executive', 'sales_manager', 'bdm', 'admin']::public.staff_role[],
                      array['receptionist', 'sales_executive', 'sales_manager', 'bdm', 'admin']::public.staff_role[]),
    ('bill_category', array['receptionist', 'sales_manager', 'admin']::public.staff_role[],
                      array['admin']::public.staff_role[]),
    ('payment_mode', array['receptionist', 'admin']::public.staff_role[], array['admin']::public.staff_role[]),
    ('relation', array['receptionist', 'admin']::public.staff_role[], array['receptionist', 'admin']::public.staff_role[]),
    ('document_kind', array['receptionist', 'admin']::public.staff_role[], array['receptionist', 'admin']::public.staff_role[]),
    ('quick_reply', array['receptionist', 'sales_executive', 'sales_manager', 'admin']::public.staff_role[],
                    array['sales_manager', 'admin']::public.staff_role[]),
    ('break_type', array['bdm', 'admin']::public.staff_role[], array['admin']::public.staff_role[])
  ) as l (kind, search_roles, create_roles)
  where l.kind = p_kind;
$$;

create or replace function private.library_item(p_kind text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  case p_kind
    when 'service' then
      select jsonb_build_object('id', s.id, 'label', s.name,
        'subtitle', concat_ws(' · ', c.label, nullif(s.sac, '')),
        'on_the_fly', s.created_on_the_fly and s.reviewed_at is null,
        'defaults', jsonb_build_object('price_paise', s.default_price_paise, 'gst_rate_bp', s.gst_rate_bp,
          'sac', s.sac, 'category_id', s.category_id, 'category_code', c.code, 'doctor_id', s.doctor_id,
          'is_doctor_charge', s.is_doctor_charge))
      into v from public.services s left join public.lookup_values c on c.id = s.category_id where s.id = p_id;
    when 'treatment_template' then
      select jsonb_build_object('id', t.id, 'label', t.name, 'subtitle', t.category,
        'on_the_fly', t.created_on_the_fly and t.reviewed_at is null,
        'defaults', jsonb_build_object('category', t.category, 'sessions', t.default_sessions,
          'gap_days', to_jsonb(t.gap_days), 'pricing', t.pricing, 'price_paise', t.default_price_paise,
          'session_minutes', t.session_minutes, 'follow_up_days', t.follow_up_days))
      into v from public.treatment_templates t where t.id = p_id;
    when 'room_type' then
      select jsonb_build_object('id', r.id, 'label', r.name, 'subtitle', null,
        'on_the_fly', r.created_on_the_fly and r.reviewed_at is null,
        'defaults', jsonb_build_object('price_paise', r.daily_rate_paise, 'gst_rate_bp', r.gst_rate_bp, 'sac', r.sac))
      into v from public.room_types r where r.id = p_id;
    when 'pharmacy_item' then
      -- Stock on hand = unexpired batches (one indexed aggregate per picker row; pages hold ≤ 50 rows).
      select jsonb_build_object('id', p.id, 'label', p.name,
        'subtitle', concat_ws(' · ', nullif(p.strength, ''), nullif(p.form, ''), nullif(p.manufacturer, '')),
        'on_the_fly', p.created_on_the_fly and p.reviewed_at is null,
        'defaults', jsonb_build_object('price_paise', p.selling_price_paise, 'mrp_paise', p.mrp_paise,
          'purchase_price_paise', p.purchase_price_paise,
          'gst_rate_bp', p.gst_rate_bp, 'hsn', p.hsn, 'manufacturer', p.manufacturer, 'sell_unit', p.sell_unit,
          'on_hand', coalesce((select sum(b.qty_on_hand) from public.item_batches b
                                where b.item_id = p.id and b.qty_on_hand <> 0
                                  and b.expiry_date >= (private.ist(now()))::date), 0)))
      into v from public.pharmacy_items p where p.id = p_id;
    when 'supplier' then
      select jsonb_build_object('id', s.id, 'label', s.name, 'subtitle', concat_ws(' · ', s.gstin, s.phone),
        'on_the_fly', false, 'defaults', jsonb_build_object('gstin', s.gstin))
      into v from public.suppliers s where s.id = p_id;
    when 'doctor' then
      select jsonb_build_object('id', d.id, 'label', coalesce(d.display_name, d.full_name),
        'subtitle', d.specialization, 'on_the_fly', false,
        'defaults', jsonb_build_object('fee_paise', d.consultation_fee_paise, 'colour_slot', d.colour_slot))
      into v from public.doctors d where d.id = p_id;
    else
      select jsonb_build_object('id', l.id, 'label', l.label, 'subtitle', null,
        'on_the_fly', l.created_on_the_fly and l.reviewed_at is null,
        'defaults', jsonb_build_object('code', l.code))
      into v from public.lookup_values l where l.id = p_id and l.kind = p_kind;
  end case;
  return v;
end;
$$;

create or replace function public.library_create(p_kind text, p_payload jsonb, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_spec record;
  v_label text := btrim(coalesce(p_payload ->> 'label', ''));
  v_id uuid;
  v_price bigint := greatest(coalesce((p_payload ->> 'price_paise')::bigint, 0), 0);
  v_gst integer := coalesce((p_payload ->> 'gst_rate_bp')::integer, 0);
begin
  select * into v_spec from private.library_spec(p_kind);
  if v_spec.tbl is null or cardinality(v_spec.create_roles) = 0 then
    perform private.fail('invalid_input', 'items of this kind cannot be added here');
  end if;
  perform private.require_staff(v_spec.create_roles);
  if length(v_label) = 0 or length(v_label) > 200 then
    perform private.fail('invalid_input', 'name is required');
  end if;
  if p_client_id is null then
    perform private.fail('invalid_input', 'client id is required');
  end if;
  if v_gst < 0 or v_gst > 4000 then
    perform private.fail('invalid_input', 'gst rate');
  end if;

  case p_kind
    when 'service' then
      select id into v_id from public.services where id = p_client_id
         or (lower(name) = lower(v_label) and merged_into_id is null) limit 1;
      if v_id is null then
        insert into public.services (id, name, default_price_paise, gst_rate_bp, category_id, created_on_the_fly)
        values (p_client_id, v_label, v_price, v_gst, (p_payload ->> 'category_id')::uuid, true)
        returning id into v_id;
      end if;
    when 'treatment_template' then
      select id into v_id from public.treatment_templates where id = p_client_id
         or (lower(name) = lower(v_label) and merged_into_id is null) limit 1;
      if v_id is null then
        insert into public.treatment_templates (id, name, default_price_paise, created_on_the_fly)
        values (p_client_id, v_label, v_price, true)
        returning id into v_id;
      end if;
    when 'room_type' then
      select id into v_id from public.room_types where id = p_client_id
         or (lower(name) = lower(v_label) and merged_into_id is null) limit 1;
      if v_id is null then
        insert into public.room_types (id, name, daily_rate_paise, gst_rate_bp, created_on_the_fly)
        values (p_client_id, v_label, v_price, v_gst, true)
        returning id into v_id;
      end if;
    when 'pharmacy_item' then
      select id into v_id from public.pharmacy_items where id = p_client_id
         or (lower(name) = lower(v_label) and strength is null and form is null and merged_into_id is null) limit 1;
      if v_id is null then
        insert into public.pharmacy_items (id, name, selling_price_paise, mrp_paise, gst_rate_bp, created_on_the_fly)
        values (p_client_id, v_label, v_price, v_price, v_gst, true)
        returning id into v_id;
      end if;
    when 'supplier' then
      select id into v_id from public.suppliers where id = p_client_id or lower(name) = lower(v_label) limit 1;
      if v_id is null then
        insert into public.suppliers (id, name, created_on_the_fly) values (p_client_id, v_label, true)
        returning id into v_id;
      end if;
    else
      select id into v_id from public.lookup_values where id = p_client_id
         or (kind = v_spec.lookup_kind and lower(label) = lower(v_label) and merged_into_id is null) limit 1;
      if v_id is null then
        insert into public.lookup_values (id, kind, label, created_on_the_fly)
        values (p_client_id, v_spec.lookup_kind, v_label, true)
        returning id into v_id;
      end if;
  end case;

  return private.library_item(p_kind, v_id);
end;
$$;

create or replace function private.library_used(p_table text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_id is null or p_table not in ('services', 'treatment_templates', 'room_types', 'pharmacy_items', 'lookup_values', 'suppliers') then
    return;
  end if;
  execute format('update public.%I set usage_count = usage_count + 1, last_used_at = now() where id = $1', p_table)
    using p_id;
end;
$$;

------------------------------------------------------------------------------
-- Alerts
------------------------------------------------------------------------------
-- Re-evaluates the alert conditions (for the given items, or all) in one set-based pass:
-- new conditions fire once, conditions that no longer hold are cleared.
create function private.refresh_stock_alerts(p_item_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (private.ist(now()))::date;
  v_days integer[] := array(
    select d::int from jsonb_array_elements_text(private.setting('pharmacy', 'near_expiry_days', '[90, 60, 30]')) d order by 1);
  v_fired integer;
begin
  with stock as (
    select b.item_id, sum(b.qty_on_hand) as on_hand from public.item_batches b
    where b.qty_on_hand > 0 and b.expiry_date >= v_today and (p_item_ids is null or b.item_id = any (p_item_ids))
    group by b.item_id
  ), wanted as (
    select i.id as item_id, null::uuid as batch_id, 'low'::text as alert, 0 as threshold_days,
           jsonb_build_object('on_hand', coalesce(s.on_hand, 0), 'reorder_level', i.reorder_level) as detail
    from public.pharmacy_items i left join stock s on s.item_id = i.id
    where i.active and i.merged_into_id is null and i.reorder_level > 0 and coalesce(s.on_hand, 0) <= i.reorder_level
      and (p_item_ids is null or i.id = any (p_item_ids))
    union all
    select b.item_id, b.id, 'expired', 0, jsonb_build_object('qty', b.qty_on_hand, 'expiry_date', b.expiry_date)
    from public.item_batches b
    where b.qty_on_hand > 0 and b.expiry_date < v_today and (p_item_ids is null or b.item_id = any (p_item_ids))
    union all
    -- The tightest window a batch falls in (30 before 60 before 90): moving closer re-fires once.
    select b.item_id, b.id, 'near_expiry', t.d, jsonb_build_object('qty', b.qty_on_hand, 'expiry_date', b.expiry_date)
    from public.item_batches b
    cross join lateral (select min(d) as d from unnest(v_days) d where b.expiry_date <= v_today + d) t
    where b.qty_on_hand > 0 and b.expiry_date >= v_today and t.d is not null
      and (p_item_ids is null or b.item_id = any (p_item_ids))
  ), cleared as (
    update public.stock_alerts a set cleared_at = now()
    where a.cleared_at is null and (p_item_ids is null or a.item_id = any (p_item_ids))
      and not exists (select 1 from wanted w where w.item_id = a.item_id and w.batch_id is not distinct from a.batch_id
                                               and w.alert = a.alert and w.threshold_days = a.threshold_days)
    returning 1
  ), fired as (
    insert into public.stock_alerts (item_id, batch_id, alert, threshold_days, detail)
    select w.item_id, w.batch_id, w.alert, w.threshold_days, w.detail from wanted w
    where not exists (select 1 from public.stock_alerts a where a.cleared_at is null and a.item_id = w.item_id
                        and a.batch_id is not distinct from w.batch_id and a.alert = w.alert and a.threshold_days = w.threshold_days)
    on conflict (item_id, coalesce(batch_id, '00000000-0000-0000-0000-000000000000'::uuid), alert, threshold_days)
      where cleared_at is null do nothing -- another desk's refresh got there first
    returning 1
  )
  -- Both data-modifying parts always run to completion; only the fired count is needed.
  select count(*) into v_fired from fired;

  -- Bell: one notification per person per day, refreshed (and unread again) when more fire.
  if v_fired > 0 then
    insert into public.notifications (recipient_id, type, title, body, link, data, dedupe_key)
    select s.id, 'stock_alert', 'Pharmacy alerts', null, '/pharmacy?tab=alerts',
           jsonb_build_object('open', (select count(*) from public.stock_alerts where cleared_at is null)),
           format('stock_alert:%s:%s', v_today, s.id)
    from public.staff s where s.active and s.role in ('receptionist', 'admin')
    on conflict (dedupe_key) do update set data = excluded.data, read_at = null, created_at = now();
  end if;
  return v_fired;
end;
$$;

------------------------------------------------------------------------------
-- Selling: bill lines → stock movements
------------------------------------------------------------------------------
-- A pharmacy line names a batch; the server copies the batch's number/expiry and the
-- item's maker/HSN so the bill keeps them even if the master changes later.
create function private.bill_item_batch_fill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.item_batches;
  v_item public.pharmacy_items;
begin
  if new.batch_id is null then
    return new;
  end if;
  select * into v_batch from public.item_batches where id = new.batch_id;
  if not found then
    perform private.fail('not_found', 'batch');
  end if;
  select * into v_item from public.pharmacy_items where id = v_batch.item_id;
  new.kind := 'pharmacy';
  new.pharmacy_item_id := v_batch.item_id;
  new.batch_no := v_batch.batch_no;
  new.expiry_date := v_batch.expiry_date;
  new.unit_cost_paise := v_batch.purchase_price_paise;
  new.mfg := coalesce(new.mfg, v_item.manufacturer);
  new.hsn_sac := coalesce(new.hsn_sac, v_item.hsn);
  new.category_id := coalesce(new.category_id,
    (select id from public.lookup_values where kind = 'bill_category' and code = 'pharmacy' and merged_into_id is null limit 1));
  return new;
end;
$$;
create trigger bill_items_batch_fill before insert or update of batch_id on public.bill_items
  for each row execute function private.bill_item_batch_fill();

-- Makes the stock moved for a bill match its pharmacy lines (all zero when cancelled).
-- Used by finalize, amend and cancel. Batches are locked in id order, so two desks
-- selling the last strip can't both succeed and can't deadlock.
create function private.sync_bill_stock(p_bill_id uuid, p_cancelled boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block boolean := coalesce(private.setting('pharmacy', 'negative_stock', '"block"') #>> '{}', 'block') = 'block';
  v_today date := (private.ist(now()))::date;
  v_batch public.item_batches;
  v_items uuid[] := '{}';
  r record;
begin
  for r in
    with wanted as (
      select i.batch_id, sum(i.qty) as qty from public.bill_items i
      where i.bill_id = p_bill_id and i.batch_id is not null and not p_cancelled
      group by i.batch_id
    ), moved as (
      select m.batch_id, -sum(m.qty) as qty from public.stock_movements m
      where m.ref_id = p_bill_id and m.ref_table = 'bills'
      group by m.batch_id
    )
    select coalesce(w.batch_id, m.batch_id) as batch_id, coalesce(w.qty, 0) - coalesce(m.qty, 0) as delta
    from wanted w full join moved m on m.batch_id = w.batch_id
    where coalesce(w.qty, 0) <> coalesce(m.qty, 0)
    order by 1
  loop
    select * into v_batch from public.item_batches where id = r.batch_id for update;
    v_items := v_items || v_batch.item_id;
    if r.delta > 0 then
      if v_batch.expiry_date < v_today then
        perform private.fail('expired_batch', v_batch.batch_no);
      end if;
      if v_block and v_batch.qty_on_hand < r.delta then
        perform private.fail('stock_insufficient', format('%s: %s left', v_batch.batch_no, v_batch.qty_on_hand));
      end if;
      insert into public.stock_movements (batch_id, kind, qty, ref_table, ref_id)
      values (r.batch_id, 'sale', -r.delta, 'bills', p_bill_id);
    else
      insert into public.stock_movements (batch_id, kind, qty, ref_table, ref_id)
      values (r.batch_id, 'sale_cancel', -r.delta, 'bills', p_bill_id);
    end if;
  end loop;
  if cardinality(v_items) > 0 then
    perform private.refresh_stock_alerts(v_items);
  end if;
end;
$$;

create or replace function private.on_bill_finalized(p_bill public.bills)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.bill_items where bill_id = p_bill.id and kind = 'pharmacy' and batch_id is null) then
    perform private.fail('batch_required');
  end if;
  perform private.sync_bill_stock(p_bill.id);
  -- Library usage counts (pickers show the most used first). Phase 7 stamps carried-in bills.
  perform private.library_used('services', i.service_id) from public.bill_items i
   where i.bill_id = p_bill.id and i.service_id is not null;
  perform private.library_used('pharmacy_items', i.pharmacy_item_id) from public.bill_items i
   where i.bill_id = p_bill.id and i.pharmacy_item_id is not null and i.kind = 'pharmacy';
end;
$$;

-- Same as Phase 5, plus: stock follows the amended lines.
create or replace function public.amend_bill(p_bill_id uuid, p_items jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.require_staff(array['admin']::public.staff_role[]);
  v_bill public.bills;
  v_paid bigint;
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    perform private.fail('reason_required');
  end if;
  select * into v_bill from public.bills where id = p_bill_id for update;
  if not found or v_bill.status <> 'finalized' then
    perform private.fail('not_found', 'only finalized bills are amended');
  end if;
  if v_bill.consolidated_into_id is not null then
    perform private.fail('bill_locked', 'this bill is included in a final bill; amend the final bill');
  end if;
  insert into public.bill_versions (bill_id, version, snapshot, edited_by, reason)
  values (p_bill_id, v_bill.version, private.bill_card(p_bill_id), v_admin, btrim(p_reason));
  perform set_config('app.bill_amend', 'on', true);
  perform set_config('app.reason', btrim(p_reason), true);
  -- Re-use the draft path for the lines, then restore the finalized state.
  update public.bills set status = 'draft' where id = p_bill_id;
  perform public.save_bill(p_bill_id, '{}', p_items, v_bill.version);
  update public.bills set status = 'finalized', patient_snapshot = private.patient_snapshot(patient_id, doctor_id)
   where id = p_bill_id returning * into v_bill;
  if exists (select 1 from public.bill_items where bill_id = p_bill_id and kind = 'pharmacy' and batch_id is null) then
    perform private.fail('batch_required');
  end if;
  perform private.sync_bill_stock(p_bill_id);
  select coalesce(sum(a.amount_paise), 0) into v_paid from public.payment_allocations a
    join public.payments p on p.id = a.payment_id and p.cancelled_at is null where a.bill_id = p_bill_id;
  if v_paid > v_bill.total_paise + v_bill.carried_in_paise then
    perform private.fail('over_allocated', 'the new total is less than what was paid; cancel or move a payment first');
  end if;
  perform set_config('app.bill_amend', '', true);
  return private.bill_card(p_bill_id);
end;
$$;

-- Same as Phase 5, plus: a cancelled bill puts its medicines back in stock.
create or replace function public.cancel_bill(p_bill_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.require_staff(array['admin']::public.staff_role[]);
  v_bill public.bills;
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    perform private.fail('reason_required');
  end if;
  select * into v_bill from public.bills where id = p_bill_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if v_bill.status = 'draft' then
    -- A draft never had a number: discard it.
    delete from public.bill_items where bill_id = p_bill_id;
    delete from public.bills where id = p_bill_id;
    return jsonb_build_object('discarded', true);
  end if;
  if v_bill.status = 'cancelled' then
    return private.bill_card(p_bill_id);
  end if;
  if v_bill.consolidated_into_id is not null then
    perform private.fail('bill_locked', 'this bill is included in a final bill; amend the final bill');
  end if;
  insert into public.bill_versions (bill_id, version, snapshot, edited_by, reason)
  values (p_bill_id, v_bill.version, private.bill_card(p_bill_id), v_admin, btrim(p_reason));
  perform set_config('app.bill_amend', 'on', true);
  perform set_config('app.reason', btrim(p_reason), true);
  delete from public.payment_allocations where bill_id = p_bill_id;
  update public.bills set status = 'cancelled', cancelled_at = now(), cancelled_by = v_admin,
         cancel_reason = btrim(p_reason), version = version + 1
   where id = p_bill_id;
  perform private.sync_bill_stock(p_bill_id, true);
  perform set_config('app.bill_amend', '', true);
  return private.bill_card(p_bill_id);
end;
$$;

------------------------------------------------------------------------------
-- Reading stock
------------------------------------------------------------------------------
-- Batches of one item in FEFO order: sellable (unexpired, in stock) first by expiry,
-- then expired ones (shown, never sellable).
create function public.batches_for_sale(p_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (private.ist(now()))::date;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'batch_no', b.batch_no, 'expiry_date', b.expiry_date, 'qty_on_hand', b.qty_on_hand,
      'mrp_paise', b.mrp_paise, 'selling_price_paise', b.selling_price_paise, 'expired', b.expiry_date < v_today)
      order by b.expiry_date < v_today, b.expiry_date, b.created_at, b.id)
    from (select * from public.item_batches where item_id = p_item_id and qty_on_hand > 0
          order by expiry_date, created_at limit 50) b), '[]'::jsonb);
end;
$$;

-- Stock table. filters: {q, view: all|in_stock|low|expiring|expired}. Exact count, offset paging.
-- One grouped pass over batches that hold stock, joined to the page of items.
create function public.stock_table(p_filters jsonb default '{}', p_offset integer default 0, p_limit integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_q text := btrim(coalesce(p_filters ->> 'q', ''));
  v_view text := coalesce(p_filters ->> 'view', 'all');
  v_today date := (private.ist(now()))::date;
  v_horizon date := (private.ist(now()))::date + coalesce((
    select max(d::int) from jsonb_array_elements_text(private.setting('pharmacy', 'near_expiry_days', '[90, 60, 30]')) d), 90);
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  if v_view not in ('all', 'in_stock', 'low', 'expiring', 'expired') then
    perform private.fail('invalid_input', 'view');
  end if;
  return (
    with s as (
      select b.item_id,
             sum(b.qty_on_hand) filter (where b.expiry_date >= v_today) as on_hand,
             sum(b.qty_on_hand) filter (where b.expiry_date < v_today) as expired_qty,
             sum(b.qty_on_hand) filter (where b.expiry_date >= v_today and b.expiry_date <= v_horizon) as expiring_qty,
             min(b.expiry_date) filter (where b.expiry_date >= v_today) as next_expiry,
             sum(round(b.qty_on_hand * b.purchase_price_paise)) filter (where b.expiry_date >= v_today) as value_paise
      from public.item_batches b where b.qty_on_hand > 0 group by b.item_id
    ), filtered as (
      select i.id, i.name, i.strength, i.form, i.manufacturer, i.reorder_level, i.sell_unit, i.rack, i.active,
             i.selling_price_paise, i.gst_rate_bp,
             coalesce(s.on_hand, 0) as on_hand, coalesce(s.expired_qty, 0) as expired_qty,
             coalesce(s.expiring_qty, 0) as expiring_qty, s.next_expiry, coalesce(s.value_paise, 0) as value_paise
      from public.pharmacy_items i left join s on s.item_id = i.id
      where i.merged_into_id is null
        and (v_q = '' or i.name ilike '%' || private.like_escape(v_q) || '%')
        and case v_view
              when 'in_stock' then coalesce(s.on_hand, 0) > 0
              when 'low' then i.active and i.reorder_level > 0 and coalesce(s.on_hand, 0) <= i.reorder_level
              when 'expiring' then coalesce(s.expiring_qty, 0) > 0
              when 'expired' then coalesce(s.expired_qty, 0) > 0
              else true end
    )
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      'value_paise', (select coalesce(sum(value_paise), 0) from filtered),
      'rows', coalesce((
        select jsonb_agg(to_jsonb(f) order by lower(f.name), f.id)
        from (select * from filtered order by lower(name), id limit v_limit offset greatest(coalesce(p_offset, 0), 0)) f),
        '[]'::jsonb)));
end;
$$;

-- One item: details and every batch that holds (or owes) stock.
create function public.item_stock(p_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (private.ist(now()))::date;
  v jsonb;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select jsonb_build_object(
    'item', to_jsonb(i) - 'created_by' - 'updated_by' - 'reviewed_by',
    'on_hand', coalesce((select sum(qty_on_hand) from public.item_batches
                          where item_id = i.id and qty_on_hand <> 0 and expiry_date >= v_today), 0),
    'batches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'batch_no', b.batch_no, 'expiry_date', b.expiry_date, 'qty_on_hand', b.qty_on_hand,
        'mrp_paise', b.mrp_paise, 'purchase_price_paise', b.purchase_price_paise,
        'selling_price_paise', b.selling_price_paise, 'supplier', s.name, 'expired', b.expiry_date < v_today)
        order by b.expiry_date, b.created_at)
      from (select * from public.item_batches where item_id = i.id and qty_on_hand <> 0
            order by expiry_date, created_at limit 100) b
      left join public.suppliers s on s.id = b.supplier_id), '[]'::jsonb))
  into v from public.pharmacy_items i where i.id = p_item_id;
  if v is null then
    perform private.fail('not_found');
  end if;
  return v;
end;
$$;

-- Movements of one item, newest first. Keyset on the movement id.
create function public.stock_ledger(p_item_id uuid, p_cursor bigint default null, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_rows jsonb;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'at', m.at, 'kind', m.kind, 'qty', m.qty, 'batch_no', b.batch_no, 'expiry_date', b.expiry_date,
      'reason', m.reason, 'by', st.full_name, 'ref_table', m.ref_table, 'ref_id', m.ref_id,
      'ref_no', case m.ref_table when 'bills' then (select bill_no from public.bills where id = m.ref_id)
                                 when 'purchases' then (select invoice_no from public.purchases where id = m.ref_id) end)
      order by m.id desc), '[]'::jsonb)
  into v_rows
  from (select m.* from public.stock_movements m join public.item_batches bb on bb.id = m.batch_id
         where bb.item_id = p_item_id and (p_cursor is null or m.id < p_cursor)
         order by m.id desc limit v_limit + 1) m
  join public.item_batches b on b.id = m.batch_id
  left join public.staff st on st.id = m.by_staff;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(e.value order by e.ordinality) from jsonb_array_elements(v_rows) with ordinality e
                        where e.ordinality <= v_limit), '[]'::jsonb),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then (v_rows -> (v_limit - 1) ->> 'id')::bigint end);
end;
$$;

-- Open alerts. type: null (all) | low | near_expiry | expired. Expired first, then by expiry.
create function public.pharmacy_alerts(p_type text default null, p_offset integer default 0, p_limit integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  return (
    with open as (
      select a.* from public.stock_alerts a where a.cleared_at is null and (p_type is null or a.alert = p_type)
    )
    select jsonb_build_object(
      'total', (select count(*) from open),
      'counts', (select jsonb_build_object(
                   'low', count(*) filter (where alert = 'low'),
                   'near_expiry', count(*) filter (where alert = 'near_expiry'),
                   'expired', count(*) filter (where alert = 'expired'))
                 from public.stock_alerts where cleared_at is null),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', o.id, 'alert', o.alert, 'threshold_days', o.threshold_days, 'fired_at', o.fired_at, 'detail', o.detail,
          'item_id', o.item_id, 'item', i.name, 'strength', i.strength, 'batch_id', o.batch_id, 'batch_no', o.batch_no,
          'expiry_date', o.expiry_date, 'qty_on_hand', o.qty_on_hand)
          order by o.alert <> 'expired', o.expiry_date nulls last, o.id)
        from (select o.*, b.batch_no, b.expiry_date, b.qty_on_hand from open o
              left join public.item_batches b on b.id = o.batch_id
              order by o.alert <> 'expired', b.expiry_date nulls last, o.id
              limit v_limit offset greatest(coalesce(p_offset, 0), 0)) o
        join public.pharmacy_items i on i.id = o.item_id), '[]'::jsonb)));
end;
$$;

------------------------------------------------------------------------------
-- Writing stock: purchases, adjustments, opening stock
------------------------------------------------------------------------------
create function private.purchase_card(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'supplier_id', p.supplier_id, 'supplier', s.name, 'invoice_no', p.invoice_no,
    'invoice_date', p.invoice_date, 'status', p.status, 'total_paise', p.total_paise, 'notes', p.notes,
    'version', p.version, 'posted_at', p.posted_at, 'created_at', p.created_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'line_no', l.line_no, 'item_id', l.item_id, 'item', i.name, 'strength', i.strength,
        'sell_unit', i.sell_unit, 'batch_no', l.batch_no, 'expiry_date', l.expiry_date, 'qty', l.qty,
        'free_qty', l.free_qty, 'purchase_price_paise', l.purchase_price_paise, 'mrp_paise', l.mrp_paise,
        'selling_price_paise', l.selling_price_paise, 'gst_rate_bp', l.gst_rate_bp,
        'line_total_paise', l.line_total_paise, 'batch_id', l.batch_id) order by l.line_no)
      from public.purchase_items l join public.pharmacy_items i on i.id = l.item_id
      where l.purchase_id = p.id), '[]'::jsonb))
  from public.purchases p join public.suppliers s on s.id = p.supplier_id
  where p.id = p_id;
$$;

-- Create (p_version null) or replace a DRAFT purchase. Idempotent on p_client_id.
-- purchase: {supplier_id, invoice_no, invoice_date, notes, items: [{item_id, batch_no, expiry_date,
--            qty, free_qty, purchase_price_paise, mrp_paise, selling_price_paise, gst_rate_bp}]}
create function public.save_purchase(p_purchase jsonb, p_client_id uuid, p_version integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_p public.purchases;
  v_items jsonb := coalesce(p_purchase -> 'items', '[]'::jsonb);
begin
  if p_client_id is null then
    perform private.fail('invalid_input', 'client id is required');
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) > 200 then
    perform private.fail('invalid_input', 'items');
  end if;
  select * into v_p from public.purchases where id = p_client_id for update;
  if not found then
    if p_version is not null then
      perform private.fail('not_found');
    end if;
    insert into public.purchases (id, supplier_id, invoice_no, invoice_date, notes)
    values (p_client_id, (p_purchase ->> 'supplier_id')::uuid, btrim(p_purchase ->> 'invoice_no'),
            coalesce((p_purchase ->> 'invoice_date')::date, (private.ist(now()))::date),
            nullif(btrim(p_purchase ->> 'notes'), ''))
    returning * into v_p;
  else
    if p_version is null then
      return private.purchase_card(v_p.id); -- a retried create
    end if;
    if v_p.status <> 'draft' then
      perform private.fail('bill_locked', 'posted purchases are final');
    end if;
    if v_p.version <> p_version then
      perform private.fail('stale_version');
    end if;
    update public.purchases set
      supplier_id = coalesce((p_purchase ->> 'supplier_id')::uuid, supplier_id),
      invoice_no = coalesce(btrim(p_purchase ->> 'invoice_no'), invoice_no),
      invoice_date = coalesce((p_purchase ->> 'invoice_date')::date, invoice_date),
      notes = case when p_purchase ? 'notes' then nullif(btrim(p_purchase ->> 'notes'), '') else notes end,
      version = version + 1
    where id = v_p.id;
  end if;

  delete from public.purchase_items where purchase_id = v_p.id;
  insert into public.purchase_items (purchase_id, line_no, item_id, batch_no, expiry_date, qty, free_qty,
    purchase_price_paise, mrp_paise, selling_price_paise, gst_rate_bp, line_total_paise)
  select v_p.id, e.ordinality, (e.value ->> 'item_id')::uuid, upper(btrim(e.value ->> 'batch_no')),
         private.month_end((e.value ->> 'expiry_date')::date), (e.value ->> 'qty')::numeric,
         coalesce((e.value ->> 'free_qty')::numeric, 0), (e.value ->> 'purchase_price_paise')::bigint,
         coalesce((e.value ->> 'mrp_paise')::bigint, 0), coalesce((e.value ->> 'selling_price_paise')::bigint, 0),
         coalesce((e.value ->> 'gst_rate_bp')::int, 0),
         -- Line total = qty × price, plus GST on that, each rounded to the paisa.
         private.round_div((e.value ->> 'qty')::numeric * (e.value ->> 'purchase_price_paise')::bigint, 1)
           + private.round_div((e.value ->> 'qty')::numeric * (e.value ->> 'purchase_price_paise')::bigint
                               * coalesce((e.value ->> 'gst_rate_bp')::int, 0), 10000)
  from jsonb_array_elements(v_items) with ordinality e;
  if exists (select 1 from public.purchase_items where purchase_id = v_p.id and expiry_date < (private.ist(now()))::date) then
    perform private.fail('expired_batch', 'an expired batch cannot be bought in');
  end if;
  update public.purchases set total_paise = coalesce((select sum(line_total_paise) from public.purchase_items
                                                       where purchase_id = v_p.id), 0)
   where id = v_p.id;
  return private.purchase_card(v_p.id);
exception
  when unique_violation then
    perform private.fail('duplicate', 'this supplier invoice is already entered');
  when invalid_text_representation or not_null_violation or check_violation or foreign_key_violation then
    perform private.fail('invalid_input', sqlerrm);
end;
$$;

create function public.get_purchase(p_purchase_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v := private.purchase_card(p_purchase_id);
  if v is null then
    perform private.fail('not_found');
  end if;
  return v;
end;
$$;

create function public.discard_purchase(p_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  if not exists (select 1 from public.purchases where id = p_purchase_id and status = 'draft') then
    perform private.fail('bill_locked', 'posted purchases are final');
  end if;
  delete from public.purchases where id = p_purchase_id;
end;
$$;

-- Post: lines → batches (one per item + batch + expiry; later lines update prices) →
-- purchase movements. Set-based: a 200-line invoice is three statements, not 200 loops.
create function public.post_purchase(p_purchase_id uuid, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_p public.purchases;
  v_items uuid[];
begin
  select * into v_p from public.purchases where id = p_purchase_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if v_p.status <> 'draft' then
    perform private.fail('bill_locked', 'already posted');
  end if;
  if v_p.version <> p_version then
    perform private.fail('stale_version');
  end if;
  if not exists (select 1 from public.purchase_items where purchase_id = p_purchase_id) then
    perform private.fail('invalid_input', 'a purchase needs at least one line');
  end if;

  insert into public.item_batches (item_id, batch_no, expiry_date, mrp_paise, purchase_price_paise, selling_price_paise, supplier_id)
  select distinct on (l.item_id, l.batch_no, l.expiry_date)
         l.item_id, l.batch_no, l.expiry_date, l.mrp_paise, l.purchase_price_paise,
         case when l.selling_price_paise > 0 then l.selling_price_paise when l.mrp_paise > 0 then l.mrp_paise
              else i.selling_price_paise end,
         v_p.supplier_id
  from public.purchase_items l join public.pharmacy_items i on i.id = l.item_id
  where l.purchase_id = p_purchase_id
  order by l.item_id, l.batch_no, l.expiry_date, l.line_no desc
  on conflict (item_id, batch_no, expiry_date) do update set
    mrp_paise = excluded.mrp_paise, purchase_price_paise = excluded.purchase_price_paise,
    selling_price_paise = excluded.selling_price_paise, supplier_id = excluded.supplier_id;

  update public.purchase_items l set batch_id = b.id
    from public.item_batches b
   where l.purchase_id = p_purchase_id and b.item_id = l.item_id and b.batch_no = l.batch_no and b.expiry_date = l.expiry_date;

  insert into public.stock_movements (batch_id, kind, qty, ref_table, ref_id)
  select l.batch_id, 'purchase', l.qty + l.free_qty, 'purchases', p_purchase_id
  from public.purchase_items l where l.purchase_id = p_purchase_id order by l.line_no;

  -- The item's last purchase price and MRP become its defaults.
  update public.pharmacy_items i set purchase_price_paise = x.purchase_price_paise,
         mrp_paise = case when x.mrp_paise > 0 then x.mrp_paise else i.mrp_paise end
    from (select distinct on (item_id) item_id, purchase_price_paise, mrp_paise from public.purchase_items
           where purchase_id = p_purchase_id order by item_id, line_no desc) x
   where i.id = x.item_id;

  update public.purchases set status = 'posted', posted_at = now(), posted_by = v_staff, version = version + 1
   where id = p_purchase_id;
  perform private.library_used('suppliers', v_p.supplier_id);
  v_items := array(select distinct item_id from public.purchase_items where purchase_id = p_purchase_id);
  perform private.refresh_stock_alerts(v_items);
  return private.purchase_card(p_purchase_id);
end;
$$;

-- Purchases table. filters: {from, to (≤ 1 year), status, supplier_id}. Exact count, offset paging.
create function public.purchases_table(p_filters jsonb default '{}', p_offset integer default 0, p_limit integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_from date := coalesce((p_filters ->> 'from')::date, (private.ist(now()))::date - 90);
  v_to date := coalesce((p_filters ->> 'to')::date, (private.ist(now()))::date);
  v_status text := nullif(p_filters ->> 'status', '');
  v_supplier uuid := (p_filters ->> 'supplier_id')::uuid;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  if v_to < v_from or v_to - v_from > 366 then
    perform private.fail('invalid_input', 'date range (max one year)');
  end if;
  return (
    with filtered as (
      select p.* from public.purchases p
      where p.invoice_date between v_from and v_to
        and (v_status is null or p.status = v_status)
        and (v_supplier is null or p.supplier_id = v_supplier)
    )
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      'sum_paise', (select coalesce(sum(total_paise), 0) from filtered where status = 'posted'),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', f.id, 'invoice_no', f.invoice_no, 'invoice_date', f.invoice_date, 'status', f.status,
          'total_paise', f.total_paise, 'supplier', s.name, 'posted_at', f.posted_at)
          order by f.invoice_date desc, f.id)
        from (select * from filtered order by invoice_date desc, id limit v_limit offset greatest(coalesce(p_offset, 0), 0)) f
        join public.suppliers s on s.id = f.supplier_id), '[]'::jsonb)));
end;
$$;

-- Damaged / expired / supplier return / patient return: p_qty is how many (always positive).
-- Count correction: p_qty is the quantity counted on the shelf; the difference is booked.
create function public.adjust_stock(p_batch_id uuid, p_kind public.stock_move_kind, p_qty numeric, p_reason text, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_batch public.item_batches;
  v_delta numeric;
begin
  if p_client_id is null then
    perform private.fail('invalid_input', 'client id is required');
  end if;
  if exists (select 1 from public.stock_movements where client_id = p_client_id) then
    return (select to_jsonb(b) from public.item_batches b where id = p_batch_id);
  end if;
  if p_kind not in ('damaged', 'expired', 'supplier_return', 'patient_return', 'count_correction') then
    perform private.fail('invalid_input', 'kind');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    perform private.fail('reason_required');
  end if;
  if p_qty is null or p_qty < 0 or (p_qty = 0 and p_kind <> 'count_correction') or p_qty <> round(p_qty, 3) then
    perform private.fail('invalid_quantity');
  end if;
  select * into v_batch from public.item_batches where id = p_batch_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  v_delta := case p_kind when 'count_correction' then p_qty - v_batch.qty_on_hand
                         when 'patient_return' then p_qty
                         else -p_qty end;
  if v_delta = 0 then
    perform private.fail('invalid_quantity', 'the count matches the stock already');
  end if;
  if v_delta < 0 and p_kind <> 'count_correction' and v_batch.qty_on_hand + v_delta < 0
     and coalesce(private.setting('pharmacy', 'negative_stock', '"block"') #>> '{}', 'block') = 'block' then
    perform private.fail('stock_insufficient', format('%s left', v_batch.qty_on_hand));
  end if;
  insert into public.stock_movements (batch_id, kind, qty, ref_table, reason, client_id, by_staff)
  values (p_batch_id, p_kind, v_delta, 'adjustments', btrim(p_reason), p_client_id, v_staff);
  perform private.refresh_stock_alerts(array[v_batch.item_id]);
  return (select to_jsonb(b) from public.item_batches b where id = p_batch_id);
end;
$$;

-- Opening stock from a sheet (admin). rows: [{name, strength?, form?, manufacturer?, hsn?, gst_rate_bp?,
-- mrp_paise?, selling_price_paise?, purchase_price_paise?, reorder_level?, rack?, batch_no, expiry_date, qty}]
-- Items are matched by name + strength + form or created; batches by number + expiry. ≤ 500 rows a call.
-- Each row runs in its own savepoint; the dry run does every insert and check, then rolls the row back.
-- Errors: [{row (1-based), field, message}] like import_patients.
create function public.import_opening_stock(p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_i integer := 0;
  v_ok integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_items uuid[] := '{}';
  v_item uuid;
  v_batch uuid;
  v_detail text;
  v_message text;
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    perform private.fail('invalid_input', 'at most 500 rows per batch');
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    begin
      if length(btrim(coalesce(v_row ->> 'name', ''))) = 0 then
        raise exception using errcode = 'P0001', message = 'invalid_input', detail = 'name';
      end if;
      if length(btrim(coalesce(v_row ->> 'batch_no', ''))) = 0 then
        raise exception using errcode = 'P0001', message = 'invalid_input', detail = 'batch_no';
      end if;
      if (v_row ->> 'expiry_date') is null then
        raise exception using errcode = 'P0001', message = 'invalid_input', detail = 'expiry_date';
      end if;
      if coalesce((v_row ->> 'qty')::numeric, 0) <= 0 then
        raise exception using errcode = 'P0001', message = 'invalid_quantity', detail = 'qty';
      end if;
      select id into v_item from public.pharmacy_items
       where lower(name) = lower(btrim(v_row ->> 'name'))
         and coalesce(strength, '') = coalesce(nullif(btrim(v_row ->> 'strength'), ''), '')
         and coalesce(form, '') = coalesce(nullif(btrim(v_row ->> 'form'), ''), '') and merged_into_id is null
       limit 1;
      if v_item is null then
        insert into public.pharmacy_items (name, strength, form, manufacturer, hsn, gst_rate_bp, mrp_paise,
          selling_price_paise, purchase_price_paise, reorder_level, rack)
        values (btrim(v_row ->> 'name'), nullif(btrim(v_row ->> 'strength'), ''), nullif(btrim(v_row ->> 'form'), ''),
          nullif(btrim(v_row ->> 'manufacturer'), ''), nullif(btrim(v_row ->> 'hsn'), ''),
          coalesce((v_row ->> 'gst_rate_bp')::int, 0), coalesce((v_row ->> 'mrp_paise')::bigint, 0),
          coalesce((v_row ->> 'selling_price_paise')::bigint, (v_row ->> 'mrp_paise')::bigint, 0),
          coalesce((v_row ->> 'purchase_price_paise')::bigint, 0), coalesce((v_row ->> 'reorder_level')::numeric, 0),
          nullif(btrim(v_row ->> 'rack'), ''))
        returning id into v_item;
      end if;
      insert into public.item_batches (item_id, batch_no, expiry_date, mrp_paise, purchase_price_paise, selling_price_paise)
      values (v_item, upper(btrim(v_row ->> 'batch_no')), private.month_end((v_row ->> 'expiry_date')::date),
              coalesce((v_row ->> 'mrp_paise')::bigint, 0), coalesce((v_row ->> 'purchase_price_paise')::bigint, 0),
              coalesce((v_row ->> 'selling_price_paise')::bigint, (v_row ->> 'mrp_paise')::bigint, 0))
      on conflict (item_id, batch_no, expiry_date) do update set mrp_paise = excluded.mrp_paise
      returning id into v_batch;
      -- Opening stock is entered once per batch: a second sheet with the same batch is refused.
      if exists (select 1 from public.stock_movements where batch_id = v_batch and kind = 'opening') then
        raise exception using errcode = 'P0001', message = 'duplicate', detail = 'batch_no';
      end if;
      insert into public.stock_movements (batch_id, kind, qty, ref_table, reason)
      values (v_batch, 'opening', (v_row ->> 'qty')::numeric, 'import', 'opening stock');
      if p_dry_run then
        raise exception using errcode = 'PX001', message = 'dry_run_ok'; -- undo this row, count it as fine
      end if;
      v_items := v_items || v_item;
      v_ok := v_ok + 1;
    exception
      when sqlstate 'PX001' then
        v_ok := v_ok + 1;
      when others then
        get stacked diagnostics v_detail = pg_exception_detail, v_message = message_text;
        v_errors := v_errors || jsonb_build_object('row', v_i, 'field', nullif(v_detail, ''), 'message', v_message);
    end;
  end loop;
  if cardinality(v_items) > 0 then
    perform private.refresh_stock_alerts(v_items);
  end if;
  return jsonb_build_object('ok', v_ok, 'errors', v_errors, 'dry_run', p_dry_run);
end;
$$;

------------------------------------------------------------------------------
-- Summary tiles for the pharmacy page and the nav badge
------------------------------------------------------------------------------
create function public.pharmacy_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (private.ist(now()))::date;
  v_month date := date_trunc('month', (private.ist(now()))::date)::date;
  v_horizon date := (private.ist(now()))::date + coalesce((
    select max(d::int) from jsonb_array_elements_text(private.setting('pharmacy', 'near_expiry_days', '[90, 60, 30]')) d), 90);
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  return (
    with v as (
      select coalesce(sum(round(qty_on_hand * purchase_price_paise)) filter (where expiry_date >= v_today), 0) as stock_value,
             coalesce(sum(round(qty_on_hand * purchase_price_paise)) filter (where expiry_date >= v_today and expiry_date <= v_horizon), 0) as near_expiry_value,
             coalesce(sum(round(qty_on_hand * purchase_price_paise)) filter (where expiry_date < v_today), 0) as expired_value
      from public.item_batches where qty_on_hand > 0
    ), k as materialized (select * from private.kpi_range(v_month, v_today)),
    t as materialized (select * from private.kpi_compute_day(v_today))
    select jsonb_build_object(
      'stock_value_paise', v.stock_value, 'near_expiry_value_paise', v.near_expiry_value, 'expired_value_paise', v.expired_value,
      'alerts', (select count(*) from public.stock_alerts where cleared_at is null),
      'sales_today_paise', coalesce((select sum(value) from t where metric = 'pharmacy_sales_paise'), 0),
      'sales_month_paise', coalesce((select sum(value) from k where metric = 'pharmacy_sales_paise'), 0),
      'margin_month_paise', coalesce((select sum(value) from k where metric = 'pharmacy_taxable_paise'), 0)
                            - coalesce((select sum(value) from k where metric = 'pharmacy_cogs_paise'), 0))
    from v);
end;
$$;

-- Small counters for the side menu badges (one cheap call per page load).
create function public.nav_badges()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff();
  if not (select private.has_role('receptionist', 'admin')) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('pharmacy', (select count(*) from public.stock_alerts where cleared_at is null));
end;
$$;

------------------------------------------------------------------------------
-- KPIs: Phase 5's day plus pharmacy sales, taxable value and cost of goods sold.
------------------------------------------------------------------------------
create or replace function private.kpi_compute_day(p_day date)
returns table (metric text, dim_kind text, dim_id text, value numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (select private.ist_at(p_day, '00:00') as lo, private.ist_at(p_day + 1, '00:00') as hi),
  bills_day as (
    select b.* from public.bills b, bounds
    where b.status = 'finalized' and b.bill_at >= bounds.lo and b.bill_at < bounds.hi
  ),
  pay_day as (
    select p.* from public.payments p, bounds
    where p.cancelled_at is null and p.received_at >= bounds.lo and p.received_at < bounds.hi
  ),
  appt_day as (select a.* from public.appointments a where a.appt_date = p_day),
  pharmacy_lines as (
    select i.total_paise, i.taxable_paise, round(i.qty * coalesce(i.unit_cost_paise, 0)) as cogs
    from bills_day b join public.bill_items i on i.bill_id = b.id and i.kind = 'pharmacy'
  )
  select 'revenue_paise', 'clinic', '', coalesce(sum(total_paise), 0) from bills_day
  union all select 'revenue_paise', 'bill_type', bill_type::text, sum(total_paise) from bills_day group by bill_type
  union all select 'discount_paise', 'clinic', '', coalesce(sum(discount_paise), 0) from bills_day
  union all select 'tax_paise', 'clinic', '', coalesce(sum(cgst_paise + sgst_paise), 0) from bills_day
  union all select 'bills_count', 'bill_type', bill_type::text, count(*) from bills_day group by bill_type
  union all
  select 'revenue_paise', 'category', coalesce(c.code, c.id::text, 'none'), sum(i.total_paise)
  from bills_day b join public.bill_items i on i.bill_id = b.id and i.kind <> 'carried_in'
  left join public.lookup_values c on c.id = i.category_id
  group by coalesce(c.code, c.id::text, 'none')
  union all
  select 'revenue_paise', 'doctor', b.doctor_id::text, sum(b.total_paise) from bills_day b where b.doctor_id is not null group by b.doctor_id
  union all
  select 'collected_paise', 'clinic', '', coalesce(sum(amount_paise) filter (where kind <> 'refund'), 0) from pay_day
  union all
  select 'collected_paise', 'mode', coalesce(m.code, m.id::text), sum(p.amount_paise)
  from pay_day p join public.lookup_values m on m.id = p.mode_id where p.kind <> 'refund' group by coalesce(m.code, m.id::text)
  union all select 'refunds_paise', 'clinic', '', coalesce(sum(amount_paise) filter (where kind = 'refund'), 0) from pay_day
  union all select 'appointments_count', 'clinic', '', count(*) from appt_day where status not in ('cancelled', 'rescheduled')
  union all select 'appointments_count', 'doctor', doctor_id::text, count(*) from appt_day
              where status not in ('cancelled', 'rescheduled') and doctor_id is not null group by doctor_id
  union all select 'arrived_count', 'clinic', '', count(*) from appt_day where arrived_at is not null
  union all select 'no_show_count', 'clinic', '', count(*) from appt_day where status = 'no_show'
  union all select 'walk_in_count', 'clinic', '', count(*) from appt_day where is_walk_in and status not in ('cancelled', 'rescheduled')
  union all
  select 'new_patients', 'clinic', '', count(*) from public.patients p, bounds
  where p.created_at >= bounds.lo and p.created_at < bounds.hi and p.merged_into_id is null
  union all select 'pharmacy_sales_paise', 'clinic', '', coalesce(sum(total_paise), 0) from pharmacy_lines
  union all select 'pharmacy_taxable_paise', 'clinic', '', coalesce(sum(taxable_paise), 0) from pharmacy_lines
  union all select 'pharmacy_cogs_paise', 'clinic', '', coalesce(sum(cogs), 0) from pharmacy_lines;
$$;

------------------------------------------------------------------------------
-- Scheduled jobs (PLAN.md D5): hourly alerts; 23:30 IST stock cache check.
------------------------------------------------------------------------------
-- Rebuilds qty_on_hand from the ledger wherever the cache drifted (should find nothing).
create function private.stock_cache_check()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixed integer;
begin
  with truth as (
    select b.id, coalesce(m.qty, 0) as qty from public.item_batches b
    left join (select batch_id, sum(qty) as qty from public.stock_movements group by batch_id) m on m.batch_id = b.id
  ), fixed as (
    update public.item_batches b set qty_on_hand = t.qty from truth t
    where t.id = b.id and b.qty_on_hand <> t.qty
    returning 1
  )
  select count(*) into v_fixed from fixed;
  if v_fixed > 0 then
    insert into public.client_errors (app, message) values ('db', format('stock cache drift fixed on %s batches', v_fixed));
  end if;
  return v_fixed;
end;
$$;

select cron.schedule('pharmacy-alerts', '20 * * * *', $$select private.refresh_stock_alerts()$$);
select cron.schedule('stock-cache-check', '0 18 * * *', $$select private.stock_cache_check()$$);

alter default privileges revoke execute on functions from public;
select private.lock_down_public_functions();
