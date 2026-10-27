import { expect, test } from "@playwright/test";
import { STATE } from "./helpers";

// W-ACC-01…06: every role × every page. Allowed → the page opens; not allowed → "This page doesn't
// exist" (the database refuses the data anyway: DB tests); phone-app roles → "Please use the mobile
// app"; logged out → the login page. Pages that need a record id are covered by their own specs.
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");

type WebRole = "admin" | "reception" | "manager";
const ALL: WebRole[] = ["admin", "reception", "manager"];
const DESK: WebRole[] = ["admin", "reception"];
const SALES: WebRole[] = ["admin", "manager"];
const ADMIN: WebRole[] = ["admin"];

const ROUTES: Record<string, WebRole[]> = {
  "/home": ALL,
  "/account/password": ALL,
  "/whatsapp": ALL,
  "/dashboard": ADMIN,
  "/design": ADMIN,
  "/bdm": ADMIN,
  "/leads": SALES,
  "/leads/dashboard": SALES,
  "/leads/pool": SALES,
  "/leads/import": SALES,
  "/recordings": SALES,
  "/targets": SALES,
  "/appointments": DESK,
  "/patients": DESK,
  "/patients/new": DESK,
  "/patients/pending": DESK,
  "/patients/qr": DESK,
  "/admissions": DESK,
  "/bills": DESK,
  "/pharmacy": DESK,
  "/followups": DESK,
  "/sessions": DESK,
  "/admin": ADMIN,
  "/admin/users": ADMIN,
  "/admin/settings": ADMIN,
  "/admin/clinic": ADMIN,
  "/admin/audit": ADMIN,
  "/admin/backup": ADMIN,
  "/admin/notifications": ADMIN,
  "/admin/import": ADMIN,
  "/admin/review": ADMIN,
  "/admin/whatsapp": ADMIN,
  "/admin/drips": ADMIN,
  "/admin/meta-leads": ADMIN,
  "/admin/discharge-templates": ADMIN,
  "/admin/libraries/doctors": ADMIN,
  "/admin/libraries/holidays": ADMIN,
  "/admin/libraries/offices": ADMIN,
  "/admin/libraries/services": ADMIN,
  "/admin/libraries/treatments": ADMIN,
  "/admin/libraries/rooms": ADMIN,
  "/admin/libraries/medicines": ADMIN,
  "/admin/libraries/lists": ADMIN,
};

const NOT_FOUND = "This page doesn't exist.";

for (const role of ALL) {
  test.describe(`${role}: every page`, () => {
    test.use({ storageState: STATE[role] });
    for (const [path, allowed] of Object.entries(ROUTES)) {
      const ok = allowed.includes(role);
      test(`${path} ${ok ? "opens" : "doesn't exist"}`, async ({ page }) => {
        const res = await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        if (ok) {
          expect(res?.status(), path).toBeLessThan(400);
          await expect(page.getByRole("heading", { name: NOT_FOUND })).toHaveCount(0);
          await expect(page).toHaveURL(new RegExp(`${path.replace(/\//g, "\\/")}$`));
        } else {
          await expect(page.getByRole("heading", { name: NOT_FOUND })).toBeVisible();
          expect(res?.status(), path).toBe(404);
        }
      });
    }
  });
}

test.describe("menu shows only the pages a role may open", () => {
  for (const role of ALL) {
    test.describe(role, () => {
      test.use({ storageState: STATE[role] });
      test(`${role}'s menu`, async ({ page }) => {
        await page.goto("/home");
        const menu = page.getByRole("navigation", { name: "Main menu" }).first();
        await expect(menu).toBeVisible();
        const hrefs = await menu.getByRole("link").evaluateAll((links) => links.map((a) => new URL((a as HTMLAnchorElement).href).pathname));
        for (const href of hrefs) {
          if (href in ROUTES) expect(ROUTES[href], `${role} sees ${href} in the menu`).toContain(role);
        }
      });
    });
  }
});

for (const role of ["sales", "bdm"] as const) {
  test.describe(`${role} (phone app) on the web`, () => {
    test.use({ storageState: STATE[role] });
    for (const path of ["/home", "/leads", "/patients", "/admin", "/dashboard"]) {
      test(`${path} → use the mobile app`, async ({ page }) => {
        await page.goto(path);
        await expect(page).toHaveURL(/\/use-the-app$/);
        await expect(page.getByRole("heading", { name: "Please use the mobile app" })).toBeVisible();
      });
    }
  });
}

test.describe("logged out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const path of ["/home", "/patients", "/admin/users", "/leads", "/print/bill/00000000-0000-0000-0000-000000000000"]) {
    test(`${path} → login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    });
  }
});
