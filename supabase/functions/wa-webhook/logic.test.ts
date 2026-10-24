// deno-lint-ignore-file require-await -- fakes implement async interfaces without awaiting
import { assertEquals } from "@std/assert";
import { hmacHex } from "../_shared/meta.ts";
import { classifyButton, classifyReply, normalizeReply, parseDelivery, webhook, type Deps } from "./logic.ts";

const SECRET = "test-wa-secret";
const enc = (s: string) => new TextEncoder().encode(s);
const signed = async (body: string) => `sha256=${await hmacHex(SECRET, enc(body))}`;
const change = (value: Record<string, unknown>) => ({ object: "whatsapp_business_account", entry: [{ id: "W1", changes: [{ field: "messages", value }] }] });
const textMsg = (id: string, body: string, from = "919845012345") => ({ from, id, timestamp: "1792771640", type: "text", text: { body } });

Deno.test("replies: yes / no / stop / start in English, Kannada and Hindi", () => {
  const cases: [string, string | null][] = [
    ["YES", "confirm"], ["y", "confirm"], ["Ok!", "confirm"], ["okay 👍", "confirm"], ["Yes, I will come", "confirm"],
    ["ಹೌದು", "confirm"], ["ಸರಿ", "confirm"], ["हाँ", "confirm"], ["हां जी", "confirm"], ["haan", "confirm"], ["👍", "confirm"],
    ["Confirmed.", "confirm"], ["theek hai", "confirm"],
    ["No", "reschedule"], ["reschedule", "reschedule"], ["Can't come", "reschedule"], ["not coming", "reschedule"],
    ["change time please", "reschedule"], ["ಇಲ್ಲ", "reschedule"], ["नहीं", "reschedule"], ["nahi", "reschedule"],
    ["STOP", "stop"], ["Stop.", "stop"], ["unsubscribe", "stop"], ["please stop sending me these", "stop"], ["बंद करो", "stop"],
    ["START", "start"], ["start", "start"],
    // Unclear: mixed answers, questions, long messages, empty.
    ["ok cancel it", null], ["yes no", null], ["What time is it?", null], ["", null], ["   ", null],
    ["Yes but can I come at 5 pm instead of 11", null], ["hello", null],
  ];
  for (const [text, want] of cases) assertEquals(classifyReply(text), want, `"${text}"`);
});

Deno.test("normalizeReply keeps Indic vowel signs and drops punctuation", () => {
  assertEquals(normalizeReply("  ಹೌದು!!  "), "ಹೌದು");
  assertEquals(normalizeReply("Can’t   come..."), "cant come");
  assertEquals(normalizeReply("हाँ।"), "हाँ");
});

Deno.test("buttons: our payloads first, then the button's text", () => {
  assertEquals(classifyButton("CONFIRM", "Yes, I'll come"), "confirm");
  assertEquals(classifyButton("RESCHEDULE", "Change time"), "reschedule");
  assertEquals(classifyButton("STOP", "Stop messages"), "stop");
  assertEquals(classifyButton("custom_1", "Yes"), "confirm");
  assertEquals(classifyButton(null, "Something else"), null);
});

Deno.test("parseDelivery: statuses, texts, buttons and media; bad items skipped", () => {
  const body = change({
    statuses: [
      { id: "wamid.A", status: "delivered", timestamp: "1792771640", recipient_id: "919845012345" },
      { id: "wamid.B", status: "failed", timestamp: "1792771641", errors: [{ code: 131026, title: "Undeliverable", error_data: { details: "Not on WhatsApp" } }] },
      { id: "wamid.C", status: "deleted" },            // unknown status → skipped
    ],
    messages: [
      textMsg("wamid.IN1", "Yes"),
      { from: "919845012345", id: "wamid.IN2", timestamp: "1792771642", type: "button", button: { payload: "RESCHEDULE", text: "Change time" }, context: { id: "wamid.OUT1" } },
      { from: "919845012345", id: "wamid.IN3", type: "image", image: { caption: "my report" } },
      { from: "not-a-number", id: "wamid.IN4", type: "text", text: { body: "hi" } }, // bad sender → skipped
    ],
  });
  const { statuses, messages } = parseDelivery(body);
  assertEquals(statuses.map((s) => [s.key, s.status, s.error_code, s.error_text]), [
    ["status:wamid.A:delivered", "delivered", null, null],
    ["status:wamid.B:failed", "failed", "131026", "Not on WhatsApp"],
  ]);
  assertEquals(statuses[0]!.at, new Date(1792771640 * 1000).toISOString());
  assertEquals(messages.map((m) => [m.inbound.wa_message_id, m.inbound.from, m.inbound.kind, m.inbound.text, m.inbound.action]), [
    ["wamid.IN1", "+919845012345", "text", "Yes", "confirm"],
    ["wamid.IN2", "+919845012345", "button_reply", "Change time", "reschedule"],
    ["wamid.IN3", "+919845012345", "media", "[image] my report", null],
  ]);
  assertEquals(messages[1]!.inbound.context_wa_id, "wamid.OUT1");
  assertEquals(parseDelivery({ entry: "nope" }), { statuses: [], messages: [] });
  assertEquals(parseDelivery(change({ statuses: "x" })), { statuses: [], messages: [] });
});

function fakeDeps(fail?: string) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const deps: Deps = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === fail) return { data: null, error: { message: "boom" } };
      if (fn === "wa_inbound") return { data: { status: "new", action: (args.p as { action: string | null }).action === "confirm" ? "confirmed" : null }, error: null };
      return { data: true, error: null };
    },
  };
  return { deps, calls };
}

Deno.test("webhook: subscription check", async () => {
  const { deps } = fakeDeps();
  const ok = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "vt", "hub.challenge": "42" });
  assertEquals(await webhook({ method: "GET", params: ok, signature: null, raw: new Uint8Array() }, { appSecret: SECRET, verifyToken: "vt" }, deps), { status: 200, text: "42" });
  const bad = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "42" });
  assertEquals((await webhook({ method: "GET", params: bad, signature: null, raw: new Uint8Array() }, { appSecret: SECRET, verifyToken: "vt" }, deps)).status, 403);
  // No verify token configured: never accept.
  assertEquals((await webhook({ method: "GET", params: ok, signature: null, raw: new Uint8Array() }, { appSecret: SECRET, verifyToken: "" }, deps)).status, 403);
});

Deno.test("webhook: unsigned, wrongly signed or unconfigured deliveries are refused", async () => {
  const { deps, calls } = fakeDeps();
  const body = JSON.stringify(change({ messages: [textMsg("wamid.X", "STOP")] }));
  const input = (signature: string | null) => ({ method: "POST", params: new URLSearchParams(), signature, raw: enc(body) });
  assertEquals((await webhook(input(null), { appSecret: SECRET, verifyToken: "vt" }, deps)).status, 401);
  assertEquals((await webhook(input("sha256=00"), { appSecret: SECRET, verifyToken: "vt" }, deps)).status, 401);
  assertEquals((await webhook(input(await signed(body)), { appSecret: "", verifyToken: "vt" }, deps)).status, 503);
  assertEquals((await webhook({ method: "PUT", params: new URLSearchParams(), signature: null, raw: enc(body) }, { appSecret: SECRET, verifyToken: "vt" }, deps)).status, 405);
  assertEquals(calls.length, 0);
  const junk = "not json";
  assertEquals((await webhook({ ...input(await signed(junk)), raw: enc(junk) }, { appSecret: SECRET, verifyToken: "vt" }, deps)).status, 400);
});

Deno.test("webhook: applies each event, then logs it", async () => {
  const { deps, calls } = fakeDeps();
  const body = JSON.stringify(change({
    statuses: [{ id: "wamid.A", status: "read", timestamp: "1792771640" }],
    messages: [textMsg("wamid.IN1", "ಹೌದು")],
  }));
  const res = await webhook({ method: "POST", params: new URLSearchParams(), signature: await signed(body), raw: enc(body) }, { appSecret: SECRET, verifyToken: "vt" }, deps);
  assertEquals(res, { status: 200, json: { statuses: 1, messages: 1, actions: ["confirmed"] } });
  assertEquals(calls.map((c) => c.fn), ["wa_status_update", "wa_webhook_seen", "wa_inbound", "wa_webhook_seen"]);
  assertEquals(calls[0]!.args.p_status, "read");
  assertEquals((calls[2]!.args.p as { action: string }).action, "confirm");
  assertEquals(calls[3]!.args.p_key, "msg:wamid.IN1");
});

Deno.test("webhook: a database error is a 500 before the event is logged (Meta retries it)", async () => {
  const { deps, calls } = fakeDeps("wa_inbound");
  const body = JSON.stringify(change({ messages: [textMsg("wamid.IN1", "yes")] }));
  let threw = false;
  try {
    await webhook({ method: "POST", params: new URLSearchParams(), signature: await signed(body), raw: enc(body) }, { appSecret: SECRET, verifyToken: "vt" }, deps);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
  assertEquals(calls.map((c) => c.fn), ["wa_inbound"]);
});
