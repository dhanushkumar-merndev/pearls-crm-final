import { expect, test, type Page } from "@playwright/test";
import { choose, login, open, PASSWORD, STATE, uniquePhone } from "./helpers";

// W-ADM-10…24: libraries, clinic profile, settings, staff logins (TEST_CASES.md).
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");

test.describe("admin", () => {
  test.use({ storageState: STATE.admin });

  test("room types: required fields, a bad SAC code, a duplicate name, then inactive", async ({ page }) => {
    const name = `E2E Room ${Date.now()}`;
    await open(page, "/admin/libraries/rooms");
    await page.getByRole("button", { name: "Add room type" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByLabel("Name")).toBeFocused();

    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Rate per day").fill("2500");
    await dialog.getByLabel("SAC code").fill("12");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByText("4 to 8 digits.")).toBeVisible();
    await dialog.getByLabel("SAC code").fill("");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // The same name in other letters is the same room type.
    await page.getByRole("button", { name: "Add room type" }).click();
    await dialog.getByLabel("Name").fill(name.toUpperCase());
    await dialog.getByLabel("Rate per day").fill("3000");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("That already exists.").first()).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("searchbox").or(page.getByLabel("Search Room types")).first().fill(name);
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("₹2,500.00")).toBeVisible();
    await row.getByRole("button", { name: "Edit" }).click();
    await dialog.getByLabel("Active (shown in pickers)").uncheck();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(row.getByText("Inactive")).toBeVisible();
  });

  test("clinic profile: GSTIN, state code and PIN code are checked; a wrong logo file is refused", async ({ page }) => {
    await open(page, "/admin/clinic");
    const gstin = page.getByLabel("GSTIN");
    const before = await gstin.inputValue();
    await gstin.fill("29ABC");
    await page.getByLabel("State code").fill("K");
    await page.getByLabel("PIN code").fill("012345");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("A GSTIN has 15 characters, e.g. 29ABCDE1234F1Z5.").or(page.getByText("15 characters, e.g. 29ABCDE1234F1Z5.")).first()).toBeVisible();
    await expect(page.getByLabel("PIN code")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("State code")).toHaveAttribute("aria-invalid", "true");

    // Nothing was saved.
    await page.reload();
    await expect(page.getByLabel("GSTIN")).toHaveValue(before);

    const file = page.locator('input[type="file"]');
    await file.setInputFiles({ name: "logo.txt", mimeType: "text/plain", buffer: Buffer.from("not a picture") });
    await expect(page.getByText("This type of file is not allowed.").first()).toBeVisible();
    await file.setInputFiles({ name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(600 * 1024, 1) });
    await expect(page.getByText("The file is too large.").first()).toBeVisible();
  });

  test("settings: values out of range are explained per field and not saved", async ({ page }) => {
    await open(page, "/admin/settings");
    const security = page.locator("form").filter({ hasText: "Shared reception computers." });
    const idle = security.getByLabel("Log out after this many idle minutes (0 = never)");
    await idle.fill("-5");
    await security.getByRole("button", { name: "Save" }).click();
    await expect(idle).toHaveAttribute("aria-invalid", "true");
    await expect(idle).toBeFocused();
    await idle.fill("");
    await security.getByRole("button", { name: "Save" }).click();
    await expect(idle).toHaveAttribute("aria-invalid", "true");

    const billing = page.locator("form").filter({ hasText: "How bills are calculated" });
    const discount = billing.getByLabel("Largest discount a receptionist may give (%)");
    await discount.fill("150");
    await billing.getByRole("button", { name: "Save" }).click();
    await expect(discount).toHaveAttribute("aria-invalid", "true");
  });

  test("settings: two tabs editing the same section — the second save is told to reload", async ({ page, context }) => {
    const other = await context.newPage();
    await open(page, "/admin/settings");
    await open(other, "/admin/settings");
    const form = (p: Page) => p.locator("form").filter({ hasText: "Shared reception computers." });
    const idle = (p: Page) => form(p).getByLabel("Log out after this many idle minutes (0 = never)");
    await expect(idle(page)).not.toHaveValue("");
    const original = await idle(page).inputValue();
    const changed = String(original === "30" ? 31 : 30);

    await idle(page).fill(changed);
    await form(page).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved ✓").first()).toBeVisible();

    await idle(other).fill(original);
    await form(other).getByRole("button", { name: "Save" }).click();
    await expect(other.getByText("Someone else changed this just now. Please reload and try again.").first()).toBeVisible();

    // Put it back (after a reload, with the new version).
    await other.reload();
    await expect(idle(other)).toHaveValue(changed);
    await idle(other).fill(original);
    await form(other).getByRole("button", { name: "Save" }).click();
    await expect(other.getByText("Saved ✓").first()).toBeVisible();
  });

  test("staff logins: checks, a taken username, a deactivated person is thrown out, password reset, back on", async ({ page, browser, baseURL }) => {
    test.setTimeout(120_000);
    const stamp = Date.now().toString(36);
    const username = `e2e.rec.${stamp}`;
    const fullName = `E2E Reception ${stamp}`;
    await open(page, "/admin/users");
    await page.getByRole("button", { name: "Add staff" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Full name").fill(fullName);
    await choose(page, dialog.getByLabel("Role"), "Receptionist");
    await dialog.getByLabel("Username").fill("Has Spaces");
    await dialog.getByLabel("Mobile number").fill(uniquePhone());
    await dialog.getByLabel("First password").fill("short");
    await dialog.getByRole("button", { name: "Create login" }).click();
    await expect(dialog.getByLabel("Username")).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByLabel("First password")).toHaveAttribute("aria-invalid", "true");

    // A username someone already has.
    await dialog.getByLabel("Username").fill("reception");
    await dialog.getByLabel("First password").fill(PASSWORD);
    await dialog.getByRole("button", { name: "Create login" }).click();
    await expect(page.getByText("That username is already taken. Please choose another.").first()).toBeVisible();

    await dialog.getByLabel("Username").fill(username);
    await dialog.getByRole("button", { name: "Create login" }).click();
    await expect(page.getByText(/Login created ✓/).first()).toBeVisible();
    await expect(dialog).toBeHidden();

    // They log in on another computer.
    const theirs = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const them = await theirs.newPage();
    await login(them, username);

    // The admin deactivates them (a reason is needed): their open session stops working.
    await page.getByLabel("Search staff by name").fill(fullName);
    const row = page.getByRole("row").filter({ hasText: username });
    await row.getByRole("button", { name: "Deactivate" }).click();
    await dialog.getByRole("button", { name: "Deactivate" }).click();
    await expect(dialog.getByLabel("Reason")).toHaveAttribute("aria-invalid", "true");
    await dialog.getByLabel("Reason").fill("E2E test: left the clinic");
    await dialog.getByRole("button", { name: "Deactivate" }).click();
    await expect(row.getByText("Deactivated")).toBeVisible();

    await them.goto("/patients");
    await expect(them).toHaveURL(/\/login/);
    await expect(them.getByText("Your account is not active. Please contact the admin.")).toBeVisible();

    // A new password, and the login back on: they get in with it.
    await row.getByRole("button", { name: "Reactivate" }).click();
    await expect(page.getByText("Login turned back on ✓").first()).toBeVisible();
    await row.getByRole("button", { name: /password/i }).click();
    const newPassword = `${PASSWORD}x9`;
    await dialog.getByLabel("New password").fill(newPassword);
    await dialog.getByRole("button", { name: "Set password" }).click();
    await expect(page.getByText("Password set ✓").first()).toBeVisible();

    await them.context().clearCookies();
    await them.goto("/login");
    await them.getByLabel("Username").fill(username);
    await them.getByLabel("Password", { exact: true }).fill(newPassword);
    await them.getByRole("button", { name: "Log in" }).click();
    await expect(them).toHaveURL(/\/home$/);
    await theirs.close();

    // Tidy: the test login is switched off again.
    await row.getByRole("button", { name: "Deactivate" }).click();
    await dialog.getByLabel("Reason").fill("E2E test finished");
    await dialog.getByRole("button", { name: "Deactivate" }).click();
    await expect(row.getByText("Deactivated")).toBeVisible();
  });

  test("admin can't change their own role", async ({ page }) => {
    await open(page, "/admin/users");
    const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "admin", exact: true }) });
    await row.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("dialog").getByText("You can't change your own role.")).toBeVisible();
  });
});

test.describe("reception (own login)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a screen left idle logs out (shared computers)", async ({ page }) => {
    // Its own session; the log-out request is answered here, so the shared test logins stay valid.
    await page.route("**/auth/v1/logout**", (route) => route.fulfill({ status: 204, body: "" }));
    await page.clock.install();
    await login(page, "reception");
    // Longer than any idle limit an admin can set (Settings → Security).
    await page.clock.fastForward("08:00:00");
    await page.clock.runFor(31_000);
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    await expect(page.getByText("You were logged out because the screen was left idle.")).toBeVisible();
  });
});
