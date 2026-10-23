/**
 * Deploys database migrations and Edge Functions to the online Supabase project
 * (pnpm deploy:supabase). Runs on this PC (root .env) and in CI after tests pass on
 * main (GitHub secrets). Needs SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF,
 * SUPABASE_DB_PASSWORD. No Docker: functions are bundled by Supabase (--use-api).
 */
import { project, supabaseCli } from "./supabase-api.ts";

const { ref } = project();

supabaseCli(["link", "--project-ref", ref]);
supabaseCli(["db", "push", "--linked", "--yes"]);
supabaseCli(["functions", "deploy", "--project-ref", ref, "--use-api", "--yes"]);

console.log("\n✔ Database and server functions are up to date.");
