import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { open, STATE } from "./helpers";

// Phase 15: an accessibility sweep. Every signed-in page (as the role that uses it) has no serious or
// critical axe finding, in the dark theme (the default) once its data has loaded. Pages that need a
// record (/patients/[id] …) are covered by their own specs' flows.
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");

async function sweep(page: Page, path: string) {
  await open(page, path);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(page.getByText(/^(Loading…|Loading chart…)$/)).toHaveCount(0, { timeout: 20_000 });
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.html.slice(0, 160)).join(" | ")}`);
  expect(bad, path).toEqual([]);
}

const PAGES = {
  admin: [
    "/home", "/dashboard", "/targets", "/admin", "/admin/users", "/admin/settings", "/admin/clinic", "/admin/audit",
    "/admin/backup", "/admin/notifications", "/admin/import", "/admin/review", "/admin/whatsapp", "/admin/drips",
    "/admin/meta-leads", "/admin/discharge-templates", "/admin/libraries/doctors", "/admin/libraries/holidays",
    "/admin/libraries/offices", "/admin/libraries/services", "/admin/libraries/treatments", "/admin/libraries/rooms",
    "/admin/libraries/medicines", "/admin/libraries/lists", "/bdm", "/recordings", "/account/password",
  ],
  reception: [
    "/home", "/patients", "/patients/new", "/patients/pending", "/patients/qr", "/appointments", "/sessions",
    "/followups", "/bills", "/admissions", "/pharmacy", "/whatsapp",
  ],
  manager: ["/home", "/leads", "/leads/dashboard", "/leads/pool", "/leads/import", "/targets"],
} as const;

for (const [role, paths] of Object.entries(PAGES) as [keyof typeof PAGES, readonly string[]][]) {
  test.describe(`${role} pages`, () => {
    test.use({ storageState: STATE[role] });
    for (const path of paths) test(`${path} has no serious accessibility issue`, ({ page }) => sweep(page, path));
  });
}
