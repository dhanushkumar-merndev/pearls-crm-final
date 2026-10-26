# Testing

A phase is finished only when all of these pass (PLAN.md E1).

| Command | What it checks | Needs the database? |
|---|---|---|
| `pnpm test` | Shared maths (money, GST, amount in words, IST dates, phones), design colours (contrast + colour-blind checks), web logic, Edge Function logic | No |
| `pnpm typecheck` | TypeScript in shared, web and Edge Functions | No |
| `pnpm lint` | ESLint (web) + Deno lint (Edge Functions) | No |
| `pnpm build` | Production build of the web app | No |
| `pnpm e2e` | Browser tests: login page, themes, accessibility (axe), keyboard use, 44 px targets, screenshots | No |
| `pnpm db:test` | pgTAP: roles, deactivation, audit log, number series, settings, uploads, RLS on every table | **Yes** (`pnpm db:start`) |
| `pnpm db:concurrency` | 50 parallel finalizes → bill numbers with no gaps and no duplicates | **Yes** |
| `cd android && ./gradlew test assembleDebug lintDebug` | Android: sync, outbox, PIN, Room migrations, sales repository, recordings, BDM day and route filter (incl. a simulated drive within ±5%), notes sheet / booking / BDM screens (Robolectric), APK builds, lint | No |
| Field checklists (manual) | Caller pop-up, call log, recording matching (`dev-docs/TRY_ANDROID.md` step 8); BDM background route recording and a scripted drive (step 11) on each real phone model. Can't be fully automated | Real phones |
| `E2E_DB=1 pnpm e2e` | Logged-in browser tests: shell, Ctrl+K search, theme saved per person, design preview charts, role pages | **Yes** (plus `pnpm db:reset` for seed data) |

### Logged-in browser tests on the online staging project
After `pnpm staging:bootstrap` (fake usernames admin / reception / manager / sales / bdm):
```bash
pnpm env:sync
cd web && E2E_DB=1 E2E_PASSWORD='<STAGING_TEST_PASSWORD from .env>' pnpm e2e --workers=3
```
Use 3 workers or fewer: the free staging project slows down under many parallel browsers and tests then time out.
`e2e/auth.setup.ts` logs in once per role and the tests reuse those sessions, so a run stays under Supabase's sign-in rate limit. Tests create fake patients and bookings with "E2E" in their names on staging.

### Without Docker: run the database tests on the online project
Needs `DATABASE_URL` (session pooler, port 5432) in the root `.env`. Every test file rolls back, so nothing is left behind.

| Command | What |
|---|---|
| `pnpm db:test:remote` | The same pgTAP files as `pnpm db:test`, run over `DATABASE_URL` |
| `DATABASE_URL=<same address with port 6543> pnpm db:concurrency` | The concurrency check. Use the **transaction pooler (port 6543)**: the session pooler allows only 15 connections and the check opens 50. It uses a test-only year (2099) and deletes it afterwards |

## Golden vectors (worked examples)
`packages/shared/test-vectors/*.json` hold hand-checked examples, such as GST lines, amounts in words and map distances (`geo.json`, also checked by the Android tests and by pgTAP `20_geo_vectors`). The TypeScript tests use them now. The SQL bill maths (Phase 5) will be tested against the **same file**, so the screen preview and the saved bill can never disagree. Change a vector only on purpose, and keep both sides passing.

## Screenshot baselines
`web/e2e/*-snapshots/` are the approved pictures. If you change the look on purpose:
```bash
pnpm --filter @pearl/web exec playwright test --update-snapshots
```
Look at the new pictures before committing them. The pixel comparison runs **on the developer PC only**: the CI server's Linux draws font edges differently, so one set of pictures can't match both. On CI the same tests still check the theme colours, 44 px sizes, keyboard use and accessibility.

## Design colours
`packages/shared/tests/palette.test.ts` fails if a colour change breaks:
- text contrast (WCAG AA 4.5:1), or
- chart-palette checks (lightness band, chroma, colour-blind separation, 3:1 against the dark chart surface).

It also fails if `web/app/tokens.css` is out of date. Run `pnpm tokens` after editing `tokens.json`.

## RLS guard rails
`supabase/tests/database/02_rls_matrix.test.sql` fails automatically if a new table:
- forgets RLS or has no policy,
- lets signed-in users write directly (anything beyond the allowed list),
- or lets logged-out visitors read or call anything except `public_branding`.

It also checks that every security-definer function pins its `search_path`.
