# Continue here

Paused on 23/10/2026 (second session), in the middle of the **online setup**. Supabase is deployed and tested; Vercel and the staging logins wait on the owner. To resume, open Claude Code in this folder and say:

> Read continue.md and carry on from "Next steps".

Read `CLAUDE.md` and `dev-docs/PLAN.md` first, as always. No secrets are written in this file; they all live in the root `.env`, which git ignores.

---

## Decisions already made by the owner

| Decision | Answer |
|---|---|
| Workflow | **Continue through all phases** without waiting for sign-off after each one. Each phase must still pass its tests before the next starts. Use PLAN.md A2 defaults for unanswered A1 questions, and note each assumption in PLAN.md. |
| GitHub repo | `dhanushkumar-merndev/pearls-crm-final`, already set as `origin`. **Stays public** (owner's choice). So never commit `.env*`, `docs/`, keys, project refs or real data. |
| Auto-deploy | **Push to `main` deploys everything:** Vercel builds the website from GitHub, and a GitHub Action deploys Supabase migrations and functions **after the CI tests pass**. |
| Region | Mumbai: Supabase `ap-south-1` (already), Vercel `bom1` (`web/vercel.json`). Tigris has no India location, so the bucket is in Singapore (`sin`). |
| Supabase | Use the **access token in `.env`**; no CLI login. No Docker on this PC, so use the online project for DB work. |
| Staging logins | **Not** the public `Pearl@2026` seed password. One test login per role, with a random password stored in `.env` as `STAGING_TEST_PASSWORD`. |

---

## Done

### Tigris (private files): finished and tested
- Logged in with the Tigris CLI (project dev dependency: `pnpm exec tigris …`).
- Bucket **`pearl-staging`**: private, Singapore, CORS allows only `http://localhost:3000` (methods GET/HEAD/PUT, header content-type).
- Access key `pearl-staging-functions` works on that bucket only (Editor). It was written straight into `.env` section 2 with `pnpm env:set`.
- `pnpm storage:check` passes 8 of 8: allowed origin, other sites refused, signed upload and download, wrong file type refused, bucket private, test file cleaned up.
- **Still to do:** add the Vercel URL to the bucket CORS once it's known:
  `pnpm exec tigris buckets set-cors pearl-staging --origins http://localhost:3000,https://<vercel-url> --methods GET,HEAD,PUT --headers content-type --expose-headers ETag --override`

### Vercel
- CLI logged in (`pnpm exec vercel whoami`). Team "Pearl" on the Hobby plan.
- **No project created yet.**

### Supabase
- Online project exists, healthy, region `ap-south-1`. `.env` section 9 is filled (token, ref, DB password, `DATABASE_URL` = session pooler).
- The database is **empty**: no migrations pushed, no users, auth settings still at their defaults.
- This project signs logins with **ES256** (new signing keys), plus legacy anon/service_role keys and new publishable/secret keys.

### Code changes made this session (all uncommitted, nothing committed yet)

**Tooling and keys**
- Root dev dependencies `@tigrisdata/cli@3.16.0` and `vercel@63.1.0`. `pnpm-workspace.yaml` has `allowBuilds: "@tigrisdata/cli": false`.
- `scripts/env-set.ts` (`pnpm env:set`) pipes `KEY=VALUE` lines into `.env` without printing them, with optional `FROM=TO` renames.
- `scripts/env-sync.ts`:
  - values needing quotes are written in single quotes, so JSON keys survive;
  - parses `export KEY=…` lines;
  - exports `WEB_KEYS`, `FUNCTION_KEYS` and `loadEnv()` (root `.env`, overridden by real environment variables);
  - adds the key `STORAGE_PATH_STYLE`.
- `.env.example`: bucket `pearl-staging`, `STORAGE_PATH_STYLE`, `WEB_ORIGIN` is now comma-separated.
- `.gitignore`: added `.vercel/`.

**Storage**
- `supabase/functions/_shared/storage.ts` now uses the **bucket's own address** (`https://<bucket>.t3.storage.dev/key`), where Tigris applies the bucket's CORS. Path style (`pathStyle` / `STORAGE_PATH_STYLE=true`) is kept only for MinIO; on that style Tigris answered CORS with `*` for any site.
- `scripts/storage-check.ts` (`pnpm storage:check`): live test of the store with the same adapter the functions use.

**Server functions**
- `supabase/functions/_shared/http.ts`: `WEB_ORIGIN` takes a list; `handler()` echoes the caller's origin only if it's listed. Tests in `http.test.ts`.
- `supabase/functions/_shared/supabase.ts`: `callerClient()` is now **async** and checks the token with `auth.getClaims()`, which handles both ES256 and HS256. Both functions `await` it.
- `supabase/config.toml`: `verify_jwt = false` for both functions. The gateway check only knows HS256, so each function verifies the login itself.
- `package.json`: `test:functions` now runs with `--allow-env=WEB_ORIGIN`. All **25 function tests pass**, and `deno check` passes.

**Docs**
- `dev-docs/SETUP.md` 2.2 rewritten with the Tigris CLI steps.

**Scripts written but NOT run or tested yet**
- `scripts/supabase-api.ts` (helpers: Management API, CLI runner, `webOrigins()`).
- `scripts/supabase-deploy.ts`: link, then `db push --linked --yes`, then `functions deploy --use-api --yes`.
- `scripts/supabase-configure.ts`: PATCHes auth config to match `config.toml` (sign-up off, password 8+ letters+digits, custom access token hook, site URL and allow-list from `WEB_ORIGIN`, Brevo SMTP if filled), then POSTs the non-empty `FUNCTION_KEYS` as function secrets.

---

## Done in session 2 (23/10/2026, not committed yet)
- Steps 1–2: `package.json` has `deploy:supabase`, `supabase:configure`, `staging:bootstrap`, `db:test:remote` (CLI 2.121 accepts `--yes`). Seed split into `supabase/seed/01_users.sql` + `02_demo_settings.sql`; `config.toml`, CLAUDE.md, PLAN.md updated.
- Steps 3–4: `scripts/staging-bootstrap.ts` and `scripts/db-test-remote.ts` written.
- Step 5: `pnpm deploy:supabase` ran (migration `20261023100000_foundation` + functions `admin-users`, `files-sign`), `pnpm supabase:configure` ran (6 function secrets). `pnpm db:test:remote` **62/62 pass**; `db:concurrency` passes via the transaction pooler (6543). `01_foundation.test.sql` now inserts its own `main` clinic fixture so it passes without seed data.
- Step 8: `deploy` job added to `.github/workflows/ci.yml`; runs on `main` are no longer cancelled by a newer push.
- Security check of the two commits already on GitHub: no secrets, no project ref.
- **CI `e2e` job fails** on both pushed commits (unit + database jobs pass). Locally all 9 no-backend browser tests pass, so the suspect is the screenshot baselines made on CachyOS vs Ubuntu. Logs need a GitHub login to read.

## Next steps (in order)
1. **Owner approves `pnpm staging:bootstrap`** (creates 5 fake logins + staff rows + demo clinic online; blocked by the auto-mode safety check), then run it.
2. **Vercel account:** the CLI is now logged in as `khanabanaodevelopment-6071` (team "FCS" only); the claude.ai Vercel connector sees no teams. Owner picks the account/team, then do old step 7 (create `pearl-crm`, envs, git link) → `WEB_ORIGIN` → `pnpm supabase:configure` → Tigris CORS.
3. **GitHub secrets** `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` (gh CLI not installed; owner adds them in GitHub → Settings → Secrets and variables → Actions, or installs `gh`).
4. Read the failing e2e log (owner sends it, or `gh` installed) and fix: probably regenerate screenshot baselines on CI.
5. **Before committing:** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`; `git add -n .` must show no `.env`, `web/.env.local`, `supabase/functions/.env`, `docs/`, `.vercel/`, `supabase/.temp/`; grep staged files for `sb_secret_`, `tid_`, `tsec_`, `eyJ` (only the public local demo key in `.env.example` is OK), the project ref and the DB password. Then commit and push to `main`; watch Vercel and the Action.
6. **Smoke test online:** each staging role logs in on the Vercel URL; `files-sign` works with an ES256 token; `/api/keepalive` works with `CRON_SECRET`. Then update SETUP.md Part 2 (Supabase, Vercel, auto-deploy).
7. **Then Phase 1** (PLAN.md E3) and onwards, tests green before moving on.

### Vercel project settings (for step 2)
- name `pearl-crm`, framework `nextjs`, root directory `web`, Node `24.x`, function region `bom1`
- install command `pnpm install --frozen-lockfile --filter @pearl/web...`
- env: `ENABLE_EXPERIMENTAL_COREPACK=1`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `CRON_SECRET` (push from `.env` by script, never printed)
- git repo `dhanushkumar-merndev/pearls-crm-final`, branch `main`
- Tigris CORS afterwards: `pnpm exec tigris buckets set-cors pearl-staging --origins http://localhost:3000,https://<vercel-url> --methods GET,HEAD,PUT --headers content-type --expose-headers ETag --override`

## Still open with the owner
- Save the full brief as `CLINIC_CRM_BUILD_PROMPT.md`. The pasted copy was cut off at section 15, and sections 16–19 have never been seen.
- PLAN.md A1 questions. Defaults are used until answered.
- Vercel Hobby is for non-commercial use. Go-live needs Vercel Pro or Cloudflare (A1 question 3).
- Docker is still not installed on this PC. That's fine: DB work uses the online project, and CI runs the Docker-based tests.
