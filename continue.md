# Continue here

Last updated 24/10/2026 (session 6). To resume, say: **"Read continue.md and carry on."**

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
| **9 Leads + Meta Lead Ads** | **DONE + deployed (session 6)**. Was: part 1 committed `be4b3e9`: migration `20261101100000_phase9_leads.sql` (NOT deployed yet), `13_leads` (78 tests; all 13 DB files = 533 pass with it pending), `meta-leads` Edge Function (11 Deno tests, not deployed), lead CSV mapping (`mapLeadColumns/mapLeadRow`), web components in `web/components/leads/` (written, not wired into pages) |
| 11 Android stage 1 | merged `26825ba` from the helper's worktree: project, login, PIN, role menus, Room, outbox + pull sync, LibraryPicker, settings. `./gradlew test` (5 tests) and `assembleDebug` pass. Sync/PIN/LibraryPicker unit tests and the CI job were NOT written yet. Branch `worktree-agent-af06e1393b4ca70be` also has an unverified WIP commit `331670f` (Gradle plugin clean-up) — not merged |
| **10 WhatsApp + drips** | **DONE + deployed (session 6)**: migration `20261103100000_phase10_whatsapp.sql`, functions `wa-webhook` / `wa-dispatch` / `wa-templates-sync`, Vault secrets + `EDGE_CRON_SECRET` via `pnpm supabase:configure`, pages Admin → WhatsApp / Drip campaigns, patient WhatsApp tab, lead WhatsApp card, `15_whatsapp` (31), e2e `whatsapp.db.spec.ts` (5). Owner setup: `dev-docs/SETUP_WHATSAPP.md` |
| 12–15 | not started |

## Session 6 (owner: "all phases, tested, production ready; validation missing; import has no template")
- DONE `cd14e32` validation on every form (shared rules `packages/shared/src/validation.ts`, hook `web/lib/use-zod-form.ts`, schemas `web/lib/schemas/*`, `packages/shared/src/{patient,lead}.ts`). New forms MUST use `useZodForm(schema)` + `Field error={checks.error(path)}`.
- DONE `61b641b` imports: templates, browser checks, server check run (migration `20261102100000_import_checks.sql`, NOT deployed; needs phase 9 deployed first), problem report CSV, leads import kind. Component `web/components/import/import-screen.tsx`.
- DONE Phase 9 part 2 (leads pages, pool, Meta admin, sales dashboard, reception hand-over, e2e `leads.db.spec.ts` 9/9) and DEPLOYED to staging: migrations 20261101100000 + 20261102100000 and all functions. Full e2e: 40 pass, 2 flaky, 3 known Tigris-CORS scanning failures.
- DONE Phase 10 (see the table). The database timer → `wa-dispatch` chain was checked live (pg_cron 200). `.env`: a value pasted over several lines (the Firebase JSON) broke the Supabase CLI and was read as "{" — it is now one line in single quotes, and `pnpm env:sync` refuses multi-line values.
- DONE WhatsApp team inbox + live updates (migration `20261104100000_wa_inbox.sql` deployed, `16_wa_inbox` 14 tests, e2e 6/6). Android: Gradle now runs on an auto-downloaded JDK 21 (`android/gradle/gradle-daemon-jvm.properties`; the PC only has Java 27, which breaks AGP's jlink); `android/local.properties` points at ~/Android/Sdk (not committed).
- NEXT: 11 (rest: Android sales features, sync/PIN/LibraryPicker tests, CI job), 12, 13, 14 (add `job_runs` purge), 15.

## Login-form validation (from another Claude session) — now committed
`loginSchema` (zod) in `packages/shared/src/auth.ts`, `login-form.tsx` (field errors, focus first bad field, "forgot password" link removed), `login.spec.ts` + screenshots, login keys in `en.json`. Committed as its own commit but not re-verified after the hand-off: run `pnpm test` and the login e2e once.

## Still open with the owner
- Tigris bucket `pearl-staging` CORS: the owner runs (after `pnpm exec tigris login`) `pnpm exec tigris buckets set-cors pearl-staging --origins http://localhost:3000,http://127.0.0.1:3417,https://pearl-sales.vercel.app --methods GET,HEAD,PUT --headers content-type --expose-headers ETag --override` — the CLI key gets "Access Denied" and Claude may not change it. Until then 3 scanning browser tests (offline, duplicate, phone) fail on upload. `WEB_ORIGIN` already has the three addresses (configured 24/10/2026). Rotate `STAGING_TEST_PASSWORD` (it was shown once in a test log).
- WhatsApp: the owner follows `dev-docs/SETUP_WHATSAPP.md` (number, token, webhook, templates). Until then sending is off and staff use the manual wa.me path.
- Commits are pushed (24/10/2026); keep pushing via VS Code Sync or `git push`. After pushing, CI annotations (Playwright "github" reporter) are readable without login.
- GitHub secrets SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF / SUPABASE_DB_PASSWORD for the auto-deploy job (it skips with a warning until set).
- Vercel env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, CRON_SECRET, NEXT_PUBLIC_TURNSTILE_SITE_KEY. Live site: https://pearl-sales.vercel.app (WEB_ORIGIN). Turnstile: real keys in .env since 24/10/2026; the Vercel env var NEXT_PUBLIC_TURNSTILE_SITE_KEY must hold the same site key.
- Full brief sections 15–19 (`CLINIC_CRM_BUILD_PROMPT.md`), PLAN.md A1 answers, Vercel Pro / Supabase Pro before go-live.
