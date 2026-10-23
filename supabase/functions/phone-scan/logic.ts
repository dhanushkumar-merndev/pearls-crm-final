// phone-scan: a phone sends page photos to the desk from the reception QR (PLAN.md D3).
// No login. Every call carries the QR token and the phone's own secret ("device key"):
// the first phone to open the link owns it, the link expires, and it closes when the desk
// saves or cancels (all checked in Postgres, phone_scan_* functions).
//   open    → claims the link for this phone → clinic name, UHID, pages so far
//   put     → upload slot for one page (type + size checked) → signed upload link
//   confirm → object exists, size matches, real type matches (magic bytes) → page number;
//             the desk sees the new page over Realtime (scan_pages)
import { z } from "zod";
import { sniffMime } from "../_shared/sniff.ts";
import type { StorageAdapter } from "../_shared/storage.ts";

export const LINK_SECONDS = 300;

const hex = z.string().regex(/^[0-9a-f]{32,128}$/);
const base = { token: hex, device_key: hex };
export const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), ...base }),
  z.object({
    action: z.literal("put"),
    ...base,
    mime: z.enum(["image/jpeg", "image/webp"]),
    size: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    client_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("confirm"),
    ...base,
    file_id: z.string().uuid(),
    width: z.number().int().min(1).max(20000).optional(),
    height: z.number().int().min(1).max(20000).optional(),
  }),
]);

type RpcError = { message: string } | null;
export interface Deps {
  /** Service-role RPC (the phone_scan_* functions are callable by nobody else). */
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: RpcError }>;
  storage: StorageAdapter;
}
export type Result = { status: number; body: Record<string, unknown> };

const STATUS: Record<string, number> = {
  link_expired: 410,
  link_used: 409,
  too_many_pages: 409,
  not_found: 404,
  invalid_input: 400,
  file_type_not_allowed: 400,
  file_too_large: 400,
  upload_incomplete: 400,
};
const err = (code: string): Result => {
  const status = STATUS[code] ?? 500;
  return { status, body: { error: status === 500 ? "unknown" : code } };
};

export async function phoneScan(input: unknown, deps: Deps): Promise<Result> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return err("invalid_input");
  const req = parsed.data;
  const who = { p_token: req.token, p_device_key: req.device_key };

  if (req.action === "open") {
    const { data, error } = await deps.rpc<Record<string, unknown>>("phone_scan_open", who);
    if (error || !data) return err(error?.message ?? "unknown");
    return { status: 200, body: data };
  }

  if (req.action === "put") {
    const { data, error } = await deps.rpc<{ file_id: string; object_key: string; status: string }>(
      "phone_scan_begin_page",
      { ...who, p_mime: req.mime, p_size_bytes: req.size, p_sha256: req.sha256 ?? null, p_client_id: req.client_id },
    );
    if (error || !data) return err(error?.message ?? "unknown");
    if (data.status !== "pending") return { status: 200, body: { file_id: data.file_id, status: data.status } };
    const url = await deps.storage.presignPut(data.object_key, req.mime, LINK_SECONDS);
    return {
      status: 200,
      body: {
        file_id: data.file_id,
        status: "pending",
        upload: { url, method: "PUT", headers: { "content-type": req.mime }, expires_in: LINK_SECONDS },
      },
    };
  }

  const file = await deps.rpc<{ object_key: string; mime: string; size_bytes: number; status: string }>(
    "phone_scan_file",
    { ...who, p_file_id: req.file_id },
  );
  if (file.error || !file.data) return err(file.error?.message ?? "unknown");
  const finish = (ok: boolean, size: number) =>
    deps.rpc<{ page_no: number | null; page_count: number }>("phone_scan_finish_upload", {
      ...who,
      p_file_id: req.file_id,
      p_ok: ok,
      p_size_bytes: size,
      p_width: req.width ?? null,
      p_height: req.height ?? null,
    });

  if (file.data.status !== "uploaded") {
    const info = await deps.storage.head(file.data.object_key);
    if (!info || info.size !== Number(file.data.size_bytes)) {
      if (info) await deps.storage.remove(file.data.object_key);
      await finish(false, Number(file.data.size_bytes));
      return err("upload_incomplete");
    }
    const head = await deps.storage.readRange(file.data.object_key, 0, 15);
    if (sniffMime(head) !== file.data.mime) {
      await deps.storage.remove(file.data.object_key);
      await finish(false, info.size);
      return err("file_type_not_allowed");
    }
  }
  const { data, error } = await finish(true, Number(file.data.size_bytes));
  if (error || !data) return err(error?.message ?? "unknown");
  return { status: 200, body: { file_id: req.file_id, page_no: data.page_no, page_count: data.page_count } };
}
