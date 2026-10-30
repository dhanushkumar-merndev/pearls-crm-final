// deno-lint-ignore-file require-await -- fakes implement async interfaces without awaiting
import { assertEquals } from "@std/assert";
import { classifyError, cronOk, dispatch, dispatchSchema, messageBody, type Claimed, type Deps, type SendResult } from "./logic.ts";

const tpl = (id: string, vars: unknown[] = ["Asha", "25/10/2026"]): Claimed => ({
  id, to: "+919845012345", kind: "template", text: "Hi {{1}}", vars, template: { name: "appointment_reminder", language: "en" },
});
const txt = (id: string, text: string | null = "See you at 11"): Claimed => ({ id, to: "+919845012345", kind: "text", text, vars: [], template: null });

function fakeDeps(opts: { batches?: Claimed[][]; send?: (body: Record<string, unknown>) => SendResult } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const sent: Record<string, unknown>[] = [];
  const batches = [...(opts.batches ?? [])];
  const deps: Deps = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "wa_due_reminders") return { data: 2, error: null };
      if (fn === "wa_drip_due") return { data: 1, error: null };
      if (fn === "wa_claim_batch") return { data: batches.shift() ?? [], error: null };
      return { data: null, error: null };
    },
    send: async (body) => {
      sent.push(body);
      return opts.send ? opts.send(body) : { ok: true, id: `wamid.${sent.length}` };
    },
  };
  return { deps, calls, sent };
}
const marks = (calls: { fn: string; args: Record<string, unknown> }[]) =>
  calls.filter((c) => c.fn === "wa_mark_result").map((c) => [c.args.p_id, c.args.p_wa_message_id, c.args.p_error_code ?? null, c.args.p_retry ?? null]);

Deno.test("cron secret: both must be set and equal", () => {
  assertEquals(cronOk("s3cret-value", "s3cret-value"), true);
  assertEquals(cronOk("s3cret-valuX", "s3cret-value"), false);
  assertEquals(cronOk(null, "s3cret-value"), false);
  assertEquals(cronOk("", ""), false);
});

Deno.test("request body: only an optional source", () => {
  assertEquals(dispatchSchema.safeParse({}).success, true);
  assertEquals(dispatchSchema.safeParse({ source: "cron" }).success, true);
  assertEquals(dispatchSchema.safeParse({ source: "bot" }).success, true);
  assertEquals(dispatchSchema.safeParse({ source: "evil" }).success, false);
  assertEquals(dispatchSchema.safeParse({ source: "cron", extra: 1 }).success, false);
});

Deno.test("message bodies: template parameters cleaned, text kept, junk refused", () => {
  assertEquals(messageBody(tpl("1", ["Asha\nRao", "", "a     b"])), {
    messaging_product: "whatsapp", recipient_type: "individual", to: "919845012345", type: "template",
    template: { name: "appointment_reminder", language: { code: "en" }, components: [{ type: "body", parameters: [
      { type: "text", text: "Asha Rao" }, { type: "text", text: "-" }, { type: "text", text: "a   b" },
    ] }] },
  });
  assertEquals((messageBody(tpl("1", [])) as { template: Record<string, unknown> }).template.components, undefined);
  assertEquals(messageBody(txt("2")), {
    messaging_product: "whatsapp", recipient_type: "individual", to: "919845012345", type: "text", text: { preview_url: false, body: "See you at 11" },
  });
  assertEquals(messageBody(txt("3", "  ")), null);
  assertEquals(messageBody({ ...txt("4"), to: "12" }), null);
  assertEquals(messageBody({ ...tpl("5"), template: null }), null);
});

Deno.test("message bodies: bot buttons and the tick-box form go as interactive; a brochure link gets its preview", () => {
  const buttons = { type: "button", body: { text: "Is this correct?" }, action: { buttons: [{ type: "reply", reply: { id: "bot_confirm", title: "Confirm" } }] } };
  assertEquals(messageBody({ ...txt("1", "Is this correct?"), kind: "interactive", payload: buttons }), {
    messaging_product: "whatsapp", recipient_type: "individual", to: "919845012345", type: "interactive", interactive: buttons,
  });
  assertEquals(messageBody({ ...txt("2"), kind: "interactive", payload: null }), null);
  assertEquals(messageBody({ ...txt("3"), kind: "interactive", payload: { type: "button" } }), null);
  assertEquals((messageBody({ ...txt("4", "Brochure: https://x.example/b.pdf"), payload: { preview_url: true } }) as { text: unknown }).text, {
    preview_url: true, body: "Brochure: https://x.example/b.pdf",
  });
});

Deno.test("Meta errors: temporary ones retried, token problems flagged, others final", () => {
  assertEquals(classifyError(400, { code: 131026, message: "Message undeliverable" }), { code: "131026", text: "Message undeliverable", retry: false, auth: false });
  assertEquals(classifyError(400, { code: 131047, error_data: { details: "More than 24 hours" } }).retry, false);
  assertEquals(classifyError(429, { code: 130429, message: "Rate limit" }).retry, true);
  assertEquals(classifyError(503, undefined), { code: "http_503", text: "HTTP 503", retry: true, auth: false });
  assertEquals(classifyError(401, { code: 190, message: "Token expired" }), { code: "190", text: "Token expired", retry: true, auth: true });
  assertEquals(classifyError(0, { message: "connection reset" }), { code: "network", text: "connection reset", retry: true, auth: false });
});

Deno.test("cron run: reminders and drips queued, every claimed message sent and marked", async () => {
  const { deps, calls, sent } = fakeDeps({ batches: [[tpl("m1"), txt("m2")]] });
  const s = await dispatch({ source: "cron", configured: true }, deps);
  assertEquals(s, { source: "cron", reminders: 2, drips: 1, sent: 2, failed: 0, retry: 0 });
  assertEquals(sent.length, 2);
  assertEquals(marks(calls), [["m1", "wamid.1", null, null], ["m2", "wamid.2", null, null]]);
  assertEquals(calls.map((c) => c.fn), [
    "wa_due_reminders", "wa_drip_due", "wa_claim_batch", "wa_mark_result", "wa_mark_result", "wa_integration_state", "wa_log_run",
  ]);
  assertEquals(calls.find((c) => c.fn === "wa_integration_state")!.args.p_state, "ok");
});

Deno.test("staff run: no reminders or drips, just the queue", async () => {
  const { deps, calls } = fakeDeps({ batches: [[txt("m1")]] });
  const s = await dispatch({ source: "staff", configured: true }, deps);
  assertEquals([s.reminders, s.drips, s.sent], [0, 0, 1]);
  assertEquals(calls.some((c) => c.fn === "wa_due_reminders" || c.fn === "wa_drip_due"), false);
});

Deno.test("bot run: replies sent at once, no reminders or drips", async () => {
  const { deps, calls } = fakeDeps({ batches: [[txt("m1")]] });
  const s = await dispatch({ source: "bot", configured: true }, deps);
  assertEquals([s.source, s.reminders, s.drips, s.sent], ["bot", 0, 0, 1]);
  assertEquals(calls.some((c) => c.fn === "wa_due_reminders" || c.fn === "wa_drip_due"), false);
});

Deno.test("not configured: queue left alone, state off, nothing sent", async () => {
  const { deps, calls, sent } = fakeDeps({ batches: [[txt("m1")]] });
  const s = await dispatch({ source: "cron", configured: false }, deps);
  assertEquals(s.skipped, "not_configured");
  assertEquals(sent.length, 0);
  assertEquals(calls.some((c) => c.fn === "wa_claim_batch"), false);
  assertEquals(calls.find((c) => c.fn === "wa_integration_state")!.args.p_state, "off");
});

Deno.test("failures: final ones failed, temporary ones retried, bad rows never sent", async () => {
  const { deps, calls, sent } = fakeDeps({
    batches: [[tpl("m1"), tpl("m2"), txt("m3", null)]],
    send: (body) => (body.type === "template" && sent.length === 1
      ? { ok: false, code: "131026", text: "Undeliverable", retry: false, auth: false }
      : { ok: false, code: "130429", text: "Rate limit", retry: true, auth: false }),
  });
  const s = await dispatch({ source: "staff", configured: true }, deps);
  assertEquals([s.sent, s.failed, s.retry], [0, 2, 1]);
  assertEquals(marks(calls), [["m1", null, "131026", false], ["m2", null, "130429", true], ["m3", null, "bad_message", false]]);
  assertEquals(sent.length, 2);
});

Deno.test("a bad token stops the run: the rest are put back without calling Meta", async () => {
  let n = 0;
  const { deps, calls, sent } = fakeDeps({
    batches: [[tpl("m1"), tpl("m2"), tpl("m3")]],
    send: () => (n++, { ok: false, code: "190", text: "Token expired", retry: true, auth: true }),
  });
  const s = await dispatch({ source: "cron", configured: true }, deps);
  assertEquals(sent.length, 1);
  assertEquals([s.retry, s.error], [3, "Token expired"]);
  assertEquals(marks(calls).map((m) => m[3]), [true, true, true]);
  const state = calls.find((c) => c.fn === "wa_integration_state")!;
  assertEquals([state.args.p_state, state.args.p_error], ["error", "Token expired"]);
  assertEquals(calls.filter((c) => c.fn === "wa_claim_batch").length, 1);
});

Deno.test("full batches keep going (up to the limit), a short batch ends the run", async () => {
  const full = Array.from({ length: 20 }, (_, i) => txt(`a${i}`));
  const { deps, calls } = fakeDeps({ batches: [full, [txt("b1")]] });
  const s = await dispatch({ source: "staff", configured: true }, deps);
  assertEquals(s.sent, 21);
  assertEquals(calls.filter((c) => c.fn === "wa_claim_batch").length, 2);
});
