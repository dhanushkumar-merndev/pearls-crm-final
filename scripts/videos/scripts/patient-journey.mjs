// Video 3 — A patient's journey to surgery: register → book → WhatsApp confirmation → the visit
// (arrived, with the doctor, done) → the doctor's prescription uploaded → IP admission → charges →
// discharge → final bill with its breakdown → all bills.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { BASE, ROOT, login } from "../lib/browser.mjs";
import { pause, scroll, type } from "../lib/director.mjs";
import { choose, istDay, pick, pickDate } from "../lib/ui.mjs";

const NAME = "Meera Joshi";
const PHONE = "9000112345";
let patientUrl = "";
let stayUrl = "";

/** The patient taps "Confirm" on the WhatsApp reminder (what Meta's webhook would deliver). */
function patientConfirmsOnWhatsApp() {
  const sql = `select public.wa_inbound(jsonb_build_object('from', '+91${PHONE}', 'kind', 'button_reply', 'text', 'Confirm',
    'action', 'confirm', 'wa_message_id', 'wamid.video.' || extract(epoch from now())::bigint))`;
  execFileSync("docker", ["exec", "-i", "supabase_db_pearl-crm", "psql", "-U", "postgres", "-qtAc", sql], { cwd: ROOT });
}

const actions = (page) => page.getByRole("button", { name: `Actions for ${NAME}` }).first();
async function setStatus(page, item) {
  await actions(page).click();
  await pause(page, 400);
  await page.getByRole("menuitem", { name: item }).click();
  await pause(page, 900);
}

export default {
  title: "Pearl Clinic CRM — A patient's journey to surgery",
  file: "3-patient-journey-to-surgery.mp4",
  async setup(page) {
    // "WhatsApp reminder" opens wa.me when the clinic's WhatsApp sending is off (as on this demo copy).
    await page.context().route("https://wa.me/**", (r) => r.fulfill({ body: "WhatsApp" }));
    await page.context().route("https://api.whatsapp.com/**", (r) => r.fulfill({ body: "WhatsApp" }));
    await login(page, "reception");
    await page.goto(`${BASE}/home`);
    await pause(page, 1500);
  },
  scenes: [
    { chapter: "A patient's journey", description: "From the first visit to surgery and the final bill" },
    {
      id: "intro",
      say: "In this video we follow one patient, Meera, from her first visit to her surgery. Reception registers her, books the doctor, confirms on WhatsApp, uploads the prescription, admits her, and makes the final bill.",
      run: async (page) => page.mouse.move(600, 400, { steps: 25 }),
    },
    { chapter: "1. Register the patient" },
    {
      id: "new-patient",
      say: "Click New patient at the top of the menu. Type her full name and mobile number. If this number is already registered, the system warns you, so the same person is never added twice.",
      run: async (page) => {
        await page.getByRole("link", { name: "New patient" }).first().click();
        await page.getByLabel("Full name").waitFor();
        await type(page.getByLabel("Full name"), NAME);
        await type(page.getByLabel("Mobile number"), PHONE, 70);
      },
    },
    {
      id: "new-patient-more",
      say: "Add her gender, age and area. Only the name and number are required; the rest can be filled in later.",
      run: async (page) => {
        await choose(page, page.getByLabel("Gender"), "Female");
        await type(page.getByLabel("Age (years)"), "32");
        const area = page.getByLabel("Area");
        if (await area.count()) await type(area.first(), "Jayanagar");
      },
    },
    {
      id: "save-patient",
      say: "Click Save patient. She gets her U H I D number, and her patient file opens. Everything about her, visits, documents, bills, and WhatsApp, lives in this one file.",
      run: async (page) => {
        await page.getByRole("button", { name: "Save patient" }).first().click();
        await page.getByRole("heading", { level: 1, name: NAME }).waitFor({ timeout: 30_000 });
        patientUrl = page.url().replace(/\?.*$/, "");
        await pause(page, 600);
      },
    },
    { chapter: "2. Book the consultation" },
    {
      id: "book",
      say: "Click Book appointment. Choose the doctor, Dr Arjun Shetty, and the day. Only the free slots can be picked, so double booking is not possible.",
      run: async (page) => {
        await page.getByRole("button", { name: "Book appointment" }).first().click();
        const dialog = page.getByRole("dialog");
        await pick(page, dialog.getByRole("combobox", { name: "Doctor" }), "Arjun", /Dr Arjun/);
        await pickDate(page, dialog.getByLabel("Day", { exact: true }), istDay(0));
        await pause(page, 800);
        await dialog.getByRole("radio").and(page.locator(":enabled")).first().click();
      },
    },
    {
      id: "booked",
      say: "Click Book. The appointment is saved, waiting for the patient to confirm.",
      run: async (page) => {
        await page.getByRole("dialog").getByRole("button", { name: "Book", exact: true }).click();
        await page.getByText(/Booked ✓/).first().waitFor();
        await page.getByRole("tab", { name: "Care" }).click();
        await page.getByText("Waiting for confirmation").first().waitFor();
      },
    },
    {
      id: "whatsapp",
      say: "From the appointment's Actions menu, send the WhatsApp reminder. It goes from the clinic's own WhatsApp number, with the doctor, the date and the time, and a button to confirm.",
      run: async (page) => {
        await actions(page).click();
        await pause(page, 500);
        await page.getByRole("menuitem", { name: "WhatsApp reminder" }).click();
        await pause(page, 1800);
        // Back to this tab if WhatsApp opened another one.
        await page.bringToFront();
      },
    },
    {
      id: "confirmed",
      say: "Meera taps Confirm on her phone. The appointment turns to Confirmed by itself, marked as confirmed on WhatsApp, and reception doesn't need to call her.",
      run: async (page) => {
        patientConfirmsOnWhatsApp();
        await pause(page, 1200);
        await page.reload();
        await page.getByRole("tab", { name: "Care" }).click();
        await pause(page, 1200);
      },
    },
    {
      id: "wa-chat",
      say: "The WhatsApp tab shows the whole conversation with her, the reminder we sent and her reply, right inside her file.",
      run: async (page) => {
        await page.getByRole("tab", { name: /WhatsApp/ }).first().click();
        await pause(page, 1800);
      },
    },
    { chapter: "3. The visit", description: "Reception moves the appointment along" },
    {
      id: "board",
      say: "On the day, the Appointments page shows every doctor's bookings. Reception moves each patient along with one click.",
      run: async (page) => {
        await page.getByRole("link", { name: "Appointments" }).first().click();
        await actions(page).waitFor({ timeout: 20_000 });
        await actions(page).scrollIntoViewIfNeeded();
        await pause(page, 1200);
      },
    },
    {
      id: "arrived",
      say: "When Meera walks in, mark her Arrived.",
      run: (page) => setStatus(page, "Mark arrived"),
    },
    {
      id: "with-doctor",
      say: "When it's her turn, Send in to the doctor.",
      run: (page) => setStatus(page, "Send in to the doctor"),
    },
    {
      id: "done",
      say: "And when the consultation is over, mark it Done. Waiting times and the doctor's day are recorded automatically.",
      run: (page) => setStatus(page, "Mark done"),
    },
    { chapter: "4. The doctor's prescription" },
    {
      id: "rx-open",
      say: "The doctor has written the prescription and the surgery plan. In her file, open Documents and click Add document.",
      run: async (page) => {
        await page.goto(`${patientUrl}?tab=documents`);
        await page.getByRole("button", { name: "Add document" }).click();
        await page.getByRole("dialog").waitFor();
      },
    },
    {
      id: "rx-upload",
      say: "Choose the photo or the P D F. A phone can also scan it straight from the desk. Give it a title, and set the type to Prescription.",
      run: async (page) => {
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Choose photos or PDF files").setInputFiles(path.join(ROOT, "scripts/videos/assets/prescription.jpg"));
        await dialog.getByRole("img", { name: "Page 1" }).waitFor({ timeout: 30_000 });
        const title = dialog.getByLabel("Title");
        if (await title.count()) await type(title, "Dr Arjun Shetty, surgery plan");
        await pick(page, dialog.getByRole("combobox", { name: "Type" }), "Presc", /^Prescription/);
      },
    },
    {
      id: "rx-save",
      say: "Save it. The prescription is stored safely in her file, and anyone at the desk can open it later.",
      run: async (page) => {
        await page.getByRole("dialog").getByRole("button", { name: /^Save document/ }).click();
        await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 60_000 });
        await pause(page, 1500);
      },
    },
    { chapter: "5. Session or admission", description: "A procedure package, or an in-patient stay for surgery" },
    {
      id: "care",
      say: "For a skin or hair package, Start treatment plans all the sessions, and each one is ticked off as it happens. Meera needs surgery, so we admit her instead.",
      run: async (page) => {
        await page.goto(`${patientUrl}?tab=care`);
        await page.getByRole("button", { name: "Start treatment" }).first().hover();
        await pause(page, 1500);
        await page.getByRole("button", { name: "Admit", exact: true }).hover();
      },
    },
    {
      id: "admit",
      say: "Click Admit. Choose the room type, the bed, the procedure and the diagnosis, and the operating surgeon.",
      run: async (page) => {
        await page.getByRole("button", { name: "Admit", exact: true }).click();
        const admit = page.getByRole("dialog");
        await pick(page, admit.getByRole("combobox", { name: "Room type" }), "Deluxe", /^Deluxe room/);
        await type(admit.getByLabel("Room / bed"), "Deluxe 2");
        await type(admit.getByLabel("Procedures"), "Rhinoplasty with septoplasty", 40);
        await type(admit.getByLabel("Diagnosis"), "Nasal hump, deviated septum", 40);
        await type(admit.getByLabel("Anaesthesia"), "General anaesthesia", 40);
        await pick(page, admit.getByRole("combobox", { name: "Doctor" }), "Arjun", /Dr Arjun/);
      },
    },
    {
      id: "admitted",
      say: "Click Admit. She gets her I P number, and the stay page opens.",
      run: async (page) => {
        await page.getByRole("dialog").getByRole("button", { name: "Admit", exact: true }).click();
        await page.waitForURL(/\/admissions\/[0-9a-f-]{36}$/, { timeout: 30_000 });
        stayUrl = page.url();
        await pause(page, 1000);
      },
    },
    {
      id: "charges",
      say: "During the stay, add each charge as it happens: the surgeon's fee, the operation theatre, the anaesthetist. They collect on her final bill.",
      run: async (page) => {
        await page.getByRole("button", { name: "Add charges" }).first().click();
        const dialog = page.getByRole("dialog");
        for (const [search, option] of [["Rhinoplasty", /^Rhinoplasty surgery/], ["OT", /^OT charges/], ["Anaesth", /^Anaesthetist/]]) {
          await pick(page, dialog.getByRole("combobox", { name: "Add from services" }), search, option);
          await pause(page, 300);
        }
        await dialog.getByRole("button", { name: /^Add \d charges?/ }).click();
        await pause(page, 1500);
      },
    },
    { chapter: "6. Discharge and the final bill" },
    {
      id: "discharge",
      say: "When the doctor discharges her, click Discharge. The room nights are counted for you.",
      run: async (page) => {
        await page.getByRole("button", { name: "Discharge", exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Discharge", exact: true }).click();
        await page.getByText("Discharged ✓").first().waitFor();
      },
    },
    {
      id: "final-bill",
      say: "Open the final bill. Every charge added during the stay is already on it. The suggested room charge for the nights she stayed is ticked, so one click adds it. Earlier bills from the same visit can be included too, without counting anything twice.",
      run: async (page) => {
        await page.getByRole("link", { name: /^Final bill$/ }).first().click();
        await page.getByRole("heading", { level: 1 }).filter({ hasText: "Final bill" }).waitFor({ timeout: 30_000 });
        await pause(page, 900);
        const add = page.getByRole("button", { name: /^Add \d+ charges?$/ });
        await add.scrollIntoViewIfNeeded();
        await pause(page, 1200);
        await add.click();
        await page.getByText(/charges? added/i).first().waitFor({ timeout: 30_000 });
        await pause(page, 800);
        await page.evaluate(() => (document.querySelector("main") ?? document.scrollingElement).scrollTo({ top: 0, behavior: "smooth" }));
        await pause(page, 1200);
      },
    },
    {
      id: "finalize",
      say: "Finalize the bill and record the payment. Here she pays by U P I.",
      run: async (page) => {
        await page.getByRole("button", { name: "Finalize bill" }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("combobox", { name: "Mode" }).first().click();
        await page.getByRole("option", { name: "UPI", exact: true }).click();
        await dialog.getByRole("button", { name: "Fully paid" }).click();
        await page.getByText(/^Bill .+ finalized$/).waitFor({ timeout: 30_000 });
        await pause(page, 800);
      },
    },
    {
      id: "breakdown",
      say: "Now the breakdown. The lines are grouped by category, room, surgeon, in patient services, each with its subtotal. Below, the totals by category and the G S T at each rate, then the payments and the balance.",
      run: async (page) => {
        await scroll(page, 450, 1600);
        await pause(page, 1500);
        await scroll(page, 700, 2000);
      },
    },
    {
      id: "print",
      say: "Print gives the itemised final bill on the clinic letterhead, ready for the patient and for insurance.",
      run: async (page) => {
        await page.goto(page.url().replace(/\/bills\//, "/print/bill/").replace(/\?.*$/, ""));
        await pause(page, 1500);
        await scroll(page, 600, 2000);
      },
    },
    { chapter: "7. All bills" },
    {
      id: "all-bills",
      say: "Finally, the Bills page. At the top is the breakdown for the dates you pick: how much was billed, how much was received, and the balance still due.",
      run: async (page) => {
        await page.goto(`${BASE}/bills`);
        await page.getByTestId("bills-summary").waitFor();
        await pause(page, 800);
        for (const t of ["Billed", "Received", "Balance due"]) {
          await page.getByTestId("bills-summary").getByText(t, { exact: true }).first().hover();
          await pause(page, 700);
        }
      },
    },
    {
      id: "all-bills-split",
      say: "It also splits the money by bill type, receipts, pharmacy and final bills, and by payment mode: cash, U P I and card. Change the dates, type or status, and the breakdown follows.",
      run: async (page) => {
        await page.getByText("By bill type").hover();
        await pause(page, 1500);
        await page.getByText("Received by mode").hover();
        await pause(page, 1200);
        await scroll(page, 450, 1500);
      },
    },
    {
      id: "outro",
      say: "That's Meera's journey, from her first visit to her final bill, all in one place and every step recorded.",
      run: async (page) => {
        await page.goto(patientUrl);
        await pause(page, 1000);
      },
    },
  ],
};
