# Continue here

Last updated 29/10/2026 (session 4). To resume, say: **"Read continue.md and carry on."**
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
| 0 Foundations | done, live on staging |
| 1 Admin + libraries | done, live, committed `5d75fa4` |
| 2 Patients | done, live, committed `ab74391` |
| 3 Appointments / Today board | done, live, committed `460f5ef` |
| 4 Treatments / sessions | done, live, committed `a2d5f27` |
| 5 Bills, payments, printing, KPI rollup | done, live, committed (Phase 5) |
| 6 Pharmacy & inventory | done, live, committed (Phase 6) |
| **7 IP stay, final bill, discharge** | **NEXT** |
| 8 Scanning | being built by a parallel agent in a git worktree (migration `20261031100000_phase8_scanning.sql`, test `11_scanning`); review, merge, deploy, run e2e |
| 9–15 | not started |

Staging: migrations up to `20261029100000_phase6_pharmacy.sql` are pushed; 328 DB tests pass (`01`–`09`); staging logins exist (usernames admin/reception/manager/sales/bdm, password = STAGING_TEST_PASSWORD in .env).

## Next
Phase 7 (IP stay, final bill, discharge summary) per PLAN.md E3. Use migration timestamp `20261030100000` and pgTAP file `10_ip_stay.test.sql` (11 is the scanning agent's). Carried-in lines + `consolidated_into_id` already exist from Phase 5.

## Still open with the owner
- Push commits to GitHub (VS Code Sync). After pushing, CI annotations (Playwright "github" reporter) are readable without login.
- GitHub secrets SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF / SUPABASE_DB_PASSWORD for the auto-deploy job (it skips with a warning until set).
- Vercel env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, CRON_SECRET, NEXT_PUBLIC_TURNSTILE_SITE_KEY. Turnstile uses Cloudflare test keys until real ones are added.
- Full brief sections 15–19 (`CLINIC_CRM_BUILD_PROMPT.md`), PLAN.md A1 answers, Vercel Pro / Supabase Pro before go-live.
