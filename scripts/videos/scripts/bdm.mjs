// Video 5 — BDM field work: a business development manager's day on the phone app (selfie start at the
// office, travel, visit, lead from the visit, break, back to the office, end of day), and what the admin
// sees on the computer (live map, day sheet, Excel report). All places and people are made up.
import { execFileSync } from "node:child_process";
import { BASE, login } from "../lib/browser.mjs";
import { pause, scroll } from "../lib/director.mjs";
import { freshLogin, unlock } from "../lib/phone.mjs";

const PHONE_LABEL = "Bhavya’s phone · BDM";
const BDM_ID = "00000000-0000-4000-a000-000000000005";
const PLACE = "Greenview Kids Clinic, JP Nagar";
const OFFICE = [12.92992, 77.58262];
const ROUTE = [OFFICE, [12.92, 77.584], [12.912, 77.5848], [12.9063, 77.5857]];

/**
 * The route estimate normally comes from the online routing service (OpenRouteService), which the
 * local demo has no key for: save one from the straight-line distance instead (local database only).
 */
function estimateRoutes() {
  const sql = `
    select public.route_estimate_save(v.id, true, round(d * 1.3)::int, greatest(round(d * 1.3 / 1000 * 2.5), 1)::int)
    from (select id, 2 * 6371000 * asin(sqrt(power(sin(radians(reached_lat - start_lat) / 2), 2)
            + cos(radians(start_lat)) * cos(radians(reached_lat)) * power(sin(radians(reached_lng - start_lng) / 2), 2))) as d
          from public.site_visits where estimate_status = 'pending' and reached_at is not null
            and start_lat is not null and reached_lat is not null) v`;
  execFileSync("docker", ["exec", "supabase_db_pearl-crm", "psql", "-U", "postgres", "-qtAc", sql]);
}

/** A tab in the phone's bottom bar (the same word can also be a tile or heading on the screen). */
const tab = (label) => (n) => n.text === label && n.bounds[1] > 2400;

/**
 * The visit cards' "km driven" is filled in when the day's trips are built (at End day). Build them
 * now so the Visits tab shows the real distance mid-day (local database only).
 */
function buildTrips() {
  execFileSync("docker", ["exec", "supabase_db_pearl-crm", "psql", "-U", "postgres", "-qtAc",
    `select private.bdm_build_trips(id) from public.bdm_days where staff_id = '${BDM_ID}' and ended_at is null`]);
}

function yesterday() {
  const d = new Date(Date.now() + 5.5 * 3600_000 - 86_400_000);
  return d.toISOString().slice(0, 10);
}

export default {
  title: "Pearl Clinic CRM — BDM field work",
  file: "5-bdm.mp4",
  async setup(page) {
    await login(page, "admin");
    await page.goto(`${BASE}/bdm`);
    await page.getByRole("heading", { name: "BDM field work" }).waitFor();
    await pause(page, 1500);
  },
  async phoneSetup(phone) {
    phone.geo(...OFFICE);
    await freshLogin(phone, "bdm");
  },
  scenes: [
    { chapter: "BDM field work", description: "A business development manager’s day, on the phone and on the computer" },
    {
      id: "intro",
      say: "This video follows a business development manager, or BDM. BDMs visit hospitals, clinics and companies to bring in referrals. The phone app records their day, and the admin sees it here, on the BDM page.",
      run: async (page) => {
        await page.mouse.move(700, 420, { steps: 20 });
        await pause(page, 1500);
        await page.getByText("Bhavya BDM").first().hover();
      },
    },

    { chapter: "On the BDM’s phone" },
    {
      id: "phone-start",
      phone: PHONE_LABEL,
      say: "This is Bhavya's phone. The day starts at the office. Tap Take selfie and start. The app takes a selfie, checks that the phone really is at the office, and starts recording the route.",
      run: async (phone) => {
        await unlock(phone);
        await phone.find("Take selfie and start");
        await phone.wait(1200);
        await phone.tap("Take selfie and start");
        await phone.tap("Shutter", { timeout: 30_000 });
        await phone.tap("Done", { timeout: 30_000 });
        await phone.find("At the office", { timeout: 30_000 });
      },
    },
    {
      id: "phone-travel",
      phone: PHONE_LABEL,
      say: "Going out for a visit? Tap Start travel, type where you are going and why, and start. The route is recorded in the background, even with the screen off or no signal.",
      run: async (phone) => {
        await phone.tap("Start travel");
        await phone.fill(/^Place/, PLACE);
        await phone.fill("Purpose (optional)", "Referral tie-up for skin and hair");
        phone.hideKeyboard();
        await phone.wait(600);
        await phone.tap("Start");
        await phone.find("Travelling", { timeout: 15_000 });
      },
    },
    { offscreen: async (phone) => phone.drive(ROUTE) },
    {
      id: "phone-reached",
      phone: PHONE_LABEL,
      say: "On arrival, tap Reached. A photo of the place is optional proof of the visit. Then tap Mark reached.",
      run: async (phone) => {
        await phone.tap("Reached");
        await phone.tap("Take photo");
        await phone.tap("Shutter", { timeout: 30_000 });
        await phone.tap("Done", { timeout: 30_000 });
        await phone.find("Photo ready ✓");
        await phone.wait(500);
        await phone.tap("Mark reached");
        await phone.find("At a visit", { timeout: 15_000 });
      },
    },
    {
      id: "phone-complete",
      phone: PHONE_LABEL,
      say: "After the meeting, tap Complete visit. Write what happened, who you met, their number and role, and how interested they are.",
      run: async (phone) => {
        await phone.tap("Complete visit");
        await phone.fill("What happened", "Met the medical director. Happy to refer hair and skin patients.");
        await phone.fill("Person you met (optional)", "Dr Meera Iyer");
        await phone.fill("Their phone (optional)", "9000312233");
        await phone.fill("Their role (optional)", "Medical director");
        phone.hideKeyboard();
        await phone.wait(500);
        await phone.tap("Hot");
      },
    },
    {
      id: "phone-lead",
      phone: PHONE_LABEL,
      say: "Met someone who wants a treatment? Tick Add a lead from this visit, and type their name and number. Save the visit. The lead goes straight to the sales team, linked to this visit.",
      run: async (phone) => {
        await phone.tap("Add a lead from this visit");
        await phone.fill("Lead name", "Arjun Nair");
        await phone.fill("Lead phone", "9000415566");
        await phone.fill("Treatment (optional)", "Hair transplant");
        phone.hideKeyboard();
        await phone.wait(600);
        await phone.tap("Save visit");
        await phone.find("Start travel", { timeout: 15_000 });
      },
    },
    {
      id: "phone-break",
      phone: PHONE_LABEL,
      say: "Breaks are recorded too. Tap Take a break, choose the type and the minutes, and start it. Tap End break when you are back.",
      run: async (phone) => {
        await phone.tap("Take a break");
        await phone.tap("Choose…");
        await phone.tap("Lunch");
        await phone.wait(500);
        await phone.tap("Start break");
        await phone.find("On a break", { timeout: 15_000 });
        await phone.wait(1800);
        await phone.tap("End break");
        await phone.find("Travelling", { timeout: 15_000 });
      },
    },
    {
      offscreen: async (phone) => {
        await phone.drive([...ROUTE].reverse());
        estimateRoutes();
        buildTrips();
      },
    },
    {
      id: "phone-office",
      phone: PHONE_LABEL,
      say: "Back at the office, tap I'm at the office. My day shows today's visits, the kilometres driven, the leads, and how the time was spent: travel, meetings, breaks and office.",
      run: async (phone) => {
        await phone.tap("I'm at the office");
        await phone.find("At the office", { timeout: 15_000 });
        await phone.tap(tab("Visits"));
        await phone.wait(400);
        await phone.tap("My day");
        await phone.find(/^Time: travel/, { timeout: 15_000 });
      },
    },
    {
      id: "phone-lists",
      phone: PHONE_LABEL,
      say: "The Visits tab lists today's visits, with the kilometres driven against the expected route. The Leads tab has the leads Bhavya brought in.",
      run: async (phone) => {
        await phone.tap(tab("Visits"));
        await phone.find(PLACE, { timeout: 15_000 });
        await phone.wait(2500);
        await phone.tap(tab("Leads"));
        await phone.find("Arjun Nair", { timeout: 15_000 });
        await phone.wait(1500);
        await phone.tap("My day");
      },
    },

    { chapter: "On the admin’s computer" },
    {
      id: "live",
      say: "On the computer, the BDM page shows where each BDM is right now on a live map, with their status, when the phone was last seen, and its battery. If a day started late, it says so.",
      run: async (page) => {
        await page.reload();
        await page.getByRole("heading", { name: "BDM field work" }).waitFor();
        await page.waitForLoadState("networkidle").catch(() => {});
        await pause(page, 1500);
        await page.getByText("Bhavya BDM").first().hover();
        await pause(page, 1500);
        await page.getByText("Started late").first().hover();
      },
    },

    { chapter: "Back on the phone" },
    {
      id: "phone-end",
      phone: PHONE_LABEL,
      say: "At the end of the day, Bhavya taps End day. Route recording stops, and the day is closed.",
      run: async (phone) => {
        await phone.tap("End day");
        await phone.find("End your day?");
        await phone.wait(1200);
        await phone.tap("End day");
        await phone.find("Day ended", { timeout: 15_000 });
      },
    },

    { chapter: "The day sheet" },
    {
      id: "sheet-today",
      say: "Day sheet opens one BDM's day: kilometres driven to visits against the expected route, visits, leads, break time, and when the day started and ended. Show selfie opens the photo taken at the start.",
      run: async (page) => {
        await page.reload();
        await page.getByRole("heading", { name: "BDM field work" }).waitFor();
        await page.getByRole("link", { name: "Day sheet" }).first().click();
        await page.getByRole("heading", { name: /day sheet/ }).waitFor();
        await page.waitForLoadState("networkidle").catch(() => {});
        await pause(page, 1500);
        await page.getByRole("button", { name: "Show selfie" }).hover();
        await pause(page, 1500);
      },
    },
    {
      id: "sheet-route",
      say: "Below, the route on the map, and What happened: every step of the day, with its time.",
      run: async (page) => {
        await scroll(page, 420, 1600);
        await pause(page, 2500);
      },
    },
    {
      id: "sheet-yesterday",
      say: "Use the arrows or the date to see another day. Yesterday, Bhavya visited three places, drove seventeen kilometres in all, and brought in two leads.",
      run: async (page) => {
        await page.goto(`${BASE}/bdm/${BDM_ID}?date=${yesterday()}`);
        await page.getByRole("heading", { name: /day sheet/ }).waitFor();
        await page.waitForLoadState("networkidle").catch(() => {});
        await pause(page, 2000);
        await page.getByRole("button", { name: "Previous day" }).hover();
        await pause(page, 1200);
        await scroll(page, 420, 1600);
        await pause(page, 1200);
      },
    },
    {
      id: "sheet-visits",
      say: "Each visit shows when Bhavya left, reached and finished, the kilometres driven against the expected route, the notes, the person met, how interested they were, and the lead it brought in. A break longer than planned is marked.",
      run: async (page) => {
        await scroll(page, 650, 1800);
        await pause(page, 3500);
        await page.getByText("Longer than planned").first().hover();
      },
    },
    {
      id: "report",
      say: "Back on the BDM page, Report for Excel gives one row per BDM per day, for any dates: start and end, the office check, visits, leads, kilometres and breaks.",
      run: async (page) => {
        await page.goto(`${BASE}/bdm`);
        await page.getByRole("heading", { name: "BDM field work" }).waitFor();
        await page.getByRole("button", { name: "Download Excel" }).scrollIntoViewIfNeeded();
        await pause(page, 1200);
        await page.getByRole("button", { name: "Download Excel" }).click();
        await page.getByText(/rows? done|Downloaded|\d+ rows?/).first().waitFor({ timeout: 15_000 }).catch(() => {});
        await pause(page, 1500);
      },
    },
    {
      id: "outro",
      say: "That's BDM field work: a selfie start at the office, every visit and lead on the phone, and a clear day sheet for the admin.",
      run: async (page) => {
        await scroll(page, -900, 1600);
        await pause(page, 1500);
      },
    },
  ],
};
