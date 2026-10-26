import { assertEquals } from "@std/assert";
import { escapeHtml, inr, sendMail, siteBase } from "./email.ts";

Deno.test("inr: Indian grouping from paise", () => {
  assertEquals(inr(15000000), "₹1,50,000.00");
  assertEquals(inr(5), "₹0.05");
  assertEquals(inr(123456789), "₹12,34,567.89");
  assertEquals(inr(-2500), "-₹25.00");
});

Deno.test("escapeHtml: names can't inject markup", () => {
  assertEquals(escapeHtml(`<b>"Rao" & 'Sons'</b>`), "&lt;b&gt;&quot;Rao&quot; &amp; &#39;Sons&#39;&lt;/b&gt;");
});

Deno.test("siteBase: the https address from WEB_ORIGIN", () => {
  assertEquals(siteBase("http://localhost:3000, https://crm.example.com/"), "https://crm.example.com");
  assertEquals(siteBase("http://localhost:3000"), "http://localhost:3000");
  assertEquals(siteBase("*"), "");
});

Deno.test("sendMail: Brevo request shape; 201 is success", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const out = await sendMail("key", { email: "crm@example.com", name: "Clinic CRM" },
    { to: [{ email: "a@example.com", name: "A" }], subject: "S", html: "<p>h</p>", text: "h" },
    (url, init) => {
      seen = { url, init };
      return Promise.resolve({ status: 201, body: { messageId: "x" } });
    });
  assertEquals(out, { ok: true, status: 201 });
  const body = JSON.parse(String(seen!.init.body));
  assertEquals(body.to, [{ email: "a@example.com", name: "A" }]);
  assertEquals((seen!.init.headers as Record<string, string>)["api-key"], "key");
});
