// meta-ads: copies the Meta ad account into the CRM (PLAN.md phase 16): campaigns, ads and their
// daily spend, reach, clicks and leads, for the Ads page.
//   Every 3 hours from the database timer (pg_cron → pg_net, header x-cron-secret): a full run that
//   also fills in older history, 30 days a run, up to a year back.
//   From the Ads page ("Sync now", login token of a sales manager or admin): the recent days only.
// The first run pulls 90 days; later runs re-read from 3 days before the last synced day (Meta
// revises recent days). Meta's throttling just waits for the next run.
// Pure logic here; index.ts wires the real Graph API and database.
import { z } from "zod";

export const syncSchema = z.object({ source: z.enum(["cron", "staff"]).optional() }).strict();

export const FIRST_DAYS = 90;
export const BACKFILL_DAYS = 365;
export const BACKFILL_STEP = 30;
export const REVISE_DAYS = 3;
/** Rows per database call. */
export const CHUNK = 1000;

/** Meta's throttling codes: try again on the next run rather than calling the connection broken. */
export const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80003, 80004, 80014]);

export class GraphError extends Error {
  constructor(message: string, readonly code: number | null) {
    super(message);
  }
}

export interface Deps {
  /** GET one Graph API page (path relative to the version, or a full `next` link). Throws GraphError. */
  graph: (pathOrUrl: string, params?: Record<string, string>) => Promise<Record<string, unknown>>;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  /** Today in the ad account's time zone (YYYY-MM-DD). */
  today: (timezone: string | null) => string;
}

async function must(p: Promise<{ data: unknown; error: { message: string } | null }>): Promise<unknown> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

/** Every page of a list (bounded, so a huge account can't run for ever). */
export async function allPages<T>(deps: Deps, path: string, params: Record<string, string>, maxPages = 40): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = path;
  let first = true;
  for (let page = 0; next && page < maxPages; page++) {
    const body = await deps.graph(next, first ? params : undefined);
    first = false;
    out.push(...((body.data as T[] | undefined) ?? []));
    next = (body.paging as { next?: string } | undefined)?.next ?? null;
  }
  return out;
}

/** "1234.5" (rupees, as Meta writes money) → 123450 paise, without floating-point maths. */
export function toPaise(v: string | number | null | undefined): number {
  const s = String(v ?? "").trim();
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) return 0;
  const frac = ((m[2] ?? "") + "00").slice(0, 2);
  const rest = (m[2] ?? "").slice(2);
  return Number(m[1]) * 100 + Number(frac) + (rest && rest[0] >= "5" ? 1 : 0);
}

// Currencies without minor units (Meta gives budgets in the smallest unit).
const ZERO_DECIMAL = new Set(["CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "PYG", "TWD", "VND"]);

/** A Meta budget ("150000" = ₹1,500.00, in minor units) → paise. */
export function budgetPaise(minor: string | number | null | undefined, currency: string | null): number | null {
  if (minor === null || minor === undefined || minor === "") return null;
  const n = Number(minor);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(currency && ZERO_DECIMAL.has(currency) ? n * 100 : n);
}

type Action = { action_type: string; value: string };
const LEAD_ACTIONS = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];

/** Leads from Meta's `actions`. The same leads appear under several types, so the first one wins. */
export function leadCount(actions: Action[] | undefined): number {
  for (const t of LEAD_ACTIONS) {
    const hit = actions?.find((a) => a.action_type === t);
    if (hit) return Math.max(0, Math.round(Number(hit.value) || 0));
  }
  return 0;
}

const count = (v: unknown) => Math.max(0, Math.round(Number(v ?? 0) || 0));

/** Adds days to a YYYY-MM-DD date (calendar arithmetic in UTC, no time-zone drift). */
export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** [since, until] in windows of at most `size` days, oldest first. */
export function dayWindows(since: string, until: string, size = 30): { since: string; until: string }[] {
  const out: { since: string; until: string }[] = [];
  for (let start = since; start <= until; start = shiftDay(start, size)) {
    const end = shiftDay(start, size - 1);
    out.push({ since: start, until: end < until ? end : until });
  }
  return out;
}

interface Account {
  id: string;
  synced_through: string | null;
  backfilled_from: string | null;
}

export interface Summary {
  ok: boolean;
  account?: string;
  campaigns?: number;
  ads?: number;
  days?: number;
  error?: string;
  rate_limited?: boolean;
}

/** The ad account to sync: the one already saved, else the first active one the key can see. */
async function pickAccount(deps: Deps): Promise<Account | null> {
  const saved = (await must(deps.rpc("ads_account_get", {}))) as Account | null;
  if (saved?.id) return saved;
  const list = await allPages<{ account_id: string; account_status?: number }>(deps, "me/adaccounts", {
    fields: "account_id,account_status",
    limit: "50",
  });
  const pick = list.find((a) => a.account_status === 1) ?? list[0];
  return pick ? { id: pick.account_id, synced_through: null, backfilled_from: null } : null;
}

/** One run: entities, daily insights (campaign and ad level), the run's end state. */
export async function sync(opts: { backfill: boolean }, deps: Deps): Promise<Summary> {
  let acct: Account | null = null;
  try {
    acct = await pickAccount(deps);
    if (!acct) return { ok: false, error: "no_ad_account" };
    const act = `act_${acct.id}`;
    const info = await deps.graph(act, { fields: "name,currency,timezone_name" });
    const currency = typeof info.currency === "string" ? info.currency : "INR";
    const timezone = typeof info.timezone_name === "string" ? info.timezone_name : "Asia/Kolkata";
    const today = deps.today(timezone);

    const campaigns = await allPages<Record<string, string | undefined>>(deps, `${act}/campaigns`, {
      fields: "id,name,objective,status,effective_status,daily_budget,lifetime_budget,created_time,start_time,stop_time",
      limit: "200",
    });
    const ads = await allPages<Record<string, unknown>>(deps, `${act}/ads`, {
      fields: "id,name,campaign_id,adset{name},status,effective_status,created_time,updated_time,creative{thumbnail_url},preview_shareable_link",
      limit: "200",
    });
    const saved = (await must(deps.rpc("ads_save_entities", {
      p_account: { id: acct.id, name: info.name ?? act, currency, timezone },
      p_campaigns: campaigns.map((c) => ({
        id: c.id, name: c.name ?? c.id, objective: c.objective ?? null, status: c.status ?? null,
        effective_status: c.effective_status ?? null, daily_budget_paise: budgetPaise(c.daily_budget, currency),
        lifetime_budget_paise: budgetPaise(c.lifetime_budget, currency), created_time: c.created_time ?? null,
        start_time: c.start_time ?? null, stop_time: c.stop_time ?? null,
      })),
      p_ads: ads.filter((a) => a.campaign_id).map((a) => ({
        id: a.id, campaign_id: a.campaign_id, adset_name: (a.adset as { name?: string } | undefined)?.name ?? null,
        name: a.name ?? a.id, status: a.status ?? null, effective_status: a.effective_status ?? null,
        created_time: a.created_time ?? null, updated_time: a.updated_time ?? null,
        thumbnail_url: (a.creative as { thumbnail_url?: string } | undefined)?.thumbnail_url ?? null,
        preview_url: a.preview_shareable_link ?? null,
      })),
    }))) as { campaigns: number; ads: number };

    const since = acct.synced_through ? shiftDay(acct.synced_through, -REVISE_DAYS) : shiftDay(today, -(FIRST_DAYS - 1));
    const windows = dayWindows(since < today ? since : today, today);
    let backfilledFrom = acct.backfilled_from ?? since;
    const oldest = shiftDay(today, -(BACKFILL_DAYS - 1));
    if (opts.backfill && acct.backfilled_from && acct.backfilled_from > oldest) {
      const from = shiftDay(acct.backfilled_from, -BACKFILL_STEP) > oldest ? shiftDay(acct.backfilled_from, -BACKFILL_STEP) : oldest;
      windows.unshift({ since: from, until: shiftDay(acct.backfilled_from, -1) });
      backfilledFrom = from;
    }

    let days = 0;
    for (const w of windows) {
      for (const level of ["campaign", "ad"] as const) {
        const rows = await allPages<Record<string, unknown>>(deps, `${act}/insights`, {
          level,
          time_increment: "1",
          time_range: JSON.stringify({ since: w.since, until: w.until }),
          fields: ["campaign_id", ...(level === "ad" ? ["ad_id"] : []), "spend", "impressions", "reach", "clicks", "inline_link_clicks", "actions"].join(","),
          limit: "500",
        }, 100);
        const out = rows.filter((r) => r.campaign_id && (level === "campaign" || r.ad_id)).map((r) => ({
          campaign_id: r.campaign_id, ad_id: level === "ad" ? r.ad_id : "", day: r.date_start,
          spend_paise: toPaise(r.spend as string), impressions: count(r.impressions), reach: count(r.reach),
          clicks: count(r.clicks), link_clicks: count(r.inline_link_clicks), meta_leads: leadCount(r.actions as Action[] | undefined),
        }));
        for (let i = 0; i < out.length; i += CHUNK) await must(deps.rpc("ads_save_daily", { p_rows: out.slice(i, i + CHUNK) }));
        if (level === "campaign") days += new Set(out.map((r) => r.day)).size;
      }
    }
    await must(deps.rpc("ads_sync_done", {
      p_account: acct.id, p_error: null, p_synced_through: today, p_backfilled_from: backfilledFrom,
    }));
    return { ok: true, account: acct.id, campaigns: saved.campaigns, ads: saved.ads, days };
  } catch (e) {
    const message = ((e as Error).message ?? "error").slice(0, 300);
    const limited = e instanceof GraphError && e.code !== null && RATE_LIMIT_CODES.has(e.code);
    if (acct?.id) {
      await deps.rpc("ads_sync_done", { p_account: acct.id, p_error: limited ? `Meta is busy, will retry: ${message}` : message });
    }
    return { ok: false, error: message, rate_limited: limited };
  }
}
