import { handler, json, readJson } from "../_shared/http.ts";
import { storageFromEnv } from "../_shared/storage.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { phoneScan } from "./logic.ts";

const storage = storageFromEnv();
const db = serviceClient();

Deno.serve(handler(async (req) => {
  const result = await phoneScan(await readJson(req), {
    rpc: async (fn, args) => {
      const { data, error } = await db.rpc(fn, args);
      return { data, error: error ? { message: error.message } : null };
    },
    storage,
  });
  return json(result.body, result.status);
}));
