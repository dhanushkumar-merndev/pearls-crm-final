-- Speed: this month's WhatsApp spend took ~0.5 s with two years of messages (the month start was
-- worked out again for every row inside the function). Work it out once, then sum: ~10 ms.
create or replace function private.wa_month_spent(p_now timestamptz default now())
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := private.ist_at(date_trunc('month', private.ist(p_now))::date, '00:00');
begin
  return (
    select coalesce(sum(m.est_cost_paise), 0)::bigint
    from public.wa_messages m
    where m.direction = 'outbound' and m.kind = 'template' and m.created_at >= v_from
      and (m.status in ('sent', 'delivered', 'read') or (m.status = 'queued' and m.locked_until > p_now)));
end;
$$;

-- One spend lookup per check (the budget was read twice).
create or replace function private.wa_over_budget(p_cost integer, p_now timestamptz default now())
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_budget bigint := private.wa_budget();
begin
  return v_budget is not null and private.wa_month_spent(p_now) + coalesce(p_cost, 0) > v_budget;
end;
$$;
