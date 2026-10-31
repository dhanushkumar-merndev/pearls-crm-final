-- Ads page (owner 31/10/2026: "see all totals at once", then "24 months"): the Ads functions
-- take up to 24 months instead of the one year the sales tables allow. Same functions as in 20261112100000_phase16_ads.sql except the check.
-- Ad tables are small (one row per campaign per day), so long ranges stay fast.
create function private.check_ads_range(p_from date, p_to date)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then
    perform private.fail('invalid_input', 'date range (max 24 months)');
  end if;
end;
$$;

create or replace function public.ads_overview(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['sales_manager', 'admin']::public.staff_role[]);
  perform private.check_ads_range(p_from, p_to);
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
create or replace function public.ads_campaign(p_campaign_id text, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['sales_manager', 'admin']::public.staff_role[]);
  perform private.check_ads_range(p_from, p_to);
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

select private.lock_down_public_functions();
