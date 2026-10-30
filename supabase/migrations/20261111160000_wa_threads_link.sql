-- The inbox learns who a number is as soon as staff register the patient or add the lead,
-- not only when their next message arrives (owner: "after save why name is not appearing").
-- Messages need no change: wa_thread already shows a number's unlinked messages.

create function private.wa_threads_link_patient()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.merged_into_id is null then
    update public.wa_threads t set patient_id = new.id, updated_at = now()
    where t.patient_id is null and right(t.phone_e164, 10) in (new.phone_last10, new.whatsapp_last10);
  end if;
  return null;
end;
$$;

create trigger patients_wa_threads after insert or update of phone_e164, whatsapp_e164 on public.patients
  for each row execute function private.wa_threads_link_patient();

create function private.wa_threads_link_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is null then
    update public.wa_threads t set lead_id = new.id, updated_at = now()
    where t.patient_id is null and t.lead_id is null and right(t.phone_e164, 10) in (new.phone_last10, new.alt_phone_last10);
  end if;
  return null;
end;
$$;

create trigger leads_wa_threads after insert or update of phone_e164, alt_phone_e164 on public.leads
  for each row execute function private.wa_threads_link_lead();

-- Numbers already registered before this change.
update public.wa_threads t set patient_id = p.id, updated_at = now()
from public.patients p
where t.patient_id is null and p.merged_into_id is null and right(t.phone_e164, 10) in (p.phone_last10, p.whatsapp_last10)
  and p.id = (select p2.id from public.patients p2
              where p2.merged_into_id is null and right(t.phone_e164, 10) in (p2.phone_last10, p2.whatsapp_last10)
              order by p2.created_at desc limit 1);
update public.wa_threads t set lead_id = l.id, updated_at = now()
from public.leads l
where t.patient_id is null and t.lead_id is null
  and l.id = (select l2.id from public.leads l2
              where l2.deleted_at is null
                and right(t.phone_e164, 10) in (l2.phone_last10, l2.alt_phone_last10)
              order by l2.created_at desc limit 1);
