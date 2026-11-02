-- Appointments → Actions → "WhatsApp reminder" sends through the clinic's own WhatsApp (owner,
-- 02/11/2026: "it opens my WhatsApp rather than the built-in one"). One click queues the approved
-- "appointment reminder" template for that booking; it shows in the patient's / lead's chat like
-- any other message. Only when the Cloud API is off (or this person is messaged by hand) does the
-- app fall back to opening WhatsApp with the text, and that is logged in the chat too.
-- Template messages switched off (Admin → WhatsApp), or no approved reminder template: if the
-- person wrote to us in the last 24 hours the reminder goes as a normal chat message (Meta allows
-- that, free); otherwise a clear reason. The staff member's own WhatsApp is never opened for this.
-- A reminder sent by hand counts as the booking's reminder: the automatic one is not sent again.
create or replace function public.wa_send_reminder(p_appointment_id uuid, p_text text, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.appointments;
  v_lead uuid;
  v_t record;
  v_row public.wa_messages;
  v_text text := nullif(btrim(p_text), '');
  v_key text;
  v_window boolean;
begin
  perform private.require_staff(array['receptionist', 'sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  if p_client_id is null or p_appointment_id is null then
    perform private.fail('invalid_input');
  end if;
  select * into v_row from public.wa_messages where id = p_client_id;
  if found then
    return to_jsonb(v_row) || jsonb_build_object('repeat', true, 'manual', v_row.kind = 'manual');
  end if;
  select * into v_a from public.appointments where id = p_appointment_id;
  if not found then
    perform private.fail('not_found');
  end if;
  v_lead := case when v_a.patient_id is null then v_a.lead_id end;
  perform private.wa_can_message(v_a.patient_id, v_lead);
  -- Only before the visit: not once arrived, done, no-show, cancelled, or the time has passed.
  if v_a.status not in ('pending_confirmation', 'confirmed') or v_a.slot_start is null or v_a.slot_start <= now() then
    perform private.fail('reminder_not_upcoming');
  end if;
  select * into v_t from private.wa_target(v_a.patient_id, v_lead);
  if v_t.phone_e164 is null then
    perform private.fail('invalid_input', 'phone');
  end if;
  if exists (select 1 from public.wa_contacts c where c.phone_e164 = v_t.phone_e164 and c.opted_out_at is not null) then
    perform private.fail('opted_out');
  end if;

  -- Cloud API off, or this person is messaged by hand: log it, the app opens WhatsApp with the text.
  if not coalesce((private.wa_setting('enabled', 'false'))::boolean, false) or v_t.wa_mode = 'manual' then
    if v_text is null or length(v_text) > 4096 then
      perform private.fail('invalid_input', 'text');
    end if;
    insert into public.wa_messages (id, patient_id, lead_id, phone_e164, direction, kind, purpose, body, status, status_rank,
                                    sent_by, appointment_id)
    values (p_client_id, v_a.patient_id, v_lead, v_t.phone_e164, 'outbound', 'manual', 'appointment_reminder', v_text,
            'manual', 1, private.my_staff_id(), v_a.id)
    returning * into v_row;
    return to_jsonb(v_row) || jsonb_build_object('repeat', false, 'manual', true);
  end if;

  -- The first reminder takes the automatic one's place; a second one by hand is just another message.
  v_key := case when exists (select 1 from public.wa_messages m where m.dedupe_key = 'reminder:' || v_a.id)
                then null else 'reminder:' || v_a.id end;
  if private.wa_templates_on() then
    v_row := private.wa_enqueue(jsonb_build_object(
      'id', p_client_id, 'patient_id', v_a.patient_id, 'lead_id', v_lead, 'appointment_id', v_a.id,
      'purpose', 'appointment_reminder', 'auto', false, 'dedupe_key', v_key));
  end if;
  if v_row.id is null then
    -- No template to use: free text inside the 24 hours after they last wrote to us.
    v_window := exists (select 1 from public.wa_contacts c where c.phone_e164 = v_t.phone_e164
                        and c.last_inbound_at >= now() - interval '24 hours');
    if not v_window or v_text is null or length(v_text) > 4096 then
      perform private.fail(case when private.wa_templates_on() then 'no_reminder_template' else 'templates_off' end);
    end if;
    v_row := private.wa_enqueue(jsonb_build_object(
      'id', p_client_id, 'patient_id', v_a.patient_id, 'lead_id', v_lead, 'appointment_id', v_a.id,
      'purpose', 'appointment_reminder', 'auto', false, 'text', v_text, 'dedupe_key', v_key));
  end if;
  if v_lead is not null then
    perform private.lead_log(v_lead, 'whatsapp', v_row.body, jsonb_build_object('message_id', v_row.id));
    update public.leads set last_activity_at = now() where id = v_lead;
  end if;
  return to_jsonb(v_row) || jsonb_build_object('repeat', false, 'manual', false);
end;
$$;

select private.lock_down_public_functions();
