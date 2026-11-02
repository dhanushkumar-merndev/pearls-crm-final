import { expect, test, type Page, type Request } from "@playwright/test";
import { open, randomUUID, STATE } from "./helpers";

// Auto-cancelled bookings (not confirmed in time): the reception home card, the alert's link to the
// filtered table, "Restore & confirm" and "Leave cancelled". The server's rules (who may, slot still
// free, YES on WhatsApp) are tested in supabase/tests/database/27_auto_cancel.test.sql; here the
// booking is supplied by intercepting the list calls, so no real booking is cancelled on staging.
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.use({ storageState: STATE.reception });
// Live refreshes can still reach an intercepted call as a test ends.
test.afterEach(async ({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

function autoCancelledCard(name: string) {
  const tomorrow = new Date(Date.now() + 26 * 3_600_000);
  tomorrow.setUTCMinutes(0, 0, 0);
  return {
    id: randomUUID(), status: "cancelled", auto_cancelled: true, slot_start: tomorrow.toISOString(), slot_end: null,
    doctor_id: null, doctor: "Dr E2E Auto", patient_id: null, lead_id: null, lead_only: false, patient: name,
    uhid: null, phone: "+919800000099", version: 3, is_walk_in: false, queue_no: null, type: "consultation",
  };
}

/** Answers set_appointment_status like the server and keeps what was sent. */
async function captureStatusCalls(page: Page) {
  const sent: Record<string, unknown>[] = [];
  await page.route("**/rest/v1/rpc/set_appointment_status", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    sent.push(body);
    await route.fulfill({ json: { id: body.p_id, status: body.p_status, version: 4 } });
  });
  return sent;
}

test("reception home: auto-cancelled card, Restore & confirm", async ({ page }) => {
  const name = `E2E Auto ${Date.now()}`;
  const card = autoCancelledCard(name);
  await page.route("**/rest/v1/rpc/today_board", async (route) => {
    const response = await route.fetch();
    const json = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...json, auto_cancelled: [card] } });
  });
  const sent = await captureStatusCalls(page);

  await open(page, "/home");
  const section = page.getByRole("region", { name: "Auto-cancelled: call back" });
  await expect(section).toBeVisible();
  await expect(section.getByText(name)).toBeVisible();
  await expect(section.getByText("Auto-cancelled (not confirmed)")).toBeVisible();

  await section.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Restore & confirm" }).click();
  await expect(page.getByText("Restored and confirmed ✓")).toBeVisible();
  expect(sent).toEqual([expect.objectContaining({ p_id: card.id, p_status: "confirmed", p_version: 3 })]);
});

test("the alert's link opens the filtered table; Leave cancelled needs a reason", async ({ page }) => {
  const name = `E2E Auto ${Date.now()}`;
  const card = autoCancelledCard(name);
  const day = "2030-01-07";
  let filters: Record<string, unknown> | null = null;
  await page.route("**/rest/v1/rpc/appointments_table", async (route) => {
    filters = ((route.request() as Request).postDataJSON() as { p_filters: Record<string, unknown> }).p_filters;
    await route.fulfill({ json: { total: 1, rows: [card] } });
  });
  const sent = await captureStatusCalls(page);

  await open(page, `/appointments?auto=1&date=${day}`);
  await expect(page.getByRole("tab", { name: "Table" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("table").getByText(name, { exact: true })).toBeVisible();
  expect(filters).toEqual({ from: day, to: day, auto_cancelled: true });
  await expect(page.getByRole("combobox", { name: "Status" })).toHaveText(/Auto-cancelled \(not confirmed\)/);

  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Leave cancelled" }).click();
  const dialog = page.getByRole("dialog", { name: "Leave this booking cancelled?" });
  await dialog.getByRole("button", { name: "Leave cancelled" }).click();
  await expect(dialog.getByLabel("Reason")).toHaveAttribute("aria-invalid", "true");
  expect(sent).toHaveLength(0);

  await dialog.getByLabel("Reason").fill("Patient will come next month");
  await dialog.getByRole("button", { name: "Leave cancelled" }).click();
  await expect(page.getByText("Left cancelled")).toBeVisible();
  expect(sent).toEqual([expect.objectContaining({ p_id: card.id, p_status: "cancelled", p_reason: "Patient will come next month" })]);
});
