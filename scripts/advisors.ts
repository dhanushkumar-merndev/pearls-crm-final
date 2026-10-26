/**
 * Supabase's own checks (Dashboard → Advisors) for the online project: security and performance.
 *   pnpm advisors            list every finding
 *   pnpm advisors --strict   exit 1 on any ERROR or WARN that isn't accepted below (for CI / go-live)
 * Accepted findings are listed with the reason, so a new one stands out.
 */
import { project } from "./supabase-api.ts";

interface Lint {
  name: string;
  title: string;
  level: "ERROR" | "WARN" | "INFO";
  categories: string[];
  detail: string;
  metadata?: Record<string, unknown>;
  cache_key: string;
}

/** name → why it is fine here. Keep this list short and explained. */
export const ACCEPTED: Record<string, string> = {
  authenticated_security_definer_function_executable:
    "By design (CLAUDE.md): every public RPC is security definer and checks the caller's role itself (private.require_staff); 21_ops / 02_rls_matrix test the refusals.",
  anon_security_definer_function_executable: "public_branding only: the login page shows the clinic's name and logo before anyone logs in.",
  auth_leaked_password_protection: "Supabase Pro only; pnpm supabase:configure switches it on after the upgrade.",
  function_search_path_mutable:
    "Only private.timerange / timemultirange remain: range-type constructors owned by supabase_admin, which migrations cannot alter.",
  unindexed_foreign_keys: "Left: references to staff (never deleted, only deactivated) and small master lists; growing tables are indexed (20261109100000).",
  unused_index: "Staging has little traffic; the indexes serve searches and reports that run in daily use.",
};

// The search_path acceptance covers only the two constructors named above.
const accepted = (l: Lint) => !!ACCEPTED[l.name] && (l.name !== "function_search_path_mutable" || /timerange|timemultirange/.test(l.detail));

const { api } = project();
const strict = process.argv.includes("--strict");
const found: Lint[] = [];
for (const kind of ["security", "performance"] as const) {
  const res = await api<{ lints: Lint[] }>(`/advisors/${kind}`);
  for (const l of res.lints ?? []) found.push(l);
}
const byLevel = (lvl: string) => found.filter((l) => l.level === lvl);
for (const l of [...byLevel("ERROR"), ...byLevel("WARN"), ...byLevel("INFO")]) {
  const ok = accepted(l);
  console.log(`${l.level.padEnd(5)} ${l.name}${ok ? " (accepted)" : ""}: ${l.detail.replace(/\s+/g, " ").slice(0, 220)}`);
}
const blocking = found.filter((l) => l.level !== "INFO" && !accepted(l));
console.log(`\n${found.length} findings: ${byLevel("ERROR").length} error, ${byLevel("WARN").length} warn, ${byLevel("INFO").length} info; ${blocking.length} not accepted.`);
if (strict && blocking.length) process.exit(1);
