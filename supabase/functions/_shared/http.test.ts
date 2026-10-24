import { assertEquals } from "@std/assert";
import { allowOrigin, handler, json } from "./http.ts";

const allowed = ["http://localhost:3000", "https://pearl-sales.vercel.app"];

Deno.test("only listed web addresses are allowed", () => {
  assertEquals(allowOrigin("http://localhost:3000", allowed), "http://localhost:3000");
  assertEquals(allowOrigin("https://pearl-sales.vercel.app", allowed), "https://pearl-sales.vercel.app");
  assertEquals(allowOrigin("https://evil.example", allowed), null);
  assertEquals(allowOrigin(null, allowed), null);
  assertEquals(allowOrigin("https://anything.example", ["*"]), "*");
});

Deno.test("handler answers preflight, refuses GET and hides crashes", async () => {
  const h = handler(() => {
    throw new Error("boom");
  });
  const pre = await h(new Request("http://x/", { method: "OPTIONS" }));
  assertEquals(pre.status, 200);
  assertEquals(pre.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");

  const get = await h(new Request("http://x/"));
  assertEquals(get.status, 405);
  assertEquals((await get.json()).error, "method_not_allowed");

  const crash = await h(new Request("http://x/", { method: "POST" }));
  assertEquals(crash.status, 500);
  assertEquals((await crash.json()).error, "unknown");
});

Deno.test("handler adds the allowed origin to normal answers", async () => {
  // WEB_ORIGIN is unset in tests, so every origin is allowed ("*").
  const h = handler(() => Promise.resolve(json({ ok: true })));
  const res = await h(new Request("http://x/", { method: "POST", headers: { Origin: "http://localhost:3000" } }));
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(await res.json(), { ok: true });
});
