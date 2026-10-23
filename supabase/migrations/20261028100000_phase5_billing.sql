-- Pearl CRM — Phase 5: bills, payments, printing data, KPI rollup (PLAN.md C3 "Billing", C4, C5, B6)
-- The database calculates every amount (C5) with the same rules as packages/shared/src/gst.ts;
-- both are tested against packages/shared/test-vectors/gst.json. Finalized bills are frozen:
-- a trigger refuses any change unless an admin amend/cancel function has opened them.

create type public.bill_type as enum ('procedure_receipt', 'pharmacy_invoice', 'final_bill');
create type public.doc_status as enum ('draft', 'finalized', 'cancelled');
create type public.discount_type as enum ('amount', 'percent');
create type public.payment_kind as enum ('payment', 'advance', 'refund');

------------------------------------------------------------------------------
-- Line maths (PLAN.md C5). All integers. Rounding: half away from zero.
--   qty numeric(10,3) → qty_milli; discount value = paise (amount) or basis points (percent);
--   gst_rate_bp = basis points (5% = 500).
------------------------------------------------------------------------------
create function private.round_div(p_n numeric, p_d numeric)
returns bigint
language sql
immutable
parallel safe
as $$
  select (sign(p_n) * sign(p_d) * floor((abs(p_n) * 2 + abs(p_d)) / (abs(p_d) * 2)))::bigint;
$$;

create function private.compute_line(
  p_rate_paise bigint, p_qty numeric, p_discount_type public.discount_type, p_discount_value bigint,
  p_gst_rate_bp integer, p_tax_inclusive boolean
)
returns table (gross bigint, discount bigint, taxable bigint, tax bigint, cgst bigint, sgst bigint, total bigint)
language plpgsql
immutable
as $$
declare
  v_qty_milli bigint := round(p_qty * 1000)::bigint;
  v_gross bigint;
  v_discount bigint;
  v_net bigint;
  v_taxable bigint;
  v_tax bigint;
begin
  if p_rate_paise is null or p_rate_paise < 0 then
    raise exception using errcode = 'P0001', message = 'invalid_input', detail = 'negative_rate';
  end if;
  if v_qty_milli is null or v_qty_milli <= 0 then
    raise exception using errcode = 'P0001', message = 'invalid_quantity';
  end if;
  if p_gst_rate_bp is null or p_gst_rate_bp < 0 or p_gst_rate_bp > 4000 then
    raise exception using errcode = 'P0001', message = 'invalid_input', detail = 'invalid_gst_rate';
  end if;
  if p_discount_value is null or p_discount_value < 0 then
    raise exception using errcode = 'P0001', message = 'invalid_input', detail = 'invalid_discount';
  end if;

  v_gross := private.round_div(p_rate_paise::numeric * v_qty_milli, 1000);
  if p_discount_type = 'percent' then
    if p_discount_value > 10000 then
      raise exception using errcode = 'P0001', message = 'discount_exceeds_gross';
    end if;
    v_discount := private.round_div(v_gross::numeric * p_discount_value, 10000);
  else
    v_discount := p_discount_value;
  end if;
  if v_discount > v_gross then
    raise exception using errcode = 'P0001', message = 'discount_exceeds_gross';
  end if;

  v_net := v_gross - v_discount;
  if p_tax_inclusive then
    v_taxable := private.round_div(v_net::numeric * 10000, 10000 + p_gst_rate_bp);
    v_tax := v_net - v_taxable;
  else
    v_taxable := v_net;
    v_tax := private.round_div(v_taxable::numeric * p_gst_rate_bp, 10000);
  end if;
  -- Odd paisa goes to SGST.
  return query select v_gross, v_discount, v_taxable, v_tax, v_tax / 2, v_tax - v_tax / 2, v_taxable + v_tax;
end;
$$;

------------------------------------------------------------------------------
-- Bills
------------------------------------------------------------------------------
create table public.bills (
  id uuid primary key default gen_random_uuid(),
  bill_type public.bill_type not null,
  bill_no text,                         -- taken at finalize, never before
  fy text,
  status public.doc_status not null default 'draft',
  patient_id uuid not null references public.patients (id),
  doctor_id uuid references public.doctors (id),
  referred_by_text text check (length(referred_by_text) <= 120),
  bill_at timestamptz,                  -- set at finalize
  treatment_id uuid references public.patient_treatments (id),
  admission_id uuid,                    -- FK added in Phase 7
  visit_id uuid references public.visits (id),
  consolidated_into_id uuid references public.bills (id),
  tax_inclusive boolean not null default true,
  gross_paise bigint not null default 0,
  discount_paise bigint not null default 0,
  taxable_paise bigint not null default 0,
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  round_off_paise bigint not null default 0,
  total_paise bigint not null default 0,     -- this bill's OWN lines (+ round off)
  carried_in_paise bigint not null default 0, -- final bill only: lines carried from interim bills
  agreed_price_paise bigint,
  below_agreed_reason text check (length(below_agreed_reason) <= 300),
  header_snapshot jsonb,
  patient_snapshot jsonb,
  notes text check (length(notes) <= 1000),
  version integer not null default 1,
  print_count integer not null default 0,
  finalized_at timestamptz,
  finalized_by uuid references public.staff (id),
  cancelled_at timestamptz,
  cancelled_by uuid references public.staff (id),
  cancel_reason text check (length(cancel_reason) <= 300),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (bill_type, bill_no),
  check (status = 'draft' or (bill_no is not null and bill_at is not null))
);
create index bills_patient on public.bills (patient_id, created_at desc);
create index bills_status_at on public.bills (status, bill_at);
create index bills_at on public.bills (bill_at) where status = 'finalized';
create index bills_when on public.bills ((coalesce(bill_at, created_at)) desc, id);
create index bills_treatment on public.bills (treatment_id) where treatment_id is not null;
create index bills_admission on public.bills (admission_id) where admission_id is not null;
create trigger bills_touch before update on public.bills
  for each row execute function private.touch_updated();
create trigger bills_audit after insert or update or delete on public.bills
  for each row execute function private.audit_row();

create table public.bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id) on delete cascade,
  line_no smallint not null check (line_no >= 1),
  category_id uuid references public.lookup_values (id),
  kind text not null default 'service' check (kind in ('service', 'pharmacy', 'room', 'doctor_charge', 'custom', 'carried_in')),
  service_id uuid references public.services (id),
  pharmacy_item_id uuid references public.pharmacy_items (id),
  batch_id uuid,                        -- FK added in Phase 6
  room_type_id uuid references public.room_types (id),
  doctor_id uuid references public.doctors (id),
  description text not null check (length(btrim(description)) between 1 and 300),
  hsn_sac text check (length(hsn_sac) <= 8),
  mfg text check (length(mfg) <= 120),
  batch_no text check (length(batch_no) <= 40),
  expiry_date date,
  service_date date,
  rate_paise bigint not null check (rate_paise >= 0),
  qty numeric(10, 3) not null check (qty > 0),
  discount_type public.discount_type not null default 'amount',
  discount_value bigint not null default 0 check (discount_value >= 0),
  gst_rate_bp integer not null default 0 check (gst_rate_bp between 0 and 4000),
  -- Calculated by trigger from the inputs above; never typed.
  gross_paise bigint not null default 0,
  discount_paise bigint not null default 0 check (discount_paise >= 0),
  taxable_paise bigint not null default 0,
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  total_paise bigint not null default 0,
  carried_from_item_id uuid references public.bill_items (id),
  created_at timestamptz not null default now(),
  check (discount_paise <= gross_paise),
  unique (bill_id, line_no)
);
create index bill_items_bill on public.bill_items (bill_id, line_no);
create index bill_items_category on public.bill_items (category_id);
-- A finalized bill line must keep pointing at the library item it was billed from.
comment on constraint bill_items_service_id_fkey on public.bill_items is 'merge:keep';
comment on constraint bill_items_pharmacy_item_id_fkey on public.bill_items is 'merge:keep';
comment on constraint bill_items_room_type_id_fkey on public.bill_items is 'merge:keep';
comment on constraint bill_items_category_id_fkey on public.bill_items is 'merge:keep';

create table public.bill_versions (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id),
  version integer not null,
  snapshot jsonb not null,
  edited_by uuid references public.staff (id),
  reason text not null,
  at timestamptz not null default now(),
  unique (bill_id, version)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id),
  kind public.payment_kind not null default 'payment',
  mode_id uuid not null references public.lookup_values (id),
  amount_paise bigint not null check (amount_paise > 0),
  reference text check (length(reference) <= 80),   -- UPI transaction id, card slip …
  received_at timestamptz not null default now(),
  received_by uuid references public.staff (id),
  treatment_id uuid references public.patient_treatments (id),
  admission_id uuid,                                -- FK added in Phase 7
  note text check (length(note) <= 300),
  cancelled_at timestamptz,
  cancelled_by uuid references public.staff (id),
  cancel_reason text check (length(cancel_reason) <= 300),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index payments_patient on public.payments (patient_id, received_at desc);
create index payments_received on public.payments (received_at) where cancelled_at is null;
create trigger payments_audit after insert or update or delete on public.payments
  for each row execute function private.audit_row();
comment on constraint payments_mode_id_fkey on public.payments is 'merge:keep';

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id),
  bill_id uuid not null references public.bills (id),
  amount_paise bigint not null check (amount_paise > 0),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index payment_allocations_payment on public.payment_allocations (payment_id);
create index payment_allocations_bill on public.payment_allocations (bill_id);
create trigger payment_allocations_audit after insert or update or delete on public.payment_allocations
  for each row execute function private.audit_row();

------------------------------------------------------------------------------
-- Triggers: line maths, finalized lock, allocation limits
------------------------------------------------------------------------------
create function private.bill_item_compute()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inclusive boolean;
  r record;
begin
  select b.tax_inclusive into v_inclusive from public.bills b where b.id = new.bill_id;
  select * into r from private.compute_line(new.rate_paise, new.qty, new.discount_type, new.discount_value,
                                            new.gst_rate_bp, coalesce(v_inclusive, true));
  new.gross_paise := r.gross;
  new.discount_paise := r.discount;
  new.taxable_paise := r.taxable;
  new.cgst_paise := r.cgst;
  new.sgst_paise := r.sgst;
  new.total_paise := r.total;
  return new;
end;
$$;
create trigger bill_items_compute before insert or update on public.bill_items
  for each row execute function private.bill_item_compute();

-- Finalized and cancelled bills are frozen — even for a direct SQL update — unless an
-- admin amend/cancel function opened them for this transaction (app.bill_amend = on).
create function private.guard_bill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.doc_status;
begin
  if coalesce(current_setting('app.bill_amend', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'bills' then
    if old.status = 'draft' then
      return coalesce(new, old);
    end if;
    -- Printing and final-bill consolidation may still touch these two columns.
    if tg_op = 'UPDATE' and (to_jsonb(new) - 'print_count' - 'consolidated_into_id' - 'updated_at' - 'updated_by')
                          = (to_jsonb(old) - 'print_count' - 'consolidated_into_id' - 'updated_at' - 'updated_by') then
      return new;
    end if;
    perform private.fail('bill_locked');
  end if;
  select b.status into v_status from public.bills b where b.id = coalesce(new.bill_id, old.bill_id);
  if v_status is distinct from 'draft' then
    perform private.fail('bill_locked');
  end if;
  return coalesce(new, old);
end;
$$;
create trigger bills_guard before update or delete on public.bills
  for each row execute function private.guard_bill();
create trigger bill_items_guard before insert or update or delete on public.bill_items
  for each row execute function private.guard_bill();

-- Allocations never exceed the payment, nor what the bill still owes.
create function private.check_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_bill public.bills;
  v_used bigint;
  v_paid bigint;
begin
  select * into v_payment from public.payments where id = new.payment_id for update;
  select * into v_bill from public.bills where id = new.bill_id;
  if v_payment.kind = 'refund' or v_payment.cancelled_at is not null then
    perform private.fail('invalid_input', 'refunds and cancelled payments are not allocated');
  end if;
  if v_bill.status <> 'finalized' or v_bill.patient_id <> v_payment.patient_id then
    perform private.fail('invalid_input', 'allocate only to this patient''s finalized bills');
  end if;
  select coalesce(sum(amount_paise), 0) into v_used from public.payment_allocations
   where payment_id = new.payment_id and id <> new.id;
  if v_used + new.amount_paise > v_payment.amount_paise then
    perform private.fail('over_allocated', 'more than the payment');
  end if;
  select coalesce(sum(a.amount_paise), 0) into v_paid
    from public.payment_allocations a join public.payments p on p.id = a.payment_id and p.cancelled_at is null
   where a.bill_id = new.bill_id and a.id <> new.id;
  if v_paid + new.amount_paise > v_bill.total_paise + v_bill.carried_in_paise then
    perform private.fail('over_allocated', 'more than the bill');
  end if;
  return new;
end;
$$;
create trigger payment_allocations_check before insert or update on public.payment_allocations
  for each row execute function private.check_allocation();

------------------------------------------------------------------------------
-- RLS: reception + admin read bills and payments; all writes through RPCs.
------------------------------------------------------------------------------
alter table public.bills enable row level security;
alter table public.bill_items enable row level security;
alter table public.bill_versions enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
grant select on public.bills, public.bill_items, public.bill_versions, public.payments, public.payment_allocations to authenticated;
create policy bills_select on public.bills for select to authenticated using ((select private.has_role('receptionist', 'admin')));
create policy bill_items_select on public.bill_items for select to authenticated using ((select private.has_role('receptionist', 'admin')));
create policy bill_versions_select on public.bill_versions for select to authenticated using ((select private.has_role('admin')));
create policy payments_select on public.payments for select to authenticated using ((select private.has_role('receptionist', 'admin')));
create policy payment_allocations_select on public.payment_allocations for select to authenticated
  using ((select private.has_role('receptionist', 'admin')));

------------------------------------------------------------------------------
-- Bill helpers
------------------------------------------------------------------------------
create function private.recompute_bill(p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round boolean := coalesce((private.setting('billing', 'round_to_rupee', 'false'))::boolean, false);
  v record;
  v_round_off bigint := 0;
begin
  select coalesce(sum(gross_paise) filter (where kind <> 'carried_in'), 0) as gross,
         coalesce(sum(discount_paise) filter (where kind <> 'carried_in'), 0) as discount,
         coalesce(sum(taxable_paise) filter (where kind <> 'carried_in'), 0) as taxable,
         coalesce(sum(cgst_paise) filter (where kind <> 'carried_in'), 0) as cgst,
         coalesce(sum(sgst_paise) filter (where kind <> 'carried_in'), 0) as sgst,
         coalesce(sum(total_paise) filter (where kind <> 'carried_in'), 0) as total,
         coalesce(sum(total_paise) filter (where kind = 'carried_in'), 0) as carried
    into v
  from public.bill_items where bill_id = p_bill_id;
  if v_round then
    v_round_off := private.round_div(v.total, 100) * 100 - v.total;
  end if;
  update public.bills set
    gross_paise = v.gross, discount_paise = v.discount, taxable_paise = v.taxable,
    cgst_paise = v.cgst, sgst_paise = v.sgst, round_off_paise = v_round_off,
    total_paise = v.total + v_round_off, carried_in_paise = v.carried
  where id = p_bill_id;
end;
$$;

-- Receptionist discount limit (Settings → Billing, default 20 %) per line and per bill. Admin: no limit.
create function private.check_discount_limit(p_bill_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_max integer := (private.setting('billing', 'receptionist_max_discount_bp', '2000'))::int;
  v_bad integer;
  v_bill public.bills;
begin
  if private.has_role('admin') then
    return;
  end if;
  select count(*) into v_bad from public.bill_items i
   where i.bill_id = p_bill_id and i.kind <> 'carried_in' and i.gross_paise > 0
     and i.discount_paise::numeric * 10000 > i.gross_paise::numeric * v_max;
  if v_bad > 0 then
    perform private.fail('discount_limit', format('a line is over %s%%', v_max / 100.0));
  end if;
  select * into v_bill from public.bills where id = p_bill_id;
  if v_bill.gross_paise > 0 and v_bill.discount_paise::numeric * 10000 > v_bill.gross_paise::numeric * v_max then
    perform private.fail('discount_limit', format('the bill is over %s%%', v_max / 100.0));
  end if;
end;
$$;

create function private.bill_card(p_bill_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(b) || jsonb_build_object(
    'patient', p.full_name, 'uhid', p.uhid,
    'doctor', coalesce(d.display_name, d.full_name),
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) || jsonb_build_object('category', c.label, 'category_code', c.code) order by i.line_no)
      from public.bill_items i left join public.lookup_values c on c.id = i.category_id
      where i.bill_id = b.id), '[]'::jsonb),
    'received_paise', coalesce((
      select sum(a.amount_paise) from public.payment_allocations a
      join public.payments pay on pay.id = a.payment_id and pay.cancelled_at is null
      where a.bill_id = b.id), 0))
  from public.bills b
  join public.patients p on p.id = b.patient_id
  left join public.doctors d on d.id = b.doctor_id
  where b.id = p_bill_id;
$$;

------------------------------------------------------------------------------
-- Bill RPCs
------------------------------------------------------------------------------
create function public.create_bill(p_type public.bill_type, p_patient_id uuid, p_links jsonb default '{}', p_client_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_id uuid := coalesce(p_client_id, gen_random_uuid());
  v_treatment public.patient_treatments;
begin
  if exists (select 1 from public.bills where id = v_id) then
    return private.bill_card(v_id);
  end if;
  if not exists (select 1 from public.patients where id = p_patient_id and merged_into_id is null) then
    perform private.fail('not_found', 'patient');
  end if;
  select * into v_treatment from public.patient_treatments where id = (p_links ->> 'treatment_id')::uuid;
  insert into public.bills (id, bill_type, patient_id, doctor_id, treatment_id, visit_id, admission_id, tax_inclusive,
                            agreed_price_paise, referred_by_text)
  values (v_id, p_type, p_patient_id,
          coalesce((p_links ->> 'doctor_id')::uuid, v_treatment.doctor_id),
          v_treatment.id, (p_links ->> 'visit_id')::uuid, (p_links ->> 'admission_id')::uuid,
          coalesce((private.setting(case when p_type = 'pharmacy_invoice' then 'pharmacy' else 'billing' end,
                                    case when p_type = 'pharmacy_invoice' then 'prices_include_gst' else 'tax_inclusive' end,
                                    'true'))::boolean, true),
          v_treatment.agreed_price_paise,
          (select referred_by_text from public.patients where id = p_patient_id));
  return private.bill_card(v_id);
end;
$$;

-- Replace a DRAFT's header and lines. The server calculates every amount.
-- items: [{category_id?, kind, service_id?, pharmacy_item_id?, room_type_id?, doctor_id?, description,
--          hsn_sac?, rate_paise, qty, discount_type, discount_value, gst_rate_bp, service_date?, …}]
create function public.save_bill(p_bill_id uuid, p_header jsonb, p_items jsonb, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_bill public.bills;
  v_item jsonb;
  v_line integer := 0;
begin
  select * into v_bill from public.bills where id = p_bill_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if v_bill.status <> 'draft' then
    perform private.fail('bill_locked');
  end if;
  if v_bill.version <> p_version then
    perform private.fail('stale_version');
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
    perform private.fail('invalid_input', 'items');
  end if;

  update public.bills set
    doctor_id = case when p_header ? 'doctor_id' then (p_header ->> 'doctor_id')::uuid else doctor_id end,
    referred_by_text = case when p_header ? 'referred_by_text' then nullif(btrim(p_header ->> 'referred_by_text'), '') else referred_by_text end,
    tax_inclusive = coalesce((p_header ->> 'tax_inclusive')::boolean, tax_inclusive),
    notes = case when p_header ? 'notes' then nullif(btrim(p_header ->> 'notes'), '') else notes end,
    version = version + 1
  where id = p_bill_id;

  delete from public.bill_items where bill_id = p_bill_id and kind <> 'carried_in';
  for v_item in select value from jsonb_array_elements(p_items) loop
    continue when v_item ->> 'kind' = 'carried_in'; -- carried lines come only from the final-bill builder
    v_line := v_line + 1;
    insert into public.bill_items (bill_id, line_no, category_id, kind, service_id, pharmacy_item_id, batch_id, room_type_id,
      doctor_id, description, hsn_sac, mfg, batch_no, expiry_date, service_date, rate_paise, qty, discount_type,
      discount_value, gst_rate_bp)
    values (p_bill_id, v_line + 100, (v_item ->> 'category_id')::uuid, coalesce(v_item ->> 'kind', 'service'),
      (v_item ->> 'service_id')::uuid, (v_item ->> 'pharmacy_item_id')::uuid, (v_item ->> 'batch_id')::uuid,
      (v_item ->> 'room_type_id')::uuid, (v_item ->> 'doctor_id')::uuid, btrim(v_item ->> 'description'),
      nullif(btrim(v_item ->> 'hsn_sac'), ''), nullif(btrim(v_item ->> 'mfg'), ''), nullif(btrim(v_item ->> 'batch_no'), ''),
      (v_item ->> 'expiry_date')::date, (v_item ->> 'service_date')::date,
      (v_item ->> 'rate_paise')::bigint, (v_item ->> 'qty')::numeric,
      coalesce((v_item ->> 'discount_type')::public.discount_type, 'amount'),
      coalesce((v_item ->> 'discount_value')::bigint, 0), coalesce((v_item ->> 'gst_rate_bp')::int, 0));
  end loop;
  -- Renumber: carried-in lines first (final bill), then own lines in the order given.
  update public.bill_items i set line_no = r.n
    from (select id, row_number() over (order by (kind <> 'carried_in'), line_no) as n
            from public.bill_items where bill_id = p_bill_id) r
   where i.id = r.id;

  perform private.recompute_bill(p_bill_id);
  perform private.check_discount_limit(p_bill_id);
  return private.bill_card(p_bill_id);
exception
  when invalid_text_representation or not_null_violation or check_violation then
    perform private.fail('invalid_input', sqlerrm);
end;
$$;

-- Hook for later phases (pharmacy stock, final-bill consolidation): runs inside finalize.
create function private.on_bill_finalized(p_bill public.bills)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Phase 5: library usage counts. Phase 6 adds stock-out; Phase 7 stamps carried-in bills.
  perform private.library_used('services', i.service_id) from public.bill_items i
   where i.bill_id = p_bill.id and i.service_id is not null;
end;
$$;

create function private.clinic_snapshot(p_bill_type public.bill_type)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name', c.name, 'legal_name', c.legal_name, 'gstin', c.gstin, 'llpin', c.llpin, 'address_lines', to_jsonb(c.address_lines),
    'city', c.city, 'state', c.state, 'state_code', c.state_code, 'pincode', c.pincode, 'phones', to_jsonb(c.phones),
    'email', c.email, 'website', c.website, 'logo_path', c.logo_path, 'letterhead_qr_url', c.letterhead_qr_url,
    'signatory_label', c.signatory_label, 'terms', coalesce(c.terms -> p_bill_type::text, '[]'::jsonb))
  from public.clinic_settings c where c.branch_code = 'main';
$$;

create function private.patient_snapshot(p_patient_id uuid, p_doctor_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'full_name', concat_ws(' ', p.title, p.full_name), 'uhid', p.uhid, 'gender', p.gender,
    'age', private.age_years(p.dob), 'phone', p.phone_e164,
    'address', concat_ws(', ', nullif(p.address, ''), nullif(p.area, ''), nullif(p.city, ''), nullif(p.pincode, '')),
    'doctor', (select full_name from public.doctors where id = p_doctor_id))
  from public.patients p where p.id = p_patient_id;
$$;

-- Records desk payments for a bill (or from an advance) inside finalize / add_payment.
create function private.record_payments(p_patient_id uuid, p_bill_id uuid, p_payments jsonb, p_staff uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_id uuid;
begin
  for v_p in select value from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    v_id := coalesce((v_p ->> 'client_id')::uuid, gen_random_uuid());
    continue when exists (select 1 from public.payments where id = v_id);
    if not exists (select 1 from public.lookup_values where id = (v_p ->> 'mode_id')::uuid and kind = 'payment_mode') then
      perform private.fail('invalid_input', 'payment mode');
    end if;
    insert into public.payments (id, patient_id, kind, mode_id, amount_paise, reference, received_by, note,
                                 treatment_id, admission_id)
    select v_id, p_patient_id, 'payment', (v_p ->> 'mode_id')::uuid, (v_p ->> 'amount_paise')::bigint,
           nullif(btrim(v_p ->> 'reference'), ''), p_staff, nullif(btrim(v_p ->> 'note'), ''), b.treatment_id, b.admission_id
    from public.bills b where b.id = p_bill_id;
    insert into public.payment_allocations (payment_id, bill_id, amount_paise)
    values (v_id, p_bill_id, (v_p ->> 'amount_paise')::bigint);
    perform private.library_used('lookup_values', (v_p ->> 'mode_id')::uuid);
  end loop;
end;
$$;

-- Unallocated money the patient has with the clinic (advances / overpayments − refunds).
create function private.patient_credit(p_patient_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(case when p.kind = 'refund' then -p.amount_paise else p.amount_paise end)
                     from public.payments p where p.patient_id = p_patient_id and p.cancelled_at is null), 0)
       - coalesce((select sum(a.amount_paise) from public.payment_allocations a
                     join public.payments p on p.id = a.payment_id and p.cancelled_at is null
                    where p.patient_id = p_patient_id), 0);
$$;

-- Uses up to p_amount of the patient's unallocated credit for a bill (oldest payments first).
create function private.allocate_credit(p_patient_id uuid, p_bill_id uuid, p_amount bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_left bigint := p_amount;
  v_take bigint;
begin
  if p_amount <= 0 then
    return 0;
  end if;
  if p_amount > private.patient_credit(p_patient_id) then
    perform private.fail('over_allocated', 'more than the advance available');
  end if;
  for r in
    select p.id, p.amount_paise - coalesce((select sum(a.amount_paise) from public.payment_allocations a where a.payment_id = p.id), 0) as free
    from public.payments p
    where p.patient_id = p_patient_id and p.cancelled_at is null and p.kind in ('payment', 'advance')
    order by p.received_at, p.id
    for update of p
  loop
    exit when v_left = 0;
    continue when r.free <= 0;
    v_take := least(r.free, v_left);
    insert into public.payment_allocations (payment_id, bill_id, amount_paise) values (r.id, p_bill_id, v_take);
    v_left := v_left - v_take;
  end loop;
  return p_amount - v_left;
end;
$$;

-- Finalize: number (gap-free, in this transaction), frozen header + patient strip, payments.
-- If the treatment's agreed price is higher than what has been billed, a reason is required.
create function public.finalize_bill(p_bill_id uuid, p_version integer, p_payments jsonb default '[]',
                                     p_use_advance_paise bigint default 0, p_below_agreed_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_bill public.bills;
  v_lines integer;
  v_billed bigint;
  v_excluded text[];
begin
  select * into v_bill from public.bills where id = p_bill_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if v_bill.status <> 'draft' then
    perform private.fail('bill_locked');
  end if;
  if v_bill.version <> p_version then
    perform private.fail('stale_version');
  end if;
  select count(*) into v_lines from public.bill_items where bill_id = p_bill_id;
  if v_lines = 0 then
    perform private.fail('invalid_input', 'a bill needs at least one line');
  end if;
  perform private.check_discount_limit(p_bill_id);

  -- Agreed price check (PLAN.md A1 q8): categories excluded in Settings → Billing don't count.
  if v_bill.agreed_price_paise is not null and v_bill.treatment_id is not null then
    v_excluded := array(select jsonb_array_elements_text(private.setting('billing', 'agreed_price_categories_exclude', '["pharmacy"]')));
    select coalesce(sum(i.total_paise), 0) into v_billed
    from public.bill_items i
    join public.bills b on b.id = i.bill_id
    left join public.lookup_values c on c.id = i.category_id
    where b.treatment_id = v_bill.treatment_id and i.kind <> 'carried_in'
      and (b.id = p_bill_id or b.status = 'finalized')
      and coalesce(c.code, '') <> all (v_excluded);
    if v_billed < v_bill.agreed_price_paise and v_bill.bill_type = 'final_bill'
       and length(btrim(coalesce(p_below_agreed_reason, ''))) < 3 then
      perform private.fail('below_agreed_price', format('billed %s of agreed %s', v_billed, v_bill.agreed_price_paise));
    end if;
  end if;

  update public.bills set
    status = 'finalized',
    bill_no = private.take_number(bill_type::text::public.series_key, now()),
    fy = private.fy_label(now()),
    bill_at = now(),
    finalized_at = now(),
    finalized_by = v_staff,
    below_agreed_reason = nullif(btrim(p_below_agreed_reason), ''),
    header_snapshot = private.clinic_snapshot(bill_type),
    patient_snapshot = private.patient_snapshot(patient_id, doctor_id),
    version = version + 1
  where id = p_bill_id
  returning * into v_bill;

  perform private.on_bill_finalized(v_bill);
  perform private.record_payments(v_bill.patient_id, v_bill.id, p_payments, v_staff);
  perform private.allocate_credit(v_bill.patient_id, v_bill.id, coalesce(p_use_advance_paise, 0));
  return private.bill_card(p_bill_id);
end;
$$;

-- Payment / advance / refund at the desk. allocations: [{bill_id, amount_paise}].
create function public.add_payment(p_payment jsonb, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_kind public.payment_kind := coalesce((p_payment ->> 'kind')::public.payment_kind, 'payment');
  v_patient uuid := (p_payment ->> 'patient_id')::uuid;
  v_amount bigint := (p_payment ->> 'amount_paise')::bigint;
  v_alloc jsonb;
  v_row public.payments;
begin
  if p_client_id is null then
    perform private.fail('invalid_input', 'client id');
  end if;
  select * into v_row from public.payments where id = p_client_id;
  if found then
    return to_jsonb(v_row);
  end if;
  if v_amount is null or v_amount <= 0 then
    perform private.fail('invalid_input', 'amount');
  end if;
  if v_kind = 'refund' and v_amount > private.patient_credit(v_patient) then
    perform private.fail('over_allocated', 'a refund can''t be more than the patient''s advance');
  end if;
  insert into public.payments (id, patient_id, kind, mode_id, amount_paise, reference, received_by, treatment_id, note)
  values (p_client_id, v_patient, v_kind, (p_payment ->> 'mode_id')::uuid, v_amount,
          nullif(btrim(p_payment ->> 'reference'), ''), v_staff, (p_payment ->> 'treatment_id')::uuid,
          nullif(btrim(p_payment ->> 'note'), ''))
  returning * into v_row;
  if v_kind <> 'refund' then
    for v_alloc in select value from jsonb_array_elements(coalesce(p_payment -> 'allocations', '[]'::jsonb)) loop
      insert into public.payment_allocations (payment_id, bill_id, amount_paise)
      values (v_row.id, (v_alloc ->> 'bill_id')::uuid, (v_alloc ->> 'amount_paise')::bigint);
    end loop;
  end if;
  perform private.library_used('lookup_values', v_row.mode_id);
  return to_jsonb(v_row);
exception
  when foreign_key_violation or invalid_text_representation or not_null_violation then
    perform private.fail('invalid_input', sqlerrm);
end;
$$;

-- Use the patient's advance for a finalized bill.
create function public.apply_advance(p_bill_id uuid, p_amount_paise bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill public.bills;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select * into v_bill from public.bills where id = p_bill_id;
  if not found or v_bill.status <> 'finalized' then
    perform private.fail('not_found');
  end if;
  perform private.allocate_credit(v_bill.patient_id, p_bill_id, p_amount_paise);
  return private.bill_card(p_bill_id);
end;
$$;

-- Admin: cancel a payment (its allocations are released). Reason required.
create function public.cancel_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.require_staff(array['admin']::public.staff_role[]);
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    perform private.fail('reason_required');
  end if;
  perform set_config('app.reason', btrim(p_reason), true);
  update public.payments set cancelled_at = now(), cancelled_by = v_admin, cancel_reason = btrim(p_reason)
   where id = p_payment_id and cancelled_at is null;
  if not found then
    perform private.fail('not_found');
  end if;
  delete from public.payment_allocations where payment_id = p_payment_id;
  -- A cancelled payment can't leave a refund bigger than what remains.
  if private.patient_credit((select patient_id from public.payments where id = p_payment_id)) < 0 then
    perform private.fail('over_allocated', 'cancel the refund first');
  end if;
end;
$$;

-- Admin: change a finalized bill's lines. The number stays; the old version is kept.
create function public.amend_bill(p_bill_id uuid, p_items jsonb, p_reason text)
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
  select coalesce(sum(a.amount_paise), 0) into v_paid from public.payment_allocations a
    join public.payments p on p.id = a.payment_id and p.cancelled_at is null where a.bill_id = p_bill_id;
  if v_paid > v_bill.total_paise + v_bill.carried_in_paise then
    perform private.fail('over_allocated', 'the new total is less than what was paid; cancel or move a payment first');
  end if;
  perform set_config('app.bill_amend', '', true);
  return private.bill_card(p_bill_id);
end;
$$;

-- Admin: cancel a finalized bill. It keeps its number and prints CANCELLED; payments are released.
create function public.cancel_bill(p_bill_id uuid, p_reason text)
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
  perform set_config('app.bill_amend', '', true);
  return private.bill_card(p_bill_id);
end;
$$;

-- Reception: throw away a draft (it has no number yet).
create function public.discard_draft_bill(p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  if not exists (select 1 from public.bills where id = p_bill_id and status = 'draft') then
    perform private.fail('bill_locked');
  end if;
  delete from public.bill_items where bill_id = p_bill_id;
  delete from public.bills where id = p_bill_id;
end;
$$;

-- Everything the A4 print needs, frozen at finalize. Counts prints: the first is the
-- "Original", later ones say "Duplicate copy".
create function public.bill_print_data(p_bill_id uuid, p_count boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill public.bills;
  v_copy text;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select * into v_bill from public.bills where id = p_bill_id;
  if not found then
    perform private.fail('not_found');
  end if;
  if p_count and v_bill.status <> 'draft' then
    update public.bills set print_count = print_count + 1 where id = p_bill_id returning * into v_bill;
  end if;
  v_copy := case when v_bill.status = 'draft' then 'draft'
                 when v_bill.status = 'cancelled' then 'cancelled'
                 when v_bill.print_count <= 1 then 'original' else 'duplicate' end;
  return private.bill_card(p_bill_id) || jsonb_build_object(
    'copy', v_copy,
    'header', coalesce(v_bill.header_snapshot, private.clinic_snapshot(v_bill.bill_type)),
    'patient_strip', coalesce(v_bill.patient_snapshot, private.patient_snapshot(v_bill.patient_id, v_bill.doctor_id)),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('received_at', p.received_at, 'mode', m.label, 'reference', p.reference,
                                          'amount_paise', a.amount_paise) order by p.received_at)
      from public.payment_allocations a
      join public.payments p on p.id = a.payment_id and p.cancelled_at is null
      join public.lookup_values m on m.id = p.mode_id
      where a.bill_id = p_bill_id), '[]'::jsonb));
end;
$$;

create function public.get_bill(p_bill_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  if not exists (select 1 from public.bills where id = p_bill_id) then
    perform private.fail('not_found');
  end if;
  return private.bill_card(p_bill_id) || jsonb_build_object(
    'patient_credit_paise', private.patient_credit((select patient_id from public.bills where id = p_bill_id)));
end;
$$;

-- Billed, received, outstanding and unallocated advance for one patient.
create function public.patient_balance(p_patient_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_billed bigint;
  v_received bigint;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select coalesce(sum(total_paise), 0) into v_billed from public.bills
   where patient_id = p_patient_id and status = 'finalized';
  select coalesce(sum(case when kind = 'refund' then -amount_paise else amount_paise end), 0) into v_received
    from public.payments where patient_id = p_patient_id and cancelled_at is null;
  return jsonb_build_object(
    'billed_paise', v_billed, 'received_paise', v_received,
    'balance_paise', v_billed - v_received,
    'advance_paise', greatest(private.patient_credit(p_patient_id), 0));
end;
$$;

-- Bills table: filters + offset paging with an exact count (max 100), range ≤ 1 year.
create function public.bills_table(p_filters jsonb default '{}', p_offset integer default 0, p_limit integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_from date := coalesce((p_filters ->> 'from')::date, (private.ist(now()))::date - 30);
  v_to date := coalesce((p_filters ->> 'to')::date, (private.ist(now()))::date);
  v_status public.doc_status := (p_filters ->> 'status')::public.doc_status;
  v_type public.bill_type := (p_filters ->> 'bill_type')::public.bill_type;
  v_patient uuid := (p_filters ->> 'patient_id')::uuid;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  if v_patient is null and (v_to < v_from or v_to - v_from > 366) then
    perform private.fail('invalid_input', 'date range (max one year)');
  end if;
  return (
    with filtered as (
      select b.* from public.bills b
      where (v_patient is not null and b.patient_id = v_patient
             or v_patient is null and coalesce(b.bill_at, b.created_at) >= private.ist_at(v_from, '00:00')
                                  and coalesce(b.bill_at, b.created_at) < private.ist_at(v_to + 1, '00:00'))
        and (v_status is null or b.status = v_status)
        and (v_type is null or b.bill_type = v_type)
    )
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      'sum_paise', (select coalesce(sum(total_paise), 0) from filtered where status = 'finalized'),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', f.id, 'bill_type', f.bill_type, 'bill_no', f.bill_no, 'status', f.status, 'bill_at', f.bill_at,
          'created_at', f.created_at, 'total_paise', f.total_paise + f.carried_in_paise, 'patient_id', f.patient_id,
          'patient', p.full_name, 'uhid', p.uhid,
          'received_paise', coalesce((select sum(a.amount_paise) from public.payment_allocations a
                                        join public.payments pay on pay.id = a.payment_id and pay.cancelled_at is null
                                       where a.bill_id = f.id), 0))
          order by coalesce(f.bill_at, f.created_at) desc, f.id)
        from (select * from filtered order by coalesce(bill_at, created_at) desc, id limit v_limit offset greatest(coalesce(p_offset, 0), 0)) f
        join public.patients p on p.id = f.patient_id), '[]'::jsonb)));
end;
$$;

------------------------------------------------------------------------------
-- KPI rollup (PLAN.md B6): closed days live in kpi_daily (additive counts and sums);
-- today is computed live by the SAME function, so the two can't disagree.
-- Each metric is ONE grouped query over the day — never a query per bill or per row.
------------------------------------------------------------------------------
create table public.kpi_daily (
  day date not null,
  metric text not null check (metric ~ '^[a-z_]+$'),
  dim_kind text not null default 'clinic' check (dim_kind in ('clinic', 'doctor', 'staff', 'source', 'bill_type', 'mode', 'category')),
  dim_id text not null default '',
  value numeric not null,
  primary key (day, metric, dim_kind, dim_id)
);
create table public.kpi_dirty_days (
  day date primary key,
  marked_at timestamptz not null default now()
);
alter table public.kpi_daily enable row level security;
alter table public.kpi_dirty_days enable row level security;
grant select on public.kpi_daily, public.kpi_dirty_days to authenticated;
create policy kpi_daily_select on public.kpi_daily for select to authenticated using ((select private.has_role('admin')));
create policy kpi_dirty_days_select on public.kpi_dirty_days for select to authenticated using ((select private.has_role('admin')));

create function private.kpi_compute_day(p_day date)
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
  appt_day as (select a.* from public.appointments a where a.appt_date = p_day)
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
  where p.created_at >= bounds.lo and p.created_at < bounds.hi and p.merged_into_id is null;
$$;

create function private.kpi_rollup_day(p_day date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  delete from public.kpi_daily where day = p_day;
  insert into public.kpi_daily (day, metric, dim_kind, dim_id, value)
  select p_day, k.metric, k.dim_kind, k.dim_id, k.value from private.kpi_compute_day(p_day) k where k.value <> 0;
  get diagnostics v_n = row_count;
  delete from public.kpi_dirty_days where day = p_day;
  return v_n;
end;
$$;

-- A backdated change marks its (closed) day for recomputing within the hour.
create function private.kpi_mark_dirty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (private.ist(now()))::date;
  -- Rows as JSON: one trigger serves three tables, and OLD/NEW may be absent.
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_field text := case tg_table_name when 'bills' then 'bill_at' when 'payments' then 'received_at' else 'appt_date' end;
begin
  insert into public.kpi_dirty_days (day)
  select distinct d
  from (
    select case when v_field = 'appt_date' then (x ->> v_field)::date
                else (private.ist((x ->> v_field)::timestamptz))::date end as d
    from unnest(array[v_new, v_old]) x
    where x is not null and x ->> v_field is not null
  ) days
  where d < v_today
  on conflict (day) do update set marked_at = now();
  return coalesce(new, old);
end;
$$;
create trigger bills_kpi_dirty after insert or update or delete on public.bills
  for each row execute function private.kpi_mark_dirty();
create trigger payments_kpi_dirty after insert or update or delete on public.payments
  for each row execute function private.kpi_mark_dirty();
create trigger appointments_kpi_dirty after insert or update or delete on public.appointments
  for each row execute function private.kpi_mark_dirty();

create function private.kpi_recompute_dirty(p_max integer default 31)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date;
  v_n integer := 0;
begin
  for v_day in select day from public.kpi_dirty_days order by day limit p_max loop
    perform private.kpi_rollup_day(v_day);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Metric totals over a range: closed days from kpi_daily (one grouped scan), today live.
create function private.kpi_range(p_from date, p_to date)
returns table (metric text, dim_kind text, dim_id text, value numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select k.metric, k.dim_kind, k.dim_id, sum(k.value)
  from (
    select d.metric, d.dim_kind, d.dim_id, d.value from public.kpi_daily d
    where d.day between p_from and least(p_to, (private.ist(now()))::date - 1)
    union all
    select c.metric, c.dim_kind, c.dim_id, c.value from private.kpi_compute_day((private.ist(now()))::date) c
    where (private.ist(now()))::date between p_from and p_to
  ) k
  group by k.metric, k.dim_kind, k.dim_id;
$$;

-- 00:15 IST (18:45 UTC): yesterday's rollup. Hourly: recompute backdated days.
select cron.schedule('kpi-rollup-yesterday', '45 18 * * *',
  $$select private.kpi_rollup_day((private.ist(now()))::date - 1)$$);
select cron.schedule('kpi-recompute-dirty', '5 * * * *', $$select private.kpi_recompute_dirty()$$);

-- Reception dashboard: today's collections by mode join the tiles.
create or replace function public.dashboard_reception(p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day date := coalesce(p_date, (private.ist(now()))::date);
  v_past date[] := array(select v_day - (7 * w) from generate_series(1, 8) w);
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  return jsonb_build_object(
    'date', v_day,
    'tiles', public.today_board(v_day) -> 'counts',
    'arrivals_by_hour', (
      select jsonb_agg(jsonb_build_object('hour', h, 'today', coalesce(t.n, 0), 'typical', round(coalesce(p.n, 0) / 8.0, 1)) order by h)
      from generate_series(7, 21) h
      left join (
        select extract(hour from private.ist(a.arrived_at))::int as hour, count(*) as n
        from public.appointments a where a.appt_date = v_day and a.arrived_at is not null group by 1
      ) t on t.hour = h
      left join (
        select extract(hour from private.ist(a.arrived_at))::int as hour, count(*) as n
        from public.appointments a where a.appt_date = any (v_past) and a.arrived_at is not null group by 1
      ) p on p.hour = h),
    'doctor_load', coalesce((
      select jsonb_agg(jsonb_build_object('doctor', coalesce(d.display_name, d.full_name), 'counts', x.counts)
                       order by d.sort, d.full_name)
      from (
        select a.doctor_id, jsonb_object_agg(a.status, a.n) as counts
        from (select doctor_id, status, count(*) as n from public.appointments
               where appt_date = v_day and doctor_id is not null and status not in ('cancelled', 'rescheduled')
               group by doctor_id, status) a
        group by a.doctor_id
      ) x join public.doctors d on d.id = x.doctor_id), '[]'::jsonb),
    'followups', jsonb_build_object(
      'due', (select count(*) from public.followups where status = 'open' and due_date = v_day),
      'overdue', (select count(*) from public.followups where status = 'open' and due_date < v_day)),
    -- Reception sees today's collections only (PLAN.md B6 defaults). The day is computed once.
    'collections', (
      with k as materialized (select * from private.kpi_compute_day(v_day))
      select jsonb_build_object(
        'total_paise', coalesce((select sum(value) from k where metric = 'collected_paise' and dim_kind = 'clinic'), 0),
        'by_mode', coalesce((
          select jsonb_agg(jsonb_build_object('mode', coalesce(m.label, k.dim_id), 'paise', k.value) order by k.value desc)
          from k left join public.lookup_values m on m.kind = 'payment_mode' and (m.code = k.dim_id or m.id::text = k.dim_id)
          where k.metric = 'collected_paise' and k.dim_kind = 'mode'), '[]'::jsonb),
        'bills', coalesce((select sum(value) from k where metric = 'bills_count'), 0))));
end;
$$;

-- Timeline: bills and payments.
create or replace function private.patient_events(p_patient_id uuid)
returns table (at timestamptz, id uuid, kind text, title text, ref jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select p.created_at, p.id, 'registered', 'Registered — UHID ' || p.uhid, jsonb_build_object('uhid', p.uhid)
  from public.patients p where p.id = p_patient_id
  union all
  select d.created_at, d.id, 'document', d.title,
         jsonb_build_object('document_id', d.id, 'file_id', d.file_id, 'kind', l.label)
  from public.documents d left join public.lookup_values l on l.id = d.kind_id
  where d.patient_id = p_patient_id and not d.archived
  union all
  select m.merged_at, m.id, 'merged', 'Merged another record into this one',
         jsonb_build_object('from_id', m.from_id, 'moved', m.moved)
  from public.patient_merges m where m.into_id = p_patient_id
  union all
  select coalesce(a.slot_start, a.arrived_at, a.created_at), a.id, 'appointment',
         coalesce(dr.display_name, dr.full_name, 'Walk-in') || ' — ' || a.status::text,
         jsonb_build_object('status', a.status, 'type', a.type, 'doctor_id', a.doctor_id)
  from public.appointments a left join public.doctors dr on dr.id = a.doctor_id
  where a.patient_id = p_patient_id and a.status <> 'rescheduled'
  union all
  select t.created_at, t.id, 'treatment', 'Started ' || t.name, jsonb_build_object('treatment_id', t.id, 'status', t.status)
  from public.patient_treatments t where t.patient_id = p_patient_id
  union all
  select private.ist_at(s.actual_date, '12:00'), s.id, 'session',
         format('%s — session %s done', t.name, s.seq), jsonb_build_object('treatment_id', t.id, 'seq', s.seq)
  from public.treatment_sessions s join public.patient_treatments t on t.id = s.treatment_id
  where s.patient_id = p_patient_id and s.status = 'done' and s.actual_date is not null
  union all
  select b.bill_at, b.id, 'bill', format('%s %s — %s', b.bill_type, b.bill_no, b.status),
         jsonb_build_object('bill_id', b.id, 'total_paise', b.total_paise + b.carried_in_paise)
  from public.bills b where b.patient_id = p_patient_id and b.status <> 'draft'
  union all
  select p.received_at, p.id, 'payment', format('%s received', p.kind),
         jsonb_build_object('amount_paise', p.amount_paise, 'cancelled', p.cancelled_at is not null)
  from public.payments p where p.patient_id = p_patient_id;
$$;

grant execute on function
  public.create_bill(public.bill_type, uuid, jsonb, uuid),
  public.save_bill(uuid, jsonb, jsonb, integer),
  public.finalize_bill(uuid, integer, jsonb, bigint, text),
  public.add_payment(jsonb, uuid),
  public.apply_advance(uuid, bigint),
  public.cancel_payment(uuid, text),
  public.amend_bill(uuid, jsonb, text),
  public.cancel_bill(uuid, text),
  public.discard_draft_bill(uuid),
  public.bill_print_data(uuid, boolean),
  public.get_bill(uuid),
  public.patient_balance(uuid),
  public.bills_table(jsonb, integer, integer)
to authenticated;

select private.lock_down_public_functions();
