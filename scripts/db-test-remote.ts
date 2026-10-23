/**
 * Runs the pgTAP files in supabase/tests/database against the online project over
 * DATABASE_URL (pnpm db:test:remote), for PCs without Docker. Each file wraps itself
 * in begin … rollback, so nothing is left behind.
 * A file passes when no line says "not ok" and the number of tests matches its plan.
 *
 * Migrations not yet applied online are run first INSIDE the same transaction, so new
 * schema can be tested before `pnpm deploy:supabase` ever touches the project.
 *   pnpm db:test:remote [name-filter]
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { need, project, root } from "./supabase-api.ts";

const { env } = project();
const [databaseUrl] = need(env, "DATABASE_URL");
const dir = resolve(root, "supabase/tests/database");
const filter = process.argv[2] ?? "";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql") && f.includes(filter)).sort();
const migrationsDir = resolve(root, "supabase/migrations");

async function pendingMigrations(): Promise<{ name: string; sql: string }[]> {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query<{ version: string }>(
      "select version from supabase_migrations.schema_migrations",
    ).catch(() => ({ rows: [] as { version: string }[] }));
    const applied = new Set(rows.map((r) => r.version));
    return readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql") && !applied.has(f.split("_")[0]!))
      .sort()
      .map((name) => ({ name, sql: readFileSync(resolve(migrationsDir, name), "utf8") }));
  } finally {
    await db.end();
  }
}

const pending = await pendingMigrations();
if (pending.length) console.log(`• testing ${pending.length} migration(s) not yet online: ${pending.map((p) => p.name).join(", ")}`);

/** Every text value of every row of every statement, split into lines. */
function tapLines(result: pg.QueryResult | pg.QueryResult[]): string[] {
  const results = Array.isArray(result) ? result : [result];
  return results.flatMap((r) =>
    (r.rows ?? []).flatMap((row: Record<string, unknown>) =>
      Object.values(row).filter((v): v is string => typeof v === "string").flatMap((v) => v.split("\n")),
    ),
  );
}

let failed = 0;
for (const file of files) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("begin");
    for (const m of pending) {
      try {
        await db.query(m.sql);
      } catch (e) {
        throw new Error(`migration ${m.name}: ${(e as Error).message}`);
      }
    }
    // No parameters → simple query protocol, so the whole file runs as one script.
    // Its own "begin" only warns inside ours; its final "rollback" undoes the migrations too.
    const lines = tapLines(await db.query(readFileSync(resolve(dir, file), "utf8")));
    const planned = Number(/^1\.\.(\d+)$/m.exec(lines.join("\n"))?.[1] ?? NaN);
    const notOk = lines.filter((l) => l.startsWith("not ok"));
    const ran = lines.filter((l) => /^(not )?ok \d+/.test(l)).length;
    if (notOk.length || ran !== planned) {
      failed++;
      console.log(`✖ ${file}: ${ran - notOk.length}/${planned} passed`);
      for (const l of lines.filter((l) => l.startsWith("not ok") || l.startsWith("#"))) console.log(`    ${l}`);
    } else {
      console.log(`✔ ${file}: ${ran}/${planned} passed`);
    }
  } catch (e) {
    failed++;
    console.log(`✖ ${file}: stopped with an error: ${(e as Error).message}`);
    await db.query("rollback").catch(() => {});
  } finally {
    await db.end();
  }
}

if (failed) {
  console.error(`\n✖ ${failed} of ${files.length} test files failed`);
  process.exit(1);
}
console.log(`\n✔ All ${files.length} database test files pass on the online project`);
