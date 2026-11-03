// Video 1 — All features: a tour of the whole CRM, one role at a time. Reception (front desk, patients,
// bills, pharmacy), the sales manager (leads, ads, recordings, targets), the admin (dashboard, BDM page,
// settings), then the phone app of a sales executive and a BDM. Each flow has its own, longer video.
import { BASE, login } from "../lib/browser.mjs";
import { pause, scroll } from "../lib/director.mjs";
import { freshLogin, unlock } from "../lib/phone.mjs";

/** Click a page in the sidebar and wait for its heading. */
async function open(page, link, heading = link) {
  // A menu link can carry a count badge ("Pharmacy 5"), so match the name with an optional number.
  const name = new RegExp(`^${link.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s*\\d+| \\(.*\\))?$`);
  await page.getByRole("link", { name }).first().click();
  await page.getByRole("heading", { name: heading, level: 1 }).waitFor({ timeout: 20_000 });
  await pause(page, 900);
}

/** Log in as someone else with the video's clock stopped, and land on their Home page. */
const as = (username) => ({
  offscreen: async (_phone, page) => {
    await page.context().clearCookies();
    await login(page, username);
    await page.goto(`${BASE}/home`);
    await page.getByRole("heading", { level: 1 }).first().waitFor();
    await pause(page, 1200);
  },
});

/** Scroll down a page and back, so the whole of it is seen. */
async function look(page, dy = 500) {
  await scroll(page, dy, 1500);
  await pause(page, 900);
  await scroll(page, -dy, 1200);
}

export default {
  title: "Pearl Clinic CRM — All features",
  file: "1-all-features.mp4",
  async setup(page) {
    await login(page, "reception");
    await page.goto(`${BASE}/home`);
    await page.getByRole("heading", { level: 1 }).first().waitFor();
    await pause(page, 1500);
  },
  async phoneSetup(phone) {
    await freshLogin(phone, "neha");
  },
  scenes: [
    { chapter: "Pearl Clinic CRM", description: "Everything in one place: reception, sales, admin and the phone app" },
    {
      id: "intro",
      say: "This is a quick tour of the whole clinic system. Reception, the sales manager and the admin work on a computer. Sales executives and BDMs use the phone app. Everyone sees only what their job needs.",
      run: async (page) => {
        await page.mouse.move(800, 420, { steps: 20 });
        await pause(page, 1500);
        await page.getByRole("navigation").first().hover().catch(() => {});
      },
    },

    { chapter: "Reception", description: "Front desk, patients, bills and pharmacy" },
    {
      id: "home",
      say: "Reception starts on Home: today's appointments, who has arrived, what is still to do, and quick buttons to book an appointment or add a walk-in.",
      run: async (page) => {
        await page.getByRole("button", { name: "Book appointment" }).first().hover();
        await pause(page, 1000);
        await look(page, 400);
      },
    },
    {
      id: "appointments",
      say: "Appointments shows each doctor's day side by side. Free times come from the doctor's own hours and leave, so a slot can never be double booked. Patients get a WhatsApp message to confirm.",
      run: async (page) => {
        await open(page, "Appointments");
        await pause(page, 1200);
        await look(page, 400);
      },
    },
    {
      id: "patients",
      say: "Patients holds every patient's file: their details, visits, prescriptions, treatment sessions, bills and messages. Search by name, phone number or patient ID from the bar at the top.",
      run: async (page) => {
        await open(page, "Patients");
        await page.locator("main a, main tbody tr").first().hover().catch(() => {});
        await pause(page, 1000);
        await look(page, 450);
      },
    },
    {
      id: "new-patient",
      say: "New patient opens a short form. Only the name and mobile number are needed; the rest can be filled in later.",
      run: async (page) => {
        await page.getByRole("link", { name: "New patient" }).first().click();
        await page.getByRole("heading", { name: "New patient", level: 1 }).waitFor();
        await pause(page, 1500);
        await look(page, 350);
      },
    },
    {
      id: "ip",
      say: "IP stays covers patients admitted after surgery: the room, daily charges, nursing notes and the discharge summary, all printed from templates.",
      run: async (page) => {
        await open(page, "IP stays");
        await pause(page, 1500);
        await look(page, 350);
      },
    },
    {
      id: "bills",
      say: "Bills lists every bill with its total, GST, what was paid and what is still due. Open one to see the breakdown by category and tax, print it, or send it on WhatsApp.",
      run: async (page) => {
        await open(page, "Bills");
        await pause(page, 1200);
        await look(page, 450);
      },
    },
    {
      id: "pharmacy",
      say: "Pharmacy keeps the stock of medicines by batch and expiry. Sell from here, receive new stock, and see alerts for low stock and medicines close to expiry.",
      run: async (page) => {
        await open(page, "Pharmacy");
        await pause(page, 1200);
        await look(page, 450);
      },
    },
    {
      id: "followups",
      say: "Follow-ups reminds the team who to call back, for example after a treatment session. And WhatsApp is the shared inbox for every chat with patients.",
      run: async (page) => {
        await open(page, "Follow-ups");
        await pause(page, 1500);
        await open(page, "WhatsApp");
        await pause(page, 1200);
      },
    },

    as("manager"),
    { chapter: "Sales manager", description: "Leads, ads, call recordings and targets" },
    {
      id: "leads",
      say: "The sales manager works on Leads: every enquiry from ads, WhatsApp, the website, walk-ins, referrals and BDM visits. Each lead has an owner, a stage and a next call. New leads are shared out in turn.",
      run: async (page) => {
        await open(page, "Leads");
        await page.locator("tbody tr").first().hover().catch(() => {});
        await pause(page, 1000);
        await look(page, 450);
      },
    },
    {
      id: "ads",
      say: "Ads shows the Facebook and Instagram campaigns: money spent, leads from Meta and in the CRM, cost per lead, and how many were booked.",
      run: async (page) => {
        await open(page, "Ads");
        await pause(page, 1200);
        await look(page, 500);
      },
    },
    {
      id: "recordings",
      say: "Recordings keeps the call recordings that the sales phones upload, so the manager can listen to any call. Targets sets each person's goals for the month and shows how close they are.",
      run: async (page) => {
        await open(page, "Recordings");
        await pause(page, 1500);
        await open(page, "Targets", "Sales targets");
        await pause(page, 1200);
      },
    },

    as("admin"),
    { chapter: "Admin", description: "The numbers, the field team and the settings" },
    {
      id: "dashboard",
      say: "The admin sees everything. The Dashboard shows revenue and collections, revenue by category and by lead source, payment modes, what is still owed, the sales funnel, and each doctor's numbers.",
      run: async (page) => {
        await open(page, "Dashboard");
        await pause(page, 1200);
        await scroll(page, 600, 1500);
        await pause(page, 800);
        await scroll(page, 600, 1500);
        await pause(page, 800);
        await scroll(page, -1200, 1500);
      },
    },
    {
      id: "bdm",
      say: "The BDM page shows on a live map where each business development manager is, their day sheet with visits and kilometres, and a monthly report for Excel.",
      run: async (page) => {
        await open(page, "BDM", "BDM field work");
        await pause(page, 1500);
        await look(page, 450);
      },
    },
    {
      id: "settings",
      say: "Under Admin are all the settings: the clinic's details printed on bills, staff logins, doctors and their hours, services, treatments, medicines, room rates, WhatsApp, imports, backups and the change history.",
      run: async (page) => {
        await open(page, "Admin");
        await pause(page, 1200);
        await look(page, 550);
      },
    },
    {
      id: "clinic",
      say: "For example, Clinic profile holds the name, logo, GST number, address and the terms printed on every bill. Nothing is fixed in the program, so the clinic can change it any time.",
      run: async (page) => {
        await page.getByRole("link", { name: /Clinic profile/ }).first().click();
        await page.getByRole("heading", { name: "Clinic profile", level: 1 }).waitFor();
        await pause(page, 1500);
        await look(page, 450);
      },
    },

    { chapter: "The phone app", description: "For sales executives and BDMs" },
    {
      id: "phone-myday",
      phone: "Neha’s phone · sales executive",
      say: "Sales executives use the phone app. My day shows today's calls, the follow-ups due, and the targets.",
      run: async (phone) => {
        await unlock(phone);
        await phone.tap("My day");
        await phone.wait(1500);
        await phone.scroll(800);
        await phone.wait(1200);
        await phone.scroll(-800);
      },
    },
    {
      id: "phone-leads",
      phone: "Neha’s phone · sales executive",
      say: "Leads lists her leads, those due now first. Swipe right to call, left to send a WhatsApp. After every call the app asks how it went, and the recording is uploaded.",
      run: async (phone) => {
        await phone.tap("Leads");
        await phone.wait(2000);
        await phone.tap("All");
        await phone.wait(2000);
        await phone.scroll(700);
        await phone.wait(1000);
      },
    },
    {
      id: "phone-calls",
      phone: "Neha’s phone · sales executive",
      say: "Follow-ups lists every call she has planned, and Calls shows her call history. It all works without signal and is sent when the internet is back.",
      run: async (phone) => {
        await phone.tap("Follow-ups");
        await phone.wait(2200);
        await phone.tap("Calls");
        await phone.wait(2200);
      },
    },
    { offscreen: async (phone) => freshLogin(phone, "bdm") },
    {
      id: "phone-bdm",
      phone: "Bhavya’s phone · BDM",
      say: "A BDM starts the day with a selfie at the office. The app then records the route, each visit with a photo and notes, the leads from visits, and the breaks.",
      run: async (phone) => {
        await unlock(phone);
        await phone.tap("My day");
        await phone.wait(2000);
        await phone.scroll(700);
        await phone.wait(1500);
        await phone.scroll(-700);
      },
    },
    {
      id: "outro",
      say: "That is the whole system. The other videos show each part step by step: the pharmacy and stock, a patient's journey to surgery, the leads, and a BDM's day.",
      run: async (page) => {
        await page.goto(`${BASE}/home`);
        await page.getByRole("heading", { level: 1 }).first().waitFor();
        await pause(page, 2500);
      },
    },
  ],
};
