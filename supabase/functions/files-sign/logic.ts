// files-sign: short-lived links for private files (PLAN.md D3).
//   put     → permission + type + size checked by RPC files_begin_upload → signed upload link
//   confirm → object exists, size matches, real type matches → RPC files_mark_uploaded
//   get     → RPC files_viewable (RLS decides) → signed view links
//   discard → RPC files_discard (own page files no document uses) → objects removed
import { z } from "zod";
import type { StorageAdapter } from "../_shared/storage.ts";
import { sniffMime } from "../_shared/sniff.ts";

export const LINK_SECONDS = 300;

const uuid = z.string().uuid();
export const requestSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("put"),
    purpose: z.string().min(1),
    mime: z.string().min(1),
    size: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
    link: z.record(z.string(), z.string()).optional(),
    client_id: uuid.optional(),
  }),
  z.object({ op: z.literal("confirm"), file_id: uuid }),
  z.object({ op: z.literal("get"), file_ids: z.array(uuid).min(1).max(100) }),
  z.object({ op: z.literal("discard"), file_ids: z.array(uuid).min(1).max(100) }),
]);
export type FilesSignRequest = z.infer<typeof requestSchema>;

type RpcError = { message: string } | null;
export interface Deps {
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: RpcError }>;
  ownFile(id: string): Promise<{ object_key: string; mime: string; size_bytes: number; status: string } | null>;
  storage: StorageAdapter;
}

export type Result = { status: number; body: Record<string, unknown> };
const err = (code: string, status = 400): Result => ({ status, body: { error: code } });
const rpcErr = (e: RpcError): Result => {
  const code = e?.message ?? "unknown";
  return err(code, code === "not_allowed" || code === "staff_inactive" ? 403 : code === "not_found" ? 404 : 400);
};

export async function filesSign(input: unknown, deps: Deps): Promise<Result> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return err("invalid_input");
  const req = parsed.data;

  if (req.op === "put") {
    const { data, error } = await deps.rpc<{ file_id: string; object_key: string; status: string }>(
      "files_begin_upload",
      {
        p_purpose: req.purpose,
        p_mime: req.mime,
        p_size_bytes: req.size,
        p_sha256: req.sha256 ?? null,
        p_link: req.link ?? {},
        p_client_id: req.client_id ?? null,
      },
    );
    if (error || !data) return rpcErr(error);
    if (data.status === "uploaded") {
      return { status: 200, body: { file_id: data.file_id, status: "uploaded" } };
    }
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

  if (req.op === "confirm") {
    const file = await deps.ownFile(req.file_id);
    if (!file) return err("not_found", 404);
    if (file.status === "uploaded") return { status: 200, body: { file_id: req.file_id, status: "uploaded" } };

    const info = await deps.storage.head(file.object_key);
    if (!info || info.size !== Number(file.size_bytes)) {
      if (info) await deps.storage.remove(file.object_key);
      await deps.rpc("files_mark_failed", { p_file_id: req.file_id });
      return err("upload_incomplete");
    }
    const head = await deps.storage.readRange(file.object_key, 0, 15);
    if (sniffMime(head) !== file.mime) {
      await deps.storage.remove(file.object_key);
      await deps.rpc("files_mark_failed", { p_file_id: req.file_id });
      return err("file_type_not_allowed");
    }
    const { error } = await deps.rpc("files_mark_uploaded", {
      p_file_id: req.file_id,
      p_size_bytes: info.size,
    });
    if (error) return rpcErr(error);
    return { status: 200, body: { file_id: req.file_id, status: "uploaded" } };
  }

  if (req.op === "discard") {
    // The database decides what may go (and marks it deleted) before any object is removed.
    const { data, error } = await deps.rpc<{ id: string; object_key: string }[]>("files_discard", { p_ids: req.file_ids });
    if (error) return rpcErr(error);
    const removed: string[] = [];
    for (const f of data ?? []) {
      try {
        await deps.storage.remove(f.object_key);
        removed.push(f.id);
      } catch (e) {
        console.error(e); // the row is already "deleted"; a leftover object only costs storage
      }
    }
    return { status: 200, body: { removed } };
  }

  const { data, error } = await deps.rpc<{ id: string; object_key: string }[]>("files_viewable", {
    p_ids: req.file_ids,
  });
  if (error) return rpcErr(error);
  const urls: Record<string, string> = {};
  for (const f of data ?? []) urls[f.id] = await deps.storage.presignGet(f.object_key, LINK_SECONDS);
  return { status: 200, body: { urls, expires_in: LINK_SECONDS } };
}
