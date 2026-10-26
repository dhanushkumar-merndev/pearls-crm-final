// daily-summary: the evening email to the admins (PLAN.md D5, 20:00 IST by default). The
// database decides when (private.daily_summary_tick, once a day after the set time), adds the
// bell entry and passes the run id; this builds the email and sends it to each recipient.
import { z } from "zod";
import { escapeHtml, inr, layout, type Mail } from "../_shared/email.ts";

export const requestSchema = z.object({ date: z.iso.date(), run_id: z.number().int().positive() }).strict();

const n = z.coerce.number().default(0);
export const payloadSchema = z.object({
  data: z.object({
    date: z.string(),
    revenue_paise: n,
    collected_paise: n,
    bills: n,
    by_mode: z.array(z.object({ label: z.string().nullable(), paise: n })).default([]),
    appointments: n,
    arrived: n,
    no_shows: n,
    new_patients: n,
    pharmacy_sales_paise: n,
    admissions: n,
    new_leads: n,
    converted: n,
    bdm_days: n,
    bdm_visits: n,
    followups_overdue: n,
    stock_alerts: n,
    storage_pct: n,
  }),
  clinic: z.string().nullable().optional(),
  recipients: z.array(z.object({ email: z.string(), name: z.string().nullable().optional() })).default([]),
});
export type Payload = z.infer<typeof payloadSchema>;

const ddmmyyyy = (iso: string) => iso.split("-").reverse().join("/");

/** Sections of label → value rows, shared by the HTML and the text version. */
export function summaryRows(d: Payload["data"]): { title: string; rows: [string, string][] }[] {
  return [
    {
      title: "Money",
      rows: [
        ["Billed", inr(d.revenue_paise)],
        ["Collected", inr(d.collected_paise)],
        ...d.by_mode.map((m): [string, string] => [`  ${m.label ?? "Other"}`, inr(m.paise)]),
        ["Bills", String(d.bills)],
        ["Pharmacy sales", inr(d.pharmacy_sales_paise)],
      ],
    },
    {
      title: "Patients",
      rows: [
        ["Appointments", String(d.appointments)],
        ["Seen", String(d.arrived)],
        ["No-shows", String(d.no_shows)],
        ["New patients", String(d.new_patients)],
        ["Admissions", String(d.admissions)],
      ],
    },
    {
      title: "Sales and field",
      rows: [
        ["New leads", String(d.new_leads)],
        ["Converted", String(d.converted)],
        ["BDMs out today", String(d.bdm_days)],
        ["Visits completed", String(d.bdm_visits)],
      ],
    },
    {
      title: "Needs attention",
      rows: [
        ["Overdue follow-ups", String(d.followups_overdue)],
        ["Pharmacy alerts", String(d.stock_alerts)],
        ["Storage used", `${d.storage_pct}%`],
      ],
    },
  ];
}

export function summaryMail(p: Payload, to: { email: string; name?: string | null }, base: string): Mail {
  const clinic = p.clinic ?? "Clinic CRM";
  const title = `Daily summary · ${ddmmyyyy(p.data.date)}`;
  const sections = summaryRows(p.data);
  const table = (rows: [string, string][]) =>
    `<table style="width:100%;border-collapse:collapse">${rows
      .map(([k, v]) => `<tr><td style="padding:6px 0;border-bottom:1px solid #e5e5e5">${escapeHtml(k)}</td><td style="padding:6px 0;border-bottom:1px solid #e5e5e5;text-align:right;font-weight:bold">${escapeHtml(v)}</td></tr>`)
      .join("")}</table>`;
  const inner = sections.map((s) => `<h2 style="font-size:17px;margin:20px 0 6px">${escapeHtml(s.title)}</h2>${table(s.rows)}`).join("\n")
    + (base ? `\n<p style="margin-top:20px"><a href="${escapeHtml(base)}/dashboard">Open the dashboard</a></p>` : "");
  return {
    to: [to],
    subject: `${title} · ${clinic}`,
    html: layout(`${clinic}: ${title}`, inner, "Change the time or switch this email off in Admin → Settings → Daily summary."),
    text: [`${clinic}: ${title}`, ...sections.map((s) => [s.title, ...s.rows.map(([k, v]) => `${k}: ${v}`)].join("\n"))].join("\n\n"),
  };
}

type RpcError = { message: string } | null;
export interface Deps {
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: RpcError }>;
  send(mail: Mail): Promise<{ ok: boolean; status: number }>;
  base: string;
}

export async function run(req: z.infer<typeof requestSchema>, configured: boolean, deps: Deps): Promise<Record<string, unknown>> {
  const done = async (ok: boolean, detail: Record<string, unknown>) => {
    await deps.rpc("daily_summary_done", { p_run_id: req.run_id, p_ok: ok, p_detail: detail });
    return { ok, ...detail };
  };
  if (!configured) return done(false, { error: "not_configured" });
  const { data, error } = await deps.rpc<unknown>("daily_summary_payload", { p_day: req.date });
  if (error) return done(false, { error: error.message });
  const parsed = payloadSchema.safeParse(data);
  if (!parsed.success) return done(false, { error: "bad_payload" });
  const recipients = parsed.data.recipients.filter((r) => z.email().safeParse(r.email).success);
  if (!recipients.length) return done(true, { sent: 0, note: "no_recipients" });
  let sent = 0;
  let failed = 0;
  for (const to of recipients) {
    try {
      const res = await deps.send(summaryMail(parsed.data, to, deps.base));
      if (res.ok) sent++;
      else failed++;
    } catch (e) {
      console.error(e);
      failed++;
    }
  }
  return done(failed === 0, { sent, failed });
}
