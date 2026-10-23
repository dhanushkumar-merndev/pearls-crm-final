import { fail, handler, json, readJson } from "../_shared/http.ts";
import { callerClient, serviceClient } from "../_shared/supabase.ts";
import { adminUsers } from "./logic.ts";

Deno.serve(handler(async (req) => {
  const db = await callerClient(req);
  if (!db) return fail("not_signed_in", 401);
  const admin = serviceClient();

  const result = await adminUsers(await readJson(req), {
    rpc: async (fn, args) => {
      const { data, error } = await db.rpc(fn, args);
      return { data, error: error ? { message: error.message } : null };
    },
    auth: {
      async createUser(email, password) {
        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        return error || !data.user ? { error: error?.message ?? "create_failed" } : { id: data.user.id };
      },
      async deleteUser(id) {
        await admin.auth.admin.deleteUser(id);
      },
      async updateUser(id, attrs) {
        const { error } = await admin.auth.admin.updateUserById(id, attrs);
        return error ? { error: error.message } : {};
      },
      async revokeSessions(id) {
        const { error } = await admin.rpc("admin_revoke_sessions", { p_user_id: id });
        if (error) console.error("revoke sessions failed", error.message); // ban + RLS still apply
      },
    },
  });
  return json(result.body, result.status);
}));
