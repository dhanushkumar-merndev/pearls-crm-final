import { assert, assertEquals } from "@std/assert";
import type { Mail } from "../_shared/email.ts";
import { notificationMail, notifySchema, run, type Deps } from "./logic.ts";

const payload = {
  id: "n1", type: "storage_alert", title: "Storage 86% full", body: "Back up <now>", link: "/admin/backup",
  to_email: "admin@example.com", to_name: "Asha", clinic: "Demo Clinic",
};

function fakeDeps(data: unknown, status = 201) {
  const sent: Mail[] = [];
  const logged: Record<string, unknown>[] = [];
  const deps: Deps = {
    rpc: <T>(fn: string, args: Record<string, unknown>) => {
      if (fn === "job_run_log") logged.push(args);
      return Promise.resolve({ data: (fn === "email_payload" ? data : null) as T | null, error: null });
    },
    send: (mail) => {
      sent.push(mail);
      return Promise.resolve({ ok: status < 300, status });
    },
    base: "https://crm.example.com",
  };
  return { deps, sent, logged };
}

Deno.test("notify-email: the body must be one notification id", () => {
  assert(notifySchema.safeParse({ id: "8f0e7c4e-3a52-4b8e-9d6c-2b1a0f9e8d7c" }).success);
  assert(!notifySchema.safeParse({ id: "x" }).success);
  assert(!notifySchema.safeParse({ id: "8f0e7c4e-3a52-4b8e-9d6c-2b1a0f9e8d7c", extra: 1 }).success);
});

Deno.test("notify-email: the email links to the page and escapes the text", () => {
  const mail = notificationMail(payload, "https://crm.example.com");
  assertEquals(mail.subject, "Storage 86% full · Demo Clinic");
  assert(mail.html.includes("https://crm.example.com/admin/backup"));
  assert(mail.html.includes("Back up &lt;now&gt;"));
  assertEquals(mail.to, [{ email: "admin@example.com", name: "Asha" }]);
});

Deno.test("notify-email: sends once and logs the run", async () => {
  const { deps, sent, logged } = fakeDeps(payload);
  assertEquals(await run("n1", true, deps), { state: "sent", status: 201 });
  assertEquals(sent.length, 1);
  assertEquals(logged[0].p_ok, true);
});

Deno.test("notify-email: Brevo refusing is logged as failed", async () => {
  const { deps, logged } = fakeDeps(payload, 401);
  assertEquals((await run("n1", true, deps)).state, "failed");
  assertEquals(logged[0].p_ok, false);
});

Deno.test("notify-email: nothing to send without Brevo, or for a person with no address", async () => {
  const none = fakeDeps(payload);
  assertEquals(await run("n1", false, none.deps), { state: "not_configured" });
  const noAddress = fakeDeps({ ...payload, to_email: null });
  assertEquals(await run("n1", true, noAddress.deps), { state: "skipped" });
  assertEquals(noAddress.sent.length, 0);
});
