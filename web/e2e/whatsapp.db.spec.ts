import { expect, test, type Page } from "@playwright/test";
import { choose, open, selectAs, STATE, uniquePhone } from "./helpers";

// Phase 10: WhatsApp. The test project has no WhatsApp keys and sending switched off, so staff
// see the manual path (the message is saved, WhatsApp opens with it) and the admin page says
// "Not set up". Needs a backend (E2E_DB=1).
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");

/**
 * WhatsApp switched on (a live number on this database): the "sending is off" paths can't show,
 * a test message could reach a real person, and saving the admin page would change the real setup
 * (the chat-bot test ends by switching the bot off). Those tests skip themselves then.
 */
async function skipIfLive(page: Page) {
  // Read as the admin: other roles can't see the WhatsApp settings.
  const admin = await page.context().browser()!.newContext({ storageState: STATE.admin });
  const [row] = await selectAs<{ value: { enabled?: boolean } }>(await admin.newPage(), "app_settings?section=eq.whatsapp&select=value");
  await admin.close();
  test.skip(row?.value?.enabled === true, "WhatsApp is live on this database: needs a test project with sending off");
}

async function newPatient(page: Page) {
  const name = `E2E WA ${Date.now()}`;
  await open(page, "/patients/new");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile number").fill(uniquePhone());
  await page.getByRole("button", { name: "Save patient" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
}

test.describe("reception", () => {
  test.use({ storageState: STATE.reception });

  test("patient WhatsApp tab: the message is checked, saved and opened in WhatsApp; opt-out and back", async ({ page, context }) => {
    await skipIfLive(page);
    // Don't really leave for whatsapp.com: answer the wa.me link locally.
    await context.route("https://wa.me/**", (route) => route.fulfill({ body: "wa.me" }));
    await newPatient(page);
    await page.getByRole("tab", { name: "WhatsApp" }).click();
    await expect(page.getByText("WhatsApp sending is off")).toBeVisible();
    await expect(page.getByText("No messages yet.")).toBeVisible();

    await page.getByRole("button", { name: "Open WhatsApp" }).click();
    await expect(page.getByText("Please fill this in.")).toBeVisible();
    await expect(page.getByLabel("Message")).toBeFocused();

    await page.getByLabel("Message").fill("Hello from the e2e test");
    const popup = context.waitForEvent("page");
    await page.getByRole("button", { name: "Open WhatsApp" }).click();
    const tab = await popup;
    await expect.poll(() => tab.url()).toMatch(/^https:\/\/wa\.me\/91\d{10}\?text=Hello%20from%20the%20e2e%20test$/);
    await tab.close();
    const conversation = page.getByRole("list", { name: "Conversation" });
    await expect(conversation.getByText("Hello from the e2e test")).toBeVisible();
    await expect(conversation.getByText("Sent from a phone")).toBeVisible();

    // Stopping messages lives in the chat's ⋮ menu, like WhatsApp Web.
    await page.getByRole("button", { name: "Chat options" }).click();
    await page.getByRole("menuitem", { name: "Stop WhatsApp messages to this number" }).click();
    await expect(page.getByText("Asked for no messages", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open WhatsApp" })).toHaveCount(0);
    await page.getByRole("button", { name: "They asked to get messages again" }).click();
    await expect(page.getByText("WhatsApp sending is off")).toBeVisible();

    // Drip campaigns: a campaign must be chosen before anything is sent.
    await expect(page.getByText("Not in any campaign.")).toBeVisible();
    await page.getByRole("button", { name: "Add to a campaign" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog.getByText("Please choose one.")).toBeVisible();
  });
});

test.describe("reception do not disturb", () => {
  test.use({ storageState: STATE.reception });

  test("WhatsApp chat link opens the tab; Do not disturb mutes the bot or automatic messages for one number", async ({ page }) => {
    await newPatient(page);
    await page.getByRole("button", { name: "WhatsApp chat" }).click();
    await expect(page.getByRole("tab", { name: "WhatsApp" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "Chat options" }).click();
    await page.getByRole("menuitem", { name: "Do not disturb…" }).click();
    const dialog = page.getByRole("dialog", { name: "Do not disturb" });
    await dialog.getByLabel("Automatic messages off").check();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Do not disturb: automatic", { exact: true })).toBeVisible();

    // W-WA-11: kept after a reload; both on → one badge says both; both off → no badge.
    await page.reload();
    await page.getByRole("tab", { name: "WhatsApp" }).click();
    await expect(page.getByText("Do not disturb: automatic", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Chat options" }).click();
    await page.getByRole("menuitem", { name: "Do not disturb…" }).click();
    await expect(dialog.getByLabel("Automatic messages off")).toBeChecked();
    await dialog.getByLabel("Chat bot off").check();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Do not disturb: bot and automatic", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Chat options" }).click();
    await page.getByRole("menuitem", { name: "Do not disturb…" }).click();
    await dialog.getByLabel("Chat bot off").uncheck();
    await dialog.getByLabel("Automatic messages off").uncheck();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/^Do not disturb: /)).toHaveCount(0);
  });
});

test.describe("reception inbox", () => {
  test.use({ storageState: STATE.reception });

  test("WhatsApp inbox: a new conversation appears live, opens beside the list, and shows in the menu", async ({ page, context }) => {
    await skipIfLive(page);
    await context.route("https://wa.me/**", (route) => route.fulfill({ body: "wa.me" }));
    // A second tab watches the inbox while the first one sends.
    const inbox = await context.newPage();
    await open(inbox, "/whatsapp");
    await expect(inbox.getByRole("heading", { name: "WhatsApp", level: 1 })).toBeVisible();

    await newPatient(page);
    const name = (await page.getByRole("heading", { level: 1 }).textContent())!;
    await page.getByRole("tab", { name: "WhatsApp" }).click();
    await page.getByLabel("Message").fill("Inbox live test");
    const popup = context.waitForEvent("page");
    await page.getByRole("button", { name: "Open WhatsApp" }).click();
    await (await popup).close();

    // No reload: Realtime brings it in.
    const row = inbox.getByRole("region", { name: "Conversations" }).getByRole("button", { name: new RegExp(name) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText("Inbox live test");
    await row.click();
    await expect(inbox.getByRole("list", { name: "Conversation" }).getByText("Inbox live test")).toBeVisible();
    await expect(inbox.getByRole("link", { name: "Open the patient file" })).toBeVisible();
    await expect(inbox.getByRole("navigation", { name: "Main menu" }).first().getByRole("link", { name: /WhatsApp/ })).toBeVisible();
  });
});

test.describe("WhatsApp number filled in", () => {
  // The inbox's Register / Add lead buttons for a number that isn't in the CRM pass it along.
  test.describe("reception", () => {
    test.use({ storageState: STATE.reception });
    test("Register from the inbox starts with their WhatsApp number", async ({ page }) => {
      await open(page, "/patients/new?phone=%2B919876543210");
      await expect(page.getByLabel("Mobile number")).toHaveValue(/9876543210$/);
    });
  });
  test.describe("sales manager", () => {
    test.use({ storageState: STATE.manager });
    test("Add lead from the inbox starts with their WhatsApp number", async ({ page }) => {
      // The new-lead dialog is modal (the menu is hidden behind it): wait for the dialog, not the menu.
      await page.goto("/leads?new=1&phone=%2B919876543210");
      await expect(page.getByRole("dialog").getByLabel("Mobile", { exact: true })).toHaveValue(/9876543210$/);
    });
  });
});

test.describe("admin", () => {
  test.use({ storageState: STATE.admin });

  test("WhatsApp page: not set up yet, the test says so, settings are checked before saving", async ({ page }) => {
    await skipIfLive(page);
    await open(page, "/admin/whatsapp");
    await expect(page.getByRole("heading", { name: "WhatsApp", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Templates" })).toBeVisible();
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "This connection isn't set up yet" })).toBeVisible();
    await expect(page.getByText("Not set up")).toBeVisible();

    const price = page.getByLabel("Price per service message (₹)");
    await price.fill("");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Type a number.")).toBeVisible();
    await expect(price).toBeFocused();
  });

  test("chat bot: treatments and brochure link are checked before saving; the form waits for Meta", async ({ page }) => {
    await skipIfLive(page);
    await open(page, "/admin/whatsapp");
    const bot = page.getByRole("region", { name: "Chat bot" });
    await expect(bot.getByText("Using a tap list")).toBeVisible();
    await bot.getByLabel("Answer new numbers with the chat bot").check();
    const first = bot.getByLabel("Treatment 1", { exact: true });
    await expect(first).toBeVisible();
    // An earlier run may have saved a treatment: start from an empty first row.
    await first.fill("");
    await bot.getByLabel("Brochure link").fill("http://not-secure.example/brochure.pdf");
    await bot.getByRole("button", { name: "Save chat bot" }).click();
    await expect(bot.getByText("Please fill this in.")).toBeVisible();
    await expect(bot.getByText("A web address starting with https://", { exact: true })).toBeVisible();
    // The first wrong field gets the cursor: the brochure link sits above the list.
    await expect(bot.getByLabel("Brochure link")).toBeFocused();

    await first.fill("E2E Treatment");
    await bot.getByRole("button", { name: "Add treatment" }).click();
    await bot.getByLabel("Treatment 2", { exact: true }).fill("e2e treatment");
    await bot.getByLabel("Brochure link").fill("https://example.com/brochure.pdf");
    await bot.getByRole("button", { name: "Save chat bot" }).click();
    await expect(bot.getByText("This is already in the list.")).toBeVisible();
    await bot.getByRole("button", { name: "Remove treatment 2" }).click();

    // Leave the bot off for the other tests.
    await bot.getByLabel("Answer new numbers with the chat bot").uncheck();
    await bot.getByRole("button", { name: "Save chat bot" }).click();
    await expect(page.getByText("Saved ✓")).toBeVisible();
    await expect(bot.getByRole("heading", { name: "Recent bot chats" })).toBeVisible();
  });

  // W-WA-10: read-only, so it also runs where WhatsApp is live.
  test("chat bot texts: the fill-in markers ({clinic}, {name} …) show as written, with no console error", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await open(page, "/admin/whatsapp");
    const bot = page.getByRole("region", { name: "Chat bot" });
    await bot.getByText("Messages the bot sends").click();
    await expect(bot.getByText(/\{clinic\} clinic name/)).toBeVisible();
    await expect(bot.getByLabel("3. Ask for treatments")).toHaveAttribute("placeholder", /\{name\}/);
    expect(errors.filter((e) => /FORMATTING_ERROR|MISSING_MESSAGE/.test(e))).toEqual([]);
  });

  test("drip campaigns: a new campaign needs a name and its messages; lead campaigns start only on lead events", async ({ page }) => {
    await open(page, "/admin/drips");
    await page.getByRole("button", { name: "New campaign" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Save campaign" }).click();
    await expect(dialog.getByText("Please fill this in.")).toBeVisible();
    await expect(dialog.getByText("Please choose one.")).toBeVisible();
    await expect(dialog.getByLabel("Name")).toBeFocused();

    await choose(page, dialog.getByLabel("Who gets it"), "Leads");
    await dialog.getByLabel("Starts when").click();
    await expect(page.getByRole("option")).toHaveText(["Staff add someone", "A new lead comes in"]);
    await page.keyboard.press("Escape");
  });
});

test.describe("sales manager", () => {
  test.use({ storageState: STATE.manager });

  test("lead page shows WhatsApp with the manual path and drip campaigns", async ({ page }) => {
    await skipIfLive(page);
    await page.goto("/leads?new=1");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(`E2E WA Lead ${Date.now()}`);
    await dialog.getByLabel("Mobile", { exact: true }).fill(uniquePhone());
    await dialog.getByRole("button", { name: "Save lead" }).click();
    await expect(page.getByRole("heading", { name: "WhatsApp" })).toBeVisible();
    await expect(page.getByText("WhatsApp sending is off")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open WhatsApp" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Drip campaigns" })).toBeVisible();
  });
});

test.describe("send now, or within 5 minutes", () => {
  test.use({ storageState: STATE.admin });
  // Both calls are answered here, so nothing is queued and no WhatsApp message goes out (safe on a live number).
  test("when the instant send can't reach the server, staff are told it goes out within 5 minutes", async ({ page }) => {
    await page.route(/\/rest\/v1\/rpc\/wa_(number_)?send/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "null" }));
    await page.route(/\/functions\/v1\/wa-dispatch/, (r) => r.abort("failed"));
    await open(page, "/whatsapp");
    const chat = page.getByRole("region", { name: "Conversations" }).locator("button:not([aria-pressed])").first();
    await expect(chat.or(page.getByText("No WhatsApp conversations yet.")).first()).toBeVisible({ timeout: 20_000 });
    test.skip(!(await chat.count()), "no conversation on this database");
    await chat.click();
    const box = page.getByPlaceholder("Type a message").first();
    const visible = await box.waitFor({ timeout: 10_000 }).then(() => true, () => false);
    test.skip(!visible, "no open 24-hour window, or WhatsApp is off on this database");
    await box.fill("E2E faked send");
    await page.getByRole("button", { name: "Send", exact: true }).first().click();
    await expect(page.getByText("Saved. It couldn't go out at once, so it will be sent within 5 minutes.")).toBeVisible();
  });
});
