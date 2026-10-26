# Go-live checklist

Tick these in order when the clinic starts using the CRM for real. Each line says who does it and roughly how long it takes. "Dev" means whoever runs this project's commands.

## A. Accounts and money (owner, one evening)
- [ ] **Supabase Pro** ($25 ≈ ₹2,200 a month): supabase.com → the clinic project → Settings → Billing. This gives daily backups you can restore with one click, no pausing, and the leaked-password check. Afterwards, the dev runs `pnpm supabase:configure` once (it switches the check on).
- [ ] **Vercel**: connect the GitHub repository (vercel.com → Add New → Project → Import `pearls-crm-final`, Root Directory `web`). The site then deploys itself on every push; never upload by hand. A clinic is a business, so Vercel's terms need **Pro** ($20 a month) for production.
- [ ] **Domain** (optional): Vercel → Settings → Domains, for example `crm.yourclinic.in`. Then the dev adds it to `WEB_ORIGIN` in `.env` and runs `pnpm supabase:configure`.

## B. The clinic's own project (dev, about 1 hour)
Staging stays as the test copy; the clinic gets its own Supabase project.
- [ ] New Supabase project in **Mumbai**, then the steps in dev-docs/RESTORE.md 2.1 (`pnpm deploy:supabase`, `pnpm supabase:configure`).
- [ ] `pnpm advisors --strict` on the new project: "0 not accepted".
- [ ] Vercel → Environment Variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` from the clinic project, then Redeploy.
- [ ] GitHub → Settings → Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` of the clinic project (the auto-deploy job).
- [ ] The first admin login: `pnpm staging:bootstrap` is for staging only. For the clinic, create one admin in Supabase → Authentication, or ask the dev, then add everyone else in **Admin → Users**.
- [ ] Tigris bucket CORS allows the live web address (dev-docs/SETUP.md 2.2).

## C. Set up the clinic (admin, half a day)
- [ ] Admin → Clinic profile: name, GSTIN, address, logo, bill terms.
- [ ] Admin → Settings: appointments, billing (discount limits, rounding), storage limits (raise them on Pro: database 8 GB, files as bought), daily summary time.
- [ ] Doctors, schedules, holidays, services, treatments, rooms, medicines, lists (Admin → Libraries).
- [ ] Users: one login per person, with the right role. Add an **email** to each admin (Users → Edit) for alerts and the evening summary.
- [ ] Admin → Notifications: choose phone / email per kind of alert.
- [ ] Imports: patients from DocPulse, opening stock (Admin → Import; Excel templates are on the screen).
- [ ] WhatsApp (dev-docs/SETUP_WHATSAPP.md) and Meta Lead Ads (dev-docs/SETUP_META.md), when ready.

## D. Phones (dev + each salesperson / BDM)
- [ ] Signing key made and stored twice (dev-docs/RELEASE_ANDROID.md 1).
- [ ] The clinic's Firebase file in place for push (dev-docs/TRY_ANDROID.md 1).
- [ ] A release built against the clinic project and shared (RELEASE_ANDROID.md 2–4).
- [ ] On each phone model: the caller and recordings checklist (TRY_ANDROID.md 8) and, for BDMs, the route checklist (TRY_ANDROID.md 11).

## E. Before the first real day (admin + dev)
- [ ] A dry run: book, bill, take payment, print, and check that the dashboard shows it.
- [ ] Backup: Admin → Backup centre → choose the USB folder → export the database → copy files.
- [ ] **Restore drill** passes on that backup (dev-docs/RESTORE.md 1).
- [ ] Change the staging test password (`STAGING_TEST_PASSWORD`): it has been shown in test logs.

## F. Every week / month afterwards
- Weekly: backup (OPERATIONS.md section 4). The CRM reminds the admins on Mondays.
- Monthly: restore drill (RESTORE.md 1); look at the storage card on the dashboard.
- Each app update: RELEASE_ANDROID.md 3–4.
