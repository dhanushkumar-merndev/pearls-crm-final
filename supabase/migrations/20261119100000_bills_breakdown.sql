-- All bills page: a breakdown of the bills the filters pick (owner, 03/11/2026: "all bills — where is
-- the breakdown? not there, fix it").
-- bills_table keeps every field it had and adds `summary`:
--   billed_paise / received_paise / due_paise  finalized bills only. Billed is each bill's OWN total
--                                              (as `sum_paise` always was), so a final bill that carries
--                                              an interim bill's lines does not count them twice;
--                                              received = payments allocated to those bills;
--                                              due = billed − received (never below 0).
--   by_type   [{bill_type, count, billed_paise, received_paise}] finalized, in a fixed order.
--   by_mode   [{mode, received_paise}] the same received money by payment mode, biggest first.
--   drafts / cancelled  how many of the picked bills are not finalized.

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
