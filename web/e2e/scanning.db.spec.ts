import { expect, test, type Page } from "@playwright/test";
import { open, STATE, uniquePhone } from "./helpers";

// Phase 8: scanning. Offline queue, duplicate warning, real file type, single-use phone link.
// Needs a backend (E2E_DB=1) with the phone-scan Edge Function and Tigris configured.
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.use({ storageState: STATE.reception });

async function newPatientDocuments(page: Page, label: string) {
  const name = `E2E Scan ${label} ${Date.now()}`;
  await open(page, "/patients/new");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile number").fill(uniquePhone());
  await page.getByRole("button", { name: "Save patient" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await page.getByRole("tab", { name: /Documents/ }).click();
  return name;
}

/** A fake prescription photo (drawn in the browser, so no real document is ever used). */
async function samplePhoto(page: Page, seed: number): Promise<Buffer> {
  const b64 = await page.evaluate((s) => {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 1600;
    const g = c.getContext("2d")!;
    g.fillStyle = "rgb(110, 72, 40)"; // desk
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "rgb(235, 235, 230)"; // page, a little tilted
    g.beginPath();
    g.moveTo(180, 120);
    g.lineTo(1050, 170);
    g.lineTo(1010, 1480);
    g.lineTo(140, 1430);
    g.closePath();
    g.fill();
    g.fillStyle = "rgb(30, 30, 60)"; // writing
    g.font = "48px sans-serif";
    for (let i = 0; i < 14; i++) g.fillText(`Rx ${s}-${i} tab. fake 500 mg 1-0-1`, 240, 260 + i * 80);
    return c.toDataURL("image/jpeg", 0.92).split(",")[1]!;
  }, seed);
  return Buffer.from(b64, "base64");
}

const backend = (url: URL) => url.pathname.startsWith("/rest/v1/") || url.pathname.startsWith("/functions/v1/");

test("offline: add pages → reload → online → uploaded", async ({ page, context }) => {
  await newPatientDocuments(page, "Offline");
  const photos = [await samplePhoto(page, 1), await samplePhoto(page, 2)];
  await page.getByRole("button", { name: "Add document" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Add document" })).toBeVisible();

  // No internet from here on.
  await context.setOffline(true);
  await dialog.getByLabel("Choose photos or PDF files").setInputFiles([
    { name: "page-1.jpg", mimeType: "image/jpeg", buffer: photos[0]! },
    { name: "page-2.jpg", mimeType: "image/jpeg", buffer: photos[1]! },
  ]);
  await expect(dialog.getByRole("img", { name: "Page 2" })).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel("Title").fill("E2E offline prescription");
  await dialog.getByRole("button", { name: "Save document (2 pages)" }).click();
  await expect(page.getByText(/Saved on this computer/)).toBeVisible();
  const queued = page.getByRole("region", { name: "Waiting to upload" });
  await expect(queued.getByText("E2E offline prescription")).toBeVisible();
  await expect(queued.getByText("Waiting for internet")).toBeVisible();

  // Reload while the clinic's server still can't be reached. (A browser can't reload a page
  // with no network at all, so the app server stays reachable; Supabase does not.)
  await page.route(backend, (route) => route.abort("internetdisconnected"));
  await context.setOffline(false);
  await page.reload();
  await page.getByRole("tab", { name: /Documents/ }).click();
  await expect(page.getByRole("region", { name: "Waiting to upload" }).getByText("E2E offline prescription")).toBeVisible();

  // Internet back: the queue uploads by itself.
  await page.unroute(backend);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("region", { name: "Waiting to upload" })).toHaveCount(0, { timeout: 60_000 });
  const row = page.getByRole("row", { name: /E2E offline prescription/ });
  await expect(row).toBeVisible();
  await expect(row.getByRole("cell", { name: "2", exact: true })).toBeVisible();
});

test("the same file twice → duplicate warning", async ({ page }) => {
  await newPatientDocuments(page, "Dup");
  const photo = { name: "rx.jpg", mimeType: "image/jpeg", buffer: await samplePhoto(page, 3) };

  await page.getByRole("button", { name: "Add document" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Choose photos or PDF files").setInputFiles(photo);
  await expect(dialog.getByRole("img", { name: "Page 1" })).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel("Title").fill("E2E first copy");
  await dialog.getByRole("button", { name: "Save document (1 page)" }).click();
  await expect(page.getByRole("row", { name: /E2E first copy/ })).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "Add document" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Choose photos or PDF files").setInputFiles(photo);
  await expect(dialog.getByText("Already saved as “E2E first copy”")).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", { name: "Save document (1 page)" }).click();
  await expect(dialog.getByRole("alert")).toContainText("already saved for this patient as “E2E first copy”");
  await expect(dialog.getByRole("button", { name: "Save anyway" })).toBeVisible();
});

test("the real file type is checked, not the name", async ({ page }) => {
  await newPatientDocuments(page, "Type");
  await page.getByRole("button", { name: "Add document" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Choose photos or PDF files").setInputFiles({
    name: "prescription.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("<!doctype html><script>alert(1)</script>".padEnd(64, " ")),
  });
  await expect(page.getByText("prescription.jpg: This type of file is not allowed.")).toBeVisible();
  await expect(dialog.getByRole("img", { name: "Page 1" })).toHaveCount(0);
});

test("phone scan: the link works on one phone, pages arrive live, and it stops working", async ({ page, browser }) => {
  await newPatientDocuments(page, "Phone");
  await page.getByRole("button", { name: "Add document" }).click();
  const dialog = page.getByRole("dialog");
  const started = page.waitForResponse((r) => r.url().includes("/rpc/start_phone_scan"));
  await dialog.getByRole("button", { name: "Phone", exact: true }).click();
  const { token } = (await (await started).json()) as { token: string };
  await expect(dialog.getByText("Waiting for the phone")).toBeVisible();

  const phoneA = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const phone = await phoneA.newPage();
  await phone.goto(`/scan/${token}`);
  await expect(phone.getByRole("button", { name: "Take a photo of the first page" })).toBeVisible();
  await expect(dialog.getByText(/Phone connected/)).toBeVisible();

  // Single use: a second phone is refused.
  const phoneB = await browser.newContext();
  const other = await phoneB.newPage();
  await other.goto(`/scan/${token}`);
  await expect(other.getByRole("heading", { name: "This code was opened on another phone" })).toBeVisible();
  await phoneB.close();

  // A page from the phone arrives at the desk.
  await phone.locator("input[capture]").setInputFiles({ name: "photo.jpg", mimeType: "image/jpeg", buffer: await samplePhoto(page, 4) });
  await phone.getByRole("button", { name: "Send page" }).click({ timeout: 30_000 });
  await expect(phone.getByText("Page 1 sent ✓")).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText("From the phone")).toBeVisible({ timeout: 30_000 });

  // Saving closes the link: the same phone can't add more.
  await dialog.getByLabel("Title").fill("E2E phone scan");
  await dialog.getByRole("button", { name: "Save document (1 page)" }).click();
  await expect(page.getByRole("row", { name: /E2E phone scan/ })).toBeVisible({ timeout: 60_000 });
  await phone.reload();
  await expect(phone.getByRole("heading", { name: "This code has expired" })).toBeVisible();
  await phoneA.close();
});

test("phone scan: a replaced code stops working at once", async ({ page, browser }) => {
  await newPatientDocuments(page, "PhoneNew");
  await page.getByRole("button", { name: "Add document" }).click();
  const dialog = page.getByRole("dialog");
  const first = page.waitForResponse((r) => r.url().includes("/rpc/start_phone_scan"));
  await dialog.getByRole("button", { name: "Phone", exact: true }).click();
  const { token } = (await (await first).json()) as { token: string };
  await expect(dialog.getByText("Waiting for the phone")).toBeVisible();
  const second = page.waitForResponse((r) => r.url().includes("/rpc/start_phone_scan"));
  await dialog.getByRole("button", { name: "New code" }).click();
  await second;

  const ctx = await browser.newContext();
  const phone = await ctx.newPage();
  await phone.goto(`/scan/${token}`);
  await expect(phone.getByRole("heading", { name: "This code has expired" })).toBeVisible();
  await ctx.close();
});
