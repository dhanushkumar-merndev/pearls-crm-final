-- Fix: global_search skipped the name branch whenever the query contained ANY digit,
-- so "Ravi 9845" or a name with a number found nothing. Now:
--   letters present → name search (and UHID prefix);
--   only phone characters (digits, spaces, +, -) → phone search;
-- both can apply to one query, best match first.
create or replace function public.global_search(p_q text, p_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.staff_role;
  v_q text := btrim(coalesce(p_q, ''));
  v_digits text := regexp_replace(v_q, '\D', '', 'g');
  v_phone_only boolean := v_q ~ '^[0-9\s+()-]+$';
  v_has_letters boolean := v_q ~ '[[:alpha:]]';
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 20);
  v_result jsonb;
begin
  perform private.require_staff();
  v_role := private.my_role();
  if length(v_q) < 2 or v_role not in ('receptionist', 'admin') then
    return '[]'::jsonb;
  end if;

  with hits as (
    -- UHID: exact or starts with
    select p.id, 0 as rank, 1.0::real as sim from public.patients p
     where lower(p.uhid) like lower(private.like_escape(v_q)) || '%' and p.merged_into_id is null
    union all
    -- phone: last 10 digits, or the end of the number when fewer digits are typed
    select p.id, 1, 1.0 from public.patients p
     where v_phone_only and length(v_digits) >= 10 and p.merged_into_id is null
       and right(v_digits, 10) in (p.phone_last10, p.whatsapp_last10, p.alt_phone_last10)
    union all
    select p.id, 2, 1.0 from public.patients p
     where v_phone_only and length(v_digits) between 4 and 9
       and p.merged_into_id is null and p.phone_last10 like '%' || v_digits
    union all
    -- name: contains, best match first (letters required, digits allowed)
    select p.id, 3, extensions.similarity(p.full_name, v_q) from public.patients p
     where v_has_letters and p.merged_into_id is null
       and p.full_name ilike '%' || private.like_escape(v_q) || '%'
  ), best as (
    select h.id, min(h.rank) as rank, max(h.sim) as sim from hits h group by h.id
    order by min(h.rank), max(h.sim) desc limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'type', 'patient', 'id', p.id, 'title', p.full_name, 'uhid', p.uhid,
           'subtitle', concat_ws(' · ', p.uhid, p.phone_e164,
             case when p.dob is not null then private.age_years(p.dob)::text || ' y' end))
         order by b.rank, b.sim desc, p.full_name), '[]'::jsonb)
    into v_result
  from best b join public.patients p on p.id = b.id;
  return v_result;
end;
$$;

select private.lock_down_public_functions();
