/**
 * Live check of the private file store with the same adapter the Edge Functions use
 * (pnpm storage:check). Reads supabase/functions/.env; uploads, reads and deletes one
 * tiny test object under _healthcheck/. Extra arguments = more browser origins to test.
 */
import { storageFromEnv } from "../supabase/functions/_shared/storage.ts";

const origins = [Deno.env.get("WEB_ORIGIN") ?? "http://localhost:3000", ...Deno.args];
const store = storageFromEnv();
const key = `_healthcheck/${crypto.randomUUID()}.txt`;
let failed = false;

function check(ok: boolean, label: string, detail = "") {
  console.log(`${ok ? "✔" : "✖"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
}

const putUrl = await store.presignPut(key, "text/plain", 120);

for (const origin of origins) {
  const pre = await fetch(putUrl, {
    method: "OPTIONS",
    headers: { Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" },
  });
  await pre.body?.cancel();
  const allowed = pre.headers.get("access-control-allow-origin");
  const hint = allowed ? `got ${allowed}` : "add it with tigris buckets set-cors";
  check(allowed === origin, `browser upload allowed from ${origin}`, allowed === origin ? "" : hint);
}

const stranger = await fetch(putUrl, {
  method: "OPTIONS",
  headers: { Origin: "https://not-our-site.example", "Access-Control-Request-Method": "PUT" },
});
await stranger.body?.cancel();
check(!stranger.headers.get("access-control-allow-origin"), "other websites are refused");

const put = await fetch(putUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body: "ok" });
await put.body?.cancel();
check(put.ok, "upload with a signed link", put.ok ? "" : `HTTP ${put.status}`);

const wrongType = await fetch(await store.presignPut(`${key}.x`, "image/png", 120), {
  method: "PUT",
  headers: { "content-type": "text/html" },
  body: "<b>x</b>",
});
await wrongType.body?.cancel();
check(!wrongType.ok, "signed link refuses a different file type", wrongType.ok ? "UPLOAD WAS ACCEPTED" : "");
if (wrongType.ok) await store.remove(`${key}.x`);

const info = await store.head(key);
check(info?.size === 2, "file is stored", info ? `${info.size} bytes, ${info.contentType}` : "not found");

const get = await fetch(await store.presignGet(key, 60));
const body = await get.text();
check(get.ok && body === "ok", "download with a signed link");

const objectUrl = new URL(putUrl);
objectUrl.search = "";
const open = await fetch(objectUrl);
await open.body?.cancel();
check(!open.ok, "bucket is private (no link = no access)", open.ok ? "FILE IS PUBLIC" : `HTTP ${open.status}`);

await store.remove(key);
check((await store.head(key)) === null, "test file deleted");

if (failed) {
  console.error("\n✖ Storage check failed.");
  Deno.exit(1);
}
console.log("\n✔ Private file storage works.");
