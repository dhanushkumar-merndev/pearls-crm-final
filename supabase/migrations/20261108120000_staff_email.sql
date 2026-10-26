-- Admin → Users → Edit can set or clear a person's contact email (daily summary and alert
-- emails go there). Logins never use it.
create or replace function public.admin_update_staff(
  p_staff_id uuid,
  p_patch jsonb,
  p_reason text default null
)
returns public.staff
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.require_staff(array['admin']::public.staff_role[]);
  v_row public.staff;
  v_active boolean;
begin
  if p_staff_id = v_admin and (p_patch ? 'active' or p_patch ? 'role') then
    perform private.fail('not_allowed', 'admins cannot change their own role or deactivate themselves');
  end if;
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  v_active := coalesce((p_patch ->> 'active')::boolean, (select active from public.staff where id = p_staff_id));

  update public.staff s set
    role = coalesce((p_patch ->> 'role')::public.staff_role, s.role),
    full_name = coalesce(nullif(btrim(p_patch ->> 'full_name'), ''), s.full_name),
    phone_e164 = case when p_patch ? 'phone_e164' then nullif(btrim(p_patch ->> 'phone_e164'), '') else s.phone_e164 end,
    email = case when p_patch ? 'email' then nullif(lower(btrim(p_patch ->> 'email')), '') else s.email end,
    bdm_start_anywhere = coalesce((p_patch ->> 'bdm_start_anywhere')::boolean, s.bdm_start_anywhere),
    recording_upload_override = case when p_patch ? 'recording_upload_override'
                                     then nullif(p_patch ->> 'recording_upload_override', '') else s.recording_upload_override end,
    office_id = case when p_patch ? 'office_id' then nullif(p_patch ->> 'office_id', '')::uuid else s.office_id end,
    active = v_active,
    deactivated_at = case when v_active then null else coalesce(s.deactivated_at, now()) end
  where s.id = p_staff_id
  returning * into v_row;

  if not found then
    perform private.fail('not_found');
  end if;
  return v_row;
end;
$$;

select private.lock_down_public_functions();
