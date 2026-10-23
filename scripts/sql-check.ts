/**
 * Runs a SQL file (e.g. a new migration) against DATABASE_URL inside a transaction that
 * is always rolled back, and reports the line of the first error (pnpm sql:check <file>).
 * Unpushed migrations before it are applied first, so it sees the schema it will run on.
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import pg from "pg";
import { need, project, root } from "./supabase-api.ts";

const file = process.argv[2];
if (!file) {
  console.error("usage: pnpm sql:check <file.sql>");
  process.exit(1);
}
const { env } = project();
const [databaseUrl] = need(env, "DATABASE_URL");
const sql = readFileSync(file, "utf8");
const db = new pg.Client({ connectionString: databaseUrl });
await db.connect();
try {
  await db.query("begin");
  const { rows } = await db.query<{ version: string }>("select version from supabase_migrations.schema_migrations");
  const applied = new Set(rows.map((r) => r.version));
  const dir = resolve(root, "supabase/migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql") && !applied.has(f.split("_")[0]!) && f < basename(file)).sort()) {
    await db.query(readFileSync(resolve(dir, f), "utf8"));
  }
  await db.query(sql);
  console.log(`✔ ${file} runs cleanly (rolled back)`);
} catch (e) {
  const err = e as { message: string; position?: string; where?: string };
  const line = sql.slice(0, Number(err.position ?? 0)).split("\n").length;
  console.error(`✖ ${err.message}${err.position ? ` — line ${line}` : ""}${err.where ? `\n  ${err.where}` : ""}`);
  if (err.position) console.error(sql.split("\n").slice(Math.max(0, line - 4), line + 1).map((l, i) => `${line - 3 + i}: ${l}`).join("\n"));
  process.exitCode = 1;
} finally {
  await db.query("rollback").catch(() => {});
  await db.end();
}
