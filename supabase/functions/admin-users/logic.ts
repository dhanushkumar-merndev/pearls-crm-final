// admin-users: login accounts for staff (PLAN.md D3). Only admins.
// Auth-admin steps (create login, password, ban) use the service client; the staff
// rows change through RPCs called AS the admin, so the audit log records who did it.
import { z } from "zod";

const roles = ["receptionist", "sales_executive", "sales_manager", "bdm", "admin"] as const;
// Same rule as supabase/config.toml: 8+ characters with letters and digits.
const password = z.string().min(8).max(72).regex(/[A-Za-z]/).regex(/[0-9]/);
const uuid = z.string().uuid();

export const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    // Every login is username + password. Auth gets <username>@staff.invalid (never mailed);
    // a real email, if given, is only a contact detail on the staff row.
    username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/),
    email: z.string().trim().toLowerCase().email().optional(),
    full_name: z.string().trim().min(1).max(120),
    role: z.enum(roles),
    phone_e164: z.string().regex(/^\+[1-9][0-9]{7,14}$/).optional(),
    password,
  }),
  z.object({ action: z.literal("set_password"), staff_id: uuid, password }),
  z.object({ action: z.literal("deactivate"), staff_id: uuid, reason: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal("reactivate"), staff_id: uuid }),
  z.object({
    action: z.literal("update"),
    staff_id: uuid,
    patch: z.object({
      role: z.enum(roles).optional(),
      full_name: z.string().trim().min(1).max(120).optional(),
      phone_e164: z.string().regex(/^\+[1-9][0-9]{7,14}$/).nullable().optional(),
      bdm_start_anywhere: z.boolean().optional(),
      recording_upload_override: z.enum(["sync_only", "all_calls"]).nullable().optional(),
    }),
    reason: z.string().trim().max(300).optional(),
  }),
]);

type RpcError = { message: string } | null;
export interface Deps {
  /** RPC as the calling admin (RLS + role checks apply). */
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: RpcError }>;
  auth: {
    createUser(email: string, password: string): Promise<{ id: string } | { error: string }>;
    deleteUser(id: string): Promise<void>;
    updateUser(id: string, attrs: { password?: string; ban_duration?: string }): Promise<{ error?: string }>;
    revokeSessions(id: string): Promise<void>;
  };
}

export type Result = { status: number; body: Record<string, unknown> };
const err = (code: string, status = 400, detail?: string): Result => ({
  status,
  body: { error: code, ...(detail ? { detail } : {}) },
});
const rpcErr = (e: RpcError): Result => {
  const code = e?.message ?? "unknown";
  return err(code, code === "not_allowed" || code === "staff_inactive" ? 403 : code === "not_found" ? 404 : 400);
};

export async function adminUsers(input: unknown, deps: Deps): Promise<Result> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return err("invalid_input", 400, parsed.error.issues[0]?.path.join("."));

  // Refuse early unless the caller is an active admin (the RPCs check again).
  const me = await deps.rpc<{ role: string }>("me", {});
  if (me.error) return rpcErr(me.error);
  if (me.data?.role !== "admin") return err("not_allowed", 403);

  const req = parsed.data;
  switch (req.action) {
    case "create": {
      const created = await deps.auth.createUser(`${req.username}@staff.invalid`, req.password);
      if ("error" in created) {
        // Supabase answers "already registered" when the username is taken.
        return /already|exists|registered/i.test(created.error) ? err("duplicate", 409) : err("invalid_input", 400, created.error);
      }
      const { data, error } = await deps.rpc("admin_create_staff", {
        p_user_id: created.id,
        p_role: req.role,
        p_full_name: req.full_name,
        p_username: req.username,
        p_email: req.email ?? null,
        p_phone_e164: req.phone_e164 ?? null,
      });
      if (error) {
        await deps.auth.deleteUser(created.id); // don't leave a login without a staff row
        return rpcErr(error);
      }
      return { status: 200, body: { staff: data } };
    }
    case "set_password": {
      const res = await deps.auth.updateUser(req.staff_id, { password: req.password });
      if (res.error) return err("invalid_input", 400, res.error);
      return { status: 200, body: { ok: true } };
    }
    case "deactivate": {
      const { data, error } = await deps.rpc("admin_update_staff", {
        p_staff_id: req.staff_id,
        p_patch: { active: false },
        p_reason: req.reason,
      });
      if (error) return rpcErr(error);
      // RLS already blocks them on the next request; also stop new logins and end sessions.
      await deps.auth.updateUser(req.staff_id, { ban_duration: "876000h" });
      await deps.auth.revokeSessions(req.staff_id);
      return { status: 200, body: { staff: data } };
    }
    case "reactivate": {
      const { data, error } = await deps.rpc("admin_update_staff", {
        p_staff_id: req.staff_id,
        p_patch: { active: true },
        p_reason: "reactivated",
      });
      if (error) return rpcErr(error);
      await deps.auth.updateUser(req.staff_id, { ban_duration: "none" });
      return { status: 200, body: { staff: data } };
    }
    case "update": {
      const { data, error } = await deps.rpc("admin_update_staff", {
        p_staff_id: req.staff_id,
        p_patch: req.patch,
        p_reason: req.reason ?? null,
      });
      if (error) return rpcErr(error);
      return { status: 200, body: { staff: data } };
    }
  }
}
