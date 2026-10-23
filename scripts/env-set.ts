/**
 * Writes KEY=VALUE lines from stdin into the root .env (pnpm env:set), so setup
 * commands can store new keys without them ever appearing on screen.
 *   <command printing KEY=VALUE or "export KEY=VALUE" lines> | pnpm env:set [FROM=TO ...]
 * FROM=TO renames a key on the way in (e.g. TIGRIS_STORAGE_ACCESS_KEY_ID=STORAGE_ACCESS_KEY_ID).
 * Only renamed keys are written when renames are given. Comments and order are kept.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatValue, parseEnv } from "./env-sync.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function setEnvValues(text: string, updates: Map<string, string>): string {
  const pending = new Map(updates);
  const lines = text.split(/\r?\n/).map((line) => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!m || !pending.has(m[1])) return line;
    const key = m[1];
    const value = pending.get(key)!;
    pending.delete(key);
    return `${key}=${formatValue(value)}`;
  });
  if (pending.size) {
    if (lines.at(-1) === "") lines.pop();
    lines.push("", "# added by pnpm env:set");
    for (const [key, value] of pending) lines.push(`${key}=${formatValue(value)}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) {
    console.error("✖ No .env file yet. Copy .env.example to .env first:\n    cp .env.example .env");
    process.exit(1);
  }
  const renames = new Map(process.argv.slice(2).map((arg) => arg.split("=", 2) as [string, string]));
  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  const updates = new Map<string, string>();
  for (const [key, value] of parseEnv(input)) {
    if (renames.size && !renames.has(key)) continue;
    updates.set(renames.get(key) ?? key, value);
  }
  if (!updates.size) {
    console.error("✖ Nothing to set (no KEY=VALUE lines received). .env was not changed.");
    process.exit(1);
  }
  writeFileSync(envPath, setEnvValues(readFileSync(envPath, "utf8"), updates));
  for (const [key, value] of updates) console.log(`✔ .env: ${key} set (${value.length} characters)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
