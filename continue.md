# Continue here

Last updated 26/10/2026 (session 9). **All 15 phases are done.** What's left is the owner's go-live list: `dev-docs/GO_LIVE.md`. To resume, say: **"Read continue.md and carry on."**

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
| **11 Android: foundation + sales** | **DONE + deployed (session 7)**: module `:feature:sales` (Leads with swipe Call/WhatsApp + new lead, lead detail, after-call notes sheet, Follow-ups, Calls, booking with free slots, My day with Vico chart + needs-confirmation), `SalesRepository` (offline-first via the outbox), Room v2 + migration test, sales sync entities, push (migration `20261105100000_phase11_push.sql`, function `push-send`, `17_push` 10 tests). Android `./gradlew test assembleDebug lintDebug`: 93 tests pass. CI job `android`. Voice note for lost leads moved to Phase 12 |
| **10 WhatsApp + drips** | **DONE + deployed (session 6)**: migration `20261103100000_phase10_whatsapp.sql`, functions `wa-webhook` / `wa-dispatch` / `wa-templates-sync`, Vault secrets + `EDGE_CRON_SECRET` via `pnpm supabase:configure`, pages Admin → WhatsApp / Drip campaigns, patient WhatsApp tab, lead WhatsApp card, `15_whatsapp` (31), e2e `whatsapp.db.spec.ts` (5). Owner setup: `dev-docs/SETUP_WHATSAPP.md` |
| **12 Caller pop-up + recordings** | **DONE + deployed (session 7)**: migration `20261106100000_phase12_recordings.sql` (recordings table, upload mode, Request sync), `18_recordings` (24), web Recordings page + lead card + settings + per-person override, e2e `recordings.db.spec.ts` (2). Android: caller bubble + after-call sheet, call-log import, recordings folder + matcher + compressor + upload worker, setup checklist, lost-lead voice note; Room v3. Owner field checklist in `dev-docs/TRY_ANDROID.md` step 8 |
| **13 BDM field day** | **DONE + deployed (session 8)**: migration `20261107100000_phase13_bdm.sql` (offices, days, visits, events, breaks, location chunks, live status, trips, watchdog + route-estimate timers), `19_bdm` (41), `20_geo_vectors` (8), function `route-estimate` (OpenRouteService, 7 Deno tests), shared `geo.ts` + `test-vectors/geo.json`, web Admin → Offices, BDM settings, menu → BDM (live map, Locate now, day sheet with playback, Excel report), e2e `bdm.db.spec.ts` (2). Android: `:feature:bdm` (My day, travel / reached / complete visit / break / end day, meeting recording, visit photo, lead from a visit), `BdmRepository` (outbox, entity key `bdm-day:<id>`), route filter + chunk upload, location foreground service, Room v4. Owner steps + field checklist: `dev-docs/TRY_ANDROID.md` steps 9–11 |
| **14 Dashboards, alerts, backup, purge** | **DONE + deployed (session 8)**: migrations `20261108100000_phase14_ops.sql`, `20261108110000_phase14_order.sql`, `20261108120000_staff_email.sql`; `21_ops` (64); functions `notify-email`, `daily-summary` (Brevo), `files-sign` op `purge`; web Dashboard, Admin → Backup centre / Notifications, Targets, storage + summary settings, staff email on edit, Excel import/export (`lib/excel.ts`), backup engine `lib/backup.ts` (Vitest with an in-memory folder); e2e `ops.db.spec.ts` (7); Android target bars on My day. Owner guide: `dev-docs/OPERATIONS.md` |
| **15 Hardening + go-live** | **DONE + deployed (session 9)**: migrations `20261109100000_phase15_hardening.sql` (search_path pinned everywhere, FK indexes, offices / WhatsApp contacts tightened) and `20261109110000_phase15_perf.sql` (today's KPIs 10× faster, admin dashboard in 3 parts with `p_parts`, faster outstanding / by-source); `22_rls_fuzz` (7), `23_dashboard_parts` (12); scripts `pnpm advisors --strict`, `pnpm perf [--pending]`, `pnpm restore:drill`; e2e `a11y.db.spec.ts` (45 pages); Android release signing + `version.properties`. Docs: `GO_LIVE.md`, `RESTORE.md`, `RELEASE_ANDROID.md` |

## Session 6 (owner: "all phases, tested, production ready; validation missing; import has no template")
- DONE `cd14e32` validation on every form (shared rules `packages/shared/src/validation.ts`, hook `web/lib/use-zod-form.ts`, schemas `web/lib/schemas/*`, `packages/shared/src/{patient,lead}.ts`). New forms MUST use `useZodForm(schema)` + `Field error={checks.error(path)}`.
- DONE `61b641b` imports: templates, browser checks, server check run (migration `20261102100000_import_checks.sql`, NOT deployed; needs phase 9 deployed first), problem report CSV, leads import kind. Component `web/components/import/import-screen.tsx`.
- DONE Phase 9 part 2 (leads pages, pool, Meta admin, sales dashboard, reception hand-over, e2e `leads.db.spec.ts` 9/9) and DEPLOYED to staging: migrations 20261101100000 + 20261102100000 and all functions. Full e2e: 40 pass, 2 flaky, 3 known Tigris-CORS scanning failures.
- DONE Phase 10 (see the table). The database timer → `wa-dispatch` chain was checked live (pg_cron 200). `.env`: a value pasted over several lines (the Firebase JSON) broke the Supabase CLI and was read as "{" — it is now one line in single quotes, and `pnpm env:sync` refuses multi-line values.
- DONE WhatsApp team inbox + live updates (migration `20261104100000_wa_inbox.sql` deployed, `16_wa_inbox` 14 tests, e2e 6/6). Android: Gradle now runs on an auto-downloaded JDK 21 (`android/gradle/gradle-daemon-jvm.properties`; the PC only has Java 27, which breaks AGP's jlink); `android/local.properties` points at ~/Android/Sdk (not committed).
- NEXT: 11 (rest: Android sales features, sync/PIN/LibraryPicker tests, CI job), 12, 13, 14 (add `job_runs` purge), 15.

## Session 7
- DONE Phase 11 (see the table). A helper session wrote the stage-1 Android tests + CI job (merged `b3cb04e`). Outbox fix: the next-retry time now ignores writes waiting behind an earlier one (was waking every 30 s).
- Android build notes: Vico must stay on 3.1.x until AGP supports compileSdk 37. Unit tests run on Robolectric; Compose UI tests live next to each feature (`feature/sales/src/test`).
- Totals now: DB 600 (17 files), shared 206, web 63, Deno 90, Android 93.
- DONE Phase 12 (see the table). The audio compressor (MediaCodec) can't run in JVM tests: its maths (mono, resample, size plan) is unit-tested; the real codec is on the field checklist.
- Totals now: DB 624 (18 files), shared 207, web 63, Deno 92, Android 134, e2e recordings 2.
- NEXT: 13 (BDM), 14 (dashboards, notifications, backup/purge incl. `job_runs`, Excel), 15.

## Session 8
- DONE Phase 13 (see the table). Timers checked live: `bdm-watchdog` and `route-estimate` run every 5/10 minutes with 200s; the ORS key works (directions 200) and is on the server.
- Fixed: library picker "Add …" now picks the new item before refreshing the list (pharmacy e2e failed when Post was pressed during the refresh); recordings e2e picks the staff row by the exact username cell.
- Full e2e on staging needs `--workers=3` (more parallel browsers overload the free project): 53 pass, 2 skipped.
- Totals now: DB 673 (20 files), shared 222, web 67, Deno 98, Android 158, e2e 53.
- DONE Phase 14 (see the table). Live checks: a real backup of the 16 staging documents (all SHA-256 matched), a full database export, notify-email / daily-summary answer 403 without the secret.
- Totals now: DB 737 (21 files), shared 235, web 85, Deno 115, Android 161, e2e 60 (3 workers: all pass; scanning / WhatsApp admin flaky only under load).
- NEXT: 15 (performance pass + perf seed, RLS fuzzing on every table, accessibility, Supabase advisors, restore drill from the export, final setup docs, APK release).

## Session 9
- DONE Phase 15 (see the table). Perf seed results (p95): search ≤ 23 ms, lists ≤ 74 ms, dashboards ≤ 204 ms; advisors: 0 not accepted; axe: 0 serious on 45 pages; restore drill: 81 tables in 8 s, value for value; release APK checked on the emulator (login, PIN, My day, lead saved to staging as `R8 Release Check`).
- **Staging disk:** the free project goes read-only above 500 MB. Repeated perf seeds (rolled back, but dead rows stay on disk) took it to 762 MB on 26/10/2026; fixed with `vacuum (full)`. `pnpm perf` now compacts after itself and refuses to start above 150 MB. Any other bulk load on staging must clean up the same way.
- Totals now: DB 756 (23 files), shared 235, web 85, Deno 115, Android 161, e2e 103 (+2 skipped; scanning phone / WhatsApp admin flaky only under load).
- Logo (owner's file, 26/10/2026): the round mark is the favicon (16/32/48 .ico), tab icon 192, Apple icon 180, web-app manifest 192/512/maskable, and the Android launcher icon (adaptive, all densities, themed layer). In the app it is the Clinic profile logo (uploaded on staging). Source is only 155 px: a 512 px+ or SVG original would sharpen the big icons.
- NEXT: nothing to build. The owner works through `dev-docs/GO_LIVE.md`; monthly `pnpm restore:drill`.

## Session 10 (owner: "UI/UX polish, professional, UI 20% smaller, WhatsApp-like inbox, centred login/PIN")
- DONE UI/UX polish pass, web + phone (plan: one spacing system, shared page pieces, one primary action per screen, charts that fit a phone). No database/RPC changes.
- **Compact size** (CLAUDE.md UI rules): web base font 14 px (`tokens.json`), phone body 14 sp, spacing 4/6/10/12/20 dp. Print pages keep 17 px.
- Web: `<Page>`/`DetailHeader`/tabs/load-more/filter bar/skeletons/"More" menu in `components/ui`; WhatsApp-Web-style inbox; charts update in place and lay out for narrow cards (`components/charts/layout.ts`: legend wraps under the plot, no zero labels on stacks); doctors with no hours fold into one "Not working on this day" line; "Design preview" only in Ctrl+K search; new Playwright "phone" project (390×844, no sideways scroll).
- Phone: centred login/PIN with a number pad (`AuthLayout`), stacked calls chart (Vico 3.1.0 stays), pull-to-refresh, empty/loading states, offline strip from a network monitor (auto-reload when back), Settings as list rows (Sign out asks first), BDM start card: allow location → then start.
- Tests (27/10/2026, final): shared 235, web 92, Deno 115, Android unit tests all pass; full Playwright on staging **286 passed, 0 failed, 3 skipped** (skip when staging has no data for them), headless, `--workers=2`. With 3 workers a different handful timed out each run while the free project was busy; logged-in checks now wait 10 s (login, phone scan, new bill 30 s).
- On-device tests (`pnpm phone:test --emulator`, Pixel_10_Pro without a window): **31 passed, 0 failed**, 2 skipped by design (real call, push).
- **GitHub CI green for the first time** (27/10/2026, run 40489642611): unit/types/lint/build, Android, pgTAP on a fresh database, Playwright on a fresh local backend, Supabase deploy. Fixes: `config.toml` `[auth.email] enable_signup = true` (false turned email login off on local/CI); pgTAP tests no longer assume staging data (Vault entries, a supplier, today's refunds, live dashboard sections); CI sets `E2E_NO_FILE_STORAGE` so scanning skips there (no Tigris keys).
- Live site: Vercel is not connected to `pearls-crm-final` yet (GO_LIVE.md step: Vercel → Add New → Project → Import, Root Directory `web`); the Vercel CLI on this PC is logged in to another team, so leave it alone.
- Phone scan page: an unclear server answer ("unknown": weak signal, function waking up) is tried twice more before "Something went wrong". New bill buttons spin until the bill page opens. Fixed in the tests: "Try again" expected `attempts >= 2` but `retry` starts attempts over (it cascaded into every sales test); each test now clears refused changes left by an earlier one; BDM taps wait for the screen to settle (software-drawn emulator).
- API: live-update channels no longer reload data that has just loaded (Home 8 → 5 requests; sidebar badges once). `dashboard_admin` stays in 3 parallel parts on purpose (one call ~0.6 s, each part < 0.3 s). Advisors: 0 not accepted. Logo: shrunk to 512 px WebP + 1-year cache on upload (re-upload the current logo once).
- On the owner's phone: a stale "Note on a lead" from an old automatic test sits in Settings → failed changes → Discard it. The test PIN is 2468 (change it in Settings → Change PIN).

## Login-form validation (from another Claude session) — now committed
`loginSchema` (zod) in `packages/shared/src/auth.ts`, `login-form.tsx` (field errors, focus first bad field, "forgot password" link removed), `login.spec.ts` + screenshots, login keys in `en.json`. Committed as its own commit but not re-verified after the hand-off: run `pnpm test` and the login e2e once.

## Still open with the owner
- Tigris bucket `pearl-staging` CORS: the owner runs (after `pnpm exec tigris login`) `pnpm exec tigris buckets set-cors pearl-staging --origins http://localhost:3000,http://127.0.0.1:3417,https://pearl-sales.vercel.app --methods GET,HEAD,PUT --headers content-type --expose-headers ETag --override` — the CLI key gets "Access Denied" and Claude may not change it. Until then 3 scanning browser tests (offline, duplicate, phone) fail on upload. `WEB_ORIGIN` already has the three addresses (configured 24/10/2026). Rotate `STAGING_TEST_PASSWORD` (it was shown once in a test log).
- WhatsApp: the owner follows `dev-docs/SETUP_WHATSAPP.md` (number, token, webhook, templates). Until then sending is off and staff use the manual wa.me path.
- Commits are pushed (24/10/2026); keep pushing via VS Code Sync or `git push`. After pushing, CI annotations (Playwright "github" reporter) are readable without login.
- GitHub secrets SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF / SUPABASE_DB_PASSWORD for the auto-deploy job (it skips with a warning until set).
- Vercel env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, CRON_SECRET, NEXT_PUBLIC_TURNSTILE_SITE_KEY. Live site: https://pearl-sales.vercel.app (WEB_ORIGIN). Turnstile: real keys in .env since 24/10/2026; the Vercel env var NEXT_PUBLIC_TURNSTILE_SITE_KEY must hold the same site key.
- Full brief sections 15–19 (`CLINIC_CRM_BUILD_PROMPT.md`), PLAN.md A1 answers, Vercel Pro / Supabase Pro before go-live.

## Session 11 (owner 30/10/2026: "WhatsApp bot: intro + brochure, name, tick-box treatments, location, summary with number to confirm/cancel, max 5 per number per day")
- BUILT, tested locally, **not deployed yet**: migration `20261111100000_wa_bot.sql` (table `wa_bot_sessions`, settings section `wa_bot`, lead source + `created_via` `whatsapp`, `wa_messages.kind` `interactive` + `payload`, `wa_inbound` hands unhandled messages to `private.wa_bot_on_inbound`, staff message = handover trigger, no `lead_welcome` for bot leads, `wa_bot_overview`, `wa_bot_flow_get/saved`). Edge: `wa-webhook` reads button ids + Flow `nfm_reply`; `wa-dispatch` sends interactive + `source: "bot"` (woken by `call_edge`); `wa-templates-sync` `{action: "flow"}` creates + publishes the tick-box Flow (Flow JSON 7.1, screen `PICK`, options sent per message so the list is editable without a new Flow). Web: `admin/whatsapp/chat-bot.tsx`. Docs: SETUP_WHATSAPP.md "Chat bot".
- Meta publishes Flows only for a **verified business**; until then the bot asks for numbers ("1, 3"), and "Try again" publishes the saved draft.
- Tests: pgTAP 795 (new `24_wa_bot` 37), shared 236, web 92, Deno 122, e2e whatsapp 7/7 + a11y on a local backend.
- DEPLOYED 30/10 (db + functions; web Admin screen not yet: needs commit + push). Bot switched on online by SQL (treatments = the 3 library names, no brochure yet). Meta refuses every WABA-level call (`/{waba}`, templates, subscribed_apps) with subcode 2388339 "This API is not supported for this WhatsApp Business Account" — phone-number calls and the webhook work; so the Flow form and template sync can't work until that's fixed on Meta's side. Token lacks `leads_retrieval` + `pages_manage_metadata`.
- Speed (owner: "so delayed, I need blue ticks, typing"): `20261111120000_wa_bot_fast.sql` drops the bot's pg_net wake-up; `wa-webhook` now marks the message read + typing indicator, then sends the queued replies itself (`replyNow`, `EdgeRuntime.waitUntil`, wa-dispatch logic with source "bot"). Was ~3 s Meta→CRM + ~4 s second hop.
- Another session uses the same migration timestamps area: check `ls supabase/migrations` before naming a new one.
- Tap list (owner: "checklist like WhatsApp, not 1 2 3"): `20261111130000_wa_bot_list.sql` — interactive list, one tap adds a treatment, `✅ Done` moves on; website link in the intro. DEPLOYED.
- Inbox for numbers that aren't patients/leads (owner: "why all messages not showing, cancelled should be my side, autofill WhatsApp number"): `20261111140000_wa_number_thread.sql` (`wa_number_thread`, `wa_number_mark_read`, reception/admin); inbox shows the whole chat via shared `ChatMessages` (whatsapp-panel.tsx); Register → `/patients/new?phone=`, Add lead → `/leads?new=1&phone=`. Photos/voice/files → `media_text` ("I can only read typed messages"), reactions ignored: `20261111150000_wa_bot_media.sql`. DB DEPLOYED 30/10; web needs commit + push. Tests: pgTAP 812 local, online 16_wa_inbox 20 + 24_wa_bot 46; e2e whatsapp+leads+patients 20/20 local.
- Then (owner: bubbles too round / reduce gaps / name not showing after register / WhatsApp button on patient / 24 h window alert + template from inbox / DND bot or template per number): `20261111160000_wa_threads_link.sql` (patients/leads insert/update → wa_threads.patient_id/lead_id, + backfill), `20261111170000_wa_dnd.sql` (wa_contacts.dnd_bot/dnd_auto, `wa_dnd_get/set`, enqueue skips auto, claim drops queued auto with error_code 'dnd', bot silent), `20261111180000_wa_number_send.sql` (`wa_number_send`, thread returns window/opt-out). Web: WhatsApp-style bubbles (time floats on the last line, rounded-lg), inbox fills to the bottom, `components/whatsapp/dnd.tsx`, `useWindowOpen` flips at window end, unknown-number composer, "WhatsApp chat" link on patient/lead pages. ALL DB DEPLOYED 30/10 (online 25 files pass); web needs commit + push. Tests: pgTAP local all pass (new 25_wa_dnd 17, 16_wa_inbox 26), e2e whatsapp+leads+patients+a11y 66/66 local.
- Templates (owner: "create the templates for FB, put in review"): `scripts/wa-templates.ts` (`pnpm wa:templates [--submit]`), 5 templates incl. new `enquiry_followup`. SUBMITTED 30/10 (all PENDING). Real cause of Meta 2388339: `.env` WHATSAPP_WABA_ID was the "business presence" asset id (…1329), not the WABA. Correct WABA = 1125531439968747 (business 888284947695724; holds +91 98454 78021); fixed in .env + server secret. After approval: Admin → WhatsApp → Get templates from Meta, set purposes/values (or do it by SQL).
- Owner asked about a date picker + multi-select: both exist only inside WhatsApp Flows (DatePicker, CheckboxGroup) — blocked by Meta 2388339 / business verification. Without Flows: tap list (done) for multi-select; a date can only be typed or offered as a tap list of the next days.
