# Continue here

Paused on 23/10/2026, in the middle of the **online setup** (Tigris → Vercel → Supabase). To resume, open Claude Code in this folder and say:

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

## Next steps (in order)

1. **Wire up the new scripts** in root `package.json`:
   - `"deploy:supabase": "tsx scripts/supabase-deploy.ts"`
   - `"supabase:configure": "tsx scripts/supabase-configure.ts"`
   - `"staging:bootstrap": "tsx scripts/staging-bootstrap.ts"`
   - `"db:test:remote": "tsx scripts/db-test-remote.ts"`

   Check whether the CLI really accepts `db push --yes` and `functions deploy --yes`; drop the flag if not.
2. **Split the seed** into `supabase/seed/01_users.sql` (local-only fake users, `Pearl@2026`) and `supabase/seed/02_demo_settings.sql` (demo clinic, settings, number series, integration status). Set `config.toml` `[db.seed] sql_paths` to both files, in order. Update references to `seed.sql` in CLAUDE.md, SETUP.md and TESTING.md.
3. **Write `scripts/staging-bootstrap.ts`.** It must be idempotent:
   - generate `STAGING_TEST_PASSWORD` into `.env` if it's empty (letters and digits);
   - create the auth users `admin@ / reception@ / manager@ / sales@ / bdm@pearl.test` through the Auth Admin REST API, using the legacy service_role key from `apiKey("service_role")`, never printed;
   - insert `public.staff` rows and run `02_demo_settings.sql` over `DATABASE_URL` when `clinic_settings` is empty.
4. **Write `scripts/db-test-remote.ts`.** For each `supabase/tests/database/*.sql`, run the file over `DATABASE_URL` and collect the TAP lines. Pass means no `not ok` and the count matches the plan. Each file already does `begin … rollback`.
5. **Run, in order:** `pnpm deploy:supabase`, then `pnpm supabase:configure`, then `pnpm staging:bootstrap`, then `pnpm db:test:remote`, then `pnpm db:concurrency`.
   - These are Phase 0's DB tests, never yet run on real Postgres with real Supabase auth.
   - For `db:concurrency`: if the session pooler (port 5432) refuses 50 clients, use the transaction pooler on port 6543.
6. ~~Fill `.env` section 1~~ **Done 23/10/2026:**
   - `NEXT_PUBLIC_SUPABASE_URL` and the publishable key are filled;
   - `CRON_SECRET` and `STAGING_TEST_PASSWORD` were generated;
   - `pnpm env:sync` has run.

   The web app on this PC now points at the **online** project. Logins only work after step 5, because the database is still empty.
7. **Create the Vercel project** (REST API with the CLI token from `~/.local/share/com.vercel.cli/auth.json`, or `vercel project add` plus settings):
   - name `pearl-crm`, framework `nextjs`, root directory `web`, Node `24.x`, function region `bom1`;
   - install command `pnpm install --frozen-lockfile --filter @pearl/web...`;
   - environment variables `ENABLE_EXPERIMENTAL_COREPACK=1` (pnpm 11 from `packageManager`), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `CRON_SECRET`;
   - connect the git repo `dhanushkumar-merndev/pearls-crm-final` on branch `main`. If Vercel's GitHub app has no access, ask the owner to grant it.

   Then add the Vercel URL to `WEB_ORIGIN` in `.env`, re-run `pnpm supabase:configure`, and update the Tigris CORS (above).
8. **CI deploy job** in `.github/workflows/ci.yml`:
   - `deploy` job with `needs: [checks, database]`, only when `github.event_name == 'push' && github.ref == 'refs/heads/main'`;
   - runs `pnpm deploy:supabase` with secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`;
   - store those with `gh secret set NAME --repo dhanushkumar-merndev/pearls-crm-final`, piping each value from `.env` so nothing is printed;
   - never use `pull_request_target` (the repo is public).
9. **Before the first commit:**
   - run `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build`;
   - do a `git add -n .` dry run and confirm there is no `.env`, `web/.env.local`, `supabase/functions/.env`, `docs/`, `.vercel/` or `supabase/.temp/`;
   - grep the staged files for `sb_secret_`, `tid_`, `tsec_`, `eyJ`, the project ref and the DB password.

   Then commit (attribution line per the system reminder) and **push to `main`** (the owner asked for this). Watch the Vercel build and the GitHub Action.
10. **Smoke test online:**
    - log in as each staging role on the Vercel URL;
    - the call to `files-sign` works with an ES256 token;
    - `/api/keepalive` works with `CRON_SECRET`.

    Then update SETUP.md Part 2 (Supabase, Vercel, auto-deploy) and TESTING.md (`db:test:remote`).
11. **Then Phase 1** (PLAN.md E3) and onwards, phase by phase, tests green before moving on.

## Still open with the owner
- Save the full brief as `CLINIC_CRM_BUILD_PROMPT.md`. The pasted copy was cut off at section 15, and sections 16–19 have never been seen.
- PLAN.md A1 questions. Defaults are used until answered.
- Vercel Hobby is for non-commercial use. Go-live needs Vercel Pro or Cloudflare (A1 question 3).
- Docker is still not installed on this PC. That's fine: DB work uses the online project, and CI runs the Docker-based tests.
