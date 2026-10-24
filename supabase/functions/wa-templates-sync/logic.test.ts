// deno-lint-ignore-file require-await -- fakes implement async interfaces without awaiting
import { assertEquals, assertRejects } from "@std/assert";
import { GraphError, paramCount, run, syncSchema, toRow, type Deps, type GraphTemplate } from "./logic.ts";

const reminder: GraphTemplate = {
  id: "111", name: "appointment_reminder", language: "en", category: "UTILITY", status: "APPROVED",
  components: [{ type: "HEADER", text: "Reminder" }, { type: "BODY", text: "Hi {{1}}, see you on {{2}} at {{3}}." }],
};

function fakeDeps(opts: { templates?: GraphTemplate[]; graphFails?: boolean; dbFails?: boolean } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const deps: Deps = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (opts.dbFails && fn === "wa_templates_upsert") return { data: null, error: { message: "db down" } };
      if (fn === "wa_templates_upsert") return { data: (args.p_templates as unknown[]).length, error: null };
      return { data: null, error: null };
    },
    listTemplates: async () => {
      if (opts.graphFails) throw new GraphError("Invalid OAuth access token");
      return opts.templates ?? [reminder];
    },
    phoneInfo: async () => {
      if (opts.graphFails) throw new GraphError("Invalid OAuth access token");
      return { display_phone_number: "+91 98450 00000", verified_name: "Test Clinic", quality_rating: "GREEN" };
    },
  };
  return { deps, calls };
}

Deno.test("request body: only sync or test", () => {
  assertEquals(syncSchema.safeParse({ action: "sync" }).success, true);
  assertEquals(syncSchema.safeParse({ action: "test" }).success, true);
  assertEquals(syncSchema.safeParse({ action: "drop" }).success, false);
  assertEquals(syncSchema.safeParse(null).success, false);
});

Deno.test("paramCount: positional and named placeholders", () => {
  assertEquals(paramCount("Hi {{1}}, see you on {{2}} at {{3}}."), 3);
  assertEquals(paramCount("Hi {{1}} {{1}}"), 1);
  assertEquals(paramCount("Hi {{ first_name }}, {{date}}"), 2);
  assertEquals(paramCount("No values"), 0);
  assertEquals(paramCount(undefined), 0);
});

Deno.test("toRow: body text, lower-case category, unusable templates dropped", () => {
  assertEquals(toRow(reminder), {
    id: "111", name: "appointment_reminder", language: "en", category: "utility", status: "APPROVED",
    components: reminder.components, body_text: "Hi {{1}}, see you on {{2}} at {{3}}.", param_count: 3,
  });
  assertEquals(toRow({ ...reminder, category: "WEIRD" })!.category, "utility");
  assertEquals(toRow({ ...reminder, status: undefined })!.status, "PENDING");
  assertEquals(toRow({ ...reminder, name: "Bad Name" }), null);
  assertEquals(toRow({ ...reminder, id: undefined }), null);
});

Deno.test("sync: usable templates saved, connection marked ok", async () => {
  const { deps, calls } = fakeDeps({ templates: [reminder, { ...reminder, id: "222", name: "Not Valid" }] });
  assertEquals(await run("sync", true, deps), { status: 200, body: { action: "sync", count: 1, skipped: 1 } });
  assertEquals((calls[0]!.args.p_templates as unknown[]).length, 1);
  assertEquals(calls[1]!.args.p_state, "ok");
});

Deno.test("test connection: shows the number Meta has", async () => {
  const { deps } = fakeDeps();
  const res = await run("test", true, deps);
  assertEquals(res.status, 200);
  assertEquals((res.body as { verified_name: string }).verified_name, "Test Clinic");
});

Deno.test("Meta refuses: 502 with Meta's reason, connection marked error", async () => {
  const { deps, calls } = fakeDeps({ graphFails: true });
  assertEquals(await run("sync", true, deps), { status: 502, body: { error: "whatsapp_api", detail: "Invalid OAuth access token" } });
  assertEquals([calls[0]!.args.p_state, calls[0]!.args.p_error], ["error", "Invalid OAuth access token"]);
});

Deno.test("keys missing: 503 not_configured, Meta never called", async () => {
  const { deps, calls } = fakeDeps();
  assertEquals(await run("test", false, deps), { status: 503, body: { error: "not_configured" } });
  assertEquals(calls.map((c) => [c.fn, c.args.p_state]), [["wa_integration_state", "off"]]);
});

Deno.test("a database error is not blamed on Meta", async () => {
  const { deps } = fakeDeps({ dbFails: true });
  await assertRejects(() => run("sync", true, deps), Error, "db down");
});
