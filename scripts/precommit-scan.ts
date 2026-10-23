/**
 * Safety check before a commit (pnpm precommit:scan): nothing private is about to be
 * committed — no .env files, docs/, keys, the Supabase project ref or any secret value
 * from the root .env. Prints only key NAMES, never values. Exit 1 if anything is found.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "./env-sync.ts";

// Values that are fine to appear in the repo (public or test-only).
const PUBLIC_KEYS = /^(NEXT_PUBLIC_SUPABASE_URL|STORAGE_BUCKET|STORAGE_REGION|STORAGE_ENDPOINT|STORAGE_PATH_STYLE|WEB_ORIGIN|SMTP_HOST|SMTP_PORT|SMTP_SENDER_NAME|NEXT_PUBLIC_TURNSTILE_SITE_KEY|TURNSTILE_SECRET_KEY|DATABASE_URL)$/;
const TURNSTILE_TEST = new Set(["1x00000000000000000000AA", "1x0000000000000000000000000000000AA"]);
const FORBIDDEN_PATHS = /(^|\/)(\.env($|\.(?!example$))|docs\/|\.vercel\/|supabase\/\.temp\/)|\.(keystore|jks)$|google-services\.json$/;
const PATTERNS = [/sb_secret_[A-Za-z0-9_-]{10,}/, /\btid_[A-Za-z0-9]{10,}/, /\btsec_[A-Za-z0-9]{10,}/, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/];

// Only the root .env (not the shell environment): those are the secrets to keep out.
const env = existsSync(".env") ? parseEnv(readFileSync(".env", "utf8")) : new Map<string, string>();
// Files that would be added AND files already staged (a merge or `git add` stages everything).
const unstaged = execSync("git add -A -n", { encoding: "utf8" })
  .split("\n")
  .map((l) => /^add '(.*)'$/.exec(l)?.[1]);
const staged = execSync("git diff --cached --name-only --diff-filter=ACMR", { encoding: "utf8" }).split("\n");
const files = [...new Set([...unstaged, ...staged])].filter((f): f is string => Boolean(f) && existsSync(f!));
const findings: string[] = [];
for (const f of files) {
  if (FORBIDDEN_PATHS.test(f)) findings.push(`private path: ${f}`);
  let text: string;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  for (const [key, value] of env) {
    if (value.length < 8 || PUBLIC_KEYS.test(key) || TURNSTILE_TEST.has(value)) continue;
    if (text.includes(value)) findings.push(`${key} value in ${f}`);
  }
  if (f !== ".env.example") for (const re of PATTERNS) if (re.test(text)) findings.push(`${re.source.slice(0, 12)}… pattern in ${f}`);
  const ref = env.get("SUPABASE_PROJECT_REF");
  if (ref && text.includes(ref)) findings.push(`project ref in ${f}`);
}
if (findings.length) {
  console.error(`✖ Not safe to commit:\n  ${findings.join("\n  ")}`);
  process.exit(1);
}
console.log(`✔ ${files.length} files checked: no secrets, keys, project ref or private files`);
