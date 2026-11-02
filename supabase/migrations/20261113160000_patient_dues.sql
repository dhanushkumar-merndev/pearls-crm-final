-- Patient file header: what is still due, bill by bill (owner, 02/11/2026: "if balance remains
-- show it; if more than one, a dropdown that opens the bill to add the payment").
-- A bill's balance is the one its own page shows: its total (own lines + carried-in lines) minus
-- payments allocated to it or to the bills it carries. Bills already included in a final bill are
-- left out (their balance shows on that final bill). Only finalized bills owe money.
create function public.patient_dues(p_patient_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select coalesce(jsonb_agg(d.row order by d.bill_at, d.id), '[]'::jsonb) into v_rows
  from (
    select b.id, b.bill_at,
           jsonb_build_object('id', b.id, 'bill_no', b.bill_no, 'bill_type', b.bill_type, 'bill_at', b.bill_at,
                              'ip_number', a.ip_number, 'total_paise', b.total_paise + b.carried_in_paise,
                              'due_paise', b.total_paise + b.carried_in_paise - r.received) as row
    from public.bills b
    left join public.admissions a on a.id = b.admission_id
    cross join lateral (
      select coalesce(sum(al.amount_paise), 0) as received
      from public.payment_allocations al
      join public.payments pay on pay.id = al.payment_id and pay.cancelled_at is null
      where al.bill_id = b.id or al.bill_id = any (private.carried_bill_ids(b.id))) r
    where b.patient_id = p_patient_id and b.status = 'finalized' and b.consolidated_into_id is null
      and b.total_paise + b.carried_in_paise - r.received > 0
  ) d;
  return jsonb_build_object(
    'total_due_paise', (select coalesce(sum((e ->> 'due_paise')::bigint), 0) from jsonb_array_elements(v_rows) e),
    'bills', v_rows);
end;
$$;

select private.lock_down_public_functions();
