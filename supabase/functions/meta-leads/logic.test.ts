// deno-lint-ignore-file require-await -- fakes implement async interfaces without awaiting
import { assertEquals } from "@std/assert";
import { challenge, hmacHex, leadgenRefs, mapLead, retrySchema, webhook, type Deps, type GraphLead } from "./logic.ts";

const SECRET = "test-app-secret";
const enc = (s: string) => new TextEncoder().encode(s);
const delivery = (ids: string[]) =>
  JSON.stringify({
    object: "page",
    entry: [{ id: "1", time: 1, changes: ids.map((id) => ({ field: "leadgen", value: { leadgen_id: id, form_id: "77", page_id: "1", created_time: 1792771640 } })) }],
  });
const signed = async (body: string) => `sha256=${await hmacHex(SECRET, enc(body))}`;

const graphLead: GraphLead = {
  field_data: [
    { name: "full_name", values: ["Asha Rao"] },
    { name: "phone_number", values: ["+91 98450 12345"] },
    { name: "email", values: ["asha@example.com"] },
    { name: "which_treatment?", values: ["Rhinoplasty"] },
    { name: "city", values: ["Mysuru"] },
  ],
  campaign_id: "9",
  campaign_name: "Nose Oct",
  ad_name: "Ad 1",
  form_id: "77",
  platform: "ig",
};

function fakeDeps(opts: { process?: boolean; graphFails?: boolean; map?: Record<string, string> } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let fetched = 0;
  const deps: Deps = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "meta_lead_received") return { data: { process: opts.process ?? true }, error: null };
      if (fn === "meta_lead_create") return { data: { status: "created", lead_id: "L1" }, error: null };
      return { data: null, error: null };
    },
    fetchLead: async () => {
      fetched++;
      if (opts.graphFails) throw new Error("token expired");
      return graphLead;
    },
    fieldMap: async () => opts.map ?? {},
  };
  return { deps, calls, fetched: () => fetched };
}

const secrets = { appSecret: SECRET, verifyToken: "verify-me" };
const post = async (body: string, signature: string | null, deps: Deps) =>
  webhook({ method: "POST", params: new URLSearchParams(), signature, raw: enc(body) }, secrets, deps);

Deno.test("subscription check answers Meta only with the right token", () => {
  const ok = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "123" });
  assertEquals(challenge(ok, "verify-me"), { status: 200, body: "123" });
  assertEquals(challenge(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "nope" }), "verify-me").status, 403);
  assertEquals(challenge(ok, "").status, 403);
});

Deno.test("a bad or missing signature is rejected before anything is stored", async () => {
  const body = delivery(["111"]);
  for (const sig of [null, "sha256=00", "sha1=abc", await signed(body + " ")]) {
    const { deps, calls } = fakeDeps();
    assertEquals((await post(body, sig, deps)).status, 401);
    assertEquals(calls, []);
  }
});

Deno.test("no app secret configured: refuse instead of accepting unsigned data", async () => {
  const { deps } = fakeDeps();
  const body = delivery(["111"]);
  const res = await webhook({ method: "POST", params: new URLSearchParams(), signature: await signed(body), raw: enc(body) },
    { appSecret: "", verifyToken: "" }, deps);
  assertEquals(res.status, 503);
});

Deno.test("a new leadgen id: answers fetched, mapped and saved", async () => {
  const { deps, calls } = fakeDeps({ map: { "which_treatment?": "treatment_text" } });
  const body = delivery(["111"]);
  const res = await post(body, await signed(body), deps);
  assertEquals(res.status, 200);
  assertEquals(calls.map((c) => c.fn), ["meta_lead_received", "meta_lead_create"]);
  assertEquals(calls[0].args.p_form_id, "77");
  assertEquals(calls[0].args.p_created_time, new Date(1792771640 * 1000).toISOString());
  assertEquals(calls[1].args.p_lead, {
    name: "Asha Rao",
    phone: "+919845012345",
    email: "asha@example.com",
    treatment_text: "Rhinoplasty",
    comments2: "city: Mysuru",
    source_code: "instagram",
    source_detail: { campaign: "Nose Oct", campaign_id: "9", ad: "Ad 1", form_id: "77", platform: "ig" },
  });
});

Deno.test("a repeated leadgen id is ignored (no Graph call, no second lead)", async () => {
  const { deps, calls, fetched } = fakeDeps({ process: false });
  const body = delivery(["111"]);
  const res = await post(body, await signed(body), deps);
  assertEquals(res.json, { results: [{ leadgen_id: "111", status: "repeat" }] });
  assertEquals(fetched(), 0);
  assertEquals(calls.map((c) => c.fn), ["meta_lead_received"]);
});

Deno.test("Meta down or token expired: recorded as failed, still 200 so it can be retried from the admin screen", async () => {
  const { deps, calls } = fakeDeps({ graphFails: true });
  const body = delivery(["111"]);
  const res = await post(body, await signed(body), deps);
  assertEquals(res.status, 200);
  assertEquals(calls.map((c) => c.fn), ["meta_lead_received", "meta_lead_failed"]);
  assertEquals(calls[1].args.p_error, "Meta: token expired");
});

Deno.test("only leadgen changes with sane ids are read", () => {
  const body = {
    entry: [{ changes: [{ field: "feed", value: { leadgen_id: "1" } }, { field: "leadgen", value: { leadgen_id: "bad id!" } },
                        { field: "leadgen", value: { leadgen_id: 98765 } }] }],
  };
  assertEquals(leadgenRefs(body).map((r) => r.leadgen_id), ["98765"]);
  assertEquals(leadgenRefs(null), []);
});

Deno.test("mapping: first + last name, alternate number, ignored questions, no number", () => {
  const lead: GraphLead = {
    field_data: [
      { name: "first_name", values: ["Ravi"] },
      { name: "last_name", values: ["Kumar"] },
      { name: "phone_number", values: ["098450-12345"] },
      { name: "work_phone", values: ["080 4123 4567"] },
      { name: "consent", values: ["yes"] },
    ],
  };
  assertEquals(mapLead(lead, { work_phone: "alt_phone", consent: "ignore", junk: "drop_table" }), {
    name: "Ravi Kumar",
    phone: "+919845012345",
    alt_phone: "+918041234567",
    source_code: "facebook",
    source_detail: {},
  });
  assertEquals(mapLead({ field_data: [{ name: "full_name", values: ["No Number"] }] }, {}), { error: "phone" });
});

Deno.test("retry request: only an action and a numeric leadgen id are accepted", () => {
  assertEquals(retrySchema.safeParse({ action: "retry", leadgen_id: "123456789012345" }).success, true);
  assertEquals(retrySchema.safeParse({ action: "retry", leadgen_id: "12;drop" }).success, false);
  assertEquals(retrySchema.safeParse({ action: "delete", leadgen_id: "123456789" }).success, false);
  assertEquals(retrySchema.safeParse(null).success, false);
});
