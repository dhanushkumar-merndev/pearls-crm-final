-- Terms & Conditions on every paper (owner, 20/11/2026, with photos of the clinic's old bills:
-- "why no logo, apply these terms on all papers").
--   * Quotation: its own points (Admin → Clinic profile → Terms → "Quotation"), plus the legal ids
--     (GSTIN, LLPIN) and the signatory, so the phone's PDF and the web print match the bills.
--   * Breakdown bill for insurance: prints the "Final bill" points (it never kept them before).
-- Clinic details still come only from clinic_settings.

create or replace function private.quotation_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(q) || jsonb_build_object(
    'lead_name', l.name,
    'lead_phone', l.phone_e164,
    'lead_sl_no', l.sl_no,
    'created_by_name', s.full_name,
    'clinic', (select jsonb_build_object('name', c.name, 'legal_name', c.legal_name, 'gstin', c.gstin,
                                         'llpin', c.llpin, 'state_code', c.state_code,
                                         'address_lines', to_jsonb(c.address_lines), 'city', c.city, 'state', c.state,
                                         'pincode', c.pincode, 'phones', to_jsonb(c.phones), 'email', c.email,
                                         'website', c.website, 'logo_path', c.logo_path,
                                         'signatory_label', c.signatory_label,
                                         'terms', case when jsonb_typeof(c.terms -> 'quotation') = 'array'
                                                       then c.terms -> 'quotation' else '[]'::jsonb end)
               from public.clinic_settings c order by c.branch_code = 'main' desc, c.created_at limit 1))
  from public.lead_quotations q
  join public.leads l on l.id = q.lead_id
  left join public.staff s on s.id = q.created_by
  where q.id = p_id;
$$;

create or replace function public.breakdown_print_data(p_id uuid, p_count boolean default true)
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
    -- The clinic as it was when finalized; the terms are today's "Final bill" points.
    'header', coalesce(v_b.header_snapshot, private.clinic_snapshot('final_bill'))
              || jsonb_build_object('terms', coalesce(private.clinic_snapshot('final_bill') -> 'terms', '[]'::jsonb)),
    'patient_strip', coalesce(v_b.patient_snapshot, private.bb_facts(v_b)));
end;
$$;

select private.lock_down_public_functions();
