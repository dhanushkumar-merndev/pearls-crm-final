-- Search: part of a phone number from 3 digits, anywhere in the number (owner, 30/10/2026: typing
-- the first digits "940849373" found nothing — only the last digits matched before). Numbers that
-- start with the digits come first, then numbers that end with them, then the rest.
create index if not exists leads_phone_trgm on public.leads using gin (phone_last10 extensions.gin_trgm_ops) where deleted_at is null;

create or replace function public.global_search(p_q text, p_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.staff_role;
  v_me uuid;
  v_q text := btrim(coalesce(p_q, ''));
  v_digits text := regexp_replace(v_q, '\D', '', 'g');
  v_phone_only boolean := v_q ~ '^[0-9\s+()-]+$';
  v_has_letters boolean := v_q ~ '[[:alpha:]]';
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 20);
  v_patients jsonb := '[]'::jsonb;
  v_leads jsonb := '[]'::jsonb;
begin
  v_me := private.require_staff();
  v_role := private.my_role();
  if length(v_q) < 2 or v_role = 'bdm' then
    return '[]'::jsonb;
  end if;

  if v_role in ('receptionist', 'admin') then
    with hits as (
      select p.id, 0 as rank, 1.0::real as sim from public.patients p
       where lower(p.uhid) like lower(private.like_escape(v_q)) || '%' and p.merged_into_id is null
      union all
      select p.id, 1, 1.0 from public.patients p
       where v_phone_only and length(v_digits) >= 10 and p.merged_into_id is null
         and right(v_digits, 10) in (p.phone_last10, p.whatsapp_last10, p.alt_phone_last10)
      union all
      select p.id, 2, case when p.phone_last10 like v_digits || '%' then 1.0 when p.phone_last10 like '%' || v_digits then 0.9 else 0.5 end::real
        from public.patients p
       where v_phone_only and length(v_digits) between 3 and 9
         and p.merged_into_id is null and p.phone_last10 like '%' || v_digits || '%'
      union all
      select p.id, 3, extensions.similarity(p.full_name, v_q) from public.patients p
       where v_has_letters and p.merged_into_id is null
         and p.full_name ilike '%' || private.like_escape(v_q) || '%'
    ), best as (
      select h.id, min(h.rank) as rank, max(h.sim) as sim from hits h group by h.id
      order by min(h.rank), max(h.sim) desc limit v_limit
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'type', 'patient', 'id', p.id, 'title', p.full_name, 'uhid', p.uhid, 'rank', b.rank,
             'subtitle', concat_ws(' · ', p.uhid, p.phone_e164,
               case when p.dob is not null then private.age_years(p.dob)::text || ' y' end))
           order by b.rank, b.sim desc, p.full_name), '[]'::jsonb)
      into v_patients
    from best b join public.patients p on p.id = b.id;
  end if;

  with hits as (
    select l.id, 1 as rank, 1.0::real as sim from public.leads l
     where v_phone_only and length(v_digits) >= 10 and l.deleted_at is null
       and right(v_digits, 10) in (l.phone_last10, l.alt_phone_last10)
    union all
    select l.id, 2, case when l.phone_last10 like v_digits || '%' then 1.0 when l.phone_last10 like '%' || v_digits then 0.9 else 0.5 end::real
      from public.leads l
     where v_phone_only and length(v_digits) between 3 and 9 and l.deleted_at is null and l.phone_last10 like '%' || v_digits || '%'
    union all
    select l.id, 3, extensions.similarity(l.name, v_q) from public.leads l
     where v_has_letters and l.deleted_at is null and l.name ilike '%' || private.like_escape(v_q) || '%'
  ), best as (
    select h.id, min(h.rank) as rank, max(h.sim) as sim
    from hits h join public.leads l on l.id = h.id
    where v_role <> 'sales_executive' or l.assigned_to = v_me
    group by h.id
    order by min(h.rank), max(h.sim) desc limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'type', 'lead', 'id', l.id, 'title', l.name, 'stage', l.stage, 'rank', b.rank,
           'subtitle', concat_ws(' · ', '#' || l.sl_no, l.phone_e164, s.full_name))
         order by b.rank, b.sim desc, l.name), '[]'::jsonb)
    into v_leads
  from best b join public.leads l on l.id = b.id left join public.staff s on s.id = l.assigned_to;

  -- Patients first, then leads; best matches first within each, at most p_limit in all.
  return coalesce((
    select jsonb_agg(e.value order by e.ord)
    from (select x.value, row_number() over () as ord
          from jsonb_array_elements(v_patients || v_leads) x) e
    where e.ord <= v_limit), '[]'::jsonb);
end;
$$;

select private.lock_down_public_functions();
