// Video 2 — Inventory: stock, alerts, a supplier purchase (stock in), a write-off (stock out),
// and a pharmacy bill that takes the earliest-expiry batch.
import { BASE, login } from "../lib/browser.mjs";
import { pause, scroll, type } from "../lib/director.mjs";
import { pick as pickIn, pickMonth } from "../lib/ui.mjs";

const pick = (page, name, search, option) => pickIn(page, page.getByRole("combobox", { name }).last(), search, option);

export default {
  title: "Pearl Clinic CRM — Pharmacy and inventory",
  file: "2-pharmacy-and-inventory.mp4",
  async setup(page) {
    await login(page, "reception");
    await page.goto(`${BASE}/pharmacy`);
    await page.getByRole("tab", { name: "Stock" }).waitFor();
    await pause(page, 1200);
  },
  scenes: [
    { chapter: "Pharmacy and inventory", description: "Stock in, stock out, and the pharmacy bill" },
    {
      id: "intro",
      say: "This video shows how the pharmacy works in Pearl Clinic CRM: how stock comes in from a supplier, how stock goes out, and how reception makes a pharmacy bill.",
      run: async (page) => {
        await page.mouse.move(700, 300, { steps: 20 });
      },
    },
    {
      id: "tiles",
      say: "The pharmacy page opens with four numbers: sales today, sales this month, the value of all stock on the shelf, and the value of stock that will expire soon.",
      run: async (page) => {
        for (const label of ["Sales today", "This month", "Stock value", "Near expiry"]) {
          const tile = page.getByText(new RegExp(`^${label}`, "i")).first();
          if (await tile.count()) await tile.hover();
          await pause(page, 900);
        }
      },
    },
    {
      id: "stock",
      say: "The Stock tab lists every medicine, with the quantity on hand, the nearest expiry date, and the reorder level. Anything running low is easy to spot.",
      run: async (page) => {
        await page.getByRole("tab", { name: "Stock" }).click();
        await pause(page, 600);
        await scroll(page, 380, 1400);
        await pause(page, 800);
        await scroll(page, -380, 1000);
      },
    },
    {
      id: "alerts",
      say: "The Alerts tab warns you before there is a problem: medicines below their reorder level, and batches that are close to expiry, so they can be sold first or returned.",
      run: async (page) => {
        await page.getByRole("tab", { name: /Alerts/ }).click();
        await pause(page, 1500);
      },
    },
    {
      id: "purchase-open",
      say: "Minoxidil is running low, so let's add new stock. Click New purchase, and choose the supplier.",
      run: async (page) => {
        await page.getByRole("link", { name: "New purchase" }).click();
        await page.getByRole("combobox", { name: "Supplier" }).waitFor();
        await pause(page, 500);
        await pick(page, "Supplier", "Medline", /Medline Pharma/);
      },
    },
    {
      id: "purchase-invoice",
      say: "Type the supplier's invoice number exactly as it is printed on their bill.",
      run: async (page) => {
        await type(page.getByLabel("Supplier invoice no."), "MPD-4529");
      },
    },
    {
      id: "purchase-line",
      say: "Now the medicine line. Pick the medicine, type the batch number printed on the box, and choose the expiry month. The month picker makes it quick to jump to the right year.",
      run: async (page) => {
        await pick(page, "Medicine", "Minox", /Minoxidil/);
        await type(page.getByLabel("Batch", { exact: true }), "MX2611");
        await pickMonth(page, page.getByLabel("Expiry", { exact: true }), `${new Date().getFullYear() + 2}-10`);
      },
    },
    {
      id: "purchase-qty",
      say: "Enter the quantity, the purchase price, and the M R P. The invoice total and the G S T are worked out for you.",
      run: async (page) => {
        await type(page.getByLabel("Qty", { exact: true }), "24");
        await type(page.getByLabel("Purchase price", { exact: true }), "610");
        await type(page.getByLabel("MRP", { exact: true }), "890");
        await page.getByText(/Invoice total/).first().hover();
      },
    },
    {
      id: "purchase-post",
      say: "When it matches the supplier's bill, click Post to stock. From this moment, the twenty four bottles are on the shelf and ready to sell.",
      run: async (page) => {
        await page.getByRole("button", { name: "Post to stock" }).click();
        await pause(page, 700);
        await page.getByRole("dialog").getByRole("button", { name: "Post to stock" }).click();
        await page.getByText("Posted", { exact: true }).waitFor();
      },
    },
    {
      id: "item",
      say: "Open the medicine to see its batches. Each batch keeps its own expiry date, price and quantity.",
      run: async (page) => {
        await page.goto(`${BASE}/pharmacy`);
        await type(page.getByLabel("Search medicines"), "Minox");
        await pause(page, 600);
        await page.getByRole("link", { name: /Minoxidil/ }).first().click();
        await page.getByText(/in stock/).first().waitFor();
      },
    },
    {
      id: "adjust",
      say: "Stock can also go out without a sale, for example a bottle that leaked. Click Adjust on the batch, choose what happened, how many, and write the reason.",
      run: async (page) => {
        await page.getByRole("button", { name: /Adjust batch MX2611/ }).click();
        const adjust = page.getByRole("dialog");
        await adjust.getByLabel("What happened").click();
        await page.getByRole("option", { name: "Damaged", exact: true }).click();
        await type(adjust.getByLabel("How many"), "1");
        await type(adjust.getByLabel("Reason"), "Bottle leaked in the box");
      },
    },
    {
      id: "adjust-save",
      say: "Save it. The stock drops by one, and the history below records who did it, when, and why.",
      run: async (page) => {
        await page.getByRole("dialog").getByRole("button", { name: "Save adjustment" }).click();
        await page.getByText("Stock adjusted ✓").waitFor();
        await pause(page, 600);
        await scroll(page, 420, 1300);
      },
    },
    { chapter: "The pharmacy bill", description: "Selling medicines to a patient" },
    {
      id: "sale-open",
      say: "Now a patient buys medicines. On the pharmacy page click New sale, and find the patient by name, phone number or U H I D.",
      run: async (page) => {
        await page.goto(`${BASE}/pharmacy`);
        await page.getByRole("button", { name: "New sale" }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("combobox").first().click();
        await type(page.getByPlaceholder("Name, phone or UHID…"), "Ananya", 70);
        await pause(page, 700);
        await page.getByRole("option", { name: /Ananya Iyer/ }).first().click();
      },
    },
    {
      id: "sale-start",
      say: "Click Start the bill. A draft pharmacy invoice opens for her.",
      run: async (page) => {
        await page.getByRole("button", { name: "Start the bill" }).click();
        await page.getByRole("heading", { level: 1 }).filter({ hasText: "Pharmacy invoice" }).waitFor({ timeout: 30_000 });
      },
    },
    {
      id: "sale-lines",
      say: "Pick the medicine and the quantity. Add another line for ten Biotin tablets. For every line, the system chooses the batch that expires first, so older stock is always sold before newer stock.",
      run: async (page) => {
        await pick(page, "Medicine", "Minox", /Minoxidil/);
        await page.getByLabel("Qty", { exact: true }).last().fill("");
        await type(page.getByLabel("Qty", { exact: true }).last(), "1");
        await pause(page, 900);
        await page.getByRole("button", { name: "Add line" }).click();
        await pick(page, "Medicine", "Biotin", /Biotin/);
        await page.getByLabel("Qty", { exact: true }).last().fill("");
        await type(page.getByLabel("Qty", { exact: true }).last(), "10");
      },
    },
    {
      id: "sale-finalize",
      say: "Click Finalize bill, choose how she paid, U P I here, and mark it fully paid. The bill gets its number, and the stock is reduced straight away.",
      run: async (page) => {
        await page.getByRole("button", { name: "Finalize bill" }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("combobox", { name: "Mode" }).click();
        await page.getByRole("option", { name: "UPI", exact: true }).click();
        await dialog.getByRole("button", { name: "Fully paid" }).click();
        await page.getByText(/^Bill .+ finalized$/).waitFor();
      },
    },
    {
      id: "sale-breakdown",
      say: "Below the lines you see the breakdown: the G S T for each rate, the payments received, and the total with the balance.",
      run: async (page) => {
        await pause(page, 500);
        await scroll(page, 520, 1500);
      },
    },
    {
      id: "print",
      say: "Print gives a clean, A4 tax invoice with the clinic's letterhead, batch and expiry for every medicine, and the amount in words.",
      run: async (page) => {
        const url = page.url().replace(/\/bills\//, "/print/bill/").replace(/\?.*$/, "");
        await page.goto(url);
        await pause(page, 1500);
        await scroll(page, 500, 1600);
      },
    },
    {
      id: "outro",
      say: "That's the whole stock cycle: buy in from the supplier, write off what can't be sold, and sell on a bill, with the stock always up to date.",
      run: async (page) => {
        await page.goto(`${BASE}/pharmacy`);
        await pause(page, 800);
      },
    },
  ],
};
