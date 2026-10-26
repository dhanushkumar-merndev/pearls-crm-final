import { expect, test } from "@playwright/test";
import { choose, open, randomUUID, rpcAs, STATE, uniquePhone } from "./helpers";

// Phase 12: call recordings. The phone app registers recordings it finds; here the test does
// the same through the RPC, then a manager asks for one from the web. Needs a backend (E2E_DB=1).
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");

test.describe("sales manager", () => {
  test.use({ storageState: STATE.manager });

  test("a recording still on the phone can be requested; the lead page lists it", async ({ page }) => {
    await open(page, "/recordings");
    await expect(page.getByRole("heading", { level: 1, name: "Recordings" })).toBeVisible();

    const name = `E2E Rec ${Date.now()}`;
    const phone = `+91${uniquePhone()}`;
    const lead = await rpcAs<{ lead: { id: string } }>(page, "create_lead", {
      p_lead: { name, phone, force: true },
      p_client_id: randomUUID(),
    });
    const leadId = lead.lead.id;
    const callId = randomUUID();
    await rpcAs(page, "log_call", {
      p_call: { client_id: callId, lead_id: leadId, phone, direction: "outgoing", started_at: new Date().toISOString(), duration_s: 840, outcome: "connected", notes: "Asked about the price" },
    });
    const recordingId = randomUUID();
    const reg = await rpcAs<{ registered: number }>(page, "recording_register", {
      p_rows: [{ id: recordingId, kind: "call", call_log_id: callId, recorded_at: new Date().toISOString(), duration_s: 840, match_confidence: 0.95 }],
    });
    expect(reg.registered).toBe(1);

    await page.reload();
    await choose(page, page.getByLabel("Status"), "On the phone");
    const item = page.getByRole("listitem").filter({ hasText: name });
    await expect(item).toBeVisible();
    await expect(item.getByText("On the phone")).toBeVisible();
    await expect(item.getByText("14:00")).toBeVisible();
    await expect(item.getByText("Asked about the price")).toBeVisible();

    await item.getByRole("button", { name: "Request sync" }).click();
    await expect(page.getByText("Asked. The phone will upload it at its next sync.")).toBeVisible();
    // The list is filtered to "On the phone": the requested one moves to "Waiting for the phone".
    await choose(page, page.getByLabel("Status"), "Waiting for the phone");
    const waiting = page.getByRole("listitem").filter({ hasText: name });
    await expect(waiting.getByText("Waiting for the phone")).toBeVisible();
    await expect(waiting.getByRole("button", { name: "Request sync" })).toHaveCount(0);

    await open(page, `/leads/${leadId}`);
    const card = page.getByText("Call recordings and voice notes").locator("..");
    await expect(card.getByText("Waiting for the phone")).toBeVisible();
  });
});

test.describe("admin", () => {
  test.use({ storageState: STATE.admin });

  test("upload mode: clinic setting and a per-person override", async ({ page }) => {
    await open(page, "/admin/settings");
    await expect(page.getByLabel("Call recordings are uploaded")).toBeVisible();
    await expect(page.getByLabel("Upload only the first … minutes of a long call")).toHaveValue(/\d+/);

    // The manager's own row (username "manager"): the override is offered for sales roles.
    await open(page, "/admin/users");
    await page.getByLabel("Search staff by name").fill("");
    // Exactly the username cell: "manager" also appears in every sales manager's role column.
    const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "manager", exact: true }) });
    await row.getByRole("button", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Call recordings")).toBeVisible();
    await choose(page, dialog.getByLabel("Call recordings"), "Upload every CRM call");
    await dialog.getByRole("button", { name: "Save" }).click();
    // Saved through the admin-users server function (slower on its first call after a deploy).
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    // Stored on the server (fresh page), then back to the clinic setting so other tests see the default.
    await page.reload();
    await row.getByRole("button", { name: "Edit" }).click();
    await expect(dialog.getByLabel("Call recordings")).toHaveText(/Upload every CRM call/);
    await choose(page, dialog.getByLabel("Call recordings"), "Same as the clinic setting");
    await dialog.getByRole("button", { name: "Save" }).click();
    // Saved through the admin-users server function (slower on its first call after a deploy).
    await expect(dialog).toBeHidden({ timeout: 15_000 });
  });
});
