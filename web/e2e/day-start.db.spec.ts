import { expect, test } from "@playwright/test";
import { open, randomUUID, rpcAs, STATE } from "./helpers";

// Phase 18 (owner, 02/11/2026): offices are picked on a map (search, this computer's location,
// a Google Maps link), and BDMs / sales executives can ask the admin to start the day where they
// are. The phone side and the rules are in supabase/tests/database/32_day_start_requests.test.sql.
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.use({ storageState: STATE.admin });
test.setTimeout(120_000);

test("office: use my location, search a place, or paste a Google Maps link; the circle starts at 100 m", async ({ page, context }) => {
  // No outside calls from the test: map tiles off, the place search answered here.
  await context.route("https://tiles.openfreemap.org/**", (r) => r.abort());
  await context.route("https://nominatim.openstreetmap.org/**", (r) =>
    r.fulfill({ json: [{ display_name: "E2E Place, Jayanagar, Bengaluru", lat: "12.9301", lon: "77.5834" }] }),
  );
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 12.9373626, longitude: 77.5582325, accuracy: 20 });

  const name = `E2E Picked Office ${Date.now()}`;
  await open(page, "/admin/libraries/offices");
  await page.getByRole("button", { name: "Add office" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Circle (metres)")).toHaveValue("100");
  const pin = dialog.getByTestId("office-pin");
  await expect(pin).toContainText("No pin yet");

  await dialog.getByRole("button", { name: "Use my current location" }).click();
  await expect(pin).toContainText("Pin 12.937363, 77.558233 · circle 100 m");
  await expect(pin).toContainText("± 20 m");
  await expect(dialog.getByLabel("Latitude")).toHaveValue("12.9373626");

  const search = dialog.getByLabel("Search a place");
  await search.fill("ab");
  await search.press("Enter");
  await expect(dialog.getByText("Type at least 3 letters.")).toBeVisible();
  await search.fill("E2E Place");
  await search.press("Enter");
  await dialog.getByRole("button", { name: /E2E Place, Jayanagar/ }).click();
  await expect(dialog.getByLabel("Longitude")).toHaveValue("77.5834");

  const link = dialog.getByLabel("Or paste a Google Maps link");
  await link.fill("hello");
  await dialog.getByRole("button", { name: "Use link" }).click();
  await expect(dialog.getByText("Paste a Google Maps link (https://maps.app.goo.gl/…) or two numbers.")).toBeVisible();
  // The pin of the place, not the centre of the map view (@…).
  await link.fill("https://www.google.com/maps/place/X/@12.90,77.50,15z/data=!8m2!3d12.95!4d77.56");
  await dialog.getByRole("button", { name: "Use link" }).click();
  await expect(dialog.getByLabel("Latitude")).toHaveValue("12.95");
  await expect(dialog.getByLabel("Longitude")).toHaveValue("77.56");

  await dialog.getByLabel("Office name").fill(name);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved ✓")).toBeVisible();
  await page.getByLabel("Search Offices").fill(name);
  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row).toContainText("12.95, 77.56");
  await expect(row).toContainText("100 m");
  // Leave the staging offices as they were: this one is only for the test.
  await row.getByRole("button", { name: /Edit/ }).click();
  await page.getByRole("dialog").getByText("Active (shown in pickers)").click();
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved ✓").first()).toBeVisible();
});

test("the Google Maps link reader: admins only, and it reads a full link without going out", async ({ page, browser, baseURL }) => {
  await open(page, "/admin");
  const ok = await page.request.post("/api/maps-link", { data: { link: "https://www.google.com/maps/place/Y/data=!3d12.9373626!4d77.5582325" } });
  expect(await ok.json()).toEqual({ lat: 12.9373626, lng: 77.5582325 });
  const bad = await page.request.post("/api/maps-link", { data: { link: "https://example.com/x" } });
  expect(bad.status()).toBe(400);
  const nobody = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  // Not signed in: sent to the login page, or refused.
  const res = await nobody.request.post("/api/maps-link", { data: { link: "https://maps.app.goo.gl/x" }, maxRedirects: 0 });
  expect([302, 303, 307, 403]).toContain(res.status());
  await nobody.close();
});

test("a sales executive asks to start away; the admin needs a note to say no, then approves the next ask", async ({ page, browser }) => {
  const salesCtx = await browser.newContext({ storageState: STATE.sales });
  // Only their login is used (sales executives work in the phone app).
  const sales = await salesCtx.newPage();
  type Req = { id: string; name: string; status: string };
  const ask = (reason: string) =>
    rpcAs<Req>(sales, "day_start_request", { p: { client_id: randomUUID(), lat: 12.9806, lng: 77.5946, accuracy: 15, reason } });
  let first: Req;
  try {
    first = await ask(`E2E working from a client site ${Date.now()}`);
  } catch (e) {
    // The phone tests (same test login) may have started today's day already: nothing to ask.
    await salesCtx.close();
    test.skip(String(e).includes("day_already_started"), "the test sales login already started today's day");
    throw e;
  }

  await open(page, "/bdm");
  const card = page.getByRole("region", { name: "Start-day requests" });
  await expect(card).toBeVisible();
  const mine = card.getByRole("listitem", { name: `Request from ${first.name}` }).first();
  if (first.status !== "pending") {
    // Approved by an earlier run today (one open request a day): it is listed as such.
    await expect(mine).toContainText(/Approved|Day started/);
    await salesCtx.close();
    return;
  }
  await expect(mine).toContainText("Waiting");
  await expect(mine).toContainText(/from /);

  await mine.getByRole("button", { name: `Decline ${first.name}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Decline" }).click();
  await expect(dialog.getByText("Please fill this in.")).toBeVisible();
  await dialog.getByLabel("Note for them").fill("Please come to the office first");
  await dialog.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByText("Declined ✓ They see your note.")).toBeVisible();
  const today = await rpcAs<{ start_request: { status: string; decline_note: string } }>(sales, "bdm_today", {});
  expect(today.start_request).toMatchObject({ status: "declined", decline_note: "Please come to the office first" });

  const second = await ask("E2E asked again");
  expect(second.status).toBe("pending");
  await page.reload();
  await card.getByRole("button", { name: `Approve ${second.name}` }).first().click();
  await expect(page.getByText("Approved ✓ They can start the day now.")).toBeVisible();
  const after = await rpcAs<{ start_request: { status: string } }>(sales, "bdm_today", {});
  expect(after.start_request.status).toBe("approved");
  await salesCtx.close();
});
