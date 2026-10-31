import { expect, test, type Page } from "@playwright/test";
import { open, randomUUID, STATE } from "./helpers";

// W-REC-17: reception checks a QR self-registration (Check & save) or discards it with a reason.
// A real form needs the captcha on the patient's phone (HAND_TEST, M-06) and the server rules are in
// 04_patients (DB), so here the pending form is answered in the browser: nothing is saved anywhere.
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.use({ storageState: STATE.reception });

const id = randomUUID();
const form = { id, full_name: "E2E Self Reg", payload: { full_name: "E2E Self Reg", phone_e164: "+919811122233" }, created_at: new Date().toISOString() };

async function fakePending(page: Page) {
  await page.route(/\/rest\/v1\/rpc\/pending_registrations/, (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [form], next_cursor: null }) }),
  );
}

test("self-registration: listed; discard needs a reason, then it goes", async ({ page }) => {
  await fakePending(page);
  let discarded: { p_request_id?: string; p_reason?: string } | null = null;
  await page.route(/\/rest\/v1\/rpc\/discard_registration/, async (r) => {
    discarded = r.request().postDataJSON();
    await r.fulfill({ contentType: "application/json", body: "null" });
  });
  await open(page, "/patients/pending");
  const row = page.getByRole("row").filter({ hasText: "E2E Self Reg" });
  await expect(row).toContainText("+919811122233");

  await row.getByRole("button", { name: "Discard" }).click();
  const dialog = page.getByRole("dialog", { name: "Discard E2E Self Reg's form?" });
  await dialog.getByRole("button", { name: "Discard" }).click();
  await expect(dialog.getByLabel("Reason")).toHaveAttribute("aria-invalid", "true");
  expect(discarded).toBeNull(); // the empty reason never left the browser

  await dialog.getByLabel("Reason").fill("E2E test entry");
  await dialog.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByText("Discarded ✓").first()).toBeVisible();
  expect(discarded).toEqual({ p_request_id: id, p_reason: "E2E test entry" });
});

test("self-registration: Check & save opens the patient form filled from what they typed", async ({ page }) => {
  await fakePending(page);
  await page.route(/\/rest\/v1\/registration_requests\?/, (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ id, payload: form.payload, status: "pending" }) }),
  );
  await open(page, "/patients/pending");
  await page.getByRole("row").filter({ hasText: "E2E Self Reg" }).getByRole("link", { name: "Check & save" }).click();
  await expect(page).toHaveURL(new RegExp(`/patients/new\\?request=${id}$`));
  await expect(page.getByLabel("Full name")).toHaveValue("E2E Self Reg");
  await expect(page.getByLabel("Mobile number")).toHaveValue(/9811122233/);
});

test("self-registration: nothing waiting says so", async ({ page }) => {
  await page.route(/\/rest\/v1\/rpc\/pending_registrations/, (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [], next_cursor: null }) }),
  );
  await open(page, "/patients/pending");
  await expect(page.getByText("Nothing waiting. 🎉")).toBeVisible();
});
