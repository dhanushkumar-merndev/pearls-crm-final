/**
 * Concurrency checks that pgTAP can't do (it runs in one connection).
 *
 *   Number series: 50 parallel "finalize" transactions, ~30% of which roll back.
 *   The committed numbers must be exactly 1..N with no gaps and no duplicates.
 *   Slot capacity: 10 parallel bookings into one 3-place slot → exactly 3 succeed.
 *   Last unit: 2 desks finalize a pharmacy bill for the only strip left → exactly 1 succeeds.
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
  await lastUnit();
}

const PH = {
  item: "99999999-6666-4000-a000-0000000000cc",
  batch: "99999999-8888-4000-a000-0000000000cc",
  bills: ["99999999-2222-4000-a000-0000000000c1", "99999999-2222-4000-a000-0000000000c2"],
};

async function lastUnit() {
  const setup = new pg.Client({ connectionString: url });
  await setup.connect();
  const claims = JSON.stringify({ sub: IDS.staff, role: "authenticated" });
  // Finalized bills and ledger rows are protected by triggers; the fixtures are removed with
  // the table owner's rights, inside one transaction, and the bill counter is put back.
  const { rows: series } = await setup.query(
    "select id, next_value, last_used from public.number_series where series_key = 'pharmacy_invoice' and fy = private.series_fy('pharmacy_invoice', now())",
  );
  const cleanup = async () => {
    await setup.query("begin");
    for (const t of ["stock_movements", "bills", "bill_items", "item_batches"]) await setup.query(`alter table public.${t} disable trigger user`);
    await setup.query("delete from public.stock_movements where batch_id = $1", [PH.batch]);
    await setup.query("delete from public.bill_items where bill_id = any($1::uuid[])", [PH.bills]);
    await setup.query("delete from public.bills where id = any($1::uuid[])", [PH.bills]);
    await setup.query("delete from public.stock_alerts where item_id = $1", [PH.item]);
    await setup.query("delete from public.item_batches where id = $1", [PH.batch]);
    await setup.query("delete from public.pharmacy_items where id = $1", [PH.item]);
    for (const t of ["stock_movements", "bills", "bill_items", "item_batches"]) await setup.query(`alter table public.${t} enable trigger user`);
    await setup.query("delete from public.patients where uhid = 'CONC-PH'");
    await setup.query("delete from public.staff where id = $1", [IDS.staff]);
    await setup.query("delete from auth.users where id = $1", [IDS.staff]);
    await setup.query("commit");
  };
  await cleanup();
  await setup.query("insert into auth.users (id, email) values ($1, 'conc-rec@staff.invalid')", [IDS.staff]);
  await setup.query("insert into public.staff (id, role, full_name, username) values ($1, 'receptionist', 'Conc Rec', 'concrec')", [IDS.staff]);
  const { rows: pat } = await setup.query<{ id: string }>("insert into public.patients (uhid, full_name) values ('CONC-PH', 'Conc Pharmacy') returning id");
  await setup.query("insert into public.pharmacy_items (id, name, active) values ($1, 'CONC last strip', false)", [PH.item]);
  await setup.query("insert into public.item_batches (id, item_id, batch_no, expiry_date) values ($1, $2, 'LAST', '2099-12-31')", [PH.batch, PH.item]);
  await setup.query("insert into public.stock_movements (batch_id, kind, qty, ref_table) values ($1, 'opening', 1, 'import')", [PH.batch]);
  for (const bill of PH.bills) {
    await setup.query("begin");
    await setup.query("select set_config('request.jwt.claims', $1, true)", [claims]);
    await setup.query("set local role authenticated");
    await setup.query("select public.create_bill('pharmacy_invoice', $1, '{}', $2)", [pat[0]!.id, bill]);
    await setup.query("select public.save_bill($1, '{}', $2::jsonb, 1)", [
      bill,
      JSON.stringify([{ kind: "pharmacy", batch_id: PH.batch, description: "CONC last strip", rate_paise: 100, qty: 1 }]),
    ]);
    await setup.query("commit");
  }

  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const results = await Promise.all(
    PH.bills.map(async (bill) => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
        await client.query("set local role authenticated");
        await client.query("select public.finalize_bill($1, 2)", [bill]);
        await client.query("select pg_sleep(0.2)"); // hold the batch lock so the other desk waits
        await client.query("commit");
        return "sold";
      } catch (e) {
        await client.query("rollback");
        return (e as Error).message;
      } finally {
        client.release();
      }
    }),
  );
  await pool.end();
  const { rows: stock } = await setup.query<{ q: string }>("select qty_on_hand as q from public.item_batches where id = $1", [PH.batch]);
  await cleanup();
  // Put the bill counter back as it was (a test must not leave a gap in real numbering).
  if (series[0]) {
    await setup.query("update public.number_series set next_value = $2, last_used = $3 where id = $1", [series[0].id, series[0].next_value, series[0].last_used]);
  } else {
    await setup.query("delete from public.number_series where series_key = 'pharmacy_invoice' and fy = private.series_fy('pharmacy_invoice', now())");
  }
  await setup.end();

  const sold = results.filter((r) => r === "sold").length;
  const refused = results.filter((r) => r === "stock_insufficient").length;
  console.log(`${sold} sold, ${refused} told "not enough stock"; ${stock[0]?.q} left`);
  if (sold !== 1 || refused !== 1 || Number(stock[0]?.q) !== 0) {
    console.error("✖ the last unit was sold twice (or not at all) under parallel finalizes");
    process.exit(1);
  }
  console.log("✔ last unit: exactly 1 of 2 parallel sales succeeds");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
