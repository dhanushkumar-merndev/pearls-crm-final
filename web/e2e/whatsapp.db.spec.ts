import { expect, test, type Page } from "@playwright/test";
import { choose, open, STATE, uniquePhone } from "./helpers";

// Phase 10: WhatsApp. The test project has no WhatsApp keys and sending switched off, so staff
// see the manual path (the message is saved, WhatsApp opens with it) and the admin page says
// "Not set up". Needs a backend (E2E_DB=1).
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");

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

    await page.getByRole("button", { name: "Stop WhatsApp messages to this number" }).click();
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

test.describe("reception inbox", () => {
  test.use({ storageState: STATE.reception });

  test("WhatsApp inbox: a new conversation appears live, opens beside the list, and shows in the menu", async ({ page, context }) => {
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
    await expect(inbox.getByRole("link", { name: "Open the patient file →" })).toBeVisible();
    await expect(inbox.getByRole("navigation", { name: "Main menu" }).first().getByRole("link", { name: /WhatsApp/ })).toBeVisible();
  });
});

test.describe("admin", () => {
  test.use({ storageState: STATE.admin });

  test("WhatsApp page: not set up yet, the test says so, settings are checked before saving", async ({ page }) => {
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
