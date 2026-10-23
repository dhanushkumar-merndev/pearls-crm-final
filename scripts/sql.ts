/**
 * Runs SQL against DATABASE_URL and prints the rows as JSON, for checking the online
 * project without Docker or psql. Always rolled back, so it never changes anything.
 *   pnpm sql "select …"              read-only transaction
 *   pnpm sql --pending "select …"    first applies migrations not yet online (then rolls back)
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { need, project, root } from "./supabase-api.ts";

const { env } = project();
const [databaseUrl] = need(env, "DATABASE_URL");
const args = process.argv.slice(2);
const withPending = args[0] === "--pending";
const sql = (withPending ? args.slice(1) : args).join(" ");

const db = new pg.Client({ connectionString: databaseUrl });
await db.connect();
try {
  if (withPending) {
    await db.query("begin");
    const { rows } = await db.query<{ version: string }>("select version from supabase_migrations.schema_migrations");
    const applied = new Set(rows.map((r) => r.version));
    const dir = resolve(root, "supabase/migrations");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql") && !applied.has(f.split("_")[0]!)).sort()) {
      await db.query(readFileSync(resolve(dir, f), "utf8"));
    }
  } else {
    await db.query("begin transaction read only");
  }
  const result = await db.query(sql);
  const last = Array.isArray(result) ? result.at(-1) : result;
  console.log(JSON.stringify(last.rows, null, 2));
} finally {
  await db.query("rollback").catch(() => {});
  await db.end();
}
