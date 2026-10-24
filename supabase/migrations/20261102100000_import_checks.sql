-- Pearl CRM — stricter import checks (patients, opening stock; leads use the same helper).
-- The check run ("dry run") now does exactly what the import would do, inside a savepoint
-- that is undone, so every problem the import would hit is found first: bad phone numbers,
-- too-long text, a UHID or batch repeated inside the same file. Each problem names the
-- column and a stable code; raw database messages never reach the screen.

-- One problem row for the import report: {row, field, message}.
--   P0001 (our own private.fail): detail names the field, message is the code.
--   Check / not-null violations: the field comes from the column or the constraint name
--   ("patients_pincode_check" → "pincode"); the message becomes invalid_input.
create function private.import_error(p_row integer, p_state text, p_message text, p_detail text,
                                     p_constraint text, p_column text, p_tables text[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_field text;
  v_table text;
begin
  if p_state = 'P0001' and p_detail ~ 'violates (check|not-null) constraint' then
    -- Some functions re-raise a constraint error as invalid_input with the database text as detail.
    v_field := coalesce(substring(p_detail from 'check constraint "([^"]+)"'), substring(p_detail from 'column "([^"]+)"'));
    v_field := regexp_replace(coalesce(v_field, ''), '_(check|key|fkey)$', '');
    foreach v_table in array p_tables loop
      v_field := regexp_replace(v_field, '^' || v_table || '_', '');
    end loop;
    v_field := nullif(v_field, '');
  elsif p_state = 'P0001' then
    v_field := nullif(p_detail, '');
  elsif nullif(p_column, '') is not null then
    v_field := p_column;
  elsif nullif(p_constraint, '') is not null then
    v_field := regexp_replace(p_constraint, '_(check|key|fkey)$', '');
    foreach v_table in array p_tables loop
      v_field := regexp_replace(v_field, '^' || v_table || '_', '');
    end loop;
  end if;
  return jsonb_build_object(
    'row', p_row,
    'field', v_field,
    'message', case
      when p_state = 'P0001' and p_message = any (array['invalid_input', 'duplicate', 'not_found', 'reason_required',
                                                        'invalid_quantity', 'expired_batch', 'not_allowed']) then p_message
      when p_state = '23505' then 'duplicate'
      else 'invalid_input' end);
end;
$$;

------------------------------------------------------------------------------
-- Patients (DocPulse import). Same checks as before plus everything the insert checks.
------------------------------------------------------------------------------
create or replace function public.import_patients(p_rows jsonb, p_dry_run boolean default true)
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
  v_fields jsonb;
  v_uhid text;
  v_id uuid;
  v_seen text[] := '{}';
  v_state text;
  v_detail text;
  v_message text;
  v_constraint text;
  v_column text;
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    perform private.fail('invalid_input', 'at most 500 rows per batch');
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    begin
      if jsonb_typeof(v_row) <> 'object' then
        perform private.fail('invalid_input', 'row');
      end if;
      v_fields := private.patient_fields(v_row);
      if not v_fields ? 'full_name' then
        perform private.fail('invalid_input', 'full_name');
      end if;
      v_uhid := nullif(btrim(v_row ->> 'uhid'), '');
      if v_uhid is not null then
        if lower(v_uhid) = any (v_seen) or exists (select 1 from public.patients where lower(uhid) = lower(v_uhid)) then
          perform private.fail('duplicate', 'uhid');
        end if;
        v_seen := v_seen || lower(v_uhid);
      end if;
      v_id := gen_random_uuid();
      insert into public.patients (id, uhid, full_name)
      values (v_id, coalesce(v_uhid, private.take_number('uhid')), v_fields ->> 'full_name');
      perform private.patient_apply(v_id, v_fields - 'full_name');
      if p_dry_run then
        raise exception using errcode = 'PX001', message = 'dry_run_ok'; -- undo this row, count it as fine
      end if;
      v_ok := v_ok + 1;
    exception
      when sqlstate 'PX001' then
        v_ok := v_ok + 1;
      when others then
        get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail,
                                v_constraint = constraint_name, v_column = column_name;
        v_errors := v_errors || private.import_error(v_i, v_state, v_message, v_detail, v_constraint, v_column, array['patients']);
    end;
  end loop;
  return jsonb_build_object('ok', v_ok, 'errors', v_errors, 'dry_run', p_dry_run);
end;
$$;

------------------------------------------------------------------------------
-- Opening stock: the same batch twice in one file is caught by the check run too.
------------------------------------------------------------------------------
create or replace function public.import_opening_stock(p_rows jsonb, p_dry_run boolean default true)
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
  v_key text;
  v_seen text[] := '{}';
  v_state text;
  v_detail text;
  v_message text;
  v_constraint text;
  v_column text;
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    perform private.fail('invalid_input', 'at most 500 rows per batch');
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    begin
      if jsonb_typeof(v_row) <> 'object' then
        perform private.fail('invalid_input', 'row');
      end if;
      if length(btrim(coalesce(v_row ->> 'name', ''))) = 0 then
        perform private.fail('invalid_input', 'name');
      end if;
      if length(btrim(coalesce(v_row ->> 'batch_no', ''))) = 0 then
        perform private.fail('invalid_input', 'batch_no');
      end if;
      if (v_row ->> 'expiry_date') is null then
        perform private.fail('invalid_input', 'expiry_date');
      end if;
      if coalesce((v_row ->> 'qty')::numeric, 0) <= 0 then
        perform private.fail('invalid_quantity', 'qty');
      end if;
      v_key := lower(concat_ws('|', btrim(v_row ->> 'name'), btrim(v_row ->> 'strength'), btrim(v_row ->> 'form'),
                               btrim(v_row ->> 'batch_no'), private.month_end((v_row ->> 'expiry_date')::date)));
      if v_key = any (v_seen) then
        perform private.fail('duplicate', 'batch_no');
      end if;
      v_seen := v_seen || v_key;
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
        perform private.fail('duplicate', 'batch_no');
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
        get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail,
                                v_constraint = constraint_name, v_column = column_name;
        v_errors := v_errors || private.import_error(v_i, v_state, v_message, v_detail, v_constraint, v_column,
                                                     array['pharmacy_items', 'item_batches', 'stock_movements']);
    end;
  end loop;
  if cardinality(v_items) > 0 then
    perform private.refresh_stock_alerts(v_items);
  end if;
  return jsonb_build_object('ok', v_ok, 'errors', v_errors, 'dry_run', p_dry_run);
end;
$$;

select private.lock_down_public_functions();
