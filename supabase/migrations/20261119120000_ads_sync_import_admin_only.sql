-- Ads page (owner, 03/11/2026): only the admin may press "Sync now" or "Import past leads".
-- Sales managers still see the Ads page and its numbers (ads_overview / ads_campaign are unchanged).

create or replace function public.ads_sync_request()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  if not exists (select 1 from public.ad_account) then
    return true;   -- the first sync finds the account
  end if;
  update public.ad_account set sync_requested_at = now()
  where sync_requested_at is null or sync_requested_at < now() - interval '1 minute';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

create or replace function public.meta_lead_import_check()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.require_staff(array['admin']::public.staff_role[]) is not null;
$$;

select private.lock_down_public_functions();
grant execute on function public.ads_sync_request(), public.meta_lead_import_check() to authenticated;
