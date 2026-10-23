-- Phase 7: IP stay (admissions), the final bill, discharge summaries (PLAN.md C2, C6, D3).

create type public.admission_status as enum ('admitted', 'discharged', 'cancelled');

------------------------------------------------------------------------------
-- Discharge templates (sections + medicines with {{placeholders}})
------------------------------------------------------------------------------
create table public.discharge_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  treatment_template_id uuid references public.treatment_templates (id),
  sections jsonb not null default '[]'::jsonb check (jsonb_typeof(sections) = 'array'),
  medications jsonb not null default '[]'::jsonb check (jsonb_typeof(medications) = 'array'),
  follow_up_days integer check (follow_up_days between 0 and 365),
  version integer not null default 1,
  active boolean not null default true,
  usage_count integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create unique index discharge_templates_name on public.discharge_templates (lower(name));
create trigger discharge_templates_touch before update on public.discharge_templates
  for each row execute function private.touch_updated();
create trigger discharge_templates_audit after insert or update or delete on public.discharge_templates
  for each row execute function private.audit_row();
alter table public.treatment_templates
  add constraint treatment_templates_discharge_template_id_fkey foreign key (discharge_template_id) references public.discharge_templates (id);
alter table public.patient_treatments
  add constraint patient_treatments_discharge_template_id_fkey foreign key (discharge_template_id) references public.discharge_templates (id);

------------------------------------------------------------------------------
-- Admissions
------------------------------------------------------------------------------
create table public.admissions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id),
  treatment_id uuid references public.patient_treatments (id),
  ip_number text not null unique,
  admitted_at timestamptz not null,
  discharged_at timestamptz,
  room_type_id uuid references public.room_types (id),
  room_label text check (length(room_label) <= 60),
  attender_name text check (length(attender_name) <= 120),
  attender_phone text check (length(attender_phone) <= 40),
  attender_relation text check (length(attender_relation) <= 40),
  diagnosis text check (length(diagnosis) <= 500),
  procedures text[] not null default '{}' check (cardinality(procedures) <= 20),
  anaesthesia text check (length(anaesthesia) <= 120),
  surgery_at timestamptz,
  status public.admission_status not null default 'admitted',
  notes text check (length(notes) <= 1000),
  cancel_reason text check (length(cancel_reason) <= 300),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (discharged_at is null or discharged_at >= admitted_at),
  check (status <> 'discharged' or discharged_at is not null)
);
create index admissions_patient on public.admissions (patient_id, admitted_at desc);
create index admissions_open on public.admissions (admitted_at desc) where status = 'admitted';
create index admissions_when on public.admissions (admitted_at desc, id);
-- One open stay per patient at a time.
create unique index admissions_one_open on public.admissions (patient_id) where status = 'admitted';
create trigger admissions_touch before update on public.admissions for each row execute function private.touch_updated();
create trigger admissions_audit after insert or update or delete on public.admissions for each row execute function private.audit_row();

create table public.admission_surgeons (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references public.admissions (id) on delete cascade,
  doctor_id uuid not null references public.doctors (id),
  role text not null default 'primary' check (role in ('primary', 'assistant', 'visiting')),
  unique (admission_id, doctor_id)
);
create index admission_surgeons_doctor on public.admission_surgeons (doctor_id);

alter table public.bills add constraint bills_admission_id_fkey foreign key (admission_id) references public.admissions (id);
alter table public.payments add constraint payments_admission_id_fkey foreign key (admission_id) references public.admissions (id);

------------------------------------------------------------------------------
-- Discharge summaries. content keeps {{placeholders}}; finalize freezes the filled text.
------------------------------------------------------------------------------
create table public.discharge_summaries (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references public.admissions (id),
  patient_id uuid not null references public.patients (id),
  status public.doc_status not null default 'draft',
  version integer not null default 1,
  content jsonb not null default '{}'::jsonb,
  rendered jsonb,
  header_snapshot jsonb,
  patient_snapshot jsonb,
  template_id uuid references public.discharge_templates (id),
  finalized_at timestamptz,
  finalized_by uuid references public.staff (id),
  pdf_file_id uuid references public.files (id),
  followup_id uuid references public.followups (id),
  print_count integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create unique index discharge_summaries_one on public.discharge_summaries (admission_id) where status <> 'cancelled';
create index discharge_summaries_patient on public.discharge_summaries (patient_id);
create trigger discharge_summaries_touch before update on public.discharge_summaries for each row execute function private.touch_updated();
create trigger discharge_summaries_audit after insert or update or delete on public.discharge_summaries for each row execute function private.audit_row();

create table public.discharge_summary_versions (
  id uuid primary key default gen_random_uuid(),
  summary_id uuid not null references public.discharge_summaries (id),
  version integer not null,
  content jsonb not null,
  rendered jsonb,
  edited_by uuid references public.staff (id),
  reason text check (length(reason) <= 300),
  at timestamptz not null default now()
);
create index discharge_summary_versions_summary on public.discharge_summary_versions (summary_id, version);

------------------------------------------------------------------------------
-- RLS: IP stays are reception + admin (PLAN.md C7); all writes through RPCs.
------------------------------------------------------------------------------
alter table public.discharge_templates enable row level security;
alter table public.admissions enable row level security;
alter table public.admission_surgeons enable row level security;
alter table public.discharge_summaries enable row level security;
alter table public.discharge_summary_versions enable row level security;
grant select on public.discharge_templates, public.admissions, public.admission_surgeons, public.discharge_summaries,
  public.discharge_summary_versions to authenticated;
create policy discharge_templates_select on public.discharge_templates for select to authenticated
  using ((select private.has_role('receptionist', 'admin')));
create policy admissions_select on public.admissions for select to authenticated
  using ((select private.has_role('receptionist', 'admin')));
create policy admission_surgeons_select on public.admission_surgeons for select to authenticated
  using ((select private.has_role('receptionist', 'admin')));
create policy discharge_summaries_select on public.discharge_summaries for select to authenticated
  using ((select private.has_role('receptionist', 'admin')));
create policy discharge_summary_versions_select on public.discharge_summary_versions for select to authenticated
  using ((select private.has_role('admin')));

------------------------------------------------------------------------------
-- Admission RPCs
------------------------------------------------------------------------------
-- Room days = nights (IST midnights crossed), at least 1 (PLAN.md A2).
create function private.room_days(p_from timestamptz, p_to timestamptz)
returns integer
language sql
immutable
as $$
  select greatest(1, (private.ist(p_to))::date - (private.ist(p_from))::date);
$$;

create function private.admission_card(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(a) || jsonb_build_object(
    'patient', p.full_name, 'uhid', p.uhid, 'gender', p.gender, 'age', private.age_years(p.dob),
    'treatment', t.name, 'room_type', r.name, 'room_rate_paise', r.daily_rate_paise,
    'room_days', private.room_days(a.admitted_at, coalesce(a.discharged_at, now())),
    'surgeons', coalesce((
      select jsonb_agg(jsonb_build_object('doctor_id', s.doctor_id, 'role', s.role, 'name', coalesce(d.display_name, d.full_name))
                       order by s.role = 'primary' desc, d.full_name)
      from public.admission_surgeons s join public.doctors d on d.id = s.doctor_id where s.admission_id = a.id), '[]'::jsonb),
    'bills', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'bill_type', b.bill_type, 'bill_no', b.bill_no, 'status', b.status,
                                          'total_paise', b.total_paise + b.carried_in_paise, 'bill_at', b.bill_at,
                                          'consolidated_into_id', b.consolidated_into_id)
                       order by coalesce(b.bill_at, b.created_at))
      from public.bills b where b.admission_id = a.id), '[]'::jsonb),
    'summary', (select jsonb_build_object('id', s.id, 'status', s.status, 'version', s.version)
                  from public.discharge_summaries s where s.admission_id = a.id and s.status <> 'cancelled'))
  from public.admissions a
  join public.patients p on p.id = a.patient_id
  left join public.patient_treatments t on t.id = a.treatment_id
  left join public.room_types r on r.id = a.room_type_id
  where a.id = p_id;
$$;

-- Applies the editable fields of an admission payload (shared by admit and update).
create function private.admission_apply(p_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.admissions set
    treatment_id = case when p ? 'treatment_id' then (p ->> 'treatment_id')::uuid else treatment_id end,
    admitted_at = coalesce((p ->> 'admitted_at')::timestamptz, admitted_at),
    room_type_id = case when p ? 'room_type_id' then (p ->> 'room_type_id')::uuid else room_type_id end,
    room_label = case when p ? 'room_label' then nullif(btrim(p ->> 'room_label'), '') else room_label end,
    attender_name = case when p ? 'attender_name' then nullif(btrim(p ->> 'attender_name'), '') else attender_name end,
    attender_phone = case when p ? 'attender_phone' then nullif(btrim(p ->> 'attender_phone'), '') else attender_phone end,
    attender_relation = case when p ? 'attender_relation' then nullif(btrim(p ->> 'attender_relation'), '') else attender_relation end,
    diagnosis = case when p ? 'diagnosis' then nullif(btrim(p ->> 'diagnosis'), '') else diagnosis end,
    procedures = case when p ? 'procedures'
                      then array(select btrim(x) from jsonb_array_elements_text(p -> 'procedures') x where btrim(x) <> '')
                      else procedures end,
    anaesthesia = case when p ? 'anaesthesia' then nullif(btrim(p ->> 'anaesthesia'), '') else anaesthesia end,
    surgery_at = case when p ? 'surgery_at' then (p ->> 'surgery_at')::timestamptz else surgery_at end,
    notes = case when p ? 'notes' then nullif(btrim(p ->> 'notes'), '') else notes end
  where id = p_id;
  if p ? 'surgeons' then
    delete from public.admission_surgeons where admission_id = p_id;
    insert into public.admission_surgeons (admission_id, doctor_id, role)
    select distinct on ((s ->> 'doctor_id')::uuid) p_id, (s ->> 'doctor_id')::uuid, coalesce(s ->> 'role', 'primary')
    from jsonb_array_elements(p -> 'surgeons') s
    where s ->> 'doctor_id' is not null;
  end if;
  if exists (select 1 from public.admissions where id = p_id and treatment_id is not null
               and (select patient_id from public.patient_treatments where id = treatment_id) <> patient_id) then
    perform private.fail('invalid_input', 'the treatment belongs to another patient');
  end if;
end;
$$;

-- Admit. IP number: its own series, or (Settings → Billing) the UHID (+ "/2", "/3" for repeat stays).
create function public.admit_patient(p_admission jsonb, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_patient public.patients;
  v_ip text;
  v_n integer;
begin
  if p_client_id is null then
    perform private.fail('invalid_input', 'client id is required');
  end if;
  if exists (select 1 from public.admissions where id = p_client_id) then
    return private.admission_card(p_client_id);
  end if;
  select * into v_patient from public.patients where id = (p_admission ->> 'patient_id')::uuid and merged_into_id is null;
  if not found then
    perform private.fail('not_found', 'patient');
  end if;
  if exists (select 1 from public.admissions where patient_id = v_patient.id and status = 'admitted') then
    perform private.fail('duplicate', 'this patient is already admitted');
  end if;
  if coalesce(private.setting('billing', 'ip_number_mode', '"separate"') #>> '{}', 'separate') = 'uhid' then
    select count(*) + 1 into v_n from public.admissions where patient_id = v_patient.id;
    v_ip := v_patient.uhid || case when v_n > 1 then '/' || v_n else '' end;
  else
    v_ip := private.take_number('ip_number', coalesce((p_admission ->> 'admitted_at')::timestamptz, now()));
  end if;
  insert into public.admissions (id, patient_id, ip_number, admitted_at)
  values (p_client_id, v_patient.id, v_ip, coalesce((p_admission ->> 'admitted_at')::timestamptz, now()));
  perform private.admission_apply(p_client_id, p_admission - 'patient_id');
  perform private.library_used('room_types', (p_admission ->> 'room_type_id')::uuid);
  return private.admission_card(p_client_id);
exception
  when invalid_text_representation or invalid_datetime_format or check_violation or foreign_key_violation then
    perform private.fail('invalid_input', sqlerrm);
end;
$$;

-- Edit details. After discharge only an admin can, with a reason (audited).
create function public.update_admission(p_admission_id uuid, p_patch jsonb, p_version integer, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_a public.admissions;
begin
  select * into v_a from public.admissions where id = p_admission_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if v_a.version <> p_version then
    perform private.fail('stale_version');
  end if;
  if v_a.status <> 'admitted' then
    if not (select private.has_role('admin')) then
      perform private.fail('not_allowed', 'after discharge only an admin can edit');
    end if;
    if length(btrim(coalesce(p_reason, ''))) < 3 then
      perform private.fail('reason_required');
    end if;
    perform set_config('app.reason', btrim(p_reason), true);
  end if;
  perform private.admission_apply(p_admission_id, p_patch - 'patient_id' - 'discharged_at' - 'status');
  update public.admissions set version = version + 1 where id = p_admission_id;
  return private.admission_card(p_admission_id);
exception
  when invalid_text_representation or invalid_datetime_format or check_violation or foreign_key_violation then
    perform private.fail('invalid_input', sqlerrm);
end;
$$;

create function public.discharge_patient(p_admission_id uuid, p_discharged_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_a public.admissions;
  v_at timestamptz := coalesce(p_discharged_at, now());
begin
  select * into v_a from public.admissions where id = p_admission_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if v_a.status <> 'admitted' then
    perform private.fail('invalid_status_change');
  end if;
  if v_at < v_a.admitted_at or v_at > now() + interval '1 day' then
    perform private.fail('dates_invalid', 'discharge must be after admission and not in the future');
  end if;
  if v_a.surgery_at is not null and v_a.surgery_at > v_at then
    perform private.fail('dates_invalid', 'surgery is after the discharge time');
  end if;
  update public.admissions set status = 'discharged', discharged_at = v_at, version = version + 1 where id = p_admission_id;
  return private.admission_card(p_admission_id);
end;
$$;

-- Cancel an admission made by mistake: only while nothing is billed or summarised.
create function public.cancel_admission(p_admission_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    perform private.fail('reason_required');
  end if;
  if exists (select 1 from public.bills where admission_id = p_admission_id and status = 'finalized')
     or exists (select 1 from public.discharge_summaries where admission_id = p_admission_id and status = 'finalized') then
    perform private.fail('in_use', 'bills or a discharge summary exist for this stay');
  end if;
  update public.admissions set status = 'cancelled', cancel_reason = btrim(p_reason), version = version + 1
   where id = p_admission_id and status = 'admitted';
  if not found then
    perform private.fail('invalid_status_change');
  end if;
  return private.admission_card(p_admission_id);
end;
$$;

create function public.get_admission(p_admission_id uuid)
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
  v := private.admission_card(p_admission_id);
  if v is null then
    perform private.fail('not_found');
  end if;
  return v;
end;
$$;

-- IP stays table. filters: {status, from, to (admitted, ≤ 1 year), patient_id}. Admitted now: no range.
create function public.admissions_table(p_filters jsonb default '{}', p_offset integer default 0, p_limit integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_status public.admission_status := nullif(p_filters ->> 'status', '')::public.admission_status;
  v_patient uuid := (p_filters ->> 'patient_id')::uuid;
  v_from date := coalesce((p_filters ->> 'from')::date, (private.ist(now()))::date - 90);
  v_to date := coalesce((p_filters ->> 'to')::date, (private.ist(now()))::date);
  v_ranged boolean := v_patient is null and v_status is distinct from 'admitted';
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  if v_ranged and (v_to < v_from or v_to - v_from > 366) then
    perform private.fail('invalid_input', 'date range (max one year)');
  end if;
  return (
    with filtered as (
      select a.* from public.admissions a
      where (v_status is null or a.status = v_status)
        and (v_patient is null or a.patient_id = v_patient)
        and (not v_ranged or (a.admitted_at >= private.ist_at(v_from, '00:00') and a.admitted_at < private.ist_at(v_to + 1, '00:00')))
    )
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', f.id, 'ip_number', f.ip_number, 'status', f.status, 'admitted_at', f.admitted_at, 'discharged_at', f.discharged_at,
          'patient_id', f.patient_id, 'patient', p.full_name, 'uhid', p.uhid, 'room', concat_ws(' · ', r.name, f.room_label),
          'room_days', private.room_days(f.admitted_at, coalesce(f.discharged_at, now())), 'treatment', t.name)
          order by f.admitted_at desc, f.id)
        from (select * from filtered order by admitted_at desc, id limit v_limit offset greatest(coalesce(p_offset, 0), 0)) f
        join public.patients p on p.id = f.patient_id
        left join public.room_types r on r.id = f.room_type_id
        left join public.patient_treatments t on t.id = f.treatment_id), '[]'::jsonb)));
end;
$$;

------------------------------------------------------------------------------
-- Final bill (PLAN.md C6): carried-in lines, no double counting, money per episode
------------------------------------------------------------------------------
-- The interim bills a bill carries lines from.
create function private.carried_bill_ids(p_bill_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct src.bill_id), '{}')
  from public.bill_items i join public.bill_items src on src.id = i.carried_from_item_id
  where i.bill_id = p_bill_id and i.kind = 'carried_in';
$$;

-- A carried-in line keeps the original line's amounts exactly (whatever this bill's tax mode).
create or replace function private.bill_item_compute()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inclusive boolean;
  r record;
  v_src public.bill_items;
begin
  if new.kind = 'carried_in' and new.carried_from_item_id is not null then
    select * into v_src from public.bill_items where id = new.carried_from_item_id;
    new.gross_paise := v_src.gross_paise;
    new.discount_paise := v_src.discount_paise;
    new.taxable_paise := v_src.taxable_paise;
    new.cgst_paise := v_src.cgst_paise;
    new.sgst_paise := v_src.sgst_paise;
    new.total_paise := v_src.total_paise;
    return new;
  end if;
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

-- Same as Phase 5, plus: received counts the carried-in bills' payments (one episode, one balance),
-- and a final bill lists the bills it carries.
create or replace function private.bill_card(p_bill_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(b) || jsonb_build_object(
    'patient', p.full_name, 'uhid', p.uhid,
    'doctor', coalesce(d.display_name, d.full_name),
    'ip_number', (select ip_number from public.admissions where id = b.admission_id),
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) || jsonb_build_object('category', c.label, 'category_code', c.code,
                                                          'carried_from_bill_no', sb.bill_no) order by i.line_no)
      from public.bill_items i left join public.lookup_values c on c.id = i.category_id
      left join public.bill_items si on si.id = i.carried_from_item_id
      left join public.bills sb on sb.id = si.bill_id
      where i.bill_id = b.id), '[]'::jsonb),
    'carried_bills', coalesce((
      select jsonb_agg(jsonb_build_object('id', cb.id, 'bill_no', cb.bill_no, 'bill_type', cb.bill_type,
                                          'total_paise', cb.total_paise) order by cb.bill_at)
      from public.bills cb where cb.id = any (private.carried_bill_ids(b.id))), '[]'::jsonb),
    'received_paise', coalesce((
      select sum(a.amount_paise) from public.payment_allocations a
      join public.payments pay on pay.id = a.payment_id and pay.cancelled_at is null
      where a.bill_id = b.id or a.bill_id = any (private.carried_bill_ids(b.id))), 0))
  from public.bills b
  join public.patients p on p.id = b.patient_id
  left join public.doctors d on d.id = b.doctor_id
  where b.id = p_bill_id;
$$;

-- A bill can take payments up to its OWN total; carried-in money belongs to the bills it came from.
create or replace function private.check_allocation()
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
  if v_paid + new.amount_paise > v_bill.total_paise then
    perform private.fail('over_allocated', 'more than the bill');
  end if;
  return new;
end;
$$;

-- Puts up to p_amount of a payment against a bill: its own outstanding first, then (for a
-- final bill) the carried-in bills', oldest first. Returns what was placed.
create function private.allocate_payment(p_payment_id uuid, p_bill_id uuid, p_amount bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_left bigint := p_amount;
  v_take bigint;
  r record;
begin
  for r in
    select b.id, b.total_paise - coalesce((
             select sum(a.amount_paise) from public.payment_allocations a
             join public.payments p on p.id = a.payment_id and p.cancelled_at is null where a.bill_id = b.id), 0) as due
    from public.bills b
    where b.id = p_bill_id or b.id = any (private.carried_bill_ids(p_bill_id))
    order by b.id <> p_bill_id, b.bill_at, b.id
    for update of b
  loop
    exit when v_left <= 0;
    continue when r.due <= 0;
    v_take := least(r.due, v_left);
    insert into public.payment_allocations (payment_id, bill_id, amount_paise) values (p_payment_id, r.id, v_take);
    v_left := v_left - v_take;
  end loop;
  return p_amount - v_left;
end;
$$;

create or replace function private.record_payments(p_patient_id uuid, p_bill_id uuid, p_payments jsonb, p_staff uuid)
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
    if private.allocate_payment(v_id, p_bill_id, (v_p ->> 'amount_paise')::bigint) < (v_p ->> 'amount_paise')::bigint then
      perform private.fail('over_allocated', 'more than the bill');
    end if;
    perform private.library_used('lookup_values', (v_p ->> 'mode_id')::uuid);
  end loop;
end;
$$;

create or replace function private.allocate_credit(p_patient_id uuid, p_bill_id uuid, p_amount bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_left bigint := p_amount;
  v_placed bigint;
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
    v_placed := private.allocate_payment(r.id, p_bill_id, least(r.free, v_left)::bigint);
    exit when v_placed = 0; -- the bill (and its carried bills) are fully paid
    v_left := v_left - v_placed;
  end loop;
  return p_amount - v_left;
end;
$$;

-- Same as Phase 5; allocations to a final bill spread over its carried-in bills.
create or replace function public.add_payment(p_payment jsonb, p_client_id uuid)
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
  insert into public.payments (id, patient_id, kind, mode_id, amount_paise, reference, received_by, treatment_id, admission_id, note)
  values (p_client_id, v_patient, v_kind, (p_payment ->> 'mode_id')::uuid, v_amount,
          nullif(btrim(p_payment ->> 'reference'), ''), v_staff, (p_payment ->> 'treatment_id')::uuid,
          (p_payment ->> 'admission_id')::uuid, nullif(btrim(p_payment ->> 'note'), ''))
  returning * into v_row;
  if v_kind <> 'refund' then
    for v_alloc in select value from jsonb_array_elements(coalesce(p_payment -> 'allocations', '[]'::jsonb)) loop
      if private.allocate_payment(v_row.id, (v_alloc ->> 'bill_id')::uuid, (v_alloc ->> 'amount_paise')::bigint)
         < (v_alloc ->> 'amount_paise')::bigint then
        perform private.fail('over_allocated', 'more than the bill');
      end if;
    end loop;
  end if;
  perform private.library_used('lookup_values', v_row.mode_id);
  return to_jsonb(v_row);
exception
  when foreign_key_violation or invalid_text_representation or not_null_violation then
    perform private.fail('invalid_input', sqlerrm);
end;
$$;

-- Same as Phase 5, plus: an admission links the bill to the stay (and its treatment, surgeon).
create or replace function public.create_bill(p_type public.bill_type, p_patient_id uuid, p_links jsonb default '{}', p_client_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_id uuid := coalesce(p_client_id, gen_random_uuid());
  v_treatment public.patient_treatments;
  v_admission public.admissions;
begin
  if exists (select 1 from public.bills where id = v_id) then
    return private.bill_card(v_id);
  end if;
  if not exists (select 1 from public.patients where id = p_patient_id and merged_into_id is null) then
    perform private.fail('not_found', 'patient');
  end if;
  select * into v_admission from public.admissions where id = (p_links ->> 'admission_id')::uuid;
  if found and (v_admission.patient_id <> p_patient_id or v_admission.status = 'cancelled') then
    perform private.fail('invalid_input', 'admission');
  end if;
  select * into v_treatment from public.patient_treatments
   where id = coalesce((p_links ->> 'treatment_id')::uuid, v_admission.treatment_id);
  insert into public.bills (id, bill_type, patient_id, doctor_id, treatment_id, visit_id, admission_id, tax_inclusive,
                            agreed_price_paise, referred_by_text)
  values (v_id, p_type, p_patient_id,
          coalesce((p_links ->> 'doctor_id')::uuid,
                   (select doctor_id from public.admission_surgeons where admission_id = v_admission.id
                     order by role = 'primary' desc limit 1),
                   v_treatment.doctor_id),
          v_treatment.id, (p_links ->> 'visit_id')::uuid, v_admission.id,
          coalesce((private.setting(case when p_type = 'pharmacy_invoice' then 'pharmacy' else 'billing' end,
                                    case when p_type = 'pharmacy_invoice' then 'prices_include_gst' else 'tax_inclusive' end,
                                    'true'))::boolean, true),
          case when p_type = 'final_bill' then v_treatment.agreed_price_paise end,
          (select referred_by_text from public.patients where id = p_patient_id));
  return private.bill_card(v_id);
end;
$$;

-- The bills a final bill can carry: this patient's finalized interim bills not yet in another
-- final bill. The episode's own (same stay / treatment) come first.
create function private.carry_candidates(p_bill public.bills)
returns setof public.bills
language sql
stable
security definer
set search_path = ''
as $$
  select b.* from public.bills b
  where b.patient_id = p_bill.patient_id and b.status = 'finalized' and b.bill_type <> 'final_bill'
    and (b.consolidated_into_id is null or b.consolidated_into_id = p_bill.id)
  order by (b.admission_id is not distinct from p_bill.admission_id and p_bill.admission_id is not null
            or b.treatment_id is not distinct from p_bill.treatment_id and p_bill.treatment_id is not null) desc,
           b.bill_at desc
  limit 100;
$$;

-- Sets which interim bills a DRAFT final bill carries (replaces the carried-in lines).
create function public.set_carried_bills(p_bill_id uuid, p_version integer, p_bill_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_bill public.bills;
begin
  select * into v_bill from public.bills where id = p_bill_id for update;
  if not found or v_bill.bill_type <> 'final_bill' then
    perform private.fail('not_found', 'final bill');
  end if;
  if v_bill.status <> 'draft' then
    perform private.fail('bill_locked');
  end if;
  if v_bill.version <> p_version then
    perform private.fail('stale_version');
  end if;
  if exists (select 1 from unnest(coalesce(p_bill_ids, '{}')) x
             where x not in (select c.id from private.carry_candidates(v_bill) c)) then
    perform private.fail('already_in_final_bill');
  end if;
  delete from public.bill_items where bill_id = p_bill_id and kind = 'carried_in';
  insert into public.bill_items (bill_id, line_no, category_id, kind, service_id, pharmacy_item_id, room_type_id, doctor_id,
    description, hsn_sac, mfg, batch_no, expiry_date, service_date, rate_paise, qty, discount_type, discount_value,
    gst_rate_bp, carried_from_item_id)
  select p_bill_id, 1000 + row_number() over (order by sb.bill_at, si.line_no), si.category_id, 'carried_in', si.service_id,
         si.pharmacy_item_id, si.room_type_id, si.doctor_id, si.description, si.hsn_sac, si.mfg, si.batch_no, si.expiry_date,
         coalesce(si.service_date, (private.ist(sb.bill_at))::date), si.rate_paise, si.qty, si.discount_type, si.discount_value,
         si.gst_rate_bp, si.id
  from public.bill_items si join public.bills sb on sb.id = si.bill_id
  where si.bill_id = any (coalesce(p_bill_ids, '{}')) and si.kind <> 'carried_in';
  -- Renumber: carried-in lines first, then own lines. Move every line out of the way first
  -- (the (bill, line_no) key is checked row by row).
  update public.bill_items set line_no = line_no + 2000 where bill_id = p_bill_id;
  update public.bill_items i set line_no = r.n
    from (select id, row_number() over (order by (kind <> 'carried_in'), line_no) as n
            from public.bill_items where bill_id = p_bill_id) r
   where i.id = r.id;
  update public.bills set version = version + 1 where id = p_bill_id;
  perform private.recompute_bill(p_bill_id);
  return private.bill_card(p_bill_id);
end;
$$;

-- Suggestions for a draft final bill: bills it can carry, and new lines for the stay
-- (room × days, IP-stay services of the treatment, surgeons' charges). The screen adds
-- the lines the person ticks; nothing is saved here.
create function public.final_bill_autofill(p_bill_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_bill public.bills;
  v_a public.admissions;
  v_end timestamptz;
  v_template uuid;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select * into v_bill from public.bills where id = p_bill_id;
  if not found then
    perform private.fail('not_found');
  end if;
  select * into v_a from public.admissions where id = v_bill.admission_id;
  v_end := coalesce(v_a.discharged_at, now());
  select template_id into v_template from public.patient_treatments where id = v_bill.treatment_id;
  return jsonb_build_object(
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'bill_no', c.bill_no, 'bill_type', c.bill_type, 'bill_at', c.bill_at, 'total_paise', c.total_paise,
        'episode', (c.admission_id = v_bill.admission_id or c.treatment_id = v_bill.treatment_id),
        'carried', c.consolidated_into_id = v_bill.id or c.id = any (private.carried_bill_ids(v_bill.id)))
        order by c.bill_at)
      from private.carry_candidates(v_bill) c), '[]'::jsonb),
    'stay', case when v_a.id is not null then jsonb_build_object(
      'admitted_at', v_a.admitted_at, 'discharged_at', v_a.discharged_at,
      'room_days', private.room_days(v_a.admitted_at, v_end)) end,
    'lines', coalesce((
      select jsonb_agg(l.line order by l.ord) from (
        -- Room: daily rate × nights (at least 1).
        select 1 as ord, jsonb_build_object('kind', 'room', 'room_type_id', r.id,
          'description', concat_ws(' — ', r.name, v_a.room_label), 'hsn_sac', r.sac,
          'category_id', (select id from public.lookup_values where kind = 'bill_category' and code = 'room' and merged_into_id is null limit 1),
          'rate_paise', r.daily_rate_paise, 'qty', private.room_days(v_a.admitted_at, v_end), 'gst_rate_bp', r.gst_rate_bp,
          'service_date', (private.ist(v_a.admitted_at))::date) as line
        from public.room_types r where r.id = v_a.room_type_id
        union all
        -- IP-stay services of the treatment's template.
        select 2, jsonb_build_object('kind', 'service', 'service_id', s.id, 'description', s.name, 'hsn_sac', s.sac,
          'category_id', s.category_id, 'rate_paise', s.default_price_paise, 'qty', ts.qty, 'gst_rate_bp', s.gst_rate_bp,
          'doctor_id', s.doctor_id)
        from public.treatment_template_services ts join public.services s on s.id = ts.service_id and s.active
        where ts.template_id = v_template and ts.when_applied = 'ip_stay'
        union all
        -- Each surgeon's charge (a doctor-charge service for that doctor), if the library has one.
        select 3, jsonb_build_object('kind', 'doctor_charge', 'service_id', s.id, 'doctor_id', s.doctor_id,
          'description', s.name, 'hsn_sac', s.sac, 'category_id', s.category_id, 'rate_paise', s.default_price_paise,
          'qty', 1, 'gst_rate_bp', s.gst_rate_bp)
        from public.admission_surgeons a
        join lateral (select * from public.services s where s.doctor_id = a.doctor_id and s.is_doctor_charge and s.active
                       order by s.usage_count desc limit 1) s on true
        where a.admission_id = v_a.id
      ) l), '[]'::jsonb));
end;
$$;

-- Same as Phase 6, plus: a final bill stamps the bills it carries ("included in final bill X").
create or replace function private.on_bill_finalized(p_bill public.bills)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := private.carried_bill_ids(p_bill.id);
begin
  if exists (select 1 from public.bill_items where bill_id = p_bill.id and kind = 'pharmacy' and batch_id is null) then
    perform private.fail('batch_required');
  end if;
  if cardinality(v_ids) > 0 then
    -- Lock the interim bills; each may be carried by one final bill only.
    perform 1 from public.bills where id = any (v_ids) order by id for update;
    if exists (select 1 from public.bills where id = any (v_ids)
                 and (status <> 'finalized' or (consolidated_into_id is not null and consolidated_into_id <> p_bill.id))) then
      perform private.fail('already_in_final_bill');
    end if;
    update public.bills set consolidated_into_id = p_bill.id where id = any (v_ids);
  end if;
  perform private.sync_bill_stock(p_bill.id);
  perform private.library_used('services', i.service_id) from public.bill_items i
   where i.bill_id = p_bill.id and i.service_id is not null and i.kind <> 'carried_in';
  perform private.library_used('pharmacy_items', i.pharmacy_item_id) from public.bill_items i
   where i.bill_id = p_bill.id and i.pharmacy_item_id is not null and i.kind = 'pharmacy';
end;
$$;

-- Same as Phase 6, plus: cancelling a final bill releases the bills it carried.
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
  update public.bills set consolidated_into_id = null where consolidated_into_id = p_bill_id;
  perform private.sync_bill_stock(p_bill_id, true);
  perform set_config('app.bill_amend', '', true);
  return private.bill_card(p_bill_id);
end;
$$;

-- Same as Phase 5, plus: a final bill's print lists the carried bills' payments too.
create or replace function public.bill_print_data(p_bill_id uuid, p_count boolean default true)
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
    'stay', (select jsonb_build_object('ip_number', a.ip_number, 'admitted_at', a.admitted_at, 'discharged_at', a.discharged_at,
                                       'room_days', private.room_days(a.admitted_at, coalesce(a.discharged_at, now())))
               from public.admissions a where a.id = v_bill.admission_id),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('received_at', p.received_at, 'mode', m.label, 'reference', p.reference,
                                          'amount_paise', a.amount_paise) order by p.received_at)
      from public.payment_allocations a
      join public.payments p on p.id = a.payment_id and p.cancelled_at is null
      join public.lookup_values m on m.id = p.mode_id
      where a.bill_id = p_bill_id or a.bill_id = any (private.carried_bill_ids(p_bill_id))), '[]'::jsonb));
end;
$$;

------------------------------------------------------------------------------
-- Discharge summary: placeholders, autofill, save, finalize, amend, print, templates
------------------------------------------------------------------------------
-- Values for {{placeholders}} (PLAN.md A3: "He underwent" for a female patient). Pronouns
-- follow the patient's gender: female → she/her, male → he/him/his, other/unknown → they/them/their.
create function private.discharge_vars(p_admission_id uuid, p_content jsonb default '{}')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'patient_name', concat_ws(' ', p.title, p.full_name),
    'first_name', split_part(btrim(p.full_name), ' ', 1),
    'age', (private.age_years(p.dob))::text,
    'gender', case p.gender when 'female' then 'female' when 'male' then 'male' end,
    'he_she', case p.gender when 'female' then 'she' when 'male' then 'he' else 'they' end,
    'He_She', case p.gender when 'female' then 'She' when 'male' then 'He' else 'They' end,
    'him_her', case p.gender when 'female' then 'her' when 'male' then 'him' else 'them' end,
    'Him_Her', case p.gender when 'female' then 'Her' when 'male' then 'Him' else 'Them' end,
    'his_her', case p.gender when 'female' then 'her' when 'male' then 'his' else 'their' end,
    'His_Her', case p.gender when 'female' then 'Her' when 'male' then 'His' else 'Their' end,
    'uhid', p.uhid,
    'ip_number', a.ip_number,
    'admitted_on', to_char(private.ist(a.admitted_at), 'DD/MM/YYYY'),
    'admitted_at', to_char(private.ist(a.admitted_at), 'DD/MM/YYYY HH12:MI AM'),
    'discharged_on', to_char(private.ist(a.discharged_at), 'DD/MM/YYYY'),
    'discharged_at', to_char(private.ist(a.discharged_at), 'DD/MM/YYYY HH12:MI AM'),
    'surgery_on', to_char(private.ist(a.surgery_at), 'DD/MM/YYYY'),
    'surgery_at', to_char(private.ist(a.surgery_at), 'DD/MM/YYYY HH12:MI AM'),
    'procedure', nullif(array_to_string(a.procedures, ', '), ''),
    'diagnosis', a.diagnosis,
    'anaesthesia', a.anaesthesia,
    'room', nullif(concat_ws(' ', r.name, a.room_label), ''),
    'surgeon', (select concat_ws(' ', coalesce(d.display_name, d.full_name), nullif(d.qualification, ''))
                  from public.admission_surgeons s join public.doctors d on d.id = s.doctor_id
                 where s.admission_id = a.id order by s.role = 'primary' desc, d.full_name limit 1),
    'surgeons', (select string_agg(coalesce(d.display_name, d.full_name), ', ' order by s.role = 'primary' desc, d.full_name)
                   from public.admission_surgeons s join public.doctors d on d.id = s.doctor_id where s.admission_id = a.id),
    'clinic_name', (select name from public.clinic_settings order by branch_code = 'main' desc limit 1),
    'follow_up_days', nullif(p_content ->> 'follow_up_days', ''),
    'follow_up_date', case when (p_content ->> 'follow_up_days') ~ '^[0-9]+$' and a.discharged_at is not null
                           then to_char((private.ist(a.discharged_at))::date + (p_content ->> 'follow_up_days')::int, 'DD/MM/YYYY') end))
  from public.admissions a
  join public.patients p on p.id = a.patient_id
  left join public.room_types r on r.id = a.room_type_id
  where a.id = p_admission_id;
$$;

-- {{ name }} → value, in one left-to-right pass (a value is never filled again). Unknown names,
-- or names without a value, stay as they are so finalize can refuse them. Same rule as
-- packages/shared/src/placeholders.ts (golden vectors: test-vectors/placeholders.json).
create function private.render_placeholders(p_text text, p_vars jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_rest text := coalesce(p_text, '');
  v_out text := '';
  v_pos integer;
  v_tok text;
  v_val text;
begin
  loop
    v_pos := regexp_instr(v_rest, '\{\{\s*[A-Za-z_]+\s*\}\}');
    exit when v_pos = 0;
    v_tok := regexp_substr(v_rest, '\{\{\s*[A-Za-z_]+\s*\}\}');
    v_val := coalesce(p_vars, '{}'::jsonb) ->> (regexp_match(v_tok, '[A-Za-z_]+'))[1];
    v_out := v_out || substr(v_rest, 1, v_pos - 1) || case when coalesce(v_val, '') <> '' then v_val else v_tok end;
    v_rest := substr(v_rest, v_pos + length(v_tok));
  end loop;
  return v_out || v_rest;
end;
$$;

-- The filled-in summary: every section and medication text rendered with the stay's values.
create function private.render_summary(p_admission_id uuid, p_content jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with v as (select private.discharge_vars(p_admission_id, p_content) as vars)
  select jsonb_build_object(
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object('key', s ->> 'key',
                                          'title', private.render_placeholders(s ->> 'title', v.vars),
                                          'body', private.render_placeholders(s ->> 'body', v.vars)) order by o)
      from jsonb_array_elements(coalesce(p_content -> 'sections', '[]')) with ordinality x (s, o)), '[]'::jsonb),
    'medications', coalesce((
      select jsonb_agg((
        select jsonb_object_agg(f.key, case when jsonb_typeof(f.value) = 'string'
                                            then to_jsonb(private.render_placeholders(f.value #>> '{}', v.vars)) else f.value end)
        from jsonb_each(m) f) order by o)
      from jsonb_array_elements(coalesce(p_content -> 'medications', '[]')) with ordinality x (m, o)), '[]'::jsonb),
    'follow_up_note', private.render_placeholders(p_content ->> 'follow_up_note', v.vars),
    'follow_up_days', p_content -> 'follow_up_days',
    'vars', v.vars)
  from v;
$$;

-- Placeholders still left after filling (unknown or without a value).
create function private.leftover_placeholders(p_rendered jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct btrim(m[1])), '{}')
  from regexp_matches((p_rendered - 'vars')::text, '\{\{([^}]*)\}\}', 'g') as m;
$$;

create function private.summary_card(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(s) || jsonb_build_object(
    'admission', private.admission_card(s.admission_id),
    'preview', case when s.status = 'draft' then private.render_summary(s.admission_id, s.content) else s.rendered end,
    'template', (select name from public.discharge_templates where id = s.template_id))
  from public.discharge_summaries s where s.id = p_id;
$$;

-- Everything a new summary starts from: the stay, its surgeons, the treatment's template
-- (or a given one), medicines from the stay's pharmacy bills, and the placeholder values.
create function public.discharge_autofill(p_admission_id uuid, p_template_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_a public.admissions;
  v_template public.discharge_templates;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select * into v_a from public.admissions where id = p_admission_id;
  if not found then
    perform private.fail('not_found');
  end if;
  select * into v_template from public.discharge_templates
   where id = coalesce(p_template_id,
                       (select discharge_template_id from public.patient_treatments where id = v_a.treatment_id),
                       (select t.discharge_template_id from public.patient_treatments pt
                          join public.treatment_templates t on t.id = pt.template_id where pt.id = v_a.treatment_id))
     and active;
  return jsonb_build_object(
    'admission', private.admission_card(p_admission_id),
    'vars', private.discharge_vars(p_admission_id, jsonb_build_object('follow_up_days', v_template.follow_up_days)),
    'template', case when v_template.id is not null then jsonb_build_object(
      'id', v_template.id, 'name', v_template.name, 'sections', v_template.sections, 'medications', v_template.medications,
      'follow_up_days', v_template.follow_up_days) end,
    'pharmacy_medicines', coalesce((
      select jsonb_agg(jsonb_build_object('pharmacy_item_id', x.pharmacy_item_id, 'name', x.name, 'dose', '', 'frequency', '',
                                          'duration', '', 'instructions', '') order by x.name)
      from (select distinct i.pharmacy_item_id, concat_ws(' ', pi.name, pi.strength) as name
              from public.bills b join public.bill_items i on i.bill_id = b.id and i.kind = 'pharmacy'
              join public.pharmacy_items pi on pi.id = i.pharmacy_item_id
             where b.admission_id = p_admission_id and b.status = 'finalized') x), '[]'::jsonb));
end;
$$;

-- Create (p_version null, idempotent on p_id) or autosave a DRAFT summary.
-- content: {sections: [{key, title, body}], medications: [{name, dose, frequency, duration, instructions,
--           pharmacy_item_id?}], follow_up_days, follow_up_note, doctor_id}
create function public.save_discharge_summary(p_id uuid, p_admission_id uuid, p_content jsonb, p_version integer default null,
                                              p_template_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_s public.discharge_summaries;
  v_a public.admissions;
begin
  if p_id is null or jsonb_typeof(p_content) <> 'object' then
    perform private.fail('invalid_input');
  end if;
  if jsonb_array_length(coalesce(p_content -> 'sections', '[]')) > 40 or jsonb_array_length(coalesce(p_content -> 'medications', '[]')) > 60
     or length(p_content::text) > 100000 then
    perform private.fail('invalid_input', 'the summary is too long');
  end if;
  select * into v_s from public.discharge_summaries where id = p_id for update;
  if not found then
    if p_version is not null then
      perform private.fail('not_found');
    end if;
    select * into v_a from public.admissions where id = p_admission_id and status <> 'cancelled';
    if not found then
      perform private.fail('not_found', 'admission');
    end if;
    if exists (select 1 from public.discharge_summaries where admission_id = p_admission_id and status <> 'cancelled') then
      perform private.fail('duplicate', 'this stay already has a discharge summary');
    end if;
    insert into public.discharge_summaries (id, admission_id, patient_id, content, template_id)
    values (p_id, p_admission_id, v_a.patient_id, p_content, p_template_id);
    if p_template_id is not null then
      update public.discharge_templates set usage_count = usage_count + 1 where id = p_template_id;
    end if;
    return private.summary_card(p_id);
  end if;
  if p_version is null then
    return private.summary_card(p_id); -- a retried create
  end if;
  if v_s.status <> 'draft' then
    perform private.fail('bill_locked', 'finalized summaries are amended by an admin');
  end if;
  if v_s.version <> p_version then
    perform private.fail('stale_version');
  end if;
  update public.discharge_summaries set content = p_content, version = version + 1,
         template_id = coalesce(p_template_id, template_id)
   where id = p_id;
  return private.summary_card(p_id);
end;
$$;

-- Checks + freezes the filled-in text, the clinic header and the patient/stay strip.
create function private.freeze_summary(p_id uuid, p_staff uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.discharge_summaries;
  v_a public.admissions;
  v_rendered jsonb;
  v_left text[];
  v_doctor public.doctors;
begin
  select * into v_s from public.discharge_summaries where id = p_id;
  select * into v_a from public.admissions where id = v_s.admission_id for update;
  if v_a.status <> 'discharged' or v_a.discharged_at is null then
    perform private.fail('not_discharged');
  end if;
  if v_a.surgery_at is not null and (v_a.surgery_at < v_a.admitted_at or v_a.surgery_at > v_a.discharged_at) then
    perform private.fail('dates_invalid', 'surgery must be inside the stay');
  end if;
  if not exists (select 1 from public.admission_surgeons where admission_id = v_a.id) then
    perform private.fail('surgeon_required');
  end if;
  select * into v_doctor from public.doctors where id = (v_s.content ->> 'doctor_id')::uuid;
  if not found then
    v_doctor := null;
    select d.* into v_doctor from public.admission_surgeons s join public.doctors d on d.id = s.doctor_id
     where s.admission_id = v_a.id order by s.role = 'primary' desc limit 1;
  end if;
  v_rendered := private.render_summary(v_a.id, v_s.content);
  v_left := private.leftover_placeholders(v_rendered);
  if cardinality(v_left) > 0 then
    perform private.fail('placeholders_left', array_to_string(v_left, ', '));
  end if;
  update public.discharge_summaries set
    status = 'finalized', rendered = v_rendered, finalized_at = now(), finalized_by = p_staff,
    header_snapshot = private.clinic_snapshot('final_bill') - 'terms',
    patient_snapshot = private.patient_snapshot(v_a.patient_id, v_doctor.id) || jsonb_build_object(
      'ip_number', v_a.ip_number, 'admitted_at', v_a.admitted_at, 'discharged_at', v_a.discharged_at,
      'surgery_at', v_a.surgery_at, 'procedures', to_jsonb(v_a.procedures), 'anaesthesia', v_a.anaesthesia,
      'diagnosis', v_a.diagnosis, 'room', (select name from public.room_types where id = v_a.room_type_id),
      'room_label', v_a.room_label, 'surgeons', (v_rendered -> 'vars') ->> 'surgeons',
      'signature', jsonb_build_object('name', coalesce(v_doctor.display_name, v_doctor.full_name), 'qualification', v_doctor.qualification,
                                      'designation', v_doctor.designation, 'reg_council', v_doctor.reg_council,
                                      'reg_number', v_doctor.reg_number)),
    version = version + 1
  where id = p_id;
end;
$$;

-- Finalize: date checks, surgery inside the stay, ≥ 1 surgeon, no {{…}} left; creates the
-- follow-up (Follow-ups list) when the summary asks for one.
create function public.finalize_discharge_summary(p_id uuid, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_s public.discharge_summaries;
  v_days integer;
  v_fu uuid;
begin
  select * into v_s from public.discharge_summaries where id = p_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if v_s.status <> 'draft' then
    perform private.fail('bill_locked');
  end if;
  if v_s.version <> p_version then
    perform private.fail('stale_version');
  end if;
  perform private.freeze_summary(p_id, v_staff);
  v_days := case when (v_s.content ->> 'follow_up_days') ~ '^[0-9]+$' then (v_s.content ->> 'follow_up_days')::int end;
  if v_days is not null and v_days > 0 then
    insert into public.followups (kind, patient_id, due_date, reason, source, ref_table, ref_id)
    select 'followup', a.patient_id, (private.ist(a.discharged_at))::date + v_days,
           left('Follow-up after discharge' || coalesce(': ' || nullif(array_to_string(a.procedures, ', '), ''), ''), 500),
           'discharge', 'discharge_summaries', p_id
    from public.admissions a where a.id = v_s.admission_id
    on conflict (kind, ref_table, ref_id) where ref_id is not null and status = 'open' do nothing
    returning id into v_fu;
    update public.discharge_summaries set followup_id = coalesce(v_fu, followup_id) where id = p_id;
  end if;
  return private.summary_card(p_id);
end;
$$;

-- Admin: change a finalized summary. The old version is kept with the reason.
create function public.amend_discharge_summary(p_id uuid, p_content jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.require_staff(array['admin']::public.staff_role[]);
  v_s public.discharge_summaries;
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    perform private.fail('reason_required');
  end if;
  select * into v_s from public.discharge_summaries where id = p_id for update;
  if not found or v_s.status <> 'finalized' then
    perform private.fail('not_found', 'only finalized summaries are amended');
  end if;
  insert into public.discharge_summary_versions (summary_id, version, content, rendered, edited_by, reason)
  values (p_id, v_s.version, v_s.content, v_s.rendered, v_admin, btrim(p_reason));
  perform set_config('app.reason', btrim(p_reason), true);
  update public.discharge_summaries set content = p_content, status = 'draft' where id = p_id;
  perform private.freeze_summary(p_id, v_admin);
  return private.summary_card(p_id);
end;
$$;

create function public.get_discharge_summary(p_id uuid)
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
  v := private.summary_card(p_id);
  if v is null then
    perform private.fail('not_found');
  end if;
  return v;
end;
$$;

-- Print: the frozen text (or a live preview for a draft). Counts prints like bills.
create function public.discharge_print_data(p_id uuid, p_count boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.discharge_summaries;
  v_a public.admissions;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select * into v_s from public.discharge_summaries where id = p_id;
  if not found then
    perform private.fail('not_found');
  end if;
  if p_count and v_s.status = 'finalized' then
    update public.discharge_summaries set print_count = print_count + 1 where id = p_id returning * into v_s;
  end if;
  select * into v_a from public.admissions where id = v_s.admission_id;
  return jsonb_build_object(
    'id', v_s.id, 'status', v_s.status, 'print_count', v_s.print_count,
    'copy', case when v_s.status = 'draft' then 'draft' when v_s.print_count <= 1 then 'original' else 'duplicate' end,
    'header', coalesce(v_s.header_snapshot, private.clinic_snapshot('final_bill') - 'terms'),
    'patient_strip', coalesce(v_s.patient_snapshot, private.patient_snapshot(v_a.patient_id, null) || jsonb_build_object(
      'ip_number', v_a.ip_number, 'admitted_at', v_a.admitted_at, 'discharged_at', v_a.discharged_at, 'surgery_at', v_a.surgery_at,
      'procedures', to_jsonb(v_a.procedures), 'anaesthesia', v_a.anaesthesia, 'diagnosis', v_a.diagnosis)),
    'body', coalesce(v_s.rendered, private.render_summary(v_s.admission_id, v_s.content)),
    'finalized_at', v_s.finalized_at);
end;
$$;

-- Save the summary's sections/medicines (with their placeholders) as a new template, or
-- update an existing one (p_template_id).
create function public.save_discharge_template(p_summary_id uuid, p_name text, p_template_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_s public.discharge_summaries;
  v_id uuid;
begin
  select * into v_s from public.discharge_summaries where id = p_summary_id;
  if not found then
    perform private.fail('not_found');
  end if;
  if p_template_id is null then
    if length(btrim(coalesce(p_name, ''))) = 0 then
      perform private.fail('invalid_input', 'name');
    end if;
    insert into public.discharge_templates (name, treatment_template_id, sections, medications, follow_up_days)
    values (btrim(p_name), (select template_id from public.patient_treatments pt join public.admissions a on a.treatment_id = pt.id
                             where a.id = v_s.admission_id),
            coalesce(v_s.content -> 'sections', '[]'), coalesce(v_s.content -> 'medications', '[]'),
            case when (v_s.content ->> 'follow_up_days') ~ '^[0-9]+$' then (v_s.content ->> 'follow_up_days')::int end)
    returning id into v_id;
  else
    update public.discharge_templates set
      name = coalesce(nullif(btrim(p_name), ''), name), sections = coalesce(v_s.content -> 'sections', '[]'),
      medications = coalesce(v_s.content -> 'medications', '[]'),
      follow_up_days = case when (v_s.content ->> 'follow_up_days') ~ '^[0-9]+$' then (v_s.content ->> 'follow_up_days')::int end,
      version = version + 1
    where id = p_template_id returning id into v_id;
    if v_id is null then
      perform private.fail('not_found', 'template');
    end if;
  end if;
  return (select to_jsonb(t) from public.discharge_templates t where id = v_id);
exception
  when unique_violation then
    perform private.fail('duplicate', 'a template with this name exists');
end;
$$;

create function public.discharge_templates_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'follow_up_days', follow_up_days,
                                                        'sections', jsonb_array_length(sections), 'active', active)
                                    order by usage_count desc, lower(name))
                   from (select * from public.discharge_templates order by active desc, usage_count desc, lower(name) limit 100) t),
                  '[]'::jsonb);
end;
$$;

-- Admin: rename / switch off a template (its content changes through save_discharge_template).
create function public.update_discharge_template(p_template_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  update public.discharge_templates set
    name = coalesce(nullif(btrim(p_patch ->> 'name'), ''), name),
    active = coalesce((p_patch ->> 'active')::boolean, active),
    sections = coalesce(p_patch -> 'sections', sections),
    medications = coalesce(p_patch -> 'medications', medications),
    follow_up_days = case when p_patch ? 'follow_up_days' then (p_patch ->> 'follow_up_days')::int else follow_up_days end,
    version = version + 1
  where id = p_template_id;
  if not found then
    perform private.fail('not_found');
  end if;
  return (select to_jsonb(t) from public.discharge_templates t where id = p_template_id);
exception
  when unique_violation then
    perform private.fail('duplicate');
  when invalid_text_representation or check_violation then
    perform private.fail('invalid_input', sqlerrm);
end;
$$;

-- A draft pharmacy bill from the summary's medicines (those linked to pharmacy items),
-- one of each from the earliest-expiring batch; the desk sets quantities before finalizing.
create function public.pharmacy_bill_from_meds(p_summary_id uuid, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_s public.discharge_summaries;
  v_bill jsonb;
  v_items jsonb;
begin
  select * into v_s from public.discharge_summaries where id = p_summary_id;
  if not found then
    perform private.fail('not_found');
  end if;
  v_bill := public.create_bill('pharmacy_invoice', v_s.patient_id, jsonb_build_object('admission_id', v_s.admission_id), p_client_id);
  if (v_bill ->> 'version')::int > 1 or jsonb_array_length(v_bill -> 'items') > 0 then
    return v_bill; -- a retry
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'pharmacy', 'batch_id', b.id,
                    'description', concat_ws(' ', pi.name, pi.strength), 'rate_paise',
                    coalesce(nullif(b.selling_price_paise, 0), nullif(b.mrp_paise, 0), pi.selling_price_paise),
                    'qty', 1, 'gst_rate_bp', pi.gst_rate_bp) order by m.o), '[]'::jsonb)
  into v_items
  from jsonb_array_elements(coalesce(v_s.content -> 'medications', '[]')) with ordinality m (med, o)
  join public.pharmacy_items pi on pi.id = (m.med ->> 'pharmacy_item_id')::uuid
  join lateral (select * from public.item_batches bb
                 where bb.item_id = pi.id and bb.qty_on_hand > 0 and bb.expiry_date >= (private.ist(now()))::date
                 order by bb.expiry_date, bb.created_at limit 1) b on true;
  return public.save_bill((v_bill ->> 'id')::uuid, '{}', v_items, (v_bill ->> 'version')::int);
end;
$$;

------------------------------------------------------------------------------
-- A generic template to start from (no patient details; edit freely in the app).
------------------------------------------------------------------------------
insert into public.discharge_templates (name, sections, medications, follow_up_days) values (
  'Septoplasty (generic)',
  '[
    {"key": "diagnosis", "title": "Diagnosis", "body": "{{diagnosis}}"},
    {"key": "history", "title": "History", "body": "{{patient_name}}, {{age}} years, was admitted on {{admitted_on}} with nasal obstruction."},
    {"key": "procedure", "title": "Procedure", "body": "{{He_She}} underwent {{procedure}} under {{anaesthesia}} on {{surgery_on}} by {{surgeon}}. The procedure was uneventful."},
    {"key": "course", "title": "Course in hospital", "body": "{{His_Her}} post-operative course was uneventful. {{He_She}} is being discharged in a stable condition on {{discharged_on}}."},
    {"key": "advice", "title": "Advice on discharge", "body": "Avoid blowing the nose and strenuous activity for two weeks. Keep the head raised while sleeping. Report any bleeding or fever."}
  ]',
  '[]',
  7)
on conflict do nothing;

------------------------------------------------------------------------------
-- KPIs: IP admissions and length of stay join the daily rollup.
------------------------------------------------------------------------------
create or replace function private.kpi_mark_dirty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (private.ist(now()))::date;
  -- Rows as JSON: one trigger serves several tables, and OLD/NEW may be absent.
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_fields text[] := case tg_table_name when 'bills' then array['bill_at'] when 'payments' then array['received_at']
                                        when 'admissions' then array['admitted_at', 'discharged_at'] else array['appt_date'] end;
begin
  insert into public.kpi_dirty_days (day)
  select distinct d
  from (
    select case when f = 'appt_date' then (x ->> f)::date else (private.ist((x ->> f)::timestamptz))::date end as d
    from unnest(array[v_new, v_old]) x cross join unnest(v_fields) f
    where x is not null and x ->> f is not null
  ) days
  where d < v_today
  on conflict (day) do update set marked_at = now();
  return coalesce(new, old);
end;
$$;
create trigger admissions_kpi_dirty after insert or update or delete on public.admissions
  for each row execute function private.kpi_mark_dirty();

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
  ),
  admitted_day as (
    select a.* from public.admissions a, bounds
    where a.status <> 'cancelled' and a.admitted_at >= bounds.lo and a.admitted_at < bounds.hi
  ),
  discharged_day as (
    select a.* from public.admissions a, bounds
    where a.status = 'discharged' and a.discharged_at >= bounds.lo and a.discharged_at < bounds.hi
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
  union all select 'pharmacy_cogs_paise', 'clinic', '', coalesce(sum(cogs), 0) from pharmacy_lines
  union all select 'admissions_count', 'clinic', '', count(*) from admitted_day
  union all select 'discharges_count', 'clinic', '', count(*) from discharged_day
  union all select 'stay_days', 'clinic', '', coalesce(sum(private.room_days(admitted_at, discharged_at)), 0) from discharged_day;
$$;

alter default privileges revoke execute on functions from public;
select private.lock_down_public_functions();
