-- The bill's date (owner, 27/11/2026: "a bill gets today's date when saved, keeps it, and I can change
-- it to a past or future day"). Before, the date was stamped only at Finalize, so a draft made on the
-- 27th and finalized on the 29th said 29th.
--   * A bill gets today's date (and time) when it is made; drafts already open get their creation time.
--   * save_bill takes header.bill_date ("YYYY-MM-DD", within a year of today either way) while it is a
--     draft; the time of day is kept.
--   * finalize_bill keeps that date; the bill number and FY follow the bill's date. finalized_at still
--     records when it was really finalized.
-- bill_at stays the one bill date every list, print and report already reads (KPI days already
-- recompute when it moves to a past day; a future day is rolled up when it ends).

alter table public.bills alter column bill_at set default now();
update public.bills set bill_at = created_at where status = 'draft' and bill_at is null;

create or replace function public.save_bill(p_bill_id uuid, p_header jsonb, p_items jsonb, p_version integer)
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
  v_today date := (private.ist(now()))::date;
  v_date date;
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
  -- The bill's date: any day within a year of today, either way (owner, 27/11/2026).
  if nullif(btrim(p_header ->> 'bill_date'), '') is not null then
    v_date := (p_header ->> 'bill_date')::date;
    if v_date < v_today - 366 or v_date > v_today + 366 then
      perform private.fail('invalid_input', 'bill_date');
    end if;
  end if;

  update public.bills set
    doctor_id = case when p_header ? 'doctor_id' then (p_header ->> 'doctor_id')::uuid else doctor_id end,
    referred_by_text = case when p_header ? 'referred_by_text' then nullif(btrim(p_header ->> 'referred_by_text'), '') else referred_by_text end,
    tax_inclusive = coalesce((p_header ->> 'tax_inclusive')::boolean, tax_inclusive),
    notes = case when p_header ? 'notes' then nullif(btrim(p_header ->> 'notes'), '') else notes end,
    -- A new day keeps the time of day the bill was made; the same day changes nothing.
    bill_at = case when v_date is null or (private.ist(coalesce(bill_at, created_at)))::date = v_date then coalesce(bill_at, created_at)
                   else private.ist_at(v_date, (private.ist(coalesce(bill_at, created_at)))::time) end,
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
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
       or not_null_violation or check_violation then
    perform private.fail('invalid_input', sqlerrm);
end;
$$;

create or replace function public.finalize_bill(p_bill_id uuid, p_version integer, p_payments jsonb default '[]',
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
    -- The bill keeps its own date (set when made, or changed by staff); its number and FY follow it.
    bill_no = private.take_number(bill_type::text::public.series_key, coalesce(bill_at, now())),
    fy = private.fy_label(coalesce(bill_at, now())),
    bill_at = coalesce(bill_at, now()),
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

select private.lock_down_public_functions();
