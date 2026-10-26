// notify-email: emails one notification to its recipient (Brevo). Called by Postgres (trigger on
// public.notifications → pg_net, header x-cron-secret) when the type's rule says "email"
// (Admin → Notifications). Best effort: the notification is already in the bell.
import { z } from "zod";
import { escapeHtml, layout, type Mail } from "../_shared/email.ts";

export const notifySchema = z.object({ id: z.uuid() }).strict();

export const payloadSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string().default(""),
  link: z.string().nullable().optional(),
  to_email: z.email(),
  to_name: z.string().nullable().optional(),
  clinic: z.string().nullable().optional(),
});
export type Payload = z.infer<typeof payloadSchema>;

/** The email for one notification; the link opens the right page of the web app. */
export function notificationMail(p: Payload, base: string): Mail {
  const url = p.link && base ? `${base}${p.link.startsWith("/") ? "" : "/"}${p.link}` : null;
  const clinic = p.clinic ?? "Clinic CRM";
  const inner = [
    p.body ? `<p style="margin:0 0 16px">${escapeHtml(p.body)}</p>` : "",
    url ? `<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#1f1f1f;color:#ffffff;padding:12px 20px;border-radius:10px;text-decoration:none">Open in the CRM</a></p>` : "",
  ].join("\n");
  return {
    to: [{ email: p.to_email, name: p.to_name ?? null }],
    subject: `${p.title} · ${clinic}`,
    html: layout(p.title, inner, `${clinic} · You get this email because of a notification rule (Admin → Notifications).`),
    text: [p.title, p.body, url ?? ""].filter(Boolean).join("\n\n"),
  };
}

type RpcError = { message: string } | null;
export interface Deps {
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: RpcError }>;
  send(mail: Mail): Promise<{ ok: boolean; status: number }>;
  base: string;
}

export async function run(id: string, configured: boolean, deps: Deps): Promise<Record<string, unknown>> {
  if (!configured) return { state: "not_configured" };
  const { data, error } = await deps.rpc<unknown>("email_payload", { p_id: id });
  if (error) throw new Error(error.message);
  const parsed = payloadSchema.safeParse(data);
  // Gone, deactivated, or no usable address: nothing to send.
  if (!parsed.success) return { state: "skipped" };
  let result: { ok: boolean; status: number };
  try {
    result = await deps.send(notificationMail(parsed.data, deps.base));
  } catch (e) {
    result = { ok: false, status: 0 };
    console.error(e);
  }
  await deps.rpc("job_run_log", { p_job: "notify-email", p_ok: result.ok, p_detail: { type: parsed.data.type, status: result.status } });
  return { state: result.ok ? "sent" : "failed", status: result.status };
}
