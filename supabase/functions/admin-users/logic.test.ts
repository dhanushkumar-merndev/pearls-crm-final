// deno-lint-ignore-file require-await -- fakes implement async interfaces without awaiting
import { assertEquals } from "@std/assert";
import { adminUsers, requestSchema, type Deps } from "./logic.ts";

const STAFF = "11111111-0000-4000-a000-0000000000b1";

function fakeDeps(opts: { role?: string; rpcError?: Record<string, string>; createError?: string } = {}) {
  const calls: string[] = [];
  const deps: Deps = {
    rpc: async (fn, args) => {
      calls.push(`rpc ${fn}${fn === "admin_update_staff" ? " " + JSON.stringify(args.p_patch) : ""}`);
      if (fn === "me") return { data: { role: opts.role ?? "admin" } as never, error: null };
      const message = opts.rpcError?.[fn];
      return message ? { data: null, error: { message } } : { data: { id: STAFF } as never, error: null };
    },
    auth: {
      createUser: async (email) => (calls.push(`createUser ${email}`), opts.createError ? { error: opts.createError } : { id: STAFF }),
      deleteUser: async (id) => void calls.push(`deleteUser ${id}`),
      updateUser: async (id, attrs) => (calls.push(`updateUser ${id} ${JSON.stringify(attrs)}`), {}),
      revokeSessions: async (id) => void calls.push(`revokeSessions ${id}`),
    },
  };
  return { deps, calls };
}

const create = {
  action: "create",
  username: "Rekha",
  full_name: "Rekha",
  role: "receptionist",
  password: "Pearl2026",
};

Deno.test("only admins can use it", async () => {
  const { deps, calls } = fakeDeps({ role: "receptionist" });
  assertEquals(await adminUsers(create, deps), { status: 403, body: { error: "not_allowed" } });
  assertEquals(calls, ["rpc me"]);
});

Deno.test("create: makes the login, then the staff row as the admin", async () => {
  const { deps, calls } = fakeDeps();
  const res = await adminUsers(create, deps);
  assertEquals(res.status, 200);
  assertEquals(calls, ["rpc me", "createUser rekha@staff.invalid", "rpc admin_create_staff"]);
});

Deno.test("create: logins are usernames — the username is required and must be simple", async () => {
  const { deps, calls } = fakeDeps();
  const { username: _u, ...noUsername } = create;
  assertEquals((await adminUsers(noUsername, deps)).body.error, "invalid_input");
  assertEquals((await adminUsers({ ...create, username: "has space" }, deps)).body.error, "invalid_input");
  assertEquals((await adminUsers({ ...create, username: "a@b.com" }, deps)).body.error, "invalid_input");
  assertEquals(calls, []);
});

Deno.test("create: a taken username is reported as duplicate", async () => {
  const { deps } = fakeDeps({ createError: "A user with this email address has already been registered" });
  assertEquals(await adminUsers(create, deps), { status: 409, body: { error: "duplicate" } });
});

Deno.test("create: if the staff row fails, the login is removed again", async () => {
  const { deps, calls } = fakeDeps({ rpcError: { admin_create_staff: "invalid_input" } });
  const res = await adminUsers(create, deps);
  assertEquals(res.body, { error: "invalid_input" });
  assertEquals(calls.at(-1), `deleteUser ${STAFF}`);
});

Deno.test("create: weak passwords and bad roles are refused before anything happens", async () => {
  const { deps, calls } = fakeDeps();
  assertEquals((await adminUsers({ ...create, password: "short1" }, deps)).body.error, "invalid_input");
  assertEquals((await adminUsers({ ...create, password: "lettersonly" }, deps)).body.error, "invalid_input");
  assertEquals((await adminUsers({ ...create, role: "doctor" }, deps)).body.error, "invalid_input");
  assertEquals(calls, []);
});

Deno.test("deactivate: staff row first, then block login and end sessions", async () => {
  const { deps, calls } = fakeDeps();
  const res = await adminUsers({ action: "deactivate", staff_id: STAFF, reason: "Left the clinic" }, deps);
  assertEquals(res.status, 200);
  assertEquals(calls, [
    "rpc me",
    'rpc admin_update_staff {"active":false}',
    `updateUser ${STAFF} {"ban_duration":"876000h"}`,
    `revokeSessions ${STAFF}`,
  ]);
});

Deno.test("deactivate: needs a reason", async () => {
  const { deps } = fakeDeps();
  assertEquals((await adminUsers({ action: "deactivate", staff_id: STAFF }, deps)).body.error, "invalid_input");
});

Deno.test("deactivate: if the RPC refuses, the login is left alone", async () => {
  const { deps, calls } = fakeDeps({ rpcError: { admin_update_staff: "not_allowed" } });
  const res = await adminUsers({ action: "deactivate", staff_id: STAFF, reason: "Myself" }, deps);
  assertEquals(res.status, 403);
  assertEquals(calls.some((c) => c.startsWith("updateUser")), false);
});

Deno.test("reactivate lifts the login block", async () => {
  const { deps, calls } = fakeDeps();
  await adminUsers({ action: "reactivate", staff_id: STAFF }, deps);
  assertEquals(calls.at(-1), `updateUser ${STAFF} {"ban_duration":"none"}`);
});

Deno.test("update: a person's recording upload mode is set or cleared; nothing else is accepted", async () => {
  const { deps, calls } = fakeDeps();
  await adminUsers({ action: "update", staff_id: STAFF, patch: { recording_upload_override: "all_calls" } }, deps);
  await adminUsers({ action: "update", staff_id: STAFF, patch: { recording_upload_override: null } }, deps);
  assertEquals(calls.filter((c) => c.startsWith("rpc admin_update_staff")), [
    'rpc admin_update_staff {"recording_upload_override":"all_calls"}',
    'rpc admin_update_staff {"recording_upload_override":null}',
  ]);
  const bad = await adminUsers({ action: "update", staff_id: STAFF, patch: { recording_upload_override: "everything" } }, deps);
  assertEquals(bad.status, 400);
});

Deno.test("update: a contact email can be set (lower-cased) or cleared; a bad one is refused", async () => {
  const id = "11111111-0000-4000-a000-000000000001";
  const ok = requestSchema.safeParse({ action: "update", staff_id: id, patch: { email: " Owner@Example.COM " } });
  assertEquals(ok.success && ok.data.action === "update" ? ok.data.patch.email : "x", "owner@example.com");
  assertEquals(requestSchema.safeParse({ action: "update", staff_id: id, patch: { email: null } }).success, true);
  assertEquals(requestSchema.safeParse({ action: "update", staff_id: id, patch: { email: "not-an-email" } }).success, false);
});

