// Email through Brevo's transactional API (the same account that sends login emails).
// Pure helpers here; the caller passes fetch so tests can fake it.

export interface Mail {
  to: { email: string; name?: string | null }[];
  subject: string;
  html: string;
  text: string;
}

export interface Sender {
  email: string;
  name: string;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<{ status: number; body: unknown }>;

export const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

/** Sends one email; true when Brevo accepted it. */
export async function sendMail(apiKey: string, sender: Sender, mail: Mail, fetcher: Fetcher): Promise<{ ok: boolean; status: number }> {
  const res = await fetcher(BREVO_URL, {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      sender,
      to: mail.to.map((t) => (t.name ? { email: t.email, name: t.name } : { email: t.email })),
      subject: mail.subject,
      htmlContent: mail.html,
      textContent: mail.text,
    }),
  });
  return { ok: res.status >= 200 && res.status < 300, status: res.status };
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** ₹1,50,000.00 (Indian grouping), from paise. */
export function inr(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100).toString();
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}₹${rest ? `${rest},${last3}` : last3}.${String(abs % 100).padStart(2, "0")}`;
}

/** The web app's address for links in emails: the https one from WEB_ORIGIN, else the first. */
export function siteBase(origins: string): string {
  const list = origins.split(",").map((o) => o.trim()).filter((o) => o && o !== "*");
  return (list.find((o) => o.startsWith("https://")) ?? list[0] ?? "").replace(/\/+$/, "");
}

/** A plain, readable email body (white page, big text) around some inner HTML. */
export function layout(title: string, inner: string, footer: string): string {
  return `<!doctype html><html><body style="margin:0;background:#ffffff;color:#1f1f1f;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5">
<div style="max-width:560px;margin:0 auto;padding:24px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>
${inner}
<p style="color:#5f5f5f;font-size:13px;margin-top:24px">${escapeHtml(footer)}</p>
</div></body></html>`;
}
