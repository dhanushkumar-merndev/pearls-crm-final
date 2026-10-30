-- Phase 16: Ads. The meta-ads sync saving campaigns, ads and days; the page's numbers per campaign
-- (spend beside CRM leads, bookings, patients, money collected); who may see them; and past leads
-- imported quietly (no alert per lead, no WhatsApp welcome, a number already in the CRM not added again).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(41);

create function pg_temp.login(p_id uuid)
returns void
language plpgsql
as $$
begin
  reset role;
  if p_id is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
end;
$$;
grant execute on function pg_temp.login(uuid) to authenticated;

insert into auth.users (id, email) values
  ('26262626-0000-4000-a000-0000000000b1', 'ads-rec@staff.invalid'),
  ('26262626-0000-4000-a000-0000000000c1', 'ads-sales@staff.invalid'),
  ('26262626-0000-4000-a000-0000000000c2', 'ads-manager@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('26262626-0000-4000-a000-0000000000b1', 'receptionist', 'Ads Rec', 'adsrec'),
  ('26262626-0000-4000-a000-0000000000c1', 'sales_executive', 'Ads Sales', 'adssales'),
  ('26262626-0000-4000-a000-0000000000c2', 'sales_manager', 'Ads Manager', 'adsmanager');

-- New leads go to the one salesperson in the pool; WhatsApp is on with a welcome template,
-- so an ordinary new lead would get an alert and a welcome message.
delete from public.lead_pool;
insert into public.app_settings (section, value) values ('sales', '{"round_robin": true}')
  on conflict (section) do update set value = public.app_settings.value || '{"round_robin": true}';
insert into public.lead_pool (staff_id, active, sort) values ('26262626-0000-4000-a000-0000000000c1', true, 1);
insert into public.app_settings (section, value) values ('whatsapp', '{"enabled": true}')
  on conflict (section) do update set value = public.app_settings.value || excluded.value;
update public.wa_templates set active = false where purpose = 'lead_welcome';
insert into public.wa_templates (id, name, language, category, status, body_text, param_count, purpose, variable_map) values
  ('26262626-1111-4000-a000-000000000001', 'ads_test_welcome', 'en', 'marketing', 'APPROVED', 'Welcome', 0, 'lead_welcome', '[]');

------------------------------------------------------------------------------
-- The sync (service role)
------------------------------------------------------------------------------
select pg_temp.login(null);
select is(public.ads_save_entities(
    '{"id": "2601", "name": "Test Ads", "currency": "INR", "timezone": "Asia/Kolkata"}',
    '[{"id": "26001", "name": "Nose Oct", "effective_status": "ACTIVE", "daily_budget_paise": 50000},
      {"id": "26002", "name": "Hair Nov", "effective_status": "PAUSED"}]',
    '[{"id": "26101", "campaign_id": "26001", "name": "Ad 1", "adset_name": "Set A"},
      {"id": "26102", "campaign_id": "26999", "name": "Orphan"}]'),
  '{"ads": 1, "campaigns": 2}'::jsonb, 'campaigns and ads are saved; an ad whose campaign is unknown is skipped');
select is(public.ads_save_daily(
    '[{"campaign_id": "26001", "ad_id": "", "day": "2030-05-01", "spend_paise": 100000, "impressions": 1000, "reach": 800,
       "clicks": 30, "link_clicks": 20, "meta_leads": 3},
      {"campaign_id": "26001", "ad_id": "", "day": "2030-05-02", "spend_paise": 50000, "impressions": 500, "meta_leads": 1},
      {"campaign_id": "26001", "ad_id": "26101", "day": "2030-05-01", "spend_paise": 100000, "meta_leads": 3},
      {"campaign_id": "26002", "ad_id": "", "day": "2030-05-01", "spend_paise": 20000},
      {"campaign_id": "26999", "ad_id": "", "day": "2030-05-01", "spend_paise": 1}]'),
  4, 'daily numbers are saved (a day of an unknown campaign is skipped)');
select is(public.ads_save_daily('[{"campaign_id": "26001", "ad_id": "", "day": "2030-05-02", "spend_paise": 60000, "meta_leads": 2}]'),
  1, 'a day read again replaces the old numbers (Meta revises recent days)');
select is((select spend_paise from public.ad_daily where campaign_id = '26001' and ad_id = '' and day = '2030-05-02'), 60000::bigint,
  '…and the new figure is kept');
select throws_ok($$ select public.ads_save_daily('[{"campaign_id": "26001", "day": "2030-05-03", "spend_paise": -5}]') $$,
  'P0001', 'invalid_input', 'negative money is refused');
select public.ads_sync_done('2601', null, '2030-05-02', '2030-04-01');
select ok((select last_synced_at is not null and synced_through = '2030-05-02' and last_error is null from public.ad_account where id = '2601'),
  'the end of a good run is recorded');
select is((select state from public.integration_status where integration = 'meta_ads'), 'ok', '…and shows as OK under Connections');
select public.ads_sync_done('2601', 'Meta is busy, will retry: (#17)');
select ok((select last_synced_at is not null and synced_through = '2030-05-02' and last_error like 'Meta is busy%'
           from public.ad_account where id = '2601'), 'a failed run keeps the last good sync and records the error');
select public.ads_sync_done('2601', null, '2030-05-02', '2030-04-20');
select is((select backfilled_from from public.ad_account where id = '2601'), '2030-04-01'::date, 'the oldest day fetched never moves forward');

------------------------------------------------------------------------------
-- Leads from the ads, and what became of them
------------------------------------------------------------------------------
insert into public.patients (id, uhid, full_name, phone_e164) values
  ('26262626-2222-4000-a000-000000000001', 'ADSTEST-1', 'Ads Patient', '+915000002603');
insert into public.leads (id, name, phone_e164, lead_date, stage, source_detail, patient_id, converted_at) values
  -- Meta's campaign id
  ('26262626-5555-4000-a000-000000000001', 'Ads One', '+915000002601', '2030-05-01', 'new', '{"campaign_id": "26001"}', null, null),
  -- only the ad id (the ad's campaign), booked
  ('26262626-5555-4000-a000-000000000002', 'Ads Two', '+915000002602', '2030-05-02', 'consultation_booked',
   '{"ad_id": "26101", "ad": "Ad 1"}', null, null),
  -- only the campaign name, became a patient
  ('26262626-5555-4000-a000-000000000003', 'Ads Three', '+915000002603', '2030-05-02', 'converted', '{"campaign": "Hair Nov"}',
   '26262626-2222-4000-a000-000000000001', now()),
  -- from an ad, but no campaign of this account
  ('26262626-5555-4000-a000-000000000004', 'Ads Four', '+915000002604', '2030-05-03', 'new', '{"campaign": "Someone else"}', null, null),
  -- not from an ad
  ('26262626-5555-4000-a000-000000000005', 'Ads Five', '+915000002605', '2030-05-03', 'new', '{}', null, null);
update public.leads set created_at = '2030-05-02T10:00:00+05:30' where id = '26262626-5555-4000-a000-000000000003';
insert into public.payments (patient_id, kind, mode_id, amount_paise, received_at) values
  ('26262626-2222-4000-a000-000000000001', 'payment', (select id from public.lookup_values where kind = 'payment_mode' and code = 'cash'),
   300000, '2030-05-10T10:00:00+05:30'),
  ('26262626-2222-4000-a000-000000000001', 'refund', (select id from public.lookup_values where kind = 'payment_mode' and code = 'cash'),
   50000, '2030-05-11T10:00:00+05:30'),
  -- before the lead came in: not the ad's doing
  ('26262626-2222-4000-a000-000000000001', 'payment', (select id from public.lookup_values where kind = 'payment_mode' and code = 'cash'),
   70000, '2030-04-01T10:00:00+05:30');

select pg_temp.login('26262626-0000-4000-a000-0000000000c2');
create temp table ov as select public.ads_overview('2030-05-01', '2030-05-31') as d;
select is((select d -> 'totals' ->> 'spend' from ov), '180000', 'spend for the period, all campaigns');
select is((select d -> 'totals' ->> 'meta_leads' from ov), '5', 'Meta''s lead count');
select is((select d -> 'totals' ->> 'crm_leads' from ov), '3', 'leads in the CRM matched by campaign id, ad id or campaign name');
select is((select d -> 'totals' ->> 'unlinked' from ov), '1', 'a lead from an ad of no known campaign is counted apart');
select is((select d -> 'totals' ->> 'booked' from ov), '2', 'booked = a consultation booked or further');
select is((select d -> 'totals' ->> 'converted' from ov), '1', 'patients');
select is((select d -> 'totals' ->> 'collected' from ov), '250000', 'money collected since the lead came in, refunds taken off');
select is((select jsonb_array_length(d -> 'daily') from ov), 31, 'one row per day of the period');
select is((select (c ->> 'crm_leads')::int from ov, jsonb_array_elements(d -> 'campaigns') c where c ->> 'id' = '26001'), 2,
  'per campaign: its own leads');
select is((select d -> 'campaigns' -> 0 ->> 'id' from ov), '26001', 'biggest spend first');

create temp table one as select public.ads_campaign('26001', '2030-05-01', '2030-05-31') as d;
select is((select d ->> 'lead_count' from one), '2', 'the side panel: the campaign''s leads');
select is((select (d -> 'ads' -> 0 ->> 'crm_leads')::int from one), 1, '…per ad, the leads that named the ad');
select is((select d -> 'campaign' ->> 'name' from one), 'Nose Oct', '…and the campaign itself');
select throws_ok($$ select public.ads_campaign('26777', '2030-05-01', '2030-05-31') $$, 'P0001', 'not_found', 'an unknown campaign');

------------------------------------------------------------------------------
-- Who may see it
------------------------------------------------------------------------------
select is(public.ads_sync_request(), true, 'a manager may press Sync now…');
select is(public.ads_sync_request(), false, '…but not twice in a minute');
select is((select count(*)::int from public.ad_campaigns), 2, 'a manager reads the campaigns');
select throws_ok($$ select public.ads_save_daily('[]') $$, '42501', null, 'staff cannot write ad numbers');
select pg_temp.login('26262626-0000-4000-a000-0000000000c1');
select is((select count(*)::int from public.ad_daily), 0, 'a salesperson sees no ad numbers');
select throws_ok($$ select public.ads_overview('2030-05-01', '2030-05-31') $$, 'P0001', 'not_allowed', 'nor the Ads page');
select pg_temp.login('26262626-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.meta_lead_import_check() $$, 'P0001', 'not_allowed', 'reception cannot import leads');

------------------------------------------------------------------------------
-- Past leads, quietly
------------------------------------------------------------------------------
select pg_temp.login(null);
-- An ordinary new lead from Meta: alert + welcome (what the import must not do).
select public.meta_lead_received('p16live', 'page', 'form', null, '2030-05-03T10:00:00Z');
select is(public.meta_lead_create('p16live', '{"name": "Ads Live", "phone": "+915000002606"}') ->> 'status', 'created', 'a live lead…');
select ok(exists (select 1 from public.wa_messages m join public.leads l on m.dedupe_key = 'welcome:' || l.id
                  where l.meta_leadgen_id = 'p16live'), '…gets the welcome message');

select public.meta_lead_received('p16old1', 'page', 'form', null, '2030-04-15T10:00:00Z');
create temp table imp as select public.meta_lead_import('p16old1',
  '{"name": "Ads Old", "phone": "+915000002607", "source_code": "facebook", "source_detail": {"campaign_id": "26001"}}') as r;
select is((select r ->> 'status' from imp), 'created', 'an old lead is added');
select is((select lead_date from public.leads where meta_leadgen_id = 'p16old1'), '2030-04-15'::date, '…dated the day the form was filled');
select is((select count(*)::int from public.notifications n join public.leads l on n.link = '/leads/' || l.id
           where l.meta_leadgen_id = 'p16old1'), 0, '…with no alert');
select is((select count(*)::int from public.wa_messages m join public.leads l on m.dedupe_key = 'welcome:' || l.id
           where l.meta_leadgen_id = 'p16old1'), 0, '…and no WhatsApp welcome');
select set_config('pearl.lead_import', '', true);

select public.meta_lead_received('p16old2');
select is(public.meta_lead_import('p16old2', '{"name": "Ads Three Again", "phone": "+915000002603"}') ->> 'lead_id',
  '26262626-5555-4000-a000-000000000003', 'a number already in the CRM (even a closed lead) is linked, not added again');
select is(public.meta_lead_import('p16old1', '{"name": "Ads Old", "phone": "+915000002607"}') ->> 'repeat', 'true',
  'the same form fill again changes nothing');
select set_config('pearl.lead_import', '', true);

select is(public.meta_lead_import_summary(array[(select r ->> 'lead_id' from imp)::uuid]), 1, 'one summary alert per owner');
select ok(exists (select 1 from public.notifications where recipient_id = '26262626-0000-4000-a000-0000000000c1'
                  and link = '/leads' and title = '1 lead from the ads was added to your list'), '…in the owner''s alerts');

select pg_temp.login('26262626-0000-4000-a000-0000000000c2');
select throws_ok($$ select public.meta_lead_import('p16old3', '{}') $$, '42501', null, 'staff cannot call the import directly');

select * from finish();
rollback;
