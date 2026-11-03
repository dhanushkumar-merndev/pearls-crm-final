// Video 4 — Leads: where enquiries come from, how the sales manager shares them out, how a sales
// executive works one on the phone app (call → notes → stage → booking), and how the manager follows
// the numbers (dashboard, targets, ads).
import { BASE, login } from "../lib/browser.mjs";
import { pause, scroll, type } from "../lib/director.mjs";
import { choose, pick, pickMonth } from "../lib/ui.mjs";
import { freshLogin, unlock } from "../lib/phone.mjs";

const NAME = "Ritika Sharma";
const PHONE = "9000213344";
const PHONE_LABEL = "Neha’s phone · sales executive";
let leadUrl = "";

export default {
  title: "Pearl Clinic CRM — Leads, from enquiry to patient",
  file: "4-leads-flow.mp4",
  async setup(page) {
    await login(page, "manager");
    await page.goto(`${BASE}/leads`);
    await page.getByRole("heading", { name: "Leads", level: 1 }).waitFor();
    await pause(page, 1500);
  },
  async phoneSetup(phone) {
    await freshLogin(phone, "neha");
  },
  scenes: [
    { chapter: "Leads", description: "From the first enquiry to a booked patient" },
    {
      id: "intro",
      say: "This video follows a lead: an enquiry from someone who may become a patient. Leads come in from Facebook and Instagram ads automatically, from WhatsApp, the website, walk-ins, referrals and BDM visits, or from an Excel import.",
      run: async (page) => {
        await page.mouse.move(700, 400, { steps: 20 });
        await pause(page, 1200);
        await page.getByRole("combobox", { name: "Source" }).first().hover();
      },
    },
    {
      id: "list",
      say: "The Leads page is the sales manager's list. Each lead shows the treatment asked about, where it came from, the owner, the stage, and when to call next. Overdue calls are shown first, in red.",
      run: async (page) => {
        await page.locator("tbody tr").first().hover();
        await pause(page, 1200);
        await scroll(page, 450, 1600);
        await pause(page, 800);
        await scroll(page, -450, 1200);
      },
    },
    {
      id: "pool",
      say: "Who gets new leads? Under More, the round-robin list. Leads without an owner are shared out in turn between the ticked sales executives, so nobody waits.",
      run: async (page) => {
        await page.getByRole("button", { name: "More", exact: true }).click();
        await pause(page, 500);
        await page.getByRole("menuitem", { name: "Who gets new leads" }).click();
        await page.getByRole("heading", { name: "Who gets new leads" }).waitFor();
        await pause(page, 1500);
        await page.getByText("Neha Kapoor").first().hover();
        await pause(page, 1000);
        await page.goto(`${BASE}/leads`);
        await page.getByRole("heading", { name: "Leads", level: 1 }).waitFor();
      },
    },
    {
      id: "new-lead",
      say: "A new enquiry on the phone? Click New lead. Only the name and the mobile number are needed. Add the treatment and the source if you know them.",
      run: async (page) => {
        await page.getByRole("button", { name: "New lead" }).last().click();
        const dialog = page.getByRole("dialog");
        await type(dialog.getByLabel("Name", { exact: true }), NAME);
        await type(dialog.getByLabel("Mobile", { exact: true }), PHONE);
        await type(dialog.getByLabel("Or type the treatment"), "Hair transplant");
        await pick(page, dialog.getByRole("combobox", { name: "Source" }), "Insta", /Instagram/);
      },
    },
    {
      id: "new-lead-owner",
      say: "Choose the owner, or leave it on round-robin. Here it goes to Neha. Save the lead.",
      run: async (page) => {
        const dialog = page.getByRole("dialog");
        await choose(page, dialog.getByRole("combobox", { name: "Owner" }), "Neha Kapoor");
        await type(dialog.getByLabel("Comments", { exact: true }), "Saw the Instagram ad. Wants to know the price and recovery time.", 30);
        await pause(page, 500);
        await dialog.getByRole("button", { name: "Save lead" }).click();
        await page.getByRole("heading", { name: NAME }).waitFor();
        await pause(page, 1200);
      },
    },
    {
      id: "assign",
      say: "The lead opens, with its owner. Back in the list, you can move any lead to someone else by changing its owner. Tick several leads to assign them all at once.",
      run: async (page) => {
        await page.getByRole("link", { name: "Back to leads" }).click();
        await page.getByRole("heading", { name: "Leads", level: 1 }).waitFor();
        await page.waitForLoadState("networkidle").catch(() => {});
        await pause(page, 800);
        const owner = page.getByRole("combobox", { name: /^Owner of Abhishek Jain$/ });
        await choose(page, owner, "Sunil Sales");
        await page.getByText(/1 lead assigned/).first().waitFor();
        await pause(page, 600);
        await page.getByRole("checkbox", { name: "Select Keerthana S" }).click();
        await page.getByRole("checkbox", { name: "Select Varun Reddy" }).click();
        await pause(page, 1200);
        await page.getByRole("button", { name: "Clear selection" }).click();
      },
    },

    { chapter: "On the sales executive's phone" },
    {
      id: "phone-myday",
      phone: PHONE_LABEL,
      say: "This is Neha's phone. The app opens on My day: her calls today, the follow-ups due, this month's targets, and her calls over the last two weeks.",
      run: async (phone) => {
        await unlock(phone);
        await phone.tap("My day");
        await phone.wait(1500);
        await phone.scroll(900);
        await phone.wait(1500);
        await phone.scroll(-900);
      },
    },
    {
      id: "phone-leads",
      phone: PHONE_LABEL,
      say: "Under Leads, Due now, Ritika is already on the list: the manager gave her the lead a moment ago, and a new lead should be called within the hour. Swipe a lead right to call it, or left to open WhatsApp.",
      run: async (phone) => {
        await phone.tap("Leads");
        await phone.tap("Due now");
        for (let i = 0; i < 6 && !(await phone.has(NAME)); i++) {
          await phone.swipe(640, 900, 640, 1900, 500); // pull to refresh
          await phone.wait(1500);
        }
        await phone.find(NAME);
      },
    },
    {
      id: "phone-call",
      phone: PHONE_LABEL,
      say: "Open the lead. The number, the stage, the treatment and the follow-ups are all on one screen. Tap Call. The call goes out through the phone's own dialer, so the patient sees a normal call from Neha's number.",
      run: async (phone) => {
        await phone.tap(NAME);
        await phone.find(/^Lead #/);
        await phone.wait(1200);
        await phone.tap("Call");
        const dial = await phone.find((n) => n.desc === "Call" && n.clickable, { timeout: 15_000 });
        await phone.wait(1200);
        await phone.tapXY((dial.bounds[0] + dial.bounds[2]) / 2, (dial.bounds[1] + dial.bounds[3]) / 2);
        await phone.find("How did the call go?", { timeout: 30_000 });
      },
    },
    {
      id: "phone-notes",
      phone: PHONE_LABEL,
      say: "When the call ends, the app asks how it went, by itself. Tap Spoke, type a short note, pick the next step, here call tomorrow, and the new stage, interested. Save. With no signal, it is kept on the phone and sent as soon as the internet is back.",
      run: async (phone) => {
        await phone.tap("Spoke");
        await phone.tap("Notes");
        await phone.type("Wants FUE hair transplant. Asked about price, EMI and recovery.");
        phone.hideKeyboard();
        await phone.wait(500);
        await phone.tap("Call tomorrow");
        await phone.tap("Interested");
        await phone.wait(800);
        await phone.tap("Save notes");
        await phone.wait(1500);
      },
    },
    {
      id: "phone-book",
      phone: PHONE_LABEL,
      say: "She would like to meet the doctor. Tap Book, choose the doctor, the day and a free time, and book the consultation. The free times come from the doctor's own schedule, so a slot can never be double booked, and reception sees the booking at once.",
      run: async (phone) => {
        await phone.tap("Book");
        await phone.tap("Choose…");
        await phone.tap("Dr Kavya Menon");
        await phone.tap("Tomorrow");
        await phone.tap(/^11:00 AM/);
        await phone.wait(800);
        await phone.tap("Book", { index: 0 });
        await phone.find(/^Booked for/, { timeout: 15_000 }).catch(() => {});
        await phone.wait(1500);
      },
    },
    {
      id: "phone-followups",
      phone: PHONE_LABEL,
      say: "The Follow-ups tab lists every call she has planned: overdue first, then today, then the next seven days. Tap Done when a follow-up is finished.",
      run: async (phone) => {
        await phone.back();
        await phone.tap("Follow-ups");
        await phone.wait(2500);
      },
    },

    { chapter: "Back on the computer" },
    {
      id: "lead-page",
      say: "Back on the computer, the manager opens Ritika's lead. The call notes, the stage, tomorrow's call and the booking are already here: the phone sent them straight away.",
      run: async (page) => {
        await page.goto(`${BASE}/leads`);
        await type(page.getByLabel("Search", { exact: true }), "Ritika", 70);
        await pause(page, 1200);
        await page.getByRole("link", { name: NAME }).first().click();
        await page.getByRole("heading", { name: NAME }).waitFor();
        leadUrl = page.url();
        await pause(page, 1500);
      },
    },
    {
      id: "lead-tabs",
      say: "The Calls tab has every call with its notes. Bookings shows the consultation. History is the full story of the lead, step by step.",
      run: async (page) => {
        for (const tab of [/^Calls/, /^Bookings/, /^History/]) {
          await page.getByRole("tab", { name: tab }).click();
          await pause(page, 1800);
        }
      },
    },
    {
      id: "agreed",
      say: "When the patient agrees a price, record it with Agreed amount. Reception sees it when they start the treatment.",
      run: async (page) => {
        await page.getByRole("tab", { name: "Details" }).click();
        await page.getByRole("button", { name: "More", exact: true }).click();
        await pause(page, 400);
        await page.getByRole("menuitem", { name: "Agreed amount" }).click();
        const dialog = page.getByRole("dialog");
        await type(dialog.getByLabel("Amount finalised (agreed)"), "115000");
        await pause(page, 400);
        await dialog.getByRole("button", { name: "Save amount" }).click();
        await page.getByText(/Agreed amount saved/).first().waitFor();
      },
    },
    {
      id: "dashboard",
      say: "The sales dashboard shows how the team is doing. Let's look at last month: new leads, how many were called within the hour, consultations booked, the show rate and conversions.",
      run: async (page) => {
        await page.goto(`${BASE}/leads/dashboard`);
        await page.getByRole("heading", { name: "Sales dashboard" }).waitFor();
        await choose(page, page.getByRole("combobox", { name: "Period" }), "Last month");
        await pause(page, 2500);
      },
    },
    {
      id: "dashboard-charts",
      say: "The funnel shows how far the leads got, and the next chart where they came from. Further down, each person's numbers side by side.",
      run: async (page) => {
        await scroll(page, 480, 1600);
        await pause(page, 2000);
        await scroll(page, 600, 1800);
        await pause(page, 1500);
      },
    },
    {
      id: "targets",
      say: "Targets: each sales executive's monthly goal for conversions, the agreed amount and calls, and how far they have got.",
      run: async (page) => {
        await page.goto(`${BASE}/targets`);
        await page.getByRole("heading", { name: "Sales targets" }).waitFor();
        await pickMonth(page, page.getByLabel("Month", { exact: true }), lastMonth());
        await pause(page, 2000);
      },
    },
    {
      id: "ads",
      say: "And Ads: what each Facebook and Instagram campaign cost, and what it brought in. Leads, bookings, patients, and the money collected from them.",
      run: async (page) => {
        await page.goto(`${BASE}/ads`);
        await page.getByRole("heading", { name: "Ads", level: 1 }).waitFor();
        await choose(page, page.getByRole("combobox", { name: "Period" }), "Last month");
        await pause(page, 2000);
        await scroll(page, 520, 1600);
        await pause(page, 1500);
        await scroll(page, 520, 1600);
      },
    },
    {
      id: "outro",
      say: "That's the leads flow: every enquiry has an owner, a next call and a clear stage, from the first message to a booked patient.",
      run: async (page) => {
        await page.goto(leadUrl);
        await page.getByRole("heading", { name: NAME }).waitFor();
        await pause(page, 1500);
      },
    },
  ],
};

function lastMonth() {
  const d = new Date(Date.now() + 5.5 * 3600_000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}
