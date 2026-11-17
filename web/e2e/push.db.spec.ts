import { expect, test } from "@playwright/test";
import { open, rpcAs, selectAs, STATE } from "./helpers";

// Phase 20a: pop-ups on the computer. The real Firebase token needs a branded Chrome, so the browser
// side is checked up to Firebase: the switch's states, "Send a test" and "Turn off" with a registered
// token. The server side (who gets pushed, locate_now, own tokens only) is 40_web_push.test.sql, and
// push-send's web message is a Deno test. Needs a backend (E2E_DB=1) and the Firebase web keys.
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");

test("the background script is a plain file anyone's browser can fetch", async ({ request }) => {
  const res = await request.get("/push-sw.js", { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/javascript/);
  expect(await res.text()).toContain("showNotification");
});

test.describe("reception", () => {
  test.use({ storageState: STATE.reception });

  test("pop-ups: off → (blocked help) → on: send a test, then turn off forgets this browser", async ({
    page,
    context,
  }) => {
    await open(page, "/notifications");
    const card = page.getByTestId("push-card");
    // The switch appears once the page has run in the browser.
    await card.waitFor({ timeout: 5000 }).catch(() => undefined);
    test.skip((await card.count()) === 0, "Firebase web keys not set (NEXT_PUBLIC_FIREBASE_*)");
    await expect(card.getByRole("heading", { name: "Pop-ups on this computer" })).toBeVisible();
    await expect(card.getByRole("status")).toHaveText(
      /Off in this browser\.|Blocked in this browser\./,
    );

    // A browser that remembers its token and has permission shows "on" (Firebase skipped here).
    const token = `e2e-web-${Date.now()}`;
    await rpcAs(page, "register_device", {
      p_token: token,
      p_platform: "web",
      p_app_version: "web",
    });
    await context.grantPermissions(["notifications"]);
    await page.evaluate((t) => window.localStorage.setItem("pearl.push.token", t), token);
    await page.reload();
    await expect(card.getByRole("status")).toHaveText("On in this browser.");

    // "Send a test" makes a notification to oneself; the bell shows it.
    // (A retry within 20 s of an earlier run is told to wait instead.)
    await card.getByRole("button", { name: "Send a test" }).click();
    await expect(
      page
        .getByText("Test sent. It should pop up in a few seconds ✓")
        .or(page.getByText("Too many tries. Please wait a moment."))
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Test notification" }).first(),
    ).toBeVisible();
    // Right away again: refused, with the translated message.
    await card.getByRole("button", { name: "Send a test" }).click();
    await expect(page.getByText("Too many tries. Please wait a moment.")).toBeVisible();

    // Turn off: this browser's token is gone from the server, the switch is off again.
    await card.getByRole("button", { name: "Turn off" }).click();
    await expect(page.getByText("Pop-ups turned off ✓")).toBeVisible();
    await expect(card.getByRole("status")).toHaveText("Off in this browser.");
    await expect(card.getByRole("button", { name: "Turn on pop-ups" })).toBeVisible();
    await expect
      .poll(
        async () => (await selectAs(page, `device_tokens?select=token&token=eq.${token}`)).length,
      )
      .toBe(0);
  });

  test("the bell offers to turn pop-ups on while they are off", async ({ page }) => {
    await open(page, "/home");
    await page.getByRole("button", { name: /^Notifications:/ }).click();
    const item = page.getByRole("menuitem", { name: "Turn on pop-ups on this computer" });
    await item.waitFor({ timeout: 3000 }).catch(() => undefined);
    if ((await item.count()) === 0)
      test.skip(true, "Firebase web keys not set, or this browser can't");
    await item.click();
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(page.getByTestId("push-card")).toBeVisible();
  });
});
