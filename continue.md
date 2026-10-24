# Continue here

Last updated 24/10/2026 (session 5). To resume, say: **"Read continue.md and carry on."**

## FIRST, on another computer: pull
Everything is pushed to GitHub (`origin/main`, plus the unmerged WIP branch). Before anything else:
```
git clone https://github.com/dhanushkumar-merndev/pearls-crm-final.git pearls   # first time only
cd pearls
git checkout main && git pull        # every time you sit down at a computer
pnpm install
```
Not in git (git-ignored, copy by hand or recreate): the root `.env` (template `.env.example`, then `pnpm env:sync`), `docs/` (private patient data), `android/local.properties`. Always `git pull` before starting and push (VS Code → Sync) when you finish, so the two computers don't diverge.
Read `CLAUDE.md` and `dev-docs/PLAN.md` first (PLAN.md section G lists every decision made while building).

## Owner's standing instructions
- Build **all phases** (PLAN.md E3, 1→15) to production-ready **without stopping** between phases; each phase must pass its tests first.
- **Logins are username + password only, for every role** (no email logins, OTP or reset links). Admin sets passwords; staff change their own under the user menu.
- Vercel deploys itself from git pushes — don't set up Vercel. **Pushing** is done by the owner (VS Code → Sync); this terminal has no GitHub login. Commits are made here.
- Repo is public: run `pnpm precommit:scan` before every commit.

## How to work without Docker (this PC)
- `pnpm db:test:remote [filter]` — pgTAP files against the online staging DB; unpushed migrations are applied inside the test transaction and rolled back.
- `pnpm sql:check <file.sql>` — runs a migration in a rolled-back transaction and prints the failing line.
- `pnpm sql "select …"` (read-only) / `pnpm sql --pending "…"`.
- Deploy a tested migration: dry run first (`supabase db push --linked --dry-run` via the tsx one-liner used before), then `pnpm deploy:supabase`, then re-run `pnpm db:test:remote`.
- `pnpm db:concurrency` with DATABASE_URL on port 6543 (transaction pooler): the `.env` URL is the 5432 session pooler (15-client cap), so swap the port for this script.
- Logged-in browser tests on staging: `cd web && E2E_DB=1 E2E_PASSWORD=<STAGING_TEST_PASSWORD> CI=1 pnpm exec playwright test` (auth.setup.ts logs in once per role).
- Every migration ends with `select private.lock_down_public_functions();`. Server-only functions: also revoke from `authenticated`.
- DB tests must not assume an empty database (staging has E2E data).

## Status
| Phase | State |
|---|---|
| 0–8 | done, live on staging, committed (Phase 8 merged `0843e48`) |
| UI rules | full-width pages + themed dropdowns (`components/ui/select.tsx`), committed `a323b70` (rules in CLAUDE.md) |
| **9 Leads + Meta Lead Ads** | **part 1 committed `be4b3e9`**: migration `20261101100000_phase9_leads.sql` (NOT deployed yet), `13_leads` (78 tests; all 13 DB files = 533 pass with it pending), `meta-leads` Edge Function (11 Deno tests, not deployed), lead CSV mapping (`mapLeadColumns/mapLeadRow`), web components in `web/components/leads/` (written, not wired into pages) |
| 11 Android stage 1 | merged `26825ba` from the helper's worktree: project, login, PIN, role menus, Room, outbox + pull sync, LibraryPicker, settings. `./gradlew test` (5 tests) and `assembleDebug` pass. Sync/PIN/LibraryPicker unit tests and the CI job were NOT written yet. Branch `worktree-agent-af06e1393b4ca70be` also has an unverified WIP commit `331670f` (Gradle plugin clean-up) — not merged |
| 10, 12–15 | not started |

## Next (Phase 9 part 2)
1. Wire the web: `lib/nav.ts` Leads item (roles sales_manager + admin, `badge: "leads"`, `badgeLabelKey: "nav.leadsWithCount"`; sidebar uses `item.badgeLabelKey ?? "nav.withCount"`), SM primary action → `/leads?new=1`; command palette: `canSearchPeople(role)` + `searchHref(hit, role)` from `lib/search-href.ts`, heading key `search.results`.
2. Add the `leads` namespace to `web/messages/en.json` (keys used in `components/leads/*`), plus `nav.leads`, `nav.leadsWithCount`, `search.results`.
3. Pages: `/leads` (LeadsTable + NewLeadDialog, layout guard SM/A), `/leads/[id]` (detail: edit, stage, amount finalised + lock, notes/activities, calls + log call, book consultation via BookDialog with a lead, link to patient, duplicates), `/leads/import` (ImportScreen kind "leads" → `import_leads`), `/leads/pool` (round-robin pool), `/admin/meta-leads` (field map in settings `sales.meta_field_map`, events + retry), sales manager home = `dashboard_sales_manager` charts.
4. Today board / appointment actions: lead-only bookings (`lead_only`, "Register as patient" → `/patients/new?lead=` using `lead_for_registration`, then `link_lead_to_patient`); Start treatment shows the agreed price from `patient_leads`.
5. e2e `leads.db.spec.ts`, then deploy (dry run → `pnpm deploy:supabase`, functions incl. meta-leads), `dev-docs/SETUP_META.md`, PLAN.md G notes for Phase 9.

## Login-form validation (from another Claude session) — now committed
`loginSchema` (zod) in `packages/shared/src/auth.ts`, `login-form.tsx` (field errors, focus first bad field, "forgot password" link removed), `login.spec.ts` + screenshots, login keys in `en.json`. Committed as its own commit but not re-verified after the hand-off: run `pnpm test` and the login e2e once.

## Still open with the owner
- Tigris bucket `pearl-staging` CORS: add the Vercel URL and `http://127.0.0.1:3417` (browser tests) to the allowed origins — the CLI key gets "Access Denied". Until then 3 scanning browser tests (offline, duplicate, phone) fail on upload. Also add the Vercel URL to `WEB_ORIGIN` in `.env` and run `pnpm supabase:configure`. Rotate `STAGING_TEST_PASSWORD` (it was shown once in a test log).
- Commits are pushed (24/10/2026); keep pushing via VS Code Sync or `git push`. After pushing, CI annotations (Playwright "github" reporter) are readable without login.
- GitHub secrets SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF / SUPABASE_DB_PASSWORD for the auto-deploy job (it skips with a warning until set).
- Vercel env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, CRON_SECRET, NEXT_PUBLIC_TURNSTILE_SITE_KEY. Turnstile uses Cloudflare test keys until real ones are added.
- Full brief sections 15–19 (`CLINIC_CRM_BUILD_PROMPT.md`), PLAN.md A1 answers, Vercel Pro / Supabase Pro before go-live.
