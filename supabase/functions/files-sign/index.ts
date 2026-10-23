import { fail, handler, json, readJson } from "../_shared/http.ts";
import { storageFromEnv } from "../_shared/storage.ts";
import { callerClient } from "../_shared/supabase.ts";
import { filesSign } from "./logic.ts";

const storage = storageFromEnv();

Deno.serve(handler(async (req) => {
  const db = callerClient(req);
  if (!db) return fail("not_signed_in", 401);

  const result = await filesSign(await readJson(req), {
    rpc: async (fn, args) => {
      const { data, error } = await db.rpc(fn, args);
      return { data, error: error ? { message: error.message } : null };
    },
    ownFile: async (id) => {
      // RLS: owners (and admins) can read their file rows.
      const { data } = await db.from("files").select("object_key, mime, size_bytes, status").eq("id", id).maybeSingle();
      return data;
    },
    storage,
  });
  return json(result.body, result.status);
}));
