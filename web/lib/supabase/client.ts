import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertSupabaseEnv, SUPABASE_KEY, SUPABASE_URL } from "./env";

let browserClient: SupabaseClient | undefined;

/** One shared client per browser tab. */
export function getSupabaseBrowser(): SupabaseClient {
  if (!browserClient) {
    assertSupabaseEnv();
    browserClient = createBrowserClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return browserClient;
}
