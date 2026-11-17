-- Breakdown bill for insurance + the lists behind the four billing sections
-- (owner, 16/11/2026 training + 17/11/2026: "surgery bill, pharmacy bill, breakdown bill for insurance
-- and discharge summary bill"; "I need all for that surgery selected and select session, more
-- customised even after autofill"; "amount can change, no problem, edit freely, the final one is saved").
--
--   * public.breakdown_bills (+ lines, + versions): its own tables, so a breakdown bill never counts as
--     money owed anywhere (patient dues, bills_table, treatment money, dashboards all read public.bills).
--   * create_breakdown_bill(patient, sources {treatment_id?, admission_id?, session_ids[], bill_ids[]}):
--     lines filled from the chosen finalized bills (a final bill's carried-in line is skipped when the
--     bill it came from is chosen too). Staff then change anything: amounts, split, add, rename.
--     No total check; billed_ref_paise (what the chosen bills came to) is kept for the screen only.
--   * finalize → number from series 'breakdown_bill' + frozen header and patient/stay facts.
--     Admin amend keeps the old copy (breakdown_bill_versions); admin cancel; a draft can be discarded.
--   * breakdown_bills_table / discharge_summaries_table: the 3rd and 4th section lists.
--   * bills_table: filter `bill_types` (several types: the Surgery section = surgery bills + IP final bills).
--   * bill_paperwork(bill): the breakdown bills and the discharge summary that belong with a bill.

create table public.breakdown_bills (
  id uuid primary key,
  patient_id uuid not null references public.patients (id),
  treatment_id uuid references public.patient_treatments (id),
  admission_id uuid references public.admissions (id),
  -- What it was filled from: {treatment_id, admission_id, session_ids: [], bill_ids: []}.
  sources jsonb not null default '{}'::jsonb check (jsonb_typeof(sources) = 'object'),
  bb_no text unique,
  fy text,
  status public.doc_status not null default 'draft',
  version integer not null default 1,
  bill_date date not null default ((now() at time zone 'Asia/Kolkata')::date),
  doctor_id uuid references public.doctors (id),
  insurer text check (length(insurer) <= 120),
  tpa text check (length(tpa) <= 120),
  policy_no text check (length(policy_no) <= 60),
  claim_no text check (length(claim_no) <= 60),
  notes text check (length(notes) <= 1000),
  total_paise bigint not null default 0 check (total_paise >= 0),
  billed_ref_paise bigint not null default 0,
  header_snapshot jsonb,
  patient_snapshot jsonb,
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
  check (status = 'draft' or bb_no is not null)
);
create index breakdown_bills_patient on public.breakdown_bills (patient_id, created_at desc);
create index breakdown_bills_when on public.breakdown_bills ((coalesce(finalized_at, created_at)) desc, id);
create index breakdown_bills_treatment on public.breakdown_bills (treatment_id) where treatment_id is not null;
create index breakdown_bills_admission on public.breakdown_bills (admission_id) where admission_id is not null;
create trigger breakdown_bills_touch before update on public.breakdown_bills
  for each row execute function private.touch_updated();
create trigger breakdown_bills_audit after insert or update or delete on public.breakdown_bills
  for each row execute function private.audit_row();

create table public.breakdown_bill_lines (
  id uuid primary key default gen_random_uuid(),
  breakdown_id uuid not null references public.breakdown_bills (id) on delete cascade,
  line_no smallint not null check (line_no >= 1),
  category_id uuid references public.lookup_values (id),
  description text not null check (length(btrim(description)) between 1 and 300),
  service_date date,
  qty numeric(10, 3) not null default 1 check (qty > 0),
  unit_paise bigint not null default 0 check (unit_paise >= 0),
  gst_rate_bp integer not null default 0 check (gst_rate_bp between 0 and 4000),
  -- Amount as printed (includes GST where the bill charged it). Staff may type any amount.
  amount_paise bigint not null check (amount_paise >= 0),
  source_bill_item_id uuid references public.bill_items (id) on delete set null,
  unique (breakdown_id, line_no)
);
comment on constraint breakdown_bill_lines_category_id_fkey on public.breakdown_bill_lines is 'merge:keep';

create table public.breakdown_bill_versions (
  id uuid primary key default gen_random_uuid(),
  breakdown_id uuid not null references public.breakdown_bills (id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  edited_by uuid references public.staff (id),
  reason text not null,
  at timestamptz not null default now(),
  unique (breakdown_id, version)
);

alter table public.breakdown_bills enable row level security;
alter table public.breakdown_bill_lines enable row level security;
alter table public.breakdown_bill_versions enable row level security;
grant select on public.breakdown_bills, public.breakdown_bill_lines, public.breakdown_bill_versions to authenticated;
create policy breakdown_bills_select on public.breakdown_bills for select to authenticated
  using ((select private.has_role('receptionist', 'admin')));
create policy breakdown_bill_lines_select on public.breakdown_bill_lines for select to authenticated
  using ((select private.has_role('receptionist', 'admin')));
create policy breakdown_bill_versions_select on public.breakdown_bill_versions for select to authenticated
  using ((select private.has_role('admin')));

------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------
-- A finalized bill as a small chip for the picker and the "filled from" list.
create function private.bb_bill_chip(b public.bills)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', b.id, 'bill_no', b.bill_no, 'bill_type', b.bill_type, 'status', b.status,
                            'bill_at', b.bill_at, 'total_paise', b.total_paise + b.carried_in_paise);
$$;

-- Checks what a breakdown is filled from (everything must be this patient's; bills finalized) and
-- returns it tidied: {treatment_id, admission_id, session_ids: [...], bill_ids: [...]}.
create function private.bb_sources(p_patient_id uuid, p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_src jsonb := coalesce(p, '{}'::jsonb);
  v_treatment uuid;
  v_admission uuid;
  v_sessions uuid[];
  v_bills uuid[];
begin
  if jsonb_typeof(v_src) <> 'object'
     or jsonb_typeof(coalesce(v_src -> 'session_ids', '[]')) <> 'array'
     or jsonb_typeof(coalesce(v_src -> 'bill_ids', '[]')) <> 'array' then
    perform private.fail('invalid_input', 'sources');
  end if;
  v_treatment := (v_src ->> 'treatment_id')::uuid;
  v_admission := (v_src ->> 'admission_id')::uuid;
  v_sessions := array(select distinct x::uuid from jsonb_array_elements_text(coalesce(v_src -> 'session_ids', '[]')) x);
  v_bills := array(select distinct x::uuid from jsonb_array_elements_text(coalesce(v_src -> 'bill_ids', '[]')) x);
  if cardinality(v_sessions) > 100 or cardinality(v_bills) > 100 then
    perform private.fail('invalid_input', 'too many sessions or bills');
  end if;
  if v_admission is not null then
    if not exists (select 1 from public.admissions where id = v_admission and patient_id = p_patient_id and status <> 'cancelled') then
      perform private.fail('invalid_input', 'admission');
    end if;
    v_treatment := coalesce(v_treatment, (select treatment_id from public.admissions where id = v_admission));
  end if;
  if exists (select 1 from unnest(v_sessions) s
             where not exists (select 1 from public.treatment_sessions ts where ts.id = s and ts.patient_id = p_patient_id)) then
    perform private.fail('invalid_input', 'session');
  end if;
  v_treatment := coalesce(v_treatment, (select ts.treatment_id from public.treatment_sessions ts
                                         where ts.id = any (v_sessions) order by ts.seq limit 1));
  if v_treatment is not null
     and not exists (select 1 from public.patient_treatments where id = v_treatment and patient_id = p_patient_id) then
    perform private.fail('invalid_input', 'treatment');
  end if;
  if exists (select 1 from unnest(v_bills) x
             where not exists (select 1 from public.bills b where b.id = x and b.patient_id = p_patient_id and b.status = 'finalized')) then
    perform private.fail('invalid_input', 'bill (finalized bills of this patient only)');
  end if;
  return jsonb_build_object('treatment_id', v_treatment, 'admission_id', v_admission,
                            'session_ids', to_jsonb(v_sessions), 'bill_ids', to_jsonb(v_bills));
end;
$$;

create function private.bb_ids(p jsonb, p_key text)
returns uuid[]
language sql
immutable
as $$
  select coalesce(array(select x::uuid from jsonb_array_elements_text(coalesce(p -> p_key, '[]')) x), '{}');
$$;

-- Lines from the chosen finalized bills, by category (in the list's order), then date and line.
-- A final bill's carried-in line is skipped when the bill it was carried from is chosen too.
create function private.bb_lines_from(p_bill_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'category_id', x.cat, 'description', i.description,
           'service_date', coalesce(i.service_date, (private.ist(b.bill_at))::date),
           'qty', i.qty,
           'unit_paise', private.round_div(i.total_paise::numeric * 1000, greatest(round(i.qty * 1000), 1)),
           'gst_rate_bp', i.gst_rate_bp, 'amount_paise', i.total_paise, 'source_bill_item_id', i.id)
         order by coalesce(c.sort, 1000), c.label, b.bill_at, b.id, i.line_no), '[]'::jsonb)
  from public.bills b
  join public.bill_items i on i.bill_id = b.id
  left join public.bill_items si on si.id = i.carried_from_item_id
  cross join lateral (
    select coalesce(i.category_id,
                    case when b.bill_type = 'pharmacy_invoice' or i.kind = 'pharmacy'
                         then (select lv.id from public.lookup_values lv where lv.kind = 'bill_category' and lv.code = 'pharmacy') end) as cat
  ) x
  left join public.lookup_values c on c.id = x.cat
  where b.id = any (p_bill_ids) and b.status = 'finalized'
    and not (i.kind = 'carried_in' and si.bill_id is not null and si.bill_id = any (p_bill_ids));
$$;

-- What the chosen bills came to (each amount once): their own totals, plus carried-in lines whose
-- source bill is not chosen. Shown beside the breakdown for reference only.
create function private.bb_billed_ref(p_bill_ids uuid[])
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select (coalesce((select sum(b.total_paise) from public.bills b where b.id = any (p_bill_ids) and b.status = 'finalized'), 0)
        + coalesce((select sum(i.total_paise) from public.bill_items i
                    join public.bills fb on fb.id = i.bill_id and fb.status = 'finalized'
                    join public.bill_items si on si.id = i.carried_from_item_id
                    where fb.id = any (p_bill_ids) and i.kind = 'carried_in' and not (si.bill_id = any (p_bill_ids))), 0))::bigint;
$$;

-- Replaces a breakdown's lines (max 300) and its total. Lines: [{category_id?, description, service_date?,
-- qty?, unit_paise?, gst_rate_bp?, amount_paise?, source_bill_item_id?}]; a missing amount = qty × unit.
create function private.bb_write_lines(p_id uuid, p_lines jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line jsonb;
  v_no integer;
  v_desc text;
  v_qty numeric;
  v_unit bigint;
  v_amount bigint;
  v_gst integer;
  v_cat uuid;
  v_src uuid;
begin
  if jsonb_typeof(coalesce(p_lines, '[]')) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]')) > 300 then
    perform private.fail('invalid_input', 'lines (at most 300)');
  end if;
  delete from public.breakdown_bill_lines where breakdown_id = p_id;
  for v_line, v_no in select e.value, e.ordinality from jsonb_array_elements(coalesce(p_lines, '[]')) with ordinality e loop
    if jsonb_typeof(v_line) <> 'object' then
      perform private.fail('invalid_input', 'line');
    end if;
    v_desc := btrim(coalesce(v_line ->> 'description', ''));
    if length(v_desc) not between 1 and 300 then
      perform private.fail('invalid_input', format('line %s: description', v_no));
    end if;
    v_qty := coalesce((v_line ->> 'qty')::numeric, 1);
    if v_qty <= 0 or v_qty > 9999999 then
      perform private.fail('invalid_quantity', format('line %s', v_no));
    end if;
    v_unit := coalesce((v_line ->> 'unit_paise')::bigint, 0);
    v_amount := coalesce((v_line ->> 'amount_paise')::bigint, private.round_div(v_unit::numeric * round(v_qty * 1000), 1000));
    if v_unit < 0 or v_amount < 0 or v_amount > 1000000000000 then
      perform private.fail('invalid_input', format('line %s: amount', v_no));
    end if;
    v_gst := coalesce((v_line ->> 'gst_rate_bp')::integer, 0);
    if v_gst not between 0 and 4000 then
      perform private.fail('invalid_input', format('line %s: GST rate', v_no));
    end if;
    v_cat := (v_line ->> 'category_id')::uuid;
    if v_cat is not null and not exists (select 1 from public.lookup_values where id = v_cat and kind = 'bill_category') then
      perform private.fail('invalid_input', format('line %s: category', v_no));
    end if;
    v_src := (v_line ->> 'source_bill_item_id')::uuid;
    if v_src is not null and not exists (select 1 from public.bill_items where id = v_src) then
      v_src := null;
    end if;
    insert into public.breakdown_bill_lines (breakdown_id, line_no, category_id, description, service_date, qty, unit_paise,
                                             gst_rate_bp, amount_paise, source_bill_item_id)
    values (p_id, v_no, v_cat, v_desc, (v_line ->> 'service_date')::date, v_qty, v_unit, v_gst, v_amount, v_src);
  end loop;
  update public.breakdown_bills
     set total_paise = coalesce((select sum(amount_paise) from public.breakdown_bill_lines where breakdown_id = p_id), 0)
   where id = p_id;
end;
$$;

-- Header fields staff may change: {bill_date?, doctor_id?, insurer?, tpa?, policy_no?, claim_no?, notes?}.
-- A key that is left out keeps its value; an empty text clears it.
create function private.bb_write_header(p_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_h jsonb := coalesce(p, '{}'::jsonb);
  v_doctor uuid := (v_h ->> 'doctor_id')::uuid;
begin
  if jsonb_typeof(v_h) <> 'object' then
    perform private.fail('invalid_input', 'header');
  end if;
  if v_doctor is not null and not exists (select 1 from public.doctors where id = v_doctor) then
    perform private.fail('invalid_input', 'doctor');
  end if;
  if length(v_h ->> 'insurer') > 120 or length(v_h ->> 'tpa') > 120 or length(v_h ->> 'policy_no') > 60
     or length(v_h ->> 'claim_no') > 60 or length(v_h ->> 'notes') > 1000 then
    perform private.fail('invalid_input', 'a header field is too long');
  end if;
  update public.breakdown_bills set
    bill_date = case when v_h ? 'bill_date' and v_h ->> 'bill_date' is not null then (v_h ->> 'bill_date')::date else bill_date end,
    doctor_id = case when v_h ? 'doctor_id' then v_doctor else doctor_id end,
    insurer = case when v_h ? 'insurer' then nullif(btrim(v_h ->> 'insurer'), '') else insurer end,
    tpa = case when v_h ? 'tpa' then nullif(btrim(v_h ->> 'tpa'), '') else tpa end,
    policy_no = case when v_h ? 'policy_no' then nullif(btrim(v_h ->> 'policy_no'), '') else policy_no end,
    claim_no = case when v_h ? 'claim_no' then nullif(btrim(v_h ->> 'claim_no'), '') else claim_no end,
    notes = case when v_h ? 'notes' then nullif(btrim(v_h ->> 'notes'), '') else notes end
  where id = p_id;
end;
$$;

-- Patient, stay and treatment facts printed on the breakdown (frozen at finalize).
create function private.bb_facts(b public.breakdown_bills)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.patient_snapshot(b.patient_id, b.doctor_id) || jsonb_strip_nulls(jsonb_build_object(
    'treatment', t.name,
    'ip_number', a.ip_number, 'admitted_at', a.admitted_at, 'discharged_at', a.discharged_at,
    'diagnosis', a.diagnosis, 'procedures', case when a.id is not null then to_jsonb(a.procedures) end,
    'surgeon', (select coalesce(d.display_name, d.full_name) from public.admission_surgeons s
                  join public.doctors d on d.id = s.doctor_id
                 where s.admission_id = a.id order by s.role = 'primary' desc, d.full_name limit 1),
    'session_dates', (select jsonb_agg(coalesce(s.actual_date, s.planned_date) order by s.seq)
                        from public.treatment_sessions s where s.id = any (private.bb_ids(b.sources, 'session_ids'))),
    'insurer', b.insurer, 'tpa', b.tpa, 'policy_no', b.policy_no, 'claim_no', b.claim_no))
  from (select 1) one
  left join public.patient_treatments t on t.id = b.treatment_id
  left join public.admissions a on a.id = b.admission_id;
$$;

create function private.breakdown_card(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select (to_jsonb(b) - 'header_snapshot' - 'patient_snapshot') || jsonb_build_object(
    'patient', p.full_name, 'uhid', p.uhid,
    'doctor', coalesce(d.display_name, d.full_name),
    'treatment', t.name,
    'ip_number', a.ip_number,
    'lines', coalesce((
      select jsonb_agg(to_jsonb(l) || jsonb_build_object('category', c.label, 'category_code', c.code) order by l.line_no)
      from public.breakdown_bill_lines l left join public.lookup_values c on c.id = l.category_id
      where l.breakdown_id = b.id), '[]'::jsonb),
    'source_bills', coalesce((
      select jsonb_agg(private.bb_bill_chip(sb) order by sb.bill_at, sb.id)
      from public.bills sb where sb.id = any (private.bb_ids(b.sources, 'bill_ids'))), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'seq', s.seq, 'date', coalesce(s.actual_date, s.planned_date)) order by s.seq)
      from public.treatment_sessions s where s.id = any (private.bb_ids(b.sources, 'session_ids'))), '[]'::jsonb),
    'billed_now_paise', private.bb_billed_ref(private.bb_ids(b.sources, 'bill_ids')))
  from public.breakdown_bills b
  join public.patients p on p.id = b.patient_id
  left join public.doctors d on d.id = b.doctor_id
  left join public.patient_treatments t on t.id = b.treatment_id
  left join public.admissions a on a.id = b.admission_id
  where b.id = p_id;
$$;

------------------------------------------------------------------------------
-- What a patient's breakdown can be filled from: each treatment with its sessions (and their bills),
-- its own bills and IP stays; stays without a treatment; other bills; breakdowns already made.
-- Bills: finalized only. A session's bills are those made for it, and older ones made for its visit.
------------------------------------------------------------------------------
create function public.breakdown_sources(p_patient_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  if not exists (select 1 from public.patients where id = p_patient_id) then
    perform private.fail('not_found', 'patient');
  end if;
  return jsonb_build_object(
    'treatments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'name', t.name, 'category', t.category, 'status', t.status, 'start_date', t.start_date,
               'doctor', coalesce(d.display_name, d.full_name),
               'sessions', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', s.id, 'seq', s.seq, 'planned_date', s.planned_date, 'actual_date', s.actual_date, 'status', s.status,
                          'bills', coalesce((
                            select jsonb_agg(private.bb_bill_chip(b) order by b.bill_at, b.id)
                            from public.bills b
                            where b.patient_id = t.patient_id and b.status = 'finalized'
                              and (b.session_id = s.id
                                   or b.session_id is null and b.admission_id is null and b.visit_id is not null
                                      and b.visit_id = (select v.id from public.visits v where v.appointment_id = s.appointment_id))),
                            '[]'::jsonb))
                        order by s.seq)
                 from public.treatment_sessions s where s.treatment_id = t.id), '[]'::jsonb),
               'bills', coalesce((
                 select jsonb_agg(private.bb_bill_chip(b) order by b.bill_at, b.id)
                 from public.bills b
                 where b.treatment_id = t.id and b.status = 'finalized' and b.session_id is null and b.admission_id is null
                   and (b.visit_id is null or not exists (select 1 from public.visits v join public.treatment_sessions s2
                                                            on s2.appointment_id = v.appointment_id and s2.treatment_id = t.id
                                                          where v.id = b.visit_id))), '[]'::jsonb),
               'stays', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', a.id, 'ip_number', a.ip_number, 'admitted_at', a.admitted_at, 'discharged_at', a.discharged_at,
                          'status', a.status,
                          'bills', coalesce((select jsonb_agg(private.bb_bill_chip(b) order by b.bill_at, b.id) from public.bills b
                                              where b.admission_id = a.id and b.status = 'finalized'), '[]'::jsonb))
                        order by a.admitted_at)
                 from public.admissions a where a.treatment_id = t.id and a.status <> 'cancelled'), '[]'::jsonb))
             order by t.start_date desc, t.created_at desc)
      from public.patient_treatments t left join public.doctors d on d.id = t.doctor_id
      where t.patient_id = p_patient_id and t.status <> 'cancelled'), '[]'::jsonb),
    'stays', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'ip_number', a.ip_number, 'admitted_at', a.admitted_at, 'discharged_at', a.discharged_at, 'status', a.status,
               'bills', coalesce((select jsonb_agg(private.bb_bill_chip(b) order by b.bill_at, b.id) from public.bills b
                                   where b.admission_id = a.id and b.status = 'finalized'), '[]'::jsonb))
             order by a.admitted_at desc)
      from public.admissions a where a.patient_id = p_patient_id and a.treatment_id is null and a.status <> 'cancelled'), '[]'::jsonb),
    'other_bills', coalesce((
      select jsonb_agg(private.bb_bill_chip(b) order by b.bill_at desc, b.id)
      from public.bills b
      where b.patient_id = p_patient_id and b.status = 'finalized' and b.treatment_id is null and b.admission_id is null
        and b.session_id is null
        and (b.visit_id is null or not exists (select 1 from public.visits v join public.treatment_sessions s2
                                                 on s2.appointment_id = v.appointment_id where v.id = b.visit_id))), '[]'::jsonb),
    'breakdowns', coalesce((
      select jsonb_agg(jsonb_build_object('id', bb.id, 'bb_no', bb.bb_no, 'status', bb.status, 'treatment_id', bb.treatment_id,
                                          'admission_id', bb.admission_id, 'total_paise', bb.total_paise, 'created_at', bb.created_at)
             order by bb.created_at desc)
      from public.breakdown_bills bb where bb.patient_id = p_patient_id and bb.status <> 'cancelled'), '[]'::jsonb));
end;
$$;

------------------------------------------------------------------------------
-- Make a draft breakdown filled from the chosen bills (idempotent on p_client_id).
------------------------------------------------------------------------------
create function public.create_breakdown_bill(p_patient_id uuid, p_sources jsonb, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_src jsonb;
  v_bills uuid[];
  v_doctor uuid;
begin
  if p_client_id is null then
    perform private.fail('invalid_input', 'client id');
  end if;
  if exists (select 1 from public.breakdown_bills where id = p_client_id) then
    return private.breakdown_card(p_client_id);
  end if;
  if not exists (select 1 from public.patients where id = p_patient_id and merged_into_id is null) then
    perform private.fail('not_found', 'patient');
  end if;
  v_src := private.bb_sources(p_patient_id, p_sources);
  v_bills := private.bb_ids(v_src, 'bill_ids');
  v_doctor := coalesce(
    (select s.doctor_id from public.admission_surgeons s where s.admission_id = (v_src ->> 'admission_id')::uuid
      order by s.role = 'primary' desc limit 1),
    (select doctor_id from public.patient_treatments where id = (v_src ->> 'treatment_id')::uuid),
    (select b.doctor_id from public.bills b where b.id = any (v_bills) and b.doctor_id is not null order by b.bill_at limit 1));
  insert into public.breakdown_bills (id, patient_id, treatment_id, admission_id, sources, doctor_id, billed_ref_paise)
  values (p_client_id, p_patient_id, (v_src ->> 'treatment_id')::uuid, (v_src ->> 'admission_id')::uuid, v_src, v_doctor,
          private.bb_billed_ref(v_bills));
  perform private.bb_write_lines(p_client_id, private.bb_lines_from(v_bills));
  return private.breakdown_card(p_client_id);
exception
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    perform private.fail('invalid_input', 'sources');
end;
$$;

-- Fill the lines again from (other) bills. Replaces every line; draft only.
create function public.breakdown_refill(p_id uuid, p_version integer, p_sources jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_b public.breakdown_bills;
  v_src jsonb;
begin
  select * into v_b from public.breakdown_bills where id = p_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if v_b.status <> 'draft' then
    perform private.fail('bill_locked');
  end if;
  if v_b.version is distinct from p_version then
    perform private.fail('stale_version');
  end if;
  v_src := private.bb_sources(v_b.patient_id, p_sources);
  update public.breakdown_bills set sources = v_src, treatment_id = (v_src ->> 'treatment_id')::uuid,
         admission_id = (v_src ->> 'admission_id')::uuid, billed_ref_paise = private.bb_billed_ref(private.bb_ids(v_src, 'bill_ids')),
         version = version + 1
   where id = p_id;
  perform private.bb_write_lines(p_id, private.bb_lines_from(private.bb_ids(v_src, 'bill_ids')));
  return private.breakdown_card(p_id);
exception
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    perform private.fail('invalid_input', 'sources');
end;
$$;

-- Save a draft: header + every line (optimistic lock on version).
create function public.save_breakdown_bill(p_id uuid, p_version integer, p_header jsonb, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_b public.breakdown_bills;
begin
  select * into v_b from public.breakdown_bills where id = p_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if v_b.status <> 'draft' then
    perform private.fail('bill_locked', 'finalized breakdown bills are amended by an admin');
  end if;
  if v_b.version is distinct from p_version then
    perform private.fail('stale_version');
  end if;
  perform private.bb_write_header(p_id, p_header);
  perform private.bb_write_lines(p_id, p_lines);
  update public.breakdown_bills set version = version + 1 where id = p_id;
  return private.breakdown_card(p_id);
exception
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
    perform private.fail('invalid_input', 'a value is not valid');
end;
$$;

-- Finalize: number + frozen clinic header and patient/stay facts. The saved copy stays as it is.
create function public.finalize_breakdown_bill(p_id uuid, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_b public.breakdown_bills;
begin
  select * into v_b from public.breakdown_bills where id = p_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if v_b.status <> 'draft' then
    perform private.fail('bill_locked');
  end if;
  if v_b.version is distinct from p_version then
    perform private.fail('stale_version');
  end if;
  if not exists (select 1 from public.breakdown_bill_lines where breakdown_id = p_id) then
    perform private.fail('invalid_input', 'add at least one line');
  end if;
  update public.breakdown_bills set
    status = 'finalized',
    bb_no = private.take_number('breakdown_bill', now()),
    fy = private.fy_label(now()),
    finalized_at = now(), finalized_by = v_staff,
    header_snapshot = private.clinic_snapshot('final_bill') - 'terms',
    patient_snapshot = private.bb_facts(v_b),
    version = version + 1
  where id = p_id;
  return private.breakdown_card(p_id);
end;
$$;

-- Admin: change a finalized breakdown. The old copy is kept with the reason; the number stays.
create function public.amend_breakdown_bill(p_id uuid, p_header jsonb, p_lines jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.require_staff(array['admin']::public.staff_role[]);
  v_b public.breakdown_bills;
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    perform private.fail('reason_required');
  end if;
  select * into v_b from public.breakdown_bills where id = p_id for update;
  if not found or v_b.status <> 'finalized' then
    perform private.fail('not_found', 'only finalized breakdown bills are amended');
  end if;
  insert into public.breakdown_bill_versions (breakdown_id, version, snapshot, edited_by, reason)
  values (p_id, v_b.version, private.breakdown_card(p_id) || jsonb_build_object('patient_snapshot', v_b.patient_snapshot),
          v_admin, btrim(p_reason));
  perform set_config('app.reason', btrim(p_reason), true);
  perform private.bb_write_header(p_id, p_header);
  perform private.bb_write_lines(p_id, p_lines);
  select * into v_b from public.breakdown_bills where id = p_id;
  update public.breakdown_bills set patient_snapshot = private.bb_facts(v_b), version = version + 1 where id = p_id;
  return private.breakdown_card(p_id);
exception
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
    perform private.fail('invalid_input', 'a value is not valid');
end;
$$;

create function public.cancel_breakdown_bill(p_id uuid, p_reason text)
returns jsonb
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
  update public.breakdown_bills set status = 'cancelled', cancelled_at = now(), cancelled_by = v_admin,
         cancel_reason = left(btrim(p_reason), 300), version = version + 1
   where id = p_id and status = 'finalized';
  if not found then
    perform private.fail('not_found', 'only finalized breakdown bills are cancelled');
  end if;
  return private.breakdown_card(p_id);
end;
$$;

-- A draft never had a number: throw it away.
create function public.discard_breakdown_bill(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
begin
  delete from public.breakdown_bills where id = p_id and status = 'draft';
  if not found then
    perform private.fail('not_found', 'only drafts are discarded');
  end if;
  return jsonb_build_object('discarded', true);
end;
$$;

create function public.get_breakdown_bill(p_id uuid)
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
  v := private.breakdown_card(p_id);
  if v is null then
    perform private.fail('not_found');
  end if;
  return v;
end;
$$;

-- Print: the frozen header and facts (live ones on a draft). Counts prints like bills.
create function public.breakdown_print_data(p_id uuid, p_count boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.breakdown_bills;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select * into v_b from public.breakdown_bills where id = p_id;
  if not found then
    perform private.fail('not_found');
  end if;
  if p_count and v_b.status <> 'draft' then
    update public.breakdown_bills set print_count = print_count + 1 where id = p_id returning * into v_b;
  end if;
  return private.breakdown_card(p_id) || jsonb_build_object(
    'copy', case when v_b.status = 'draft' then 'draft' when v_b.status = 'cancelled' then 'cancelled'
                 when v_b.print_count <= 1 then 'original' else 'duplicate' end,
    'header', coalesce(v_b.header_snapshot, private.clinic_snapshot('final_bill') - 'terms'),
    'patient_strip', coalesce(v_b.patient_snapshot, private.bb_facts(v_b)));
end;
$$;

------------------------------------------------------------------------------
-- Lists for the 3rd and 4th billing sections (offset pages, max 100). Filters: patient_id (all dates)
-- or from / to (max one year, default the last 30 days), status.
------------------------------------------------------------------------------
create function public.breakdown_bills_table(p_filters jsonb default '{}', p_offset integer default 0, p_limit integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_from date;
  v_to date;
  v_status public.doc_status;
  v_patient uuid;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_from := coalesce((p_filters ->> 'from')::date, (private.ist(now()))::date - 30);
  v_to := coalesce((p_filters ->> 'to')::date, (private.ist(now()))::date);
  v_status := nullif(p_filters ->> 'status', '')::public.doc_status;
  v_patient := (p_filters ->> 'patient_id')::uuid;
  if v_patient is null and (v_to < v_from or v_to - v_from > 366) then
    perform private.fail('invalid_input', 'date range (max one year)');
  end if;
  return (
    with filtered as (
      select bb.* from public.breakdown_bills bb
      where (v_patient is not null and bb.patient_id = v_patient
             or v_patient is null and coalesce(bb.finalized_at, bb.created_at) >= private.ist_at(v_from, '00:00')
                                  and coalesce(bb.finalized_at, bb.created_at) < private.ist_at(v_to + 1, '00:00'))
        and (v_status is null or bb.status = v_status)
    )
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      'sum_paise', (select coalesce(sum(total_paise), 0) from filtered where status = 'finalized'),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', f.id, 'bb_no', f.bb_no, 'status', f.status, 'bill_date', f.bill_date, 'created_at', f.created_at,
                 'finalized_at', f.finalized_at, 'total_paise', f.total_paise, 'billed_ref_paise', f.billed_ref_paise,
                 'patient_id', f.patient_id, 'patient', p.full_name, 'uhid', p.uhid, 'insurer', f.insurer,
                 'treatment', (select name from public.patient_treatments where id = f.treatment_id),
                 'ip_number', (select ip_number from public.admissions where id = f.admission_id))
               order by coalesce(f.finalized_at, f.created_at) desc, f.id)
        from (select * from filtered order by coalesce(finalized_at, created_at) desc, id
              limit v_limit offset greatest(coalesce(p_offset, 0), 0)) f
        join public.patients p on p.id = f.patient_id), '[]'::jsonb)));
end;
$$;

create function public.discharge_summaries_table(p_filters jsonb default '{}', p_offset integer default 0, p_limit integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_from date;
  v_to date;
  v_status public.doc_status;
  v_patient uuid;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_from := coalesce((p_filters ->> 'from')::date, (private.ist(now()))::date - 30);
  v_to := coalesce((p_filters ->> 'to')::date, (private.ist(now()))::date);
  v_status := nullif(p_filters ->> 'status', '')::public.doc_status;
  v_patient := (p_filters ->> 'patient_id')::uuid;
  if v_patient is null and (v_to < v_from or v_to - v_from > 366) then
    perform private.fail('invalid_input', 'date range (max one year)');
  end if;
  return (
    with filtered as (
      select s.* from public.discharge_summaries s
      where (v_patient is not null and s.patient_id = v_patient
             or v_patient is null and coalesce(s.finalized_at, s.created_at) >= private.ist_at(v_from, '00:00')
                                  and coalesce(s.finalized_at, s.created_at) < private.ist_at(v_to + 1, '00:00'))
        and (v_status is null or s.status = v_status)
    )
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', f.id, 'status', f.status, 'created_at', f.created_at, 'finalized_at', f.finalized_at,
                 'patient_id', f.patient_id, 'patient', p.full_name, 'uhid', p.uhid,
                 'kind', 'ip', 'admission_id', a.id, 'ip_number', a.ip_number, 'admitted_at', a.admitted_at,
                 'discharged_at', a.discharged_at, 'procedures', to_jsonb(a.procedures))
               order by coalesce(f.finalized_at, f.created_at) desc, f.id)
        from (select * from filtered order by coalesce(finalized_at, created_at) desc, id
              limit v_limit offset greatest(coalesce(p_offset, 0), 0)) f
        join public.patients p on p.id = f.patient_id
        left join public.admissions a on a.id = f.admission_id), '[]'::jsonb)));
end;
$$;

------------------------------------------------------------------------------
-- The paperwork that goes with a bill: breakdown bills made from it (or for its treatment / stay),
-- and its stay's discharge summary.
------------------------------------------------------------------------------
create function public.bill_paperwork(p_bill_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_b public.bills;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select * into v_b from public.bills where id = p_bill_id;
  if not found then
    perform private.fail('not_found');
  end if;
  return jsonb_build_object(
    'breakdowns', coalesce((
      select jsonb_agg(jsonb_build_object('id', bb.id, 'bb_no', bb.bb_no, 'status', bb.status, 'total_paise', bb.total_paise)
             order by bb.created_at desc)
      from public.breakdown_bills bb
      where bb.patient_id = v_b.patient_id and bb.status <> 'cancelled'
        and (bb.sources -> 'bill_ids' ? v_b.id::text
             or v_b.admission_id is not null and bb.admission_id = v_b.admission_id
             or v_b.treatment_id is not null and bb.treatment_id = v_b.treatment_id)), '[]'::jsonb),
    'admission', (select jsonb_build_object('id', a.id, 'ip_number', a.ip_number, 'status', a.status,
                                            'summary', (select jsonb_build_object('id', s.id, 'status', s.status)
                                                          from public.discharge_summaries s
                                                         where s.admission_id = a.id and s.status <> 'cancelled' limit 1))
                    from public.admissions a where a.id = v_b.admission_id));
end;
$$;

------------------------------------------------------------------------------
-- bills_table: as 20261119100000, plus `bill_types` (several types; the Surgery section shows surgery
-- bills and IP final bills together).
------------------------------------------------------------------------------
create or replace function public.bills_table(p_filters jsonb default '{}', p_offset integer default 0, p_limit integer default 25)
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
  v_types public.bill_type[] := case when jsonb_typeof(p_filters -> 'bill_types') = 'array'
                                     then array(select x::public.bill_type from jsonb_array_elements_text(p_filters -> 'bill_types') x) end;
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
        and (v_types is null or cardinality(v_types) = 0 or b.bill_type = any (v_types))
    ),
    -- Money received, by bill and mode, against the finalized bills (cancelled payments left out).
    paid as (
      select f.id, pay.mode_id, a.amount_paise
      from filtered f
      join public.payment_allocations a on a.bill_id = f.id
      join public.payments pay on pay.id = a.payment_id and pay.cancelled_at is null
      where f.status = 'finalized'
    ),
    per_bill as (
      select f.id, f.bill_type, f.total_paise, coalesce((select sum(p.amount_paise) from paid p where p.id = f.id), 0) as received
      from filtered f where f.status = 'finalized'
    ),
    totals as (
      select coalesce(sum(total_paise), 0)::bigint as billed, coalesce(sum(received), 0)::bigint as received from per_bill
    )
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      'sum_paise', (select coalesce(sum(total_paise), 0) from filtered where status = 'finalized'),
      'summary', jsonb_build_object(
        'billed_paise', (select billed from totals),
        'received_paise', (select received from totals),
        'due_paise', (select greatest(billed - received, 0) from totals),
        'drafts', (select count(*) from filtered where status = 'draft'),
        'cancelled', (select count(*) from filtered where status = 'cancelled'),
        'by_type', coalesce((
          select jsonb_agg(jsonb_build_object('bill_type', t.bill_type, 'count', t.n, 'billed_paise', t.billed,
                                              'received_paise', t.received) order by t.bill_type)
          from (select bill_type, count(*) as n, sum(total_paise)::bigint as billed, sum(received)::bigint as received
                from per_bill group by bill_type) t), '[]'::jsonb),
        'by_mode', coalesce((
          select jsonb_agg(jsonb_build_object('mode', coalesce(m.label, '—'), 'received_paise', x.amount) order by x.amount desc, m.label)
          from (select mode_id, sum(amount_paise)::bigint as amount from paid where mode_id is not null group by mode_id) x
          left join public.lookup_values m on m.id = x.mode_id), '[]'::jsonb)),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', f.id, 'bill_type', f.bill_type, 'bill_no', f.bill_no, 'status', f.status, 'bill_at', f.bill_at,
          'created_at', f.created_at, 'total_paise', f.total_paise + f.carried_in_paise, 'patient_id', f.patient_id,
          'patient', p.full_name, 'uhid', p.uhid, 'for', private.bill_for(bb),
          'received_paise', coalesce((select sum(a.amount_paise) from public.payment_allocations a
                                        join public.payments pay on pay.id = a.payment_id and pay.cancelled_at is null
                                       where a.bill_id = f.id), 0))
          order by coalesce(f.bill_at, f.created_at) desc, f.id)
        from (select * from filtered order by coalesce(bill_at, created_at) desc, id limit v_limit offset greatest(coalesce(p_offset, 0), 0)) f
        join public.bills bb on bb.id = f.id
        join public.patients p on p.id = f.patient_id), '[]'::jsonb)));
end;
$$;

select private.lock_down_public_functions();
