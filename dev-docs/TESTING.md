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
| `E2E_DB=1 pnpm e2e` | Logged-in browser tests: shell, Ctrl+K search, theme saved per person, design preview charts, role pages | **Yes** (plus `pnpm db:reset` for seed data) |

## Golden vectors (worked examples)
`packages/shared/test-vectors/*.json` hold hand-checked examples, such as GST lines and amounts in words. The TypeScript tests use them now. The SQL bill maths (Phase 5) will be tested against the **same file**, so the screen preview and the saved bill can never disagree. Change a vector only on purpose, and keep both sides passing.

## Screenshot baselines
`web/e2e/*-snapshots/` are the approved pictures. If you change the look on purpose:
```bash
pnpm --filter @pearl/web exec playwright test --update-snapshots
```
Look at the new pictures before committing them. On a different operating system (for example the CI server), fonts render slightly differently, so baselines may need regenerating there once.

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
