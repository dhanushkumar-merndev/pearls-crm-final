/**
 * Concurrency checks that pgTAP can't do (it runs in one connection).
 *
 *   Number series: 50 parallel "finalize" transactions, ~30% of which roll back.
 *   The committed numbers must be exactly 1..N with no gaps and no duplicates.
 *
 * Run against local Supabase (pnpm db:start first):  pnpm db:concurrency
 * Override the database with DATABASE_URL.
 */
import pg from "pg";

const url = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const PARALLEL = 50;
const SERIES_FY = "2099-00"; // a test-only financial year (FY starting April 2099)
const AT = "2099-06-01T06:00:00Z";

async function main() {
  const setup = new pg.Client({ connectionString: url });
  await setup.connect();
  await setup.query(
    `delete from public.number_series where series_key = 'final_bill' and fy = $1`,
    [SERIES_FY],
  );
  await setup.query(
    `insert into public.number_series (series_key, fy, prefix, format, next_value)
     values ('final_bill', $1, 'CC', '{prefix}/{fy}/{n}', 1)`,
    [SERIES_FY],
  );

  const pool = new pg.Pool({ connectionString: url, max: PARALLEL });
  const committed: number[] = [];
  let rolledBack = 0;

  await Promise.all(
    Array.from({ length: PARALLEL }, async (_, i) => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const { rows } = await client.query<{ n: string }>(
          `select private.take_number('final_bill', $1::timestamptz) as n`,
          [AT],
        );
        // Hold the lock a moment so transactions genuinely overlap.
        await client.query("select pg_sleep(0.01)");
        if (i % 3 === 0) {
          await client.query("rollback");
          rolledBack++;
        } else {
          await client.query("commit");
          committed.push(Number(rows[0]!.n.split("/").pop()));
        }
      } finally {
        client.release();
      }
    }),
  );
  await pool.end();

  const sorted = [...committed].sort((a, b) => a - b);
  const expected = Array.from({ length: sorted.length }, (_, i) => i + 1);
  const ok = JSON.stringify(sorted) === JSON.stringify(expected);
  const { rows } = await setup.query(
    `select next_value, last_used from public.number_series where series_key = 'final_bill' and fy = $1`,
    [SERIES_FY],
  );
  await setup.query(`delete from public.number_series where series_key = 'final_bill' and fy = $1`, [
    SERIES_FY,
  ]);
  await setup.end();

  console.log(
    `${committed.length} committed, ${rolledBack} rolled back → numbers ${sorted[0]}..${sorted.at(-1)}; series next_value=${rows[0]?.next_value}`,
  );
  if (!ok || Number(rows[0]?.next_value) !== committed.length + 1) {
    console.error("✖ number series has gaps or duplicates under concurrency");
    process.exit(1);
  }
  console.log("✔ number series: gap-free and unique under 50 parallel finalizes");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
