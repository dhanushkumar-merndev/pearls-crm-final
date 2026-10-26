-- Phase 15: hardening (PLAN.md E3 row 15).
-- Every function we own gets a fixed search_path (Supabase advisor "function_search_path_mutable").
-- These helpers are called from security-definer RPCs that already run with search_path = '',
-- so an empty path changes nothing for them and closes the door on lookups through a caller's path.
-- The range-type constructors (private.timerange / timemultirange) belong to supabase_admin and
-- are left alone (see scripts/advisors.ts ACCEPTED).
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prokind = 'f'
      and pg_get_userbyid(p.proowner) = current_user
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = %L', r.fn, '');
  end loop;
end $$;

-- Foreign keys on tables that grow, or that merges and joins follow (Supabase advisor
-- "unindexed_foreign_keys"). The rest point at staff rows (never deleted) or small master lists.
create index if not exists bill_items_pharmacy_item_id_fk_idx on public.bill_items (pharmacy_item_id);
create index if not exists bill_items_service_id_fk_idx on public.bill_items (service_id);
create index if not exists bill_items_doctor_id_fk_idx on public.bill_items (doctor_id);
create index if not exists bill_items_carried_from_item_id_fk_idx on public.bill_items (carried_from_item_id);
create index if not exists bills_doctor_id_fk_idx on public.bills (doctor_id);
create index if not exists bills_consolidated_into_id_fk_idx on public.bills (consolidated_into_id);
create index if not exists bills_visit_id_fk_idx on public.bills (visit_id);
create index if not exists payments_treatment_id_fk_idx on public.payments (treatment_id);
create index if not exists payments_admission_id_fk_idx on public.payments (admission_id);
create index if not exists payments_mode_id_fk_idx on public.payments (mode_id);
create index if not exists leads_source_id_fk_idx on public.leads (source_id);
create index if not exists leads_lost_reason_id_fk_idx on public.leads (lost_reason_id);
create index if not exists leads_doctor_id_fk_idx on public.leads (doctor_id);
create index if not exists leads_treatment_template_id_fk_idx on public.leads (treatment_template_id);
create index if not exists appointments_rescheduled_from_id_fk_idx on public.appointments (rescheduled_from_id);
create index if not exists appointments_treatment_id_fk_idx on public.appointments (treatment_id);
create index if not exists appointments_session_id_fk_idx on public.appointments (session_id);
create index if not exists appointments_source_id_fk_idx on public.appointments (source_id);
create index if not exists documents_visit_id_fk_idx on public.documents (visit_id);
create index if not exists documents_session_id_fk_idx on public.documents (session_id);
create index if not exists documents_kind_id_fk_idx on public.documents (kind_id);
create index if not exists recordings_file_id_fk_idx on public.recordings (file_id);
create index if not exists recordings_patient_id_fk_idx on public.recordings (patient_id);
create index if not exists recordings_site_visit_id_fk_idx on public.recordings (site_visit_id);
create index if not exists site_visits_lead_id_fk_idx on public.site_visits (lead_id);
create index if not exists site_visits_staff_id_fk_idx on public.site_visits (staff_id);
create index if not exists site_visits_recording_id_fk_idx on public.site_visits (recording_id);
create index if not exists trips_staff_id_fk_idx on public.trips (staff_id);
create index if not exists trips_site_visit_id_fk_idx on public.trips (site_visit_id);
create index if not exists wa_messages_appointment_id_fk_idx on public.wa_messages (appointment_id);
create index if not exists wa_messages_template_id_fk_idx on public.wa_messages (template_id);
create index if not exists wa_messages_drip_send_id_fk_idx on public.wa_messages (drip_send_id);
create index if not exists wa_threads_patient_id_fk_idx on public.wa_threads (patient_id);
create index if not exists treatment_sessions_doctor_id_fk_idx on public.treatment_sessions (doctor_id);
create index if not exists stock_alerts_batch_id_fk_idx on public.stock_alerts (batch_id);
create index if not exists purchase_items_batch_id_fk_idx on public.purchase_items (batch_id);
create index if not exists files_lead_id_fk_idx on public.files (lead_id);
create index if not exists files_thumbnail_file_id_fk_idx on public.files (thumbnail_file_id);
create index if not exists files_backup_item_id_fk_idx on public.files (backup_item_id);
create index if not exists patients_lead_id_fk_idx on public.patients (lead_id);
create index if not exists patients_merged_into_id_fk_idx on public.patients (merged_into_id);
create index if not exists patients_heard_from_id_fk_idx on public.patients (heard_from_id);
create index if not exists call_logs_recording_id_fk_idx on public.call_logs (recording_id);
create index if not exists meta_lead_events_lead_id_fk_idx on public.meta_lead_events (lead_id);
create index if not exists registration_requests_patient_id_fk_idx on public.registration_requests (patient_id);
create index if not exists drip_sends_message_id_fk_idx on public.drip_sends (message_id);
create index if not exists drip_sends_step_id_fk_idx on public.drip_sends (step_id);
create index if not exists lead_activities_staff_id_fk_idx on public.lead_activities (staff_id);
create index if not exists lead_assignments_to_staff_fk_idx on public.lead_assignments (to_staff);
create index if not exists admissions_treatment_id_fk_idx on public.admissions (treatment_id);
create index if not exists admissions_room_type_id_fk_idx on public.admissions (room_type_id);
create index if not exists patient_treatments_doctor_id_fk_idx on public.patient_treatments (doctor_id);
create index if not exists discharge_summaries_followup_id_fk_idx on public.discharge_summaries (followup_id);
create index if not exists discharge_summaries_template_id_fk_idx on public.discharge_summaries (template_id);
create index if not exists bdm_events_site_visit_id_fk_idx on public.bdm_events (site_visit_id);
create index if not exists bdm_events_staff_id_fk_idx on public.bdm_events (staff_id);
create index if not exists bdm_breaks_staff_id_fk_idx on public.bdm_breaks (staff_id);
create index if not exists item_batches_supplier_id_fk_idx on public.item_batches (supplier_id);
create index if not exists location_chunks_staff_id_fk_idx on public.location_chunks (staff_id);

-- RLS fuzzing (22_rls_fuzz) found two reads wider than needed:
--  * offices were readable by any signed-in account, even one with no staff row or a
--    deactivated one: now active staff only.
--  * wa_contacts (every number that has written to the clinic, with opt-out flags) was readable
--    by reception and sales; no screen reads it directly (the RPCs do), so: admin only.
drop policy offices_select on public.offices;
create policy offices_select on public.offices for select to authenticated using ((select private.my_role()) is not null);
drop policy wa_contacts_select on public.wa_contacts;
create policy wa_contacts_select on public.wa_contacts for select to authenticated using ((select private.my_role()) = 'admin');

select private.lock_down_public_functions();
