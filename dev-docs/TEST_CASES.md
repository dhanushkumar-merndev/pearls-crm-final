# Test cases — every role, page and feature

The written list of what is tested, numbered so a failing test points to a case here. Each row says
**how** it is tested and its **status** from the last full run (date at the top of each section).

| Kind of test | Where | Run with |
|---|---|---|
| Server rules (every RPC, every role, RLS on every table) | `supabase/tests/database/*.test.sql` (pgTAP) | `pnpm db:test` / `pnpm db:test:remote` |
| Web pages in a real browser | `web/e2e/*.spec.ts` (Playwright) | `cd web && E2E_DB=1 E2E_PASSWORD=… pnpm e2e --workers=3` (add `E2E_HEADED=1 E2E_SCREEN_X=0` to watch it) |
| Android on a real phone | `android/app/src/androidTest/…/e2e/*.kt` | `pnpm phone:test` (`--real-call` for the real call) |
| Android logic on the computer | `android/**/src/test` (JVM / Robolectric) | `cd android && ./gradlew testDebugUnitTest` |
| Field checks by a person | this file, last section | by hand, see [TRY_ANDROID.md](TRY_ANDROID.md) |

Status: ✔ passed · ✖ failed · ⏭ skipped (reason given) · ✋ manual check · ⏳ not run yet.

**Last full run: 31/10/2026, after every fix of the day** (Finalize wait, error messages, Ads 24 months,
self-registration screen): web headless (2 browsers), 330 tests — 320 passed, 0 failed, 8 skipped (same 8),
2 passed on the retry (phone scan: making the test patient took over 10 s on the busy server; the step now
waits 30 s and the scanning file passes 11/11 twice without retries).
Then the 3 skips that were not WhatsApp: the Excel test skipped because it looked at the button before the
list had loaded (133 appointments in 2026) — it now waits, and both Excel downloads run (reception-day 8/8).
The 2 "no server" login tests run with the backend address pointing nowhere:
`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:59999 pnpm exec playwright test e2e/login.spec.ts` → 13/13.
Left skipped on purpose: the 5 WhatsApp tests while the live number is connected (W-WA-12).

Earlier the same day: web headless (2 browsers), full suite run
again after the fixes: 324 tests — 316 passed (3 of them on the retry: staging statement timeouts under
load), 0 failed, 8 skipped (same 8 as below). Fixed on the way: the follow-up test pages with "Load more"
once more than 50 follow-ups are due sooner; the pharmacy flow test gets 90 s like the other long flows. Phone on the emulator (Pixel_10_Pro, Android 17):
41 tests — 39 passed, 0 failed, 2 skipped (real call, push). Database 879/879 (13_leads now 82: call logs
older than 60 days are not synced). Speed (`pnpm perf --pending`, two-year seed, 30 runs, quiet server): all 33 screens inside budget
(admin year money p95 217 ms, phone first sync p95 68 ms); see continue.md session 13.

Previous run: 30/10/2026 on the online staging project (2 browsers, headless). Web: 324 tests —
316 passed, 0 failed, 8 skipped, 0 passed only on a retry (311 desktop, 12 phone-width, 1 login setup).
Skipped on purpose: 5 WhatsApp tests while WhatsApp is live on staging (W-WA-12), 2 "no server" login
tests (they need the server switched off), 1 Excel download (no appointments in the chosen range).
Database: 877/877. Unit: shared + web 92 + Edge Functions pass; Android JVM 139/139.
Phone (on-device, realme RMX2161, Android 12): 41 tests — 34 passed, 5 failed, 2 skipped (real call, push:
by design). The 5 (BDM day ×2, caller bubble ×2, call setup ×1) need the tests to switch "mock location" and
"draw over other apps"; this Realme refuses that even with "Disable permission monitoring" on. The same 10
tests of those classes pass on the emulator (Pixel_10_Pro, Android 17): 10/10. Hand checks: [HAND_TEST.md](HAND_TEST.md).

Edge cases every form shares, tested once per form type rather than repeated in every row:
an empty form is stopped before anything is sent; the message sits under the field, the field is
marked invalid and gets the focus; editing the field clears its message; the server checks the
same rule again (DB tests), so a bypassed browser check is still refused.

## Edge cases every form shares

Tested on the busiest forms (new patient, new lead; on the phone, new lead) rather than repeated in every row.

| ID | Case and edge cases | Test | Status |
|---|---|---|---|
| W-EDGE-01 | Save pressed twice quickly still makes one patient | `edge-inputs.db.spec.ts` | ✔ |
| W-EDGE-02 | Tamil / Hindi names kept letter for letter; extra spaces tidied | `edge-inputs.db.spec.ts` | ✔ |
| W-EDGE-03 | Number typed as `+91 98450 12345`, `098450-12345` or `0091…` is saved as +91 and ten digits | `edge-inputs.db.spec.ts` | ✔ |
| W-EDGE-04 | `12345`, 14 digits, letters, `0000000000` refused under the field, focus there, nothing saved | `edge-inputs.db.spec.ts` | ✔ |
| W-EDGE-05 | A name of only spaces counts as empty | `edge-inputs.db.spec.ts` | ✔ |
| W-EDGE-06 | The name box takes at most 120 letters | `edge-inputs.db.spec.ts` | ✔ |
| W-EDGE-07 | Save lead pressed twice quickly: one lead, number cleaned, the lead opens (was stuck on "Saving…" on staging, fixed 30/10/2026) | `edge-inputs.db.spec.ts` | ✔ |
| W-EDGE-08 | Closing the new-lead form with Escape saves nothing | `edge-inputs.db.spec.ts` | ✔ |
| W-EDGE-09 | Retried save with the same id (answer lost) makes one record | `OfflineSyncTest`, DB tests (`p_client_id`) | ✔ |
| W-EDGE-10 | Money in paise: ₹1,250.50 stays exact on screen, print and in words | `print-bill.db.spec.ts`, `07_gst_vectors` (DB) | ✔ |
| W-EDGE-11 | "Today", month and financial year counted in IST (31/03 → 01/04) | shared Vitest (IST dates), `08_billing` (DB) | ✔ |
| W-EDGE-12 | Impossible date ranges (end before start, over a year) refused | `reception-day.db.spec.ts`, `leads.db.spec.ts` | ✔ |
| W-EDGE-13 | Two people editing the same settings: the second is told to reload | `admin-setup.db.spec.ts` | ✔ |
| W-EDGE-14 | Server out of reach / list can't load: said plainly, no stale data | `session-edges.db.spec.ts` | ✔ |
| W-EDGE-15 | Screen text missing from `en.json` or with an unfilled `{marker}` fails the page (all 45 pages, folded panels opened) | `a11y.db.spec.ts` | ✔ |
| A-SAL-10 | Phone: `+91 98450 12345` saved as +91 and ten digits; Tamil / Hindi name kept | `SalesFlowTest` | ✔ |
| A-SAL-11 | Phone: Save tapped twice quickly still makes one lead | `SalesFlowTest` | ✔ |
| A-SAL-12 | Phone: turning the phone sideways keeps what was typed | `SalesFlowTest` | ✔ |

## Web — access (all roles)

| ID | Case and edge cases | Test | Status |
|---|---|---|---|
| W-ACC-01 | Admin opens every one of their 43 pages; none says "doesn't exist" | `access.db.spec.ts` | ✔ |
| W-ACC-02 | Receptionist: their 15 pages open; admin, sales and dashboard pages say "This page doesn't exist." (HTTP 404) | `access.db.spec.ts` | ✔ |
| W-ACC-03 | Sales manager: their 9 pages open; front-desk pages (patients, bills, appointments, pharmacy, admissions, follow-ups, sessions, print) and admin pages don't exist for them | `access.db.spec.ts` | ✔ |
| W-ACC-04 | Each role's menu lists only pages that role may open | `access.db.spec.ts` | ✔ |
| W-ACC-05 | Sales executive and BDM on the web → "Please use the mobile app", whatever page they type | `access.db.spec.ts`, `shell.db.spec.ts` | ✔ |
| W-ACC-06 | Logged out → login page, for app pages and print pages | `access.db.spec.ts`, `login.spec.ts` | ✔ |
| W-ACC-07 | Every RPC refuses the wrong role even when the page is bypassed; RLS on every table, fuzzed | `02_rls_matrix`, `22_rls_fuzz` (DB) | ✔ |
| W-ACC-10 | Login with the server out of reach says the connection is the problem | `session-edges.db.spec.ts`, `login.spec.ts` | ✔ |
| W-ACC-11 | A list that can't load says so ("Couldn't load…") | `session-edges.db.spec.ts` | ✔ |
| W-ACC-12 | A screen left idle logs out (shared reception PCs), with the reason on the login page | `admin-setup.db.spec.ts` | ✔ |
| W-ACC-13 | A person deactivated while logged in is thrown out on their next click ("Your account is not active") | `admin-setup.db.spec.ts` | ✔ |
| W-ACC-14 | Ctrl+K: reception finds a patient by phone; a manager finds a lead and isn't offered reception pages | `session-edges.db.spec.ts`, `shell.db.spec.ts`, `patients.db.spec.ts` | ✔ |
| W-ACC-15 | Login: empty/impossible input, wrong password, keyboard only, 44 px targets, both themes, no forgot-password e-mail | `login.spec.ts` | ✔ |
| W-ACC-17 | Staff change their own password: empty, wrong current, weak and mismatched refused; afterwards the old one fails and the new one works (throwaway login) | `admin-setup.db.spec.ts` | ✔ |
| W-ACC-16 | Accessibility: no serious or critical axe finding on 45 pages, dark theme, data loaded | `a11y.db.spec.ts` | ✔ |

## Web — admin

| ID | Case and edge cases | Test | Status |
|---|---|---|---|
| W-ADM-01 | Dashboard: tiles, charts with "View as table", storage and connections | `ops.db.spec.ts` | ✔ |
| W-ADM-02 | Doctor added, weekly hours set; overlapping hours refused | `admin.db.spec.ts` | ✔ |
| W-ADM-03 | Service added and found in the change history (audit filter) | `admin.db.spec.ts` | ✔ |
| W-ADM-10 | Room types: required fields, bad SAC code ("4 to 8 digits"), the same name in other letters refused ("That already exists."), deactivate shows Inactive | `admin-setup.db.spec.ts` | ✔ |
| W-ADM-11 | Clinic profile: bad GSTIN, state code and PIN code refused and nothing saved; logo of the wrong type or over 500 KB refused | `admin-setup.db.spec.ts` | ✔ |
| W-ADM-12 | Settings: out-of-range or empty values refused per field, focus on the first | `admin-setup.db.spec.ts` | ✔ |
| W-ADM-13 | Settings in two tabs: the second save is told someone else changed it (version check) | `admin-setup.db.spec.ts` | ✔ |
| W-ADM-14 | Staff logins: bad username and weak password refused, a taken username refused, created login works, deactivate needs a reason, reactivate, new password works | `admin-setup.db.spec.ts` | ✔ |
| W-ADM-15 | Admin can't change their own role | `admin-setup.db.spec.ts` | ✔ |
| W-ADM-16 | Contact e-mail for summaries checked, saved and cleared | `ops.db.spec.ts` | ✔ |
| W-ADM-17 | Notification rules saved and kept | `ops.db.spec.ts` | ✔ |
| W-ADM-18 | Sales targets: whole numbers only; progress shown; manager sees but can't change | `ops.db.spec.ts` | ✔ |
| W-ADM-19 | Backup centre: folder, database export, purge preview keeps files without a backup | `ops.db.spec.ts` | ✔ |
| W-ADM-20 | Offices: bad coordinates explained; BDM page live list, day sheet, Excel | `bdm.db.spec.ts` | ✔ |
| W-ADM-21 | WhatsApp setup and drip campaigns validated; Meta lead-ads form | `whatsapp.db.spec.ts`, `leads.db.spec.ts` | ✔ drips, Meta form · ⏭ WhatsApp setup + chat bot while WhatsApp is live (W-WA-12) |
| W-ADM-22 | Recording upload mode: clinic setting and per-person override | `recordings.db.spec.ts` | ✔ |
| W-ADM-23 | Libraries merge / in-use rules, number series never reused, imports | `03_admin_libraries`, `08_billing`, `14_imports` (DB) | ✔ |
| W-ADM-30 | Finalized bill amended by an admin keeps its number, needs a reason, old version kept | `billing-edges.db.spec.ts`, `08_billing` (DB) | ✔ |
| W-ADM-31 | Payment above what is due refused; part payment saved | `billing-edges.db.spec.ts` | ✔ |
| W-ADM-32 | Cancelled bill: reason needed, reason shown, no more payments or amends | `billing-edges.db.spec.ts` | ✔ |

| W-ADM-33 | Review: an item added on the fly is kept and leaves the list | `admin-review.db.spec.ts` | ✔ |
| W-ADM-34 | Review: merging needs a choice; the duplicate leaves the list | `admin-review.db.spec.ts` | ✔ |
| W-ADM-35 | Discharge template: empty name and follow-up outside 0–3650 days refused, nothing saved | `admin-review.db.spec.ts` | ✔ (⏭ when no template) |

## Web — lists: round ✕ "Clear filters"

Hidden while the filters are as the page opened; shows after a change; one click puts everything back.

| ID | List | Test | Status |
|---|---|---|---|
| W-LST-01 | Appointments table (dates back to today, sort back) | `filters.db.spec.ts` | ✔ |
| W-LST-02 | Sessions to book | `filters.db.spec.ts` | ✔ |
| W-LST-03 | Admissions (back to "Admitted") | `filters.db.spec.ts` | ✔ |
| W-LST-04 | Bills (status back to All) | `filters.db.spec.ts` | ✔ |
| W-LST-05 | Pharmacy stock (search and "Show") | `filters.db.spec.ts` | ✔ |
| W-LST-06 | Pharmacy purchases | `filters.db.spec.ts` | ✔ |
| W-LST-07 | Change history (audit) | `filters.db.spec.ts` | ✔ |
| W-LST-08 | Admin dashboard (period back to "This month") | `filters.db.spec.ts` | ✔ |
| W-LST-09 | Sales dashboard | `filters.db.spec.ts` | ✔ |
| W-LST-10 | Leads table | `leads-manager.db.spec.ts` | ✔ |

## Web — printed bill

| ID | Case and edge cases | Test | Status |
|---|---|---|---|
| W-PRN-01 | Letterhead = Admin → Clinic profile (name, GSTIN, phone), nothing typed into the page | `print-bill.db.spec.ts` | ✔ |
| W-PRN-02 | Title "Bill cum receipt", patient name, **Original** on the first print | `print-bill.db.spec.ts` | ✔ |
| W-PRN-03 | ₹1,250.50 exact, "Paid in full", amount in words | `print-bill.db.spec.ts` | ✔ |
| W-PRN-04 | Disc., GST and Date columns left out when every line is empty there | `print-bill.db.spec.ts` | ✔ |
| W-PRN-05 | Numbered terms for this bill type, exactly as saved (none saved → no terms box) | `print-bill.db.spec.ts` | ✔ |
| W-PRN-06 | Logo watermark, fixed so it repeats on every printed page | `print-bill.db.spec.ts` | ✔ |
| W-PRN-07 | White paper even when the app is dark | `print-bill.db.spec.ts` | ✔ |
| W-PRN-08 | Any later print says **Duplicate** | `print-bill.db.spec.ts`, `billing.db.spec.ts` | ✔ |
| W-PRN-09 | Looks right on paper; pharmacy and IP final bill layouts | ✋ [HAND_TEST.md](HAND_TEST.md) B | ✋ |

## Web — WhatsApp

| ID | Case and edge cases | Test | Status |
|---|---|---|---|
| W-WA-10 | Chat-bot texts: `{clinic}`, `{name}` … show as written, no console error (crashed once, fixed 30/10/2026) | `whatsapp.db.spec.ts` | ✔ |
| W-WA-11 | Do not disturb: kept after a reload; both on → one badge; both off → no badge; the badge changes straight from the save (was > 10 s on a busy server, fixed 30/10/2026) | `whatsapp.db.spec.ts` | ✔ |
| W-WA-12 | Tests that need sending off, or would change the real setup (the chat-bot test switches the bot off), skip themselves when WhatsApp is live on the database | `whatsapp.db.spec.ts` | ✔ |
| W-WA-13 | Register / Add lead from the inbox start with their WhatsApp number | `whatsapp.db.spec.ts` | ✔ |
| W-WA-20 | Bot: intro, name, tap list + Done, area, summary, confirm makes one lead / cancel nothing; 5 chats a day; 3 bad answers → staff; photos → "typed messages only"; silent for patients, open leads, staff-handled chats, STOP | `24_wa_bot` (DB) + ✋ HAND_TEST E | ✔ / ✋ |
| W-WA-21 | Unknown numbers: whole chat shown, 24-hour window, templates only after it | `16_wa_inbox` (DB) + ✋ HAND_TEST E | ✔ / ✋ |
| W-WA-22 | DND: bot silent, automatic messages dropped, staff can still send | `25_wa_dnd` (DB) | ✔ |
| W-WA-23 | Instant send can't reach the server: staff are told it goes out within 5 minutes (the 5-minute run sends it). Faked in the browser, so safe on a live number | `whatsapp.db.spec.ts` | ✔ |
| W-WA-24 | Functions accept the web app from any local address (localhost / 127.0.0.1 any port / same Wi-Fi) when a local one is listed, and previews of the listed Vercel site; other sites refused | `_shared/http.test.ts` (Deno) | ✔ |

## Web — reception

| ID | Case and edge cases | Test | Status |
|---|---|---|---|
| W-REC-01 | Desk registration gives a UHID; the same phone again: update ticked details or add a family member | `patients.db.spec.ts` | ✔ |
| W-REC-02 | Booking from the board, seen live on a second desk; walk-in queue; confirm from the patient file | `appointments.db.spec.ts` | ✔ |
| W-REC-03 | Slot rules: full, past, holiday, leave, outside hours, double booking under load | `05_appointments` (DB), `pnpm db:concurrency` | ✔ |
| W-REC-04 | Bill cum receipt: service added on the fly, split payment, original then duplicate print | `billing.db.spec.ts` | ✔ |
| W-REC-05 | Treatment package of 6 sessions done to completion | `treatments.db.spec.ts` | ✔ |
| W-REC-06 | IP stay: final bill without double counting; discharge summary | `ip-stay.db.spec.ts` | ✔ |
| W-REC-07 | Pharmacy: purchase, sale with the batch picked, write-off, history | `pharmacy.db.spec.ts` | ✔ |
| W-REC-08 | Scanning: offline pages upload later; duplicate warned; real file type checked; phone scan link single-use | `scanning.db.spec.ts` | ✔ |
| W-REC-09 | WhatsApp tab and inbox: message checked, opt-out, live inbox | `whatsapp.db.spec.ts` | ⏭ WhatsApp is live on staging (test skips itself, see W-WA-12) |
| W-REC-10 | Appointments table: end before start refused, over a year refused, sort, Excel download | `reception-day.db.spec.ts` | ✔ (Excel ⏭ when no 2026 appointments) |
| W-REC-11 | Bills table: end before start refused, status filter shows only that status, Excel download | `reception-day.db.spec.ts` | ✔ |
| W-REC-12 | Patients search: by phone digits; nonsense says nobody found | `reception-day.db.spec.ts` | ✔ |
| W-REC-13 | Follow-ups: "what to do" required; added; done with an outcome leaves the list | `reception-day.db.spec.ts` | ✔ |
| W-REC-14 | Advance kept for later bills; refund over the advance refused; balance tiles update | `reception-day.db.spec.ts` | ✔ |
| W-REC-15 | Receptionist discount above the limit (Settings → Billing) refused at save; within it the bill finalizes and is locked (no editing, no amend) | `reception-day.db.spec.ts` | ✔ |
| W-REC-16 | Sessions to book and admissions lists open | `reception-day.db.spec.ts` | ✔ |
| W-REC-17 | Self-registration from the QR: form, captcha, check & save / discard (discard needs a reason; Check & save opens the form filled in; nothing waiting says so) | `04_patients` (DB) + `discharge-review.db.spec.ts` (screen, form answered in the browser) + ✋ phone scan of the QR | ✔ / ✋ |
| W-REC-30 | Pharmacy: an expired batch can't be bought in | `billing-edges.db.spec.ts`, `09_pharmacy` (DB) | ✔ |
| W-REC-31 | Pharmacy: the batch expiring first is sold first (FEFO) | `billing-edges.db.spec.ts`, `pharmacy.db.spec.ts` | ✔ |
| W-REC-32 | Slow server: Finalize / Save clicked while a picker still waits for its answer (a medicine's batches, a service added on the fly, the bill reloading after "Include bills") wait ("Loading…") instead of doing nothing; the first click then works (bug found 31/10/2026: the check ran on the half-filled line and the late answer cleared its message) | `pharmacy.db.spec.ts` (batches answered 3 s late; fails on the old editor) | ✔ |
| W-REC-32 | Pharmacy: selling more than the batch holds is refused | `billing-edges.db.spec.ts` | ✔ |

## Web — sales manager

| ID | Case and edge cases | Test | Status |
|---|---|---|---|
| W-MGR-01 | New lead form explains what is missing; same number caught; stage, call and note in the history | `leads.db.spec.ts` | ✔ |
| W-MGR-02 | Leads table: search; impossible date range refused | `leads.db.spec.ts` | ✔ |
| W-MGR-03 | Import: template, bad rows listed and left out, .xls gets Save-As steps | `leads.db.spec.ts` | ✔ |
| W-MGR-04 | Home is the sales dashboard; hand-over to reception links lead and patient | `leads.db.spec.ts` | ✔ |
| W-MGR-05 | Recording still on the phone can be requested; lead page lists it | `recordings.db.spec.ts` | ✔ |
| W-MGR-10 | Bulk assign: an owner must be chosen; both leads assigned | `leads-manager.db.spec.ts` | ✔ |
| W-MGR-11 | Lead pool: round-robin state shown; pool saves | `leads-manager.db.spec.ts` | ✔ |
| W-MGR-12 | Leads dashboard opens, chart as a table | `leads-manager.db.spec.ts` | ✔ |
| W-MGR-13 | Round-robin skips inactive people and people not in the pool | `13_leads` (DB) | ✔ |
| W-MGR-20 | Ads page: tiles, filters with clear, campaign side panel; reception has no Ads page | `ads.db.spec.ts` | ✔ |
| W-MGR-21 | Ads periods up to 24 months ("Last 24 months"); 25 months refused on screen and by the server; the campaigns table has its own period, a total row for every campaign that passes the filters, 10 rows a page | `ads.db.spec.ts`, `26_ads` (DB), `date-range.test.ts` | ✔ |
| W-MGR-22 | Sync now / Meta page when the server function can't be reached: "Couldn't reach the server … (meta-ads: …)", not only "Something went wrong" (31/10/2026) | `ads.db.spec.ts` | ✔ |

## Android — everyone

| ID | Case and edge cases | Test | Status |
|---|---|---|---|
| A-SYS-01 | Empty login stopped before sending | `LoginPinTest` | ✔ |
| A-SYS-02 | Wrong password: friendly message, not logged in | `LoginPinTest` | ✔ |
| A-SYS-03 | Login with no signal: "can't reach the server" | `LoginPinTest` | ✔ |
| A-SYS-04 | Receptionist on the phone is sent to the web app | `LoginPinTest` | ✔ |
| A-SYS-05 | PINs that don't match start again; matching PIN opens the app | `LoginPinTest` | ✔ |
| A-SYS-06 | Away under 5 minutes: no PIN asked | `LoginPinTest` | ✔ |
| A-SYS-07 | Away over 5 minutes: PIN asked; a wrong one counts down the tries | `LoginPinTest` | ✔ |
| A-SYS-08 | Forgot PIN means logging in again | `LoginPinTest` | ✔ |
| A-SYS-09 | Sign out removes this person's data from the phone | `LoginPinTest` | ✔ |
| A-SYS-10 | A lead and a note made with no signal reach the server exactly once when it is back; Settings shows "Offline" and how many wait | `OfflineSyncTest` | ✔ |
| A-SYS-11 | The same send repeated (answer lost) still leaves one lead on the server | `OfflineSyncTest` | ✔ |
| A-SYS-12 | A change the server refuses: My day warns, Settings lists it; Retry tries again; Discard (confirmed) removes it | `OfflineSyncTest` | ✔ |
| A-SYS-13 | Sync now shows the last sync time | `OfflineSyncTest` | ✔ |
| A-SYS-20 | Push: the phone gets a push address (needs google-services.json) | `PushTest` | ⏭ no google-services.json yet |
| A-SYS-21 | Sync ordering, back-off, outbox rules, PIN lock maths, track filter, call tracker | JVM tests (`./gradlew testDebugUnitTest`) | ✔ |

| A-SYS-14 | Change PIN: a wrong current PIN counts down; the new PIN works, the old one doesn't | `SettingsTest` | ✔ |
| A-SYS-15 | Change PIN → Cancel keeps the old PIN | `SettingsTest` | ✔ |
| A-SYS-16 | Sign out asks first; "Stay signed in" keeps you in | `SettingsTest` | ✔ |
| A-SYS-17 | Theme choice is kept | `SettingsTest` | ✔ |
| A-SYS-18 | No signal: the "Offline…" strip shows, and goes when the signal is back | `SettingsTest` | ✔ |

## Android — sales executive

| ID | Case and edge cases | Test | Status |
|---|---|---|---|
| A-SAL-01 | New lead form: name and a mobile number required; "12345" refused | `SalesFlowTest` | ✔ |
| A-SAL-02 | New lead saved on the phone opens at once and reaches the server exactly once | `SalesFlowTest` | ✔ |
| A-SAL-03 | The same number again is flagged before saving | `SalesFlowTest` | ✔ |
| A-SAL-04 | Search by name or last digits; stage filters | `SalesFlowTest` | ✔ |
| A-SAL-05 | Stage change: Lost needs a reason; a note needs text; the server shows the new stage | `SalesFlowTest` | ✔ |
| A-SAL-06 | Call notes need a result; "Tomorrow" sets the next call | `SalesFlowTest` | ✔ |
| A-SAL-07 | Booking: doctor needed; first free day/time picked; shows as waiting for confirmation | `SalesFlowTest` | ✔ |
| A-SAL-08 | My day tiles and the chart as a table | `SalesFlowTest` | ✔ |
| A-SAL-09 | Follow-ups list the next call | `SalesFlowTest` | ✔ |
| A-SAL-20 | A call with a known lead: bubble with the name during the call, gone after; notes sheet opens; result required; call saved once as outgoing | `CallerTest` (simulated call states) | ✔ emulator (31/10) · ⏭ Realme phone: it refuses the test switches (mock location / draw over apps), so the test can't start there; not an app fault |
| A-SAL-21 | Incoming call: bubble while ringing; a missed call still asks for notes (length 0) | `CallerTest` | ✔ emulator (31/10) · ⏭ Realme phone: it refuses the test switches (mock location / draw over apps), so the test can't start there; not an app fault |
| A-SAL-22 | A number the CRM doesn't know: no bubble, no notes | `CallerTest` | ✔ emulator (31/10) · ⏭ Realme phone: it refuses the test switches (mock location / draw over apps), so the test can't start there; not an app fault |
| A-SAL-23 | Pop-up switched off: nothing shown | `CallerTest` | ✔ emulator (31/10) · ⏭ Realme phone: it refuses the test switches (mock location / draw over apps), so the test can't start there; not an app fault |
| A-SAL-24 | Without "draw over other apps": the notes come as a notification that opens the sheet | `CallerTest` | ✔ emulator (31/10) · ⏭ Realme phone: it refuses the test switches (mock location / draw over apps), so the test can't start there; not an app fault |
| A-SAL-26 | Calls setup screen shows each permission done / not done; pop-up switch kept; "look for recordings" waits for a folder | `CallSetupTest` | ✔ emulator (31/10) · ⏭ Realme phone: it refuses the test switches (mock location / draw over apps), so the test can't start there; not an app fault |
| A-SAL-27 | A permission taken away shows as not done | `CallSetupTest` | ✔ emulator (31/10) · ⏭ Realme phone: it refuses the test switches (mock location / draw over apps), so the test can't start there; not an app fault |
| A-SAL-28 | Recordings on this phone starts empty | `CallSetupTest` | ✔ emulator (31/10) · ⏭ Realme phone: it refuses the test switches (mock location / draw over apps), so the test can't start there; not an app fault |
| A-SAL-30 | One real call: bubble during the call, notes with the real length from the call log, saved once (the call-log import doesn't add it again) | `RealCallTest` (`--real-call`, someone answers) | ⏭ opt-in (`--real-call`), HAND_TEST C |

## Android — BDM

| ID | Case and edge cases | Test | Status |
|---|---|---|---|
| A-BDM-01 | Starting the day 55 km from the office is refused (selfie taken, no day started) | `BdmDayTest` (pretend GPS + camera) | ✔ emulator (31/10) · ⏭ Realme phone: it refuses the test switches (mock location / draw over apps), so the test can't start there; not an app fault |
| A-BDM-02 | Start at the office: "Day started at the office", route recording on | `BdmDayTest` | ✔ emulator (31/10) · ⏭ Realme phone: it refuses the test switches (mock location / draw over apps), so the test can't start there; not an app fault |
| A-BDM-03 | Travel needs a destination | `BdmDayTest` | ✔ emulator (31/10) · ⏭ Realme phone: it refuses the test switches (mock location / draw over apps), so the test can't start there; not an app fault |
| A-BDM-04 | Reached with a photo of the place | `BdmDayTest` | ✔ emulator (31/10) · ⏭ Realme phone: it refuses the test switches (mock location / draw over apps), so the test can't start there; not an app fault |
| A-BDM-05 | Meeting recording, stopped and attached | `BdmDayTest` | ✔ emulator (31/10) · ⏭ Realme phone: it refuses the test switches (mock location / draw over apps), so the test can't start there; not an app fault |
| A-BDM-06 | Complete: outcome required; a new lead needs a valid number | `BdmDayTest` | ✔ emulator (31/10) · ⏭ Realme phone: it refuses the test switches (mock location / draw over apps), so the test can't start there; not an app fault |
| A-BDM-07 | Break: 5–180 minutes; end break | `BdmDayTest` | ✔ emulator (31/10) · ⏭ Realme phone: it refuses the test switches (mock location / draw over apps), so the test can't start there; not an app fault |
| A-BDM-08 | End the day (confirmed); server has the day ended and one finished visit | `BdmDayTest` | ✔ emulator (31/10) · ⏭ Realme phone: it refuses the test switches (mock location / draw over apps), so the test can't start there; not an app fault |
| A-BDM-09 | Fake (mock) locations are flagged on the day and never counted as kilometres | `BdmDayTest`, `19_bdm` (DB), JVM track filter | ✔ emulator (31/10) · ⏭ Realme phone: it refuses the test switches (mock location / draw over apps), so the test can't start there; not an app fault |
| A-BDM-10 | Geofence maths, auto-end, alerts, trips | `19_bdm`, `20_geo_vectors` (DB) | ✔ |

## Manual field checks (can't be automated honestly)

| ID | What | Why by hand | Status |
|---|---|---|---|
| M-01 | A real drive with the BDM app: km within ±5% of the car's trip meter | Android marks test locations as fake, and fake points are (rightly) not counted | ✋ |
| M-02 | Each phone brand's battery saver doesn't stop route recording or the caller pop-up (Xiaomi, Vivo, Oppo, Samsung…) | Brand settings differ; see TRY_ANDROID.md | ✋ |
| M-03 | Choosing the dialer's call-recording folder, then a recorded call is matched and uploaded | The folder picker is the phone's own screen, different on every brand | ✋ |
| M-04 | A push arrives and opens the right screen | Needs google-services.json (Firebase) | ✋ |
| M-05 | Printed bills, registration and discharge pages on the clinic's printer | Paper and printer | ✋ |
| M-06 | The QR self-registration on a patient's own phone, with the captcha | Captcha is meant to stop robots | ✋ |
