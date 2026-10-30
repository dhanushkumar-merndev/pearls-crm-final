-- Phase 16: Ads (owner 30/10/2026: "where is the ads performance page, all campaigns running, sync the
-- campaign leads"; layout after the owner's other CRM: campaign table, a side panel per campaign).
-- The meta-ads Edge Function copies the Meta ad account here (campaigns, ads, daily spend and results);
-- the page shows it beside what the clinic did with each campaign's leads: contacted, booked, became a
-- patient, money collected. Past leads from the lead forms come in through meta-leads {action: "import"}
-- quietly: no WhatsApp welcome, no drip campaign, no alert per lead (one summary alert per owner).

alter table public.integration_status drop constraint integration_status_integration_check;
alter table public.integration_status add constraint integration_status_integration_check
  check (integration in ('whatsapp', 'meta_leads', 'meta_ads', 'brevo', 'ors', 'fcm', 'tigris'));

------------------------------------------------------------------------------
-- Tables (Meta ids are numbers kept as text; money in paise)
------------------------------------------------------------------------------
create table public.ad_account (
  id text primary key check (id ~ '^[0-9]{1,30}$'),
  name text check (length(name) <= 200),
  currency text check (length(currency) <= 8),
  timezone text check (length(timezone) <= 60),
  synced_through date,                 -- last day fetched (re-read from 3 days before on each run)
  backfilled_from date,                -- oldest day fetched so far (older history filled 30 days a run)
  last_synced_at timestamptz,
  last_error text check (length(last_error) <= 1000),
  sync_requested_at timestamptz,       -- the last "Sync now" (one a minute)
  created_at timestamptz not null default now()
);

create table public.ad_campaigns (
  id text primary key check (id ~ '^[0-9]{1,30}$'),
  account_id text not null references public.ad_account (id) on delete cascade,
  name text not null check (length(name) <= 400),
  objective text check (length(objective) <= 60),
  status text check (length(status) <= 40),
  effective_status text check (length(effective_status) <= 40),
  daily_budget_paise bigint check (daily_budget_paise >= 0),
  lifetime_budget_paise bigint check (lifetime_budget_paise >= 0),
  created_time timestamptz,
  start_time timestamptz,
  stop_time timestamptz,
  synced_at timestamptz not null default now()
);
create index ad_campaigns_account on public.ad_campaigns (account_id);
create index ad_campaigns_name on public.ad_campaigns (name);

create table public.ad_ads (
  id text primary key check (id ~ '^[0-9]{1,30}$'),
  campaign_id text not null references public.ad_campaigns (id) on delete cascade,
  adset_name text check (length(adset_name) <= 400),
  name text not null check (length(name) <= 400),
  status text check (length(status) <= 40),
  effective_status text check (length(effective_status) <= 40),
  created_time timestamptz,
  updated_time timestamptz,
  thumbnail_url text check (length(thumbnail_url) <= 2000),   -- Meta's signed link (expires; page shows a placeholder)
  preview_url text check (length(preview_url) <= 2000),
  synced_at timestamptz not null default now()
);
create index ad_ads_campaign on public.ad_ads (campaign_id);

-- One row per campaign per day (ad_id '') and per ad per day.
create table public.ad_daily (
  campaign_id text not null references public.ad_campaigns (id) on delete cascade,
  ad_id text not null default '' check (ad_id = '' or ad_id ~ '^[0-9]{1,30}$'),
  day date not null,
  spend_paise bigint not null default 0 check (spend_paise >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  reach bigint not null default 0 check (reach >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  link_clicks bigint not null default 0 check (link_clicks >= 0),
  meta_leads integer not null default 0 check (meta_leads >= 0),
  primary key (campaign_id, ad_id, day)
);
create index ad_daily_day on public.ad_daily (day) where ad_id = '';
create index ad_daily_ad on public.ad_daily (ad_id, day) where ad_id <> '';

alter table public.ad_account enable row level security;
alter table public.ad_campaigns enable row level security;
alter table public.ad_ads enable row level security;
alter table public.ad_daily enable row level security;
-- Read: sales managers and admins (the page). Writes only through the service functions below.
create policy ad_account_select on public.ad_account for select to authenticated
  using ((select private.my_role()) in ('sales_manager', 'admin'));
create policy ad_campaigns_select on public.ad_campaigns for select to authenticated
  using ((select private.my_role()) in ('sales_manager', 'admin'));
create policy ad_ads_select on public.ad_ads for select to authenticated
  using ((select private.my_role()) in ('sales_manager', 'admin'));
create policy ad_daily_select on public.ad_daily for select to authenticated
  using ((select private.my_role()) in ('sales_manager', 'admin'));

------------------------------------------------------------------------------
-- Which campaign a lead came from: Meta's campaign id, else its ad's campaign, else the name.
------------------------------------------------------------------------------
create function private.lead_ad_campaign(p_detail jsonb)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select c.id from public.ad_campaigns c where c.id = p_detail ->> 'campaign_id'),
    (select a.campaign_id from public.ad_ads a where a.id = p_detail ->> 'ad_id'),
    (select c.id from public.ad_campaigns c where c.name = p_detail ->> 'campaign' order by c.created_time desc nulls last limit 1));
$$;

------------------------------------------------------------------------------
-- The sync (service role only)
------------------------------------------------------------------------------
-- The ad account to sync: {id, synced_through, backfilled_from}, or null before the first run.
create function public.ads_account_get()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(a) from public.ad_account a order by a.created_at limit 1;
$$;

-- p_account {id, name, currency, timezone}; p_campaigns [{id, name, objective, status, effective_status,
-- daily_budget_paise, lifetime_budget_paise, created_time, start_time, stop_time}];
-- p_ads [{id, campaign_id, adset_name, name, status, effective_status, created_time, updated_time, thumbnail_url, preview_url}].
create function public.ads_save_entities(p_account jsonb, p_campaigns jsonb, p_ads jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text := p_account ->> 'id';
  v_c integer;
  v_a integer;
begin
  insert into public.ad_account (id, name, currency, timezone)
  values (v_id, left(p_account ->> 'name', 200), left(p_account ->> 'currency', 8), left(p_account ->> 'timezone', 60))
  on conflict (id) do update set name = excluded.name, currency = excluded.currency, timezone = excluded.timezone;

  insert into public.ad_campaigns (id, account_id, name, objective, status, effective_status, daily_budget_paise,
                                   lifetime_budget_paise, created_time, start_time, stop_time, synced_at)
  select c.id, v_id, left(c.name, 400), left(c.objective, 60), left(c.status, 40), left(c.effective_status, 40),
         c.daily_budget_paise, c.lifetime_budget_paise, c.created_time, c.start_time, c.stop_time, now()
  from jsonb_to_recordset(coalesce(p_campaigns, '[]')) as c (id text, name text, objective text, status text, effective_status text,
       daily_budget_paise bigint, lifetime_budget_paise bigint, created_time timestamptz, start_time timestamptz, stop_time timestamptz)
  on conflict (id) do update set name = excluded.name, objective = excluded.objective, status = excluded.status,
    effective_status = excluded.effective_status, daily_budget_paise = excluded.daily_budget_paise,
    lifetime_budget_paise = excluded.lifetime_budget_paise, created_time = excluded.created_time,
    start_time = excluded.start_time, stop_time = excluded.stop_time, synced_at = now();
  get diagnostics v_c = row_count;

  -- An ad whose campaign Meta didn't list (deleted) is skipped.
  insert into public.ad_ads (id, campaign_id, adset_name, name, status, effective_status, created_time, updated_time,
                             thumbnail_url, preview_url, synced_at)
  select a.id, a.campaign_id, left(a.adset_name, 400), left(a.name, 400), left(a.status, 40), left(a.effective_status, 40),
         a.created_time, a.updated_time, left(a.thumbnail_url, 2000), left(a.preview_url, 2000), now()
  from jsonb_to_recordset(coalesce(p_ads, '[]')) as a (id text, campaign_id text, adset_name text, name text, status text,
       effective_status text, created_time timestamptz, updated_time timestamptz, thumbnail_url text, preview_url text)
  where exists (select 1 from public.ad_campaigns c where c.id = a.campaign_id)
  on conflict (id) do update set campaign_id = excluded.campaign_id, adset_name = excluded.adset_name, name = excluded.name,
    status = excluded.status, effective_status = excluded.effective_status, created_time = excluded.created_time,
    updated_time = excluded.updated_time, thumbnail_url = excluded.thumbnail_url, preview_url = excluded.preview_url,
    synced_at = now();
  get diagnostics v_a = row_count;
  return jsonb_build_object('campaigns', v_c, 'ads', v_a);
exception
  when check_violation or invalid_text_representation or datetime_field_overflow then
    perform private.fail('invalid_input', sqlerrm);
end;
$$;

-- p_rows [{campaign_id, ad_id ('' = whole campaign), day, spend_paise, impressions, reach, clicks, link_clicks, meta_leads}]:
-- each row replaces that day (Meta revises recent days).
create function public.ads_save_daily(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into public.ad_daily (campaign_id, ad_id, day, spend_paise, impressions, reach, clicks, link_clicks, meta_leads)
  select r.campaign_id, coalesce(r.ad_id, ''), r.day, coalesce(r.spend_paise, 0), coalesce(r.impressions, 0), coalesce(r.reach, 0),
         coalesce(r.clicks, 0), coalesce(r.link_clicks, 0), coalesce(r.meta_leads, 0)
  from jsonb_to_recordset(coalesce(p_rows, '[]')) as r (campaign_id text, ad_id text, day date, spend_paise bigint, impressions bigint,
       reach bigint, clicks bigint, link_clicks bigint, meta_leads integer)
  where exists (select 1 from public.ad_campaigns c where c.id = r.campaign_id)
    and (coalesce(r.ad_id, '') = '' or exists (select 1 from public.ad_ads a where a.id = r.ad_id))
  on conflict (campaign_id, ad_id, day) do update set spend_paise = excluded.spend_paise, impressions = excluded.impressions,
    reach = excluded.reach, clicks = excluded.clicks, link_clicks = excluded.link_clicks, meta_leads = excluded.meta_leads;
  get diagnostics v_n = row_count;
  return v_n;
exception
  when check_violation or invalid_text_representation or datetime_field_overflow then
    perform private.fail('invalid_input', sqlerrm);
end;
$$;

-- End of a run: where the sync got to, or the error (also shown under Connections on the admin dashboard).
create function public.ads_sync_done(p_account text, p_error text default null, p_synced_through date default null,
                                     p_backfilled_from date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ad_account set
    last_error = left(p_error, 1000),
    last_synced_at = case when p_error is null then now() else last_synced_at end,
    synced_through = coalesce(p_synced_through, synced_through),
    backfilled_from = least(coalesce(p_backfilled_from, backfilled_from), coalesce(backfilled_from, p_backfilled_from))
  where id = p_account;
  insert into public.integration_status (integration, state, last_ok_at, last_error, checked_at)
  values ('meta_ads', case when p_error is null then 'ok' else 'error' end, case when p_error is null then now() end,
          left(p_error, 1000), now())
  on conflict (integration) do update set
    state = excluded.state,
    last_ok_at = coalesce(excluded.last_ok_at, public.integration_status.last_ok_at),
    last_error = excluded.last_error,
    checked_at = now();
end;
$$;

-- "Sync now" from the page: sales managers and admins, at most once a minute.
create function public.ads_sync_request()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  perform private.require_staff(array['sales_manager', 'admin']::public.staff_role[]);
  if not exists (select 1 from public.ad_account) then
    return true;   -- the first sync finds the account
  end if;
  update public.ad_account set sync_requested_at = now()
  where sync_requested_at is null or sync_requested_at < now() - interval '1 minute';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

------------------------------------------------------------------------------
-- The page
------------------------------------------------------------------------------
-- Leads that came from an ad (lead date in the range) with their campaign, one row each.
create function private.ad_leads(p_from date, p_to date)
returns table (lead_id uuid, campaign_id text, ad_id text, stage public.lead_stage, booked boolean, converted boolean,
               patient_id uuid, created_at timestamptz, lead_date date)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, private.lead_ad_campaign(l.source_detail), l.source_detail ->> 'ad_id', l.stage,
         private.stage_rank(l.stage) >= 3 or exists (select 1 from public.appointments a where a.lead_id = l.id),
         l.converted_at is not null, l.patient_id, l.created_at, l.lead_date
  from public.leads l
  where l.deleted_at is null and l.lead_date between p_from and p_to
    and (l.source_detail ? 'campaign' or l.source_detail ? 'campaign_id' or l.source_detail ? 'ad_id');
$$;

-- Money collected from the patients these leads became (payments since the lead came in, refunds
-- taken off), counted once per patient, per campaign.
create function private.ad_collected(p_from date, p_to date)
returns table (campaign_id text, collected_paise bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with p as (
    select distinct on (x.patient_id) x.patient_id, x.campaign_id, x.created_at
    from private.ad_leads(p_from, p_to) x
    where x.patient_id is not null and x.campaign_id is not null
    order by x.patient_id, x.created_at
  )
  select p.campaign_id, coalesce(sum(case when y.kind = 'refund' then -y.amount_paise else y.amount_paise end), 0)::bigint
  from p join public.payments y on y.patient_id = p.patient_id and y.cancelled_at is null and y.received_at >= p.created_at
  group by p.campaign_id;
$$;

-- Everything the Ads page shows for a date range in one call.
create function public.ads_overview(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['sales_manager', 'admin']::public.staff_role[]);
  perform private.check_range(p_from, p_to);
  return (
    with spend as (
      select d.campaign_id, sum(d.spend_paise)::bigint as spend, sum(d.impressions)::bigint as impressions,
             sum(d.reach)::bigint as reach, sum(d.clicks)::bigint as clicks, sum(d.link_clicks)::bigint as link_clicks,
             sum(d.meta_leads)::bigint as meta_leads
      from public.ad_daily d
      where d.ad_id = '' and d.day between p_from and p_to
      group by d.campaign_id
    ), leads as materialized (
      select * from private.ad_leads(p_from, p_to)
    ), crm as (
      select l.campaign_id, count(*) as crm_leads, count(*) filter (where l.stage <> 'new') as contacted,
             count(*) filter (where l.booked) as booked, count(*) filter (where l.converted) as converted
      from leads l where l.campaign_id is not null group by l.campaign_id
    ), money as (
      select * from private.ad_collected(p_from, p_to)
    ), camp as (
      select c.id, c.name, c.objective, c.effective_status, c.daily_budget_paise, c.lifetime_budget_paise, c.created_time,
             coalesce(s.spend, 0) as spend, coalesce(s.impressions, 0) as impressions, coalesce(s.reach, 0) as reach,
             coalesce(s.clicks, 0) as clicks, coalesce(s.link_clicks, 0) as link_clicks, coalesce(s.meta_leads, 0) as meta_leads,
             coalesce(r.crm_leads, 0) as crm_leads, coalesce(r.contacted, 0) as contacted, coalesce(r.booked, 0) as booked,
             coalesce(r.converted, 0) as converted, coalesce(m.collected_paise, 0) as collected
      from public.ad_campaigns c
      left join spend s on s.campaign_id = c.id
      left join crm r on r.campaign_id = c.id
      left join money m on m.campaign_id = c.id
      where s.campaign_id is not null or r.campaign_id is not null or c.effective_status = 'ACTIVE'
    )
    select jsonb_build_object(
      'from', p_from, 'to', p_to,
      'account', (select jsonb_build_object('id', a.id, 'name', a.name, 'currency', a.currency, 'last_synced_at', a.last_synced_at,
                                            'last_error', a.last_error, 'synced_through', a.synced_through,
                                            'backfilled_from', a.backfilled_from)
                  from public.ad_account a order by a.created_at limit 1),
      'totals', (select jsonb_build_object(
          'spend', coalesce(sum(r.spend), 0), 'impressions', coalesce(sum(r.impressions), 0), 'reach', coalesce(sum(r.reach), 0),
          'clicks', coalesce(sum(r.clicks), 0), 'link_clicks', coalesce(sum(r.link_clicks), 0),
          'meta_leads', coalesce(sum(r.meta_leads), 0), 'crm_leads', coalesce(sum(r.crm_leads), 0),
          'contacted', coalesce(sum(r.contacted), 0), 'booked', coalesce(sum(r.booked), 0),
          'converted', coalesce(sum(r.converted), 0), 'collected', coalesce(sum(r.collected), 0),
          'campaigns', count(*), 'active', count(*) filter (where r.effective_status = 'ACTIVE'),
          'unlinked', (select count(*) from leads l where l.campaign_id is null))
        from camp r),
      'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', g.day::date, 'spend', coalesce(s.spend, 0),
                                                             'meta_leads', coalesce(s.meta_leads, 0), 'crm_leads', coalesce(l.n, 0))
                                          order by g.day), '[]'::jsonb)
                from generate_series(p_from, p_to, interval '1 day') as g (day)
                left join (select d.day, sum(d.spend_paise)::bigint as spend, sum(d.meta_leads)::bigint as meta_leads
                           from public.ad_daily d where d.ad_id = '' and d.day between p_from and p_to group by d.day) s
                  on s.day = g.day::date
                left join (select x.lead_date, count(*) as n from leads x where x.campaign_id is not null group by x.lead_date) l
                  on l.lead_date = g.day::date),
      'campaigns', (select coalesce(jsonb_agg(to_jsonb(r) order by r.spend desc, r.crm_leads desc, r.name), '[]'::jsonb)
                    from (select * from camp order by spend desc, crm_leads desc, name limit 200) r))
  );
end;
$$;

-- One campaign for the side panel: its days, its ads and its latest leads in the range.
create function public.ads_campaign(p_campaign_id text, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['sales_manager', 'admin']::public.staff_role[]);
  perform private.check_range(p_from, p_to);
  if not exists (select 1 from public.ad_campaigns where id = p_campaign_id) then
    perform private.fail('not_found', 'campaign');
  end if;
  return (
    with leads as materialized (
      select * from private.ad_leads(p_from, p_to) x where x.campaign_id = p_campaign_id
    )
    select jsonb_build_object(
      'campaign', (select to_jsonb(c) - 'account_id' - 'synced_at' from public.ad_campaigns c where c.id = p_campaign_id),
      'collected', coalesce((select m.collected_paise from private.ad_collected(p_from, p_to) m where m.campaign_id = p_campaign_id), 0),
      'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', g.day::date, 'spend', coalesce(d.spend_paise, 0),
                                                             'meta_leads', coalesce(d.meta_leads, 0), 'crm_leads', coalesce(l.n, 0))
                                          order by g.day), '[]'::jsonb)
                from generate_series(p_from, p_to, interval '1 day') as g (day)
                left join public.ad_daily d on d.campaign_id = p_campaign_id and d.ad_id = '' and d.day = g.day::date
                left join (select x.lead_date, count(*) as n from leads x group by x.lead_date) l on l.lead_date = g.day::date),
      'ads', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', a.id, 'name', a.name, 'adset_name', a.adset_name, 'effective_status', a.effective_status,
                  'created_time', a.created_time, 'thumbnail_url', a.thumbnail_url, 'preview_url', a.preview_url,
                  'spend', coalesce(s.spend, 0), 'impressions', coalesce(s.impressions, 0), 'clicks', coalesce(s.clicks, 0),
                  'meta_leads', coalesce(s.meta_leads, 0), 'crm_leads', coalesce(l.n, 0), 'converted', coalesce(l.converted, 0))
                order by coalesce(s.spend, 0) desc, a.created_time desc nulls last), '[]'::jsonb)
              from public.ad_ads a
              left join (select d.ad_id, sum(d.spend_paise)::bigint as spend, sum(d.impressions)::bigint as impressions,
                                sum(d.clicks)::bigint as clicks, sum(d.meta_leads)::bigint as meta_leads
                         from public.ad_daily d where d.campaign_id = p_campaign_id and d.ad_id <> '' and d.day between p_from and p_to
                         group by d.ad_id) s on s.ad_id = a.id
              left join (select x.ad_id, count(*) as n, count(*) filter (where x.converted) as converted
                         from leads x group by x.ad_id) l on l.ad_id = a.id
              where a.campaign_id = p_campaign_id),
      'leads', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', l.id, 'sl_no', l.sl_no, 'name', l.name, 'stage', l.stage, 'lead_date', l.lead_date,
                    'owner', s.full_name, 'ad', l.source_detail ->> 'ad')
                  order by l.lead_date desc, l.created_at desc), '[]'::jsonb)
                from (select l.* from public.leads l join leads x on x.lead_id = l.id
                      order by l.lead_date desc, l.created_at desc limit 50) l
                left join public.staff s on s.id = l.assigned_to),
      'lead_count', (select count(*) from leads))
  );
end;
$$;

------------------------------------------------------------------------------
-- Past leads from the lead forms, quietly
------------------------------------------------------------------------------
-- While an import runs (this transaction only): no "New lead" alert per lead.
create or replace function private.notify_staff(p_staff uuid, p_type text, p_title text, p_body text, p_link text, p_dedupe text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_id, type, title, body, link, dedupe_key)
  select p_staff, p_type, p_title, p_body, p_link, p_dedupe
  where p_staff is not null and p_staff is distinct from private.my_staff_id()
    and not (coalesce(current_setting('pearl.lead_import', true), '') = 'on' and p_type in ('lead_assigned', 'lead_enquired_again'))
  on conflict (dedupe_key) do nothing;
$$;

-- As in 20261111100000_wa_bot.sql, and nothing for an imported old lead (no welcome, no drip).
create or replace function private.wa_on_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('pearl.lead_import', true), '') = 'on' then
    return null;
  end if;
  if new.created_via is distinct from 'whatsapp' then
    perform private.wa_enqueue(jsonb_build_object('lead_id', new.id, 'purpose', 'lead_welcome', 'auto', true,
                                                  'dedupe_key', 'welcome:' || new.id));
  end if;
  perform private.drip_auto_enroll('lead_created', null, new.id, now());
  return null;
end;
$$;

-- One old lead from a lead form (after meta_lead_received). Any lead with the same number, open or
-- closed, means the person is already in the CRM: nothing new is made. Otherwise as meta_lead_create,
-- dated the day they filled the form, without alerts, welcome message or drips.
create function public.meta_lead_import(p_leadgen_id text, p_lead jsonb, p_raw jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.meta_lead_events;
  v_lead uuid;
begin
  select * into v_event from public.meta_lead_events where leadgen_id = p_leadgen_id for update;
  if not found then
    perform private.fail('not_found', 'leadgen');
  end if;
  if v_event.status in ('created', 'duplicate') then
    return jsonb_build_object('status', v_event.status, 'lead_id', v_event.lead_id, 'repeat', true);
  end if;
  if coalesce(p_lead ->> 'phone', '') ~ '^\+[1-9][0-9]{7,14}$' then
    select l.id into v_lead from public.leads l
    where l.deleted_at is null
      and (l.phone_last10 = right(p_lead ->> 'phone', 10) or l.alt_phone_last10 = right(p_lead ->> 'phone', 10))
    order by l.created_at desc limit 1;
    if v_lead is not null then
      update public.meta_lead_events set status = 'duplicate', lead_id = v_lead, error = null, payload = p_raw, processed_at = now()
      where id = v_event.id;
      return jsonb_build_object('status', 'duplicate', 'lead_id', v_lead);
    end if;
  end if;
  perform set_config('pearl.lead_import', 'on', true);
  return public.meta_lead_create(p_leadgen_id, p_lead, p_raw);
end;
$$;

-- After an import: one alert per owner ("12 leads from your ads were added to your list").
create function public.meta_lead_import_summary(p_lead_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select l.assigned_to, count(*) as n from public.leads l
    where l.id = any (p_lead_ids) and l.assigned_to is not null group by l.assigned_to
  loop
    perform private.notify_staff(r.assigned_to, 'lead_assigned',
                                 case when r.n = 1 then '1 lead from the ads was added to your list'
                                      else r.n || ' leads from the ads were added to your list' end, null,
                                 '/leads', 'lead_import:' || r.assigned_to || ':' || now()::text);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Leads import: sales managers and admins (the button on the Ads page), checked by meta-leads.
create function public.meta_lead_import_check()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.require_staff(array['sales_manager', 'admin']::public.staff_role[]) is not null;
$$;

------------------------------------------------------------------------------
-- Grants and the timer
------------------------------------------------------------------------------
revoke execute on function
  public.ads_account_get(), public.ads_save_entities(jsonb, jsonb, jsonb), public.ads_save_daily(jsonb),
  public.ads_sync_done(text, text, date, date), public.meta_lead_import(text, jsonb, jsonb),
  public.meta_lead_import_summary(uuid[])
  from public, anon, authenticated;
grant execute on function
  public.ads_account_get(), public.ads_save_entities(jsonb, jsonb, jsonb), public.ads_save_daily(jsonb),
  public.ads_sync_done(text, text, date, date), public.meta_lead_import(text, jsonb, jsonb),
  public.meta_lead_import_summary(uuid[])
  to service_role;
revoke execute on function public.ads_sync_request(), public.ads_overview(date, date), public.ads_campaign(text, date, date),
  public.meta_lead_import_check() from public, anon;
grant execute on function public.ads_sync_request(), public.ads_overview(date, date), public.ads_campaign(text, date, date),
  public.meta_lead_import_check() to authenticated;
revoke execute on function private.lead_ad_campaign(jsonb), private.ad_leads(date, date), private.ad_collected(date, date)
  from public, anon, authenticated;

-- Every 3 hours (Meta's numbers for the last 3 days are re-read each time).
select cron.schedule('meta-ads-sync', '15 */3 * * *', $$select private.call_edge('meta-ads', '{"source": "cron"}')$$);
