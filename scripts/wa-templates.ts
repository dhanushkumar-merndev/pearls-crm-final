/**
 * The WhatsApp message templates the CRM uses, sent to Meta for review in one go.
 *   pnpm wa:templates            shows which exist on Meta and what would be submitted (changes nothing)
 *   pnpm wa:templates --submit   submits the missing ones (existing names are left alone)
 * Needs WHATSAPP_ACCESS_TOKEN + WHATSAPP_WABA_ID in .env, and the system user must have the
 * WhatsApp account assigned (Business settings → System users → Assign assets).
 * Texts carry no clinic details: {{n}} are filled by the CRM (Admin → WhatsApp → a template).
 * Button texts must stay understood by wa-webhook (classifyButton: confirm / reschedule / stop).
 */
import { need, project } from "./supabase-api.ts";

const GRAPH = "https://graph.facebook.com/v23.0";

interface Template {
  name: string;
  category: "UTILITY" | "MARKETING";
  body: string;
  /** Sample values Meta reviews the text with (one per {{n}}). */
  example: string[];
  buttons?: string[];
  /** What to choose in Admin → WhatsApp → Edit afterwards. */
  usedFor: string;
  values: string;
}

const STOP = "Stop messages";
export const TEMPLATES: Template[] = [
  {
    name: "appointment_booked",
    category: "UTILITY",
    body: "Hi {{1}}, your appointment at {{2}} is booked for {{3}} at {{4}} with {{5}}. Reply YES to confirm or NO to change it.",
    example: ["Asha", "Our Clinic", "05/11/2026", "11:30 AM", "Dr. Rao"],
    buttons: ["Yes, I'll come", "Change time"],
    usedFor: "Booking confirmation",
    values: "First name, Clinic name, Booking date, Booking time, Doctor",
  },
  {
    name: "appointment_reminder",
    category: "UTILITY",
    body: "Hi {{1}}, a reminder of your appointment at {{2}} on {{3}} at {{4}}. Reply YES to confirm or NO to change it.",
    example: ["Asha", "Our Clinic", "05/11/2026", "11:30 AM"],
    buttons: ["Yes, I'll come", "Change time"],
    usedFor: "Booking reminder",
    values: "First name, Clinic name, Booking date, Booking time",
  },
  {
    name: "lead_welcome",
    category: "MARKETING",
    body: "Hi {{1}}, thank you for contacting {{2}}. Our team will call you shortly. Reply STOP to stop these messages.",
    example: ["Asha", "Our Clinic"],
    buttons: [STOP],
    usedFor: "New lead welcome",
    values: "First name, Clinic name",
  },
  {
    name: "followup_checkin",
    category: "UTILITY",
    body: "Hi {{1}}, this is {{2}}. How are you feeling after your treatment? Reply to this message if you have any questions.",
    example: ["Asha", "Our Clinic"],
    usedFor: "Other (staff and drip campaigns)",
    values: "First name, Clinic name",
  },
  {
    // After the 24-hour window, e.g. a number that chatted with the bot: needs only the clinic name.
    name: "enquiry_followup",
    category: "MARKETING",
    body: "Hello from {{1}}! You contacted us on WhatsApp about our treatments. Would you like our team to help you? Tap a button below or reply to this message.",
    example: ["Our Clinic"],
    buttons: ["Yes, please", STOP],
    usedFor: "Other (staff, from the inbox)",
    values: "Clinic name",
  },
];

function payload(t: Template) {
  const components: unknown[] = [{ type: "BODY", text: t.body, example: { body_text: [t.example] } }];
  if (t.buttons) components.push({ type: "BUTTONS", buttons: t.buttons.map((text) => ({ type: "QUICK_REPLY", text })) });
  return { name: t.name, language: "en", category: t.category, components };
}

async function graph(path: string, token: string, body?: unknown) {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as { error?: { message?: string; error_subcode?: number; error_user_msg?: string } } & Record<string, unknown>;
  if (json.error) {
    const e = json.error;
    throw new Error(`${e.error_user_msg ?? e.message ?? "Meta error"}${e.error_subcode ? ` (subcode ${e.error_subcode})` : ""}`);
  }
  return json;
}

async function main() {
  const { env } = project();
  const [token, waba] = need(env, "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_WABA_ID");
  const submit = process.argv.includes("--submit");
  let existing: Map<string, string>;
  try {
    const list = (await graph(`${waba}/message_templates?fields=name,status&limit=200`, token)) as { data: { name: string; status: string }[] };
    existing = new Map(list.data.map((x) => [x.name, x.status]));
  } catch (e) {
    console.error(`✖ Meta refused to list the templates: ${(e as Error).message}`);
    console.error("  Business settings → Users → System users → (the CRM's user) → Assign assets → WhatsApp accounts → the clinic's account → Full control.");
    process.exit(1);
  }
  let failed = 0;
  for (const t of TEMPLATES) {
    const status = existing.get(t.name);
    if (status) {
      console.log(`• ${t.name}: already on Meta (${status})`);
      continue;
    }
    if (!submit) {
      console.log(`○ ${t.name}: would submit (${t.category}${t.buttons ? `, buttons: ${t.buttons.join(" / ")}` : ""})`);
      continue;
    }
    try {
      const r = (await graph(`${waba}/message_templates`, token, payload(t))) as { status?: string };
      console.log(`✔ ${t.name}: submitted (${r.status ?? "PENDING"})`);
    } catch (e) {
      failed++;
      console.error(`✖ ${t.name}: ${(e as Error).message}`);
    }
  }
  console.log("\nAfter Meta approves: Admin → WhatsApp → Get templates from Meta, then Edit each one:");
  for (const t of TEMPLATES) console.log(`  ${t.name}: Used for "${t.usedFor}"; values: ${t.values}`);
  if (!submit) console.log("\nNothing was sent. Run with --submit to send the missing ones for review.");
  process.exit(failed ? 1 : 0);
}

void main();
