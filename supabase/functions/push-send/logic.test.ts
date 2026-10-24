// deno-lint-ignore-file require-await -- fakes implement async interfaces without awaiting
import { assert, assertEquals } from "@std/assert";
import { classify, type Deps, fcmMessage, pemToDer, pushSchema, run, serviceAccountSchema, signedAssertion } from "./logic.ts";

const payload = (over: Record<string, unknown> = {}) => ({
  id: "n1", type: "lead_assigned", title: "New lead: Asha", body: "Call within 15 minutes", link: "/leads/1", read: false,
  tokens: ["tok-a", "tok-b"], ...over,
});

function fakeDeps(opts: { data?: unknown; answer?: (token: string) => { status: number; body: unknown } } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const sent: Record<string, unknown>[] = [];
  const deps: Deps = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return { data: fn === "push_payload" ? (opts.data === undefined ? payload() : opts.data) : null, error: null };
    },
    send: async (message) => {
      sent.push(message);
      const token = (message.message as { token: string }).token;
      return opts.answer ? opts.answer(token) : { status: 200, body: { name: "projects/x/messages/1" } };
    },
  };
  return { deps, calls, sent };
}

Deno.test("push-send: request body is exactly one notification id", () => {
  assert(pushSchema.safeParse({ id: "8f9c2f0e-4b1e-4c57-9a43-0f1f8a5c2b11" }).success);
  assert(!pushSchema.safeParse({ id: "nope" }).success);
  assert(!pushSchema.safeParse({}).success);
  assert(!pushSchema.safeParse({ id: "8f9c2f0e-4b1e-4c57-9a43-0f1f8a5c2b11", extra: 1 }).success);
});

Deno.test("push-send: sends to every phone and logs the run", async () => {
  const { deps, calls, sent } = fakeDeps();
  const result = await run("n1", true, deps);
  assertEquals(result, { state: "done", sent: 2, dropped: 0, failed: 0 });
  assertEquals(sent.map((m) => (m.message as { token: string }).token), ["tok-a", "tok-b"]);
  assertEquals(calls.at(-1)?.fn, "push_log_run");
  assertEquals(calls.at(-1)?.args.p_ok, true);
});

Deno.test("push-send: data-only message the app shows itself", () => {
  const m = fcmMessage("tok", { ...payload(), link: null }).message as Record<string, Record<string, string>>;
  assertEquals(m.data, { id: "n1", type: "lead_assigned", title: "New lead: Asha", body: "Call within 15 minutes", link: "" });
  assertEquals(m.android.priority, "HIGH");
  assertEquals("notification" in m, false);
});

Deno.test("push-send: tokens Firebase doesn't know are removed", async () => {
  const { deps, calls } = fakeDeps({
    answer: (t) =>
      t === "tok-a"
        ? { status: 404, body: { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } } }
        : { status: 200, body: {} },
  });
  const result = await run("n1", true, deps);
  assertEquals(result, { state: "done", sent: 1, dropped: 1, failed: 0 });
  assertEquals(calls.find((c) => c.fn === "push_tokens_drop")?.args, { p_tokens: ["tok-a"] });
});

Deno.test("push-send: a key problem stops after the first phone", async () => {
  const { deps, sent, calls } = fakeDeps({ answer: () => ({ status: 403, body: { error: { status: "PERMISSION_DENIED" } } }) });
  const result = await run("n1", true, deps);
  assertEquals(result.state, "auth_error");
  assertEquals(sent.length, 1);
  assertEquals(calls.at(-1)?.args.p_ok, false);
});

Deno.test("push-send: nothing to do when off, read, gone or no phone", async () => {
  assertEquals((await run("n1", false, fakeDeps().deps)).state, "off");
  assertEquals((await run("n1", true, fakeDeps({ data: payload({ read: true }) }).deps)).state, "skipped");
  assertEquals((await run("n1", true, fakeDeps({ data: payload({ tokens: [] }) }).deps)).state, "skipped");
  const missing = fakeDeps({ data: null });
  assertEquals((await run("n1", true, missing.deps)).state, "skipped");
  assertEquals(missing.sent.length, 0);
});

Deno.test("push-send: a network error counts as failed, the rest still go", async () => {
  const { deps } = fakeDeps();
  let n = 0;
  const flaky: Deps = { ...deps, send: async (m) => (n++ === 0 ? Promise.reject(new Error("timeout")) : deps.send(m)) };
  assertEquals(await run("n1", true, flaky), { state: "done", sent: 1, dropped: 0, failed: 1 });
});

Deno.test("push-send: Firebase answers sorted", () => {
  assertEquals(classify(200, {}), "sent");
  assertEquals(classify(400, { error: { status: "INVALID_ARGUMENT", message: "The registration token is not a valid FCM registration token" } }), "gone");
  assertEquals(classify(400, { error: { status: "INVALID_ARGUMENT", message: "Invalid JSON payload" } }), "failed");
  assertEquals(classify(401, null), "auth");
  assertEquals(classify(403, { error: { details: [{ errorCode: "SENDER_ID_MISMATCH" }] } }), "auth");
  assertEquals(classify(429, { error: { status: "RESOURCE_EXHAUSTED" } }), "failed");
  assertEquals(classify(503, null), "failed");
});

Deno.test("push-send: the Google assertion is a valid RS256 JWT", async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const b64 = btoa(String.fromCharCode(...der));
  // As pasted in .env: one line with literal "\n".
  const pem = `-----BEGIN PRIVATE KEY-----\\n${b64.match(/.{1,64}/g)!.join("\\n")}\\n-----END PRIVATE KEY-----\\n`;
  assertEquals(pemToDer(pem), der);
  const sa = serviceAccountSchema.parse({ client_email: "push@test.iam.gserviceaccount.com", private_key: pem, project_id: "test" });

  const jwt = await signedAssertion(sa, 1_800_000_000);
  const [h, c, s] = jwt.split(".");
  const decode = (part: string) => Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
  assertEquals(JSON.parse(new TextDecoder().decode(decode(h))), { alg: "RS256", typ: "JWT" });
  const claims = JSON.parse(new TextDecoder().decode(decode(c)));
  assertEquals(claims.iss, "push@test.iam.gserviceaccount.com");
  assertEquals(claims.scope, "https://www.googleapis.com/auth/firebase.messaging");
  assertEquals(claims.aud, "https://oauth2.googleapis.com/token");
  assertEquals(claims.exp - claims.iat, 3600);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", pair.publicKey, decode(s) as BufferSource, new TextEncoder().encode(`${h}.${c}`));
  assert(ok);
});
