# Pearl Clinic CRM — guide for Claude Code sessions

The plan is `dev-docs/PLAN.md`. Read it before any change. The owner's original brief is `CLINIC_CRM_BUILD_PROMPT.md` (may not exist yet; it was pasted truncated at section 15).

## How we work
- One phase at a time (PLAN.md part E3). A phase is done only when its tests pass. After each phase, write step-by-step "how to try it" for a non-technical owner and **stop**.
- Ask before anything expensive to redo. Stay inside free tiers; say clearly when something can't be free.
- **Never** commit or copy anything from `docs/` (real patient data), `.env*`, keystores, or real patient data. Seed/test data is fake.
- Never hard-code clinic details (name, GSTIN, address, T&C, logo, prices, tax rates). They come from `clinic_settings` / `app_settings`.
- Setup docs for the owner are click-by-click (`dev-docs/SETUP.md`).

## Folder map
```
web/              Next.js 16 App Router (reception, admin, sales manager)
  app/(auth)/       login, forgot password
  app/(clinic)/     signed-in pages inside the ChatGPT-style shell
  app/api/          keepalive (Vercel Cron)
  components/ui/    shadcn-style primitives (radix-ui + cva)
  components/shell/ sidebar, top bar, command palette, user menu
  components/charts/ <EChart> wrapper (lazy ECharts, view-as-table)
  components/kpi/   stat tiles with inline-SVG sparklines
  lib/supabase/     browser / server / proxy clients (@supabase/ssr)
  messages/en.json  ALL screen text (next-intl). No hard-coded UI strings.
  proxy.ts          login redirects (Next 16 renamed middleware → proxy)
packages/shared/  pure TS used by web + Edge Functions: money, GST, words, IST dates, phone, design tokens
  test-vectors/     golden vectors shared by Vitest and pgTAP — change both sides together
supabase/         migrations/, functions/ (Deno Edge), tests/database (pgTAP), seed/ (01_users local-only, 02_demo_settings), config.toml
dev-docs/         PLAN.md, SETUP.md, TESTING.md (committed)
docs/             PRIVATE, git-ignored
```

## Commands (run from repo root)
| Command | What |
|---|---|
| `pnpm install` | install everything |
| `pnpm dev` | web app on http://localhost:3000 |
| `pnpm test` | unit tests: shared + web (Vitest) + Edge Functions (Deno) |
| `pnpm typecheck` · `pnpm lint` · `pnpm build` | tsc + deno check · ESLint + deno lint · production build |
| `pnpm tokens` | regenerate `web/app/tokens.css` + Kotlin colours from `packages/shared/src/design/tokens.json` |
| `pnpm env:sync` | copy keys from the root `.env` (template: `.env.example`) to `web/.env.local` (browser-safe allow-list only) and `supabase/functions/.env` (secrets). Add new keys to `.env.example` AND the allow-lists in `scripts/env-sync.ts` |
| `pnpm db:start` · `pnpm db:reset` · `pnpm db:test` | local Supabase (needs Docker), re-apply migrations + seed, pgTAP |
| `pnpm db:concurrency` | parallel-transaction checks (number series) against the local DB |
| `pnpm db:types` | regenerate `packages/shared/src/db.types.ts` from the local DB |
| `pnpm e2e` | Playwright on port 3417 (logged-in tests: `E2E_DB=1`, need `pnpm db:start` + `pnpm db:reset`) |

Edge Function imports are pinned once in `supabase/functions/deno.json` (bare specifiers in code). Fake seed logins are listed in `dev-docs/SETUP.md`.

## Conventions
- **Business rules live in Postgres** (RPC functions + RLS). Web and Android call the same RPCs. Apps write through RPCs; direct table writes only for simple admin master data.
- RLS helpers read the live `staff` table (`private.my_role()`, `private.my_staff_id()`), called as `(select private.my_role())`.
- Schemas: `public` = exposed tables/RPCs; `private` = helpers/triggers, never exposed.
- RPC errors: `raise exception using errcode = 'P0001', message = '<stable_code>'` → UI maps the code to a translated message.
- **Validate every input with zod** (`zod` 4, already in web, shared and Edge Functions). Every form runs a zod schema (`safeParse`) on submit *before* any request, so an empty or invalid form never reaches Supabase/an RPC/an Edge Function. Schema messages are `messages/en.json` keys, not English text. Show the message under its field (`FieldError` + `aria-invalid`/`aria-describedby`), focus the first bad field, clear a field's message when it is edited. A schema used by more than one place (web + Edge Function, e.g. `loginSchema`, `SETTINGS_SCHEMAS`) lives in `packages/shared` with a Vitest. Edge Functions parse their request body with zod too; Postgres still enforces the real rule. Client checks are for the user, not for security.
- Creates take a client-generated uuid (`p_client_id`) so retries are idempotent. Drafts take `p_version` (optimistic lock).
- Money is integer **paise** (`bigint` / `number` in TS) — never floats. Display `₹1,50,000.00`. GST maths per PLAN.md C5, implemented in `packages/shared/src/gst.ts` and mirrored in SQL; both tested against `test-vectors/`.
- Dates shown `DD/MM/YYYY`, 12-hour time, Asia/Kolkata. Store `timestamptz`. "Today"/FY boundaries are computed in IST on the server.
- Phones: E.164 `+91XXXXXXXXXX` + `*_last10` column.
- Migrations are append-only: never edit a migration that has been applied anywhere except local; add a new one.
- Every table: RLS enabled + policies + an entry in the RLS matrix test (`supabase/tests/database/rls_matrix.test.sql`).

## UI rules
- ChatGPT-style dark theme by default (PLAN.md B5). Colours only through CSS variables generated from `tokens.json` — never raw hex in components.
- **Compact size** (owner, 26/10/2026: "UI too big, reduce 20%"): web base font 14 px (`tokens.json` `font.baseSizePx`; everything is rem so it all scales), body text ~14 px, visual controls ~36 px tall; phone text ~20% under Material defaults used before (body 14 sp), touch area still ≥ 40 dp. Print pages keep their own size. Icon + text on buttons, status = icon + label, one primary action per screen.
- **Full width** (owner, 23/10/2026): every signed-in page fills the whole workspace beside the sidebar. No centred `max-w-*` page column (`components/shell/app-shell.tsx` `<main>` has none — don't add one back or wrap pages in one). Only long paragraphs keep a readable width (`max-w-prose`); dialogs, the top search bar and public phone pages (`/r`, `/scan`) keep their own sizes.
- **Custom dropdowns only** (owner, 23/10/2026): never the browser's native `<select>` list. Fixed choices use `Select` (`components/ui/select.tsx`, Radix, themed, same `value` / `onChange(e.target.value)` / `<option>` API); library lists use `LibraryCombobox`. In Playwright pick with `choose(page, field, "Label")` from `e2e/helpers.ts`, not `selectOption`.
- Charts: ECharts via `components/charts/echart.tsx` only (tree-shaken, lazy). Categorical colours in fixed order; no dual axes; every chart has "View as table". Print pages always white.
- Lists are server-paginated (keyset for feeds, offset for admin tables, max 100).
