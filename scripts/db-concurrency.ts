/**
 * Concurrency checks that pgTAP can't do (it runs in one connection).
 *
 *   Number series: 50 parallel "finalize" transactions, ~30% of which roll back.
 *   The committed numbers must be exactly 1..N with no gaps and no duplicates.
 *   Slot capacity: 10 parallel bookings into one 3-place slot → exactly 3 succeed.
 *
 * Fixtures use a test-only doctor/staff and a far-future date, and are deleted afterwards.
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
  await slotCapacity();
}

const IDS = {
  staff: "99999999-0000-4000-a000-00000000000a",
  doctor: "99999999-2222-4000-a000-00000000000a",
};
const SLOT = "2031-01-06 10:00+05:30"; // a Monday, far in the future

async function slotCapacity() {
  const setup = new pg.Client({ connectionString: url });
  await setup.connect();
  const cleanup = async () => {
    await setup.query("delete from public.appointments where doctor_id = $1", [IDS.doctor]);
    await setup.query("delete from public.patients where uhid like 'CONC-%'");
    await setup.query("delete from public.doctor_schedules where doctor_id = $1", [IDS.doctor]);
    await setup.query("delete from public.doctors where id = $1", [IDS.doctor]);
    await setup.query("delete from public.staff where id = $1", [IDS.staff]);
    await setup.query("delete from auth.users where id = $1", [IDS.staff]);
  };
  await cleanup();
  await setup.query("insert into auth.users (id, email) values ($1, 'conc-rec@staff.invalid')", [IDS.staff]);
  await setup.query("insert into public.staff (id, role, full_name, username) values ($1, 'receptionist', 'Conc Rec', 'concrec')", [IDS.staff]);
  await setup.query("insert into public.doctors (id, full_name, slot_minutes, capacity_override) values ($1, 'Dr Conc', 15, 3)", [IDS.doctor]);
  await setup.query("insert into public.doctor_schedules (doctor_id, weekday, start_time, end_time) values ($1, 1, '10:00', '11:00')", [IDS.doctor]);
  const { rows: patients } = await setup.query<{ id: string }>(
    "insert into public.patients (uhid, full_name) select 'CONC-' || n, 'Conc ' || n from generate_series(1, 10) n returning id",
  );

  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const results = await Promise.all(
    patients.map(async (p) => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: IDS.staff, role: "authenticated" })]);
        await client.query("set local role authenticated");
        await client.query("select public.book_appointment($1::jsonb, gen_random_uuid())", [
          JSON.stringify({ patient_id: p.id, doctor_id: IDS.doctor, slot_start: SLOT }),
        ]);
        await client.query("commit");
        return "booked";
      } catch (e) {
        await client.query("rollback");
        return (e as Error).message;
      } finally {
        client.release();
      }
    }),
  );
  await pool.end();
  const { rows } = await setup.query<{ n: number }>(
    "select count(*)::int as n from public.appointments where doctor_id = $1 and status not in ('cancelled', 'rescheduled')",
    [IDS.doctor],
  );
  await cleanup();
  await setup.end();

  const booked = results.filter((r) => r === "booked").length;
  const full = results.filter((r) => r === "slot_full").length;
  console.log(`${booked} booked, ${full} told "slot full", ${10 - booked - full} other; ${rows[0]!.n} in the database`);
  if (booked !== 3 || full !== 7 || rows[0]!.n !== 3) {
    console.error("✖ slot capacity broke under parallel bookings");
    process.exit(1);
  }
  console.log("✔ slot capacity: exactly 3 of 10 parallel bookings into a 3-place slot");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
