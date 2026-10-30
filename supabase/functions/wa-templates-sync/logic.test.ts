// deno-lint-ignore-file require-await -- fakes implement async interfaces without awaiting
import { assertEquals, assertRejects } from "@std/assert";
import { flowJson, GraphError, paramCount, run, syncSchema, toRow, type Deps, type GraphTemplate } from "./logic.ts";

const reminder: GraphTemplate = {
  id: "111", name: "appointment_reminder", language: "en", category: "UTILITY", status: "APPROVED",
  components: [{ type: "HEADER", text: "Reminder" }, { type: "BODY", text: "Hi {{1}}, see you on {{2}} at {{3}}." }],
};

function fakeDeps(
  opts: { templates?: GraphTemplate[]; graphFails?: boolean; dbFails?: boolean; flow?: { flow_id?: string | null; flow_draft_id?: string | null }; publishFails?: string } = {},
) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const graph: string[] = [];
  const deps: Deps = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "wa_bot_flow_get") return { data: { flow_id: null, flow_draft_id: null, ...opts.flow }, error: null };
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
    createFlow: async (name, json) => {
      graph.push(`create ${name} ${JSON.parse(json).version}`);
      return "1234567890";
    },
    publishFlow: async (id) => {
      graph.push(`publish ${id}`);
      if (opts.publishFails) throw new GraphError(opts.publishFails);
    },
    now: () => 42,
  };
  return { deps, calls, graph };
}

Deno.test("request body: sync, test, or flow with a title and button", () => {
  assertEquals(syncSchema.safeParse({ action: "sync" }).success, true);
  assertEquals(syncSchema.safeParse({ action: "test" }).success, true);
  assertEquals(syncSchema.safeParse({ action: "flow", title: "Treatments", button: "Send" }).success, true);
  assertEquals(syncSchema.safeParse({ action: "flow", title: "", button: "Send" }).success, false);
  assertEquals(syncSchema.safeParse({ action: "flow", title: "x".repeat(31), button: "Send" }).success, false);
  assertEquals(syncSchema.safeParse({ action: "sync", title: "x" }).success, false);
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

Deno.test("flow JSON: one screen, tick boxes from the message data, sends the choices back", () => {
  const f = flowJson("Treatments", "Send");
  const screen = f.screens[0]!;
  assertEquals([screen.id, screen.title, screen.terminal], ["PICK", "Treatments", true]);
  assertEquals(screen.layout.children[0], {
    type: "CheckboxGroup", name: "choices", label: "${data.label}", "data-source": "${data.options}", required: true, "min-selected-items": 1,
  });
  assertEquals(screen.layout.children[1]!["on-click-action"], { name: "complete", payload: { choices: "${form.choices}" } });
});

Deno.test("flow: made as a draft, saved, published, saved as published", async () => {
  const { deps, calls, graph } = fakeDeps();
  assertEquals(await run({ action: "flow", title: "Treatments", button: "Send" }, true, deps), {
    status: 200, body: { action: "flow", flow_id: "1234567890", published: true },
  });
  assertEquals(graph, ["create crm_treatments_42 7.1", "publish 1234567890"]);
  assertEquals(calls.filter((c) => c.fn === "wa_bot_flow_saved").map((c) => c.args.p_published), [false, true]);
});

Deno.test("flow: Meta won't publish (business not verified) → 502 with the reason, the draft is kept", async () => {
  const { deps, calls } = fakeDeps({ publishFails: "Business is not verified" });
  assertEquals(await run({ action: "flow", title: "T", button: "B" }, true, deps), {
    status: 502, body: { error: "whatsapp_api", detail: "Business is not verified" },
  });
  assertEquals(calls.filter((c) => c.fn === "wa_bot_flow_saved").map((c) => [c.args.p_flow_id, c.args.p_published]), [["1234567890", false]]);
});

Deno.test("flow: pressing again publishes the saved draft (no second form); a published one is left alone", async () => {
  const again = fakeDeps({ flow: { flow_draft_id: "5555555" } });
  await run({ action: "flow", title: "T", button: "B" }, true, again.deps);
  assertEquals(again.graph, ["publish 5555555"]);
  const done = fakeDeps({ flow: { flow_id: "7777777" } });
  assertEquals(await run({ action: "flow", title: "T", button: "B" }, true, done.deps), {
    status: 200, body: { action: "flow", flow_id: "7777777", published: true },
  });
  assertEquals(done.graph, []);
});
