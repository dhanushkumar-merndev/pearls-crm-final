/**
 * Restores a Backup centre copy (dev-docs/OPERATIONS.md section 4) into a database: the drill that
 * proves the weekly backups work, and the real thing after a disaster.
 *
 *   pnpm restore:drill "<backup folder>"            DRILL on DATABASE_URL: everything below happens in
 *                                                   ONE transaction that is always rolled back
 *   pnpm restore:drill "<backup folder>" --commit   REAL restore into RESTORE_DATABASE_URL (a new, empty
 *                                                   project with the migrations applied); also uploads the
 *                                                   files with RESTORE_SUPABASE_URL + RESTORE_SERVICE_ROLE_KEY
 *   --stamp <name>                                  a particular export (default: the newest in database/)
 *
 * Steps:
 *   1. every exported table file is checked against manifest.json (rows, SHA-256);
 *   2. every file the database lists as stored is looked for in the folder and its SHA-256 checked;
 *   3. the tables are emptied and loaded from the export in foreign-key order (links that go round in
 *      a circle are filled in afterwards), with the tables' own triggers off so nothing is re-numbered,
 *      re-audited or re-sent; logins missing from Auth are created with RESTORE_TEMP_PASSWORD;
 *   4. every table's rows are compared with the export, value for value.
 * A drill locks the tables for its minute or two: run it on staging, never on the clinic's project.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import { loadEnv } from "./env-sync.ts";

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const stampArg = args.includes("--stamp") ? args[args.indexOf("--stamp") + 1] : undefined;
const folder = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--stamp");
if (!folder || !existsSync(folder)) {
  console.error('✖ give the backup folder: pnpm restore:drill "/media/usb/Clinic CRM backup" [--commit]');
  process.exit(1);
}
const env = loadEnv();
const url = env.get(commit ? "RESTORE_DATABASE_URL" : "DATABASE_URL");
if (!url) {
  console.error(`✖ ${commit ? "RESTORE_DATABASE_URL" : "DATABASE_URL"} missing in .env`);
  process.exit(1);
}
if (commit && url === env.get("DATABASE_URL")) {
  console.error("✖ RESTORE_DATABASE_URL is the same database as DATABASE_URL; a restore goes into a NEW project");
  process.exit(1);
}

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");
let problems = 0;
const fail = (msg: string) => {
  problems++;
  console.log(`  ✖ ${msg}`);
};

// ── 1. The export files ─────────────────────────────────────────────────────────────────────────
const dbDir = join(folder, "database");
const stamps = existsSync(dbDir) ? readdirSync(dbDir).filter((d) => existsSync(join(dbDir, d, "manifest.json"))).sort() : [];
const stamp = stampArg ?? stamps.at(-1);
if (!stamp || !existsSync(join(dbDir, stamp, "manifest.json"))) {
  console.error(`✖ no database export in ${dbDir} (Backup centre → Export the database)`);
  process.exit(1);
}
type Entry = { table: string; rows: number; bytes: number; sha256: string; path: string };
const manifest = JSON.parse(readFileSync(join(dbDir, stamp, "manifest.json"), "utf8")) as { stamp: string; tables: Entry[] };
console.log(`• export ${stamp}: ${manifest.tables.length} tables`);
const rowsOf = new Map<string, Record<string, unknown>[]>();
for (const e of manifest.tables) {
  const file = join(folder, e.path);
  if (!existsSync(file)) {
    fail(`${e.path} is missing`);
    continue;
  }
  const buf = readFileSync(file);
  if (sha256(buf) !== e.sha256) fail(`${e.path} has changed since it was exported (SHA-256 differs)`);
  const lines = buf.toString("utf8").split("\n").filter(Boolean);
  if (lines.length !== e.rows) fail(`${e.path} has ${lines.length} rows, the manifest says ${e.rows}`);
  rowsOf.set(e.table, lines.map((l) => JSON.parse(l) as Record<string, unknown>));
}
if (problems) {
  console.error(`✖ the export is damaged (${problems}); try an older one with --stamp (${stamps.join(", ")})`);
  process.exit(1);
}
console.log("  ✔ every table file matches the manifest");

// ── 2. The stored files ─────────────────────────────────────────────────────────────────────────
type FileRow = { id: string; bucket: string; object_key: string; status: string; sha256: string | null; backup_item_id: string | null };
const items = new Map((rowsOf.get("backup_items") ?? []).map((i) => [i.id as string, i as { rel_path: string | null; verified_at: string | null }]));
const stored = ((rowsOf.get("files") ?? []) as FileRow[]).filter((f) => f.status !== "deleted");
const copies: { file: FileRow; path: string }[] = [];
let notBacked = 0;
for (const f of stored) {
  const item = f.backup_item_id ? items.get(f.backup_item_id) : undefined;
  const path = item?.rel_path ? join(folder, item.rel_path) : null;
  if (!path || !item?.verified_at || !existsSync(path)) {
    notBacked++;
    continue;
  }
  if (f.sha256 && sha256(readFileSync(path)) !== f.sha256) fail(`${item.rel_path} differs from the original (SHA-256)`);
  else copies.push({ file: f, path });
}
console.log(`• files: ${stored.length} stored, ${copies.length} with a good copy in this folder` +
  (notBacked ? `, ${notBacked} without one yet (Backup centre → Copy files)` : ""));

// ── 3. Load ──────────────────────────────────────────────────────────────────────────────────────
const db = new pg.Client({ connectionString: url, statement_timeout: 900_000 });
await db.connect();
const t0 = Date.now();
try {
  await db.query("begin");
  const { rows: tables } = await db.query<{ name: string }>(
    "select c.relname as name from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by 1");
  const here = new Set(tables.map((t) => t.name));
  for (const t of rowsOf.keys()) if (!here.has(t)) console.log(`  ! ${t} is in the export but no longer in the database (skipped)`);
  for (const t of here) if (!rowsOf.has(t)) console.log(`  ! ${t} is not in the export (left empty)`);
  const load = [...rowsOf.keys()].filter((t) => here.has(t));

  if (commit) {
    const { rows } = await db.query<{ n: string }>("select count(*) as n from public.patients");
    if (Number(rows[0]!.n) > 0) throw new Error("the target database already has patients; a restore goes into a NEW project");
  }

  // Columns (not generated), primary keys and foreign keys between the loaded tables.
  const { rows: cols } = await db.query<{ tbl: string; col: string; nullable: boolean; identity: boolean }>(`
    select c.relname as tbl, a.attname as col, not a.attnotnull as nullable, a.attidentity = 'a' as identity
    from pg_attribute a join pg_class c on c.oid = a.attrelid
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
      and a.attgenerated = ''`);
  const { rows: pks } = await db.query<{ tbl: string; cols: string[] }>(`
    select c.relname as tbl, array_agg(a.attname::text order by a.attnum) as cols
    from pg_index i join pg_class c on c.oid = i.indrelid join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
    where i.indisprimary and c.relnamespace = 'public'::regnamespace group by c.relname`);
  const { rows: fks } = await db.query<{ src: string; dst: string; cols: string[] }>(`
    select s.relname as src, d.relname as dst, array_agg(a.attname::text order by a.attnum) as cols
    from pg_constraint k join pg_class s on s.oid = k.conrelid join pg_class d on d.oid = k.confrelid
    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
    where k.contype = 'f' and s.relnamespace = 'public'::regnamespace and d.relnamespace = 'public'::regnamespace
    group by k.oid, s.relname, d.relname`);
  // Columns a CHECK looks at can't be left empty for a moment either.
  const { rows: checked } = await db.query<{ tbl: string; col: string }>(`
    select distinct s.relname as tbl, a.attname::text as col
    from pg_constraint k join pg_class s on s.oid = k.conrelid join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
    where k.contype = 'c' and s.relnamespace = 'public'::regnamespace`);
  const colsOf = (t: string) => cols.filter((c) => c.tbl === t);
  const pkOf = new Map(pks.map((p) => [p.tbl, p.cols]));

  // Foreign-key order; in a circle, the links to tables not loaded yet are filled in afterwards.
  const order: string[] = [];
  const later = new Map<string, Set<string>>();
  const left = new Set(load);
  while (left.size) {
    const openCols = (t: string) => fks.filter((f) => f.src === t && f.dst !== t && left.has(f.dst)).flatMap((f) => f.cols);
    const ready = [...left].filter((t) => openCols(t).length === 0);
    // Stuck in a circle: load next the table with the fewest open links that may be empty for a moment.
    const optional = (t: string) =>
      openCols(t).every((c) => colsOf(t).find((x) => x.col === c)?.nullable && !checked.some((k) => k.tbl === t && k.col === c));
    const pick = ready.length ? ready : [[...left].filter(optional).sort((a, b) => openCols(a).length - openCols(b).length)[0]
      ?? [...left][0]!];
    for (const t of pick) {
      const open = openCols(t);
      if (open.length) later.set(t, new Set(open));
      order.push(t);
      left.delete(t);
    }
  }

  const list = load.map((t) => `public.${pg.escapeIdentifier(t)}`).join(", ");
  for (const t of load) await db.query(`alter table public.${pg.escapeIdentifier(t)} disable trigger user`);
  await db.query(`truncate ${list} restart identity cascade`);

  // Logins: Auth needs a user for every staff member (a new project has none).
  const staff = (rowsOf.get("staff") ?? []) as { id: string; username: string }[];
  const { rows: haveAuth } = await db.query<{ id: string }>("select id::text from auth.users where id = any($1::uuid[])", [staff.map((s) => s.id)]);
  const missing = staff.filter((s) => !haveAuth.some((h) => h.id === s.id));
  if (missing.length) {
    const temp = env.get("RESTORE_TEMP_PASSWORD");
    if (!temp || temp.length < 10) throw new Error(`${missing.length} logins need RESTORE_TEMP_PASSWORD (10+ characters) in .env`);
    for (const s of missing) {
      await db.query(`
        insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
                                raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
                extensions.crypt($3, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}',
                now(), now(), '', '', '', '')`, [s.id, `${s.username}@staff.invalid`, temp]);
      await db.query(`
        insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        values (gen_random_uuid(), $1, $1::text, jsonb_build_object('sub', $1::text, 'email', $2::text), 'email', now(), now(), now())`,
        [s.id, `${s.username}@staff.invalid`]);
    }
    console.log(`  • ${missing.length} logins created with the temporary password`);
  }

  for (const t of order) {
    const rows = rowsOf.get(t)!;
    if (!rows.length) continue;
    const keys = new Set(Object.keys(rows[0]!));
    const use = colsOf(t).filter((c) => keys.has(c.col));
    const defer = later.get(t) ?? new Set<string>();
    for (const c of use) if (defer.has(c.col) && !c.nullable) throw new Error(`${t}.${c.col} is part of a circle of links but required`);
    const q = (c: string) => pg.escapeIdentifier(c);
    const sql = `insert into public.${q(t)} (${use.map((c) => q(c.col)).join(", ")})
      ${use.some((c) => c.identity) ? "overriding system value" : ""}
      select ${use.map((c) => (defer.has(c.col) ? "null" : `r.${q(c.col)}`)).join(", ")}
      from jsonb_populate_recordset(null::public.${q(t)}, $1::jsonb) r`;
    for (let i = 0; i < rows.length; i += 1000) await db.query(sql, [JSON.stringify(rows.slice(i, i + 1000))]);
  }
  for (const [t, deferred] of later) {
    const rows = rowsOf.get(t)!;
    const pk = pkOf.get(t);
    if (!rows.length) continue;
    if (!pk) throw new Error(`${t} has no primary key to fill in its links`);
    const q = (c: string) => pg.escapeIdentifier(c);
    const sql = `update public.${q(t)} x set ${[...deferred].map((c) => `${q(c)} = r.${q(c)}`).join(", ")}
      from jsonb_populate_recordset(null::public.${q(t)}, $1::jsonb) r where ${pk.map((c) => `x.${q(c)} = r.${q(c)}`).join(" and ")}`;
    for (let i = 0; i < rows.length; i += 1000) await db.query(sql, [JSON.stringify(rows.slice(i, i + 1000))]);
  }
  for (const t of load) await db.query(`alter table public.${pg.escapeIdentifier(t)} enable trigger user`);
  // Counters behind identity / serial columns carry on after the restored rows.
  await db.query(`
    do $$ declare r record; begin
      for r in select c.relname as tbl, a.attname as col, pg_get_serial_sequence(format('public.%I', c.relname), a.attname) as seq
               from pg_attribute a join pg_class c on c.oid = a.attrelid
               where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
      loop
        if r.seq is not null then
          execute format('select setval(%L, coalesce((select max(%I) from public.%I), 0) + 1, false)', r.seq, r.col, r.tbl);
        end if;
      end loop;
    end $$`);
  console.log(`  ✔ ${order.length} tables loaded in ${((Date.now() - t0) / 1000).toFixed(0)} s` +
    (later.size ? ` (links filled in afterwards: ${[...later].map(([t, c]) => `${t}.${[...c].join("/")}`).join(", ")})` : ""));

  // ── 4. Check ──────────────────────────────────────────────────────────────────────────────────
  // Every row exactly as exported (same values in every column), unless the table has changed shape since.
  let same = 0;
  for (const e of manifest.tables.filter((e) => here.has(e.table))) {
    const { rows } = await db.query<{ j: Record<string, unknown> }>(`select to_jsonb(t) as j from public.${pg.escapeIdentifier(e.table)} t`);
    if (rows.length !== e.rows) {
      fail(`${e.table}: ${rows.length} rows after the restore, ${e.rows} exported`);
      continue;
    }
    const exported = rowsOf.get(e.table)!;
    if (exported.length && Object.keys(exported[0]!).sort().join() !== Object.keys(rows[0]!.j).sort().join()) continue;
    const digest = (list: Record<string, unknown>[]) =>
      sha256(Buffer.from(list.map((r) => JSON.stringify(r, Object.keys(r).sort())).sort().join("\n")));
    if (digest(rows.map((r) => r.j)) !== digest(exported)) fail(`${e.table}: the restored rows differ from the export`);
    else same++;
  }
  if (problems) throw new Error(`${problems} problem(s)`);
  const { rows: sum } = await db.query<{ patients: string; bills: string; leads: string }>(
    "select (select count(*) from public.patients) as patients, (select count(*) from public.bills) as bills, (select count(*) from public.leads) as leads");
  console.log(`  ✔ every table has its exported rows; ${same} checked value for value (patients ${sum[0]!.patients}, bills ${sum[0]!.bills}, leads ${sum[0]!.leads})`);

  if (!commit) {
    await db.query("rollback");
    console.log("\n✔ DRILL PASSED: this backup restores completely. Nothing was changed (rolled back).");
  } else {
    await db.query("commit");
    console.log("\n✔ database restored.");
  }
} catch (e) {
  await db.query("rollback").catch(() => {});
  console.error(`\n✖ restore failed, nothing was changed: ${(e as Error).message}`);
  process.exit(1);
} finally {
  await db.end();
}

// ── Files (real restore only) ─────────────────────────────────────────────────────────────────────
if (commit && copies.length) {
  const [base, key] = [env.get("RESTORE_SUPABASE_URL"), env.get("RESTORE_SERVICE_ROLE_KEY")];
  if (!base || !key) {
    console.error("✖ to upload the files, add RESTORE_SUPABASE_URL and RESTORE_SERVICE_ROLE_KEY to .env and run again");
    process.exit(1);
  }
  let up = 0;
  for (const { file, path } of copies) {
    const res = await fetch(`${base}/storage/v1/object/${file.bucket}/${file.object_key.split("/").map(encodeURIComponent).join("/")}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "x-upsert": "true", "content-type": "application/octet-stream" },
      body: readFileSync(resolve(path)),
    });
    if (res.ok) up++;
    else fail(`${file.object_key}: upload failed (${res.status})`);
  }
  console.log(`✔ ${up} of ${copies.length} files uploaded`);
  if (problems) process.exit(1);
}
