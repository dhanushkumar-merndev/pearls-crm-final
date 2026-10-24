# Pearl Clinic CRM — Build Plan

**Draft 1 · 23/10/2026 · Status: waiting for your answers and approval. No code has been written.**

How to read this:
- **Part A (questions)** is what I need from you. About 15 minutes.
- **Parts B–F** are the technical plan you asked for in section 0 of the brief: architecture, database, API list, phases with tests, risks. Skim them. You don't need to follow every line.
- In VS Code, press `Ctrl+Shift+V` on this file to see it formatted.

> ### ⚠️ Your brief was cut off
> The pasted brief hit the 50,000-character limit. I received sections 0–14 and the start of section 15. It stops at "No service-role k…". I did **not** receive:
> - the rest of **15** (security & privacy)
> - **16** performance & API rules
> - **17** testing
> - **18** phase plan
> - **19** open questions
>
> Below I wrote my own versions of 16–19. They are marked **DRAFT**. Please save the complete brief as `CLINIC_CRM_BUILD_PROMPT.md` in the project folder (the brief itself says to keep it there). I'll read all of it and merge your phase plan, testing rules and questions with mine before I build anything.

What I looked at: all 8 images in `docs/` (logo, bill cum receipt, pharmacy invoice, final bill pages 1–2, discharge summary pages 1–2, handwritten BDM/lead sheet). I did not copy any patient details into this plan.

---

## A. Questions

### A1. Please answer these before I start (expensive to change later)

| # | Question | Why it matters | My recommendation |
|---|---|---|---|
| 1 | Can you send sections 15–19 of the brief? | Your phase plan, testing rules and questions may differ from my drafts | Save the full file at the repo root |
| 2 | **Production database: Supabase Free or Pro?** | Free has **no backups you can restore**. It pauses after 7 idle days. 500 MB fills in about 9–15 months (see C8). This system will hold billing and medical records | Build and test on Free. Switch production to **Supabase Pro ($25/month ≈ ₹2,200)** on go-live day |
| 3 | **Web hosting: Vercel Pro or Cloudflare?** | Vercel's free Hobby plan doesn't allow business use | **Vercel Pro ($20/month)**, as your brief says. The cheaper option is Cloudflare Workers Paid ($5/month), with more setup. Cloudflare's free plan is too small for Next.js (10 ms CPU limit) |
| 4 | **DocPulse data: what should come over?** Can DocPulse export Excel/CSV? | Decides which import tools I build and when | Import **patients**, **pharmacy items + current stock** (as opening stock) and **unpaid balances**. Keep old bills as a read-only Excel/PDF archive instead of re-creating them as bills |
| 5 | **Bill numbers and financial year.** Your bills dated 01/10/2026 print "PAC/25-26/…", but 1 Oct 2026 falls in FY 2026-27 | The brief says numbering resets every 1 April. Numbering mistakes on tax invoices are hard to undo | Print the correct year (`PAC/26-27/…`). For the rest of this year, continue from DocPulse's last number. Reset to 1 on 1 April 2027. Please confirm with your CA, and tell me the last UHID and the last number of each bill series on switch-over day |
| 6 | **IP number: same as UHID or a separate series?** The sample shows "PAC :2139", which looks like a UHID | If a patient is admitted twice, a UHID-based IP number repeats | A separate IP series (for example `IP/26-27/1`). A setting can still switch to "same as UHID" |
| 7 | **Packages:** when a patient buys a 6-session package, do you bill the whole package up front (with part payments) or bill each session? | Changes how sessions, bills and balances link together | Support both. Default: one Bill cum Receipt for the package at the start, part payments allowed, sessions recorded at ₹0 |
| 8 | **What does "Amount finalised" (the agreed price) include?** Pharmacy? Room? Consumables? | Drives the "Agreed vs billed" report and the "billing below agreed price" warning | A setting that lists which bill categories count. Default: everything except Pharmacy |
| 9 | **Staff logins:** does every staff member have an email address? | Supabase login is email + password | Admin creates every account. Staff without email get a username (e.g. `ravi`) mapped to a hidden internal address. Admin resets their passwords |
| 10 | **Sales phones:** company-owned or personal? Which brands and models? | On phones that use the **Google Phone app** (Pixel, Motorola and many newer Xiaomi/Redmi/POCO, OnePlus, Oppo and Realme models), call recordings stay locked inside the dialer, so our app **cannot read them** | **Company-owned Samsung phones** for sales staff. Samsung's dialer saves recordings where our app can read them. On personal phones, the app only keeps calls to CRM numbers and ignores all other calls |
| 11 | **How will the Android app be installed?** | Google Play's rules restrict apps that read call logs, draw pop-ups over other apps and track location in the background. Approval is slow and uncertain | **Install the APK directly** (internal app) with an in-app "update available" prompt. Google is expected to require developer verification for directly installed apps in India from 2027 (verify the date). We register then, for a small one-time fee |
| 12 | **WhatsApp number:** use the clinic's existing WhatsApp Business number ("coexistence") or a new number? Who owns the clinic's Meta Business account, and is it verified? | Meta approvals take days to weeks. Changing numbers later loses chat history | **Start Meta Business Verification now.** Use the existing number through coexistence if it qualifies (patients already know it). Otherwise use a new SIM just for the API |
| 13 | **Team size:** how many receptionists, reception PCs, sales executives, sales managers, BDMs and doctors? | Drives cost estimates, the BDM upload interval and test data | — |
| 14 | **Domain:** do you own one, and do you have DNS access? | Needed for the app address and so emails (password reset, daily summary) don't land in spam | Use a sub-domain of the clinic's website domain, e.g. `crm.<clinic-domain>` |
| 15 | **Where should the code live?** | Automated tests run on every change. GitHub Actions is free for private repos (about 2,000 minutes/month) | Private GitHub repository owned by you |

### A2. Defaults I'll use unless you say otherwise

| Topic | Default |
|---|---|
| Doctor logins (your brief's open question) | No login now. The database leaves room to add a read-only `doctor` role later |
| **GST on cosmetic procedures** (needed before go-live, not before building) | Under GST, healthcare services by clinics are exempt, **but cosmetic and plastic surgery is taxable (18%) unless it reconstructs after a congenital defect, injury or trauma**. Hospital room rent above ₹5,000/day (non-ICU) carries 5%. Your samples bill 0%. **Please ask your CA.** The system already supports a GST rate per service, room type and medicine (default 0% for services), so no code change is needed either way |
| Registration form | The field list in brief section 7.2 until you send your real form. Fields live in settings, so adding yours later needs no code change |
| QR self-registration | A QR shown on a reception screen that changes every 30 minutes. A setting allows a printed, permanent QR instead |
| Room day count | Number of nights (midnights crossed), minimum 1. Your sample (admitted 30/03 10:50, discharged 31/03 10:50) = 1 day |
| Discount limits | Receptionist: up to 20% per line and per bill. Above that the app blocks it with "Ask admin". Admin has no limit |
| Shared reception PCs | Each receptionist has their own login (needed for the audit trail). Auto logout after 15 minutes idle (setting) |
| Reception and call recordings | Reception sees call notes in the patient file but can't play recordings (setting) |
| BDM visit "record camera, speaker and location" | I read your note as **photo punch + audio recording + GPS**. No video (video would use up storage very quickly) |
| Recording consent | The app reminds the BDM to tell the person the meeting is being recorded. For calls, the phone's dialer plays its own recording notice |
| Appointment defaults | 15-minute slots, 3 patients per slot, 10:00–20:00 Mon–Sat. **Please send real hours and holidays** |
| Payment modes | Cash, UPI, Card, Bank transfer, Online |
| Pharmacy | Prices include GST. Near-expiry warnings at 90/60/30 days. Negative stock blocked. Batches picked earliest-expiry-first (FEFO) |
| Lead stages | Moves automatically to "Consultation booked" when booked, "Consulted" when that appointment is done, "Converted" when a treatment starts |
| Printing | A4 for all three bill types, like your samples |
| Language | English now. All screen text kept in translation files for Kannada/Hindi later |
| Region | Supabase and Vercel in Mumbai |
| Maps | **Change from the brief:** MapLibre on both web and Android with **OpenFreeMap** tiles (free, business use allowed). The brief's openstreetmap.org tile servers have a usage policy that discourages app traffic |

### A3. What I noticed in your photos

- **Bill numbers:** the procedure bill (…/964 at 10:56) and pharmacy invoice (…/1192 at 11:12, same morning) use **separate counters** with the same prefix. This matches the brief's "separate series per bill type".
- **"Rupees Only" is empty** on both the procedure bill and pharmacy invoice. The amount in words is missing. We will always print it.
- **Discount column:** the header says "Discount (Rs.)" but the value is "100.00 %". We'll print the unit on each line ("10 %" or "₹500").
- **Pharmacy GST:** CGST 2.5% + SGST 2.5% on two items. The third item shows no GST at all, and there is an Ex-GST/In-GST total column. Rates come from each item.
- **Final bill errors** (on top of those the brief lists): the In-Patient Services group lines add up to ₹35,000 but the group total says ₹25,000. Group totals add up to ₹1,35,000 against a bill amount of ₹1,50,000. The summary label says "Pharmacy Change" (typo). In our version every total and the words are calculated and can't be typed. Category labels are editable settings.
- **Discharge summary:** "He underwent" for a female patient (the placeholders fix this). Page 1's photo has no letterhead, but page 2 shows logo + QR + phone top right. We print the letterhead on every page. The signature block is "for" + signature + doctor name + designation + council registration number.
- **Handwritten sheet:** BDM day start must be **away from home** ("location not home"), which is the office-geofence rule. "15 mins travel + km covered (VV Imp)" means actual km vs estimated km should be prominent on the BDM timeline. Lead columns match brief section 9.2.

---

## B. Architecture

### B1. Big picture

```
  Reception · Admin · Sales Manager               Sales exec · Sales manager · BDM
  Chrome / Edge (desktop, tablet)                 Android app (Kotlin)
        │  Next.js on Vercel (Mumbai)                   │  Room + WorkManager = offline queue
        │  screens, print pages, PDF route              │
        ▼                                               ▼
  ┌──────────────────────────── Supabase (Mumbai) ──────────────────────────────┐
  │ Auth: staff only, role in login token    Postgres + RLS: all business rules │
  │ RPC functions: book, finalize, stock…    Realtime: bell, Today board, map   │
  │ Edge Functions: files-sign, webhooks, drip-runner, notify, purge, …         │
  │ pg_cron: watchdog, drips, reminders, alerts, trips, daily summary           │
  │ Vault: WhatsApp / Meta tokens            Storage: public-assets (logo, avatars)
  └───────────────┬──────────────────────────┬────────────────────────┬─────────┘
                  │ short-lived signed URLs  │                        │
                  ▼                          ▼                        ▼
         Tigris (private files)     Meta: WhatsApp + Lead Ads    Brevo · FCM · OpenRouteService
```

Files go **straight from the browser or phone to Tigris** using a signed link that works for a few minutes. Our servers never carry file bytes.

### B2. Key decisions

1. **Postgres is the rulebook.** Slot capacity, bill numbering, stock, bill maths, locking finalized documents and who-can-see-what all live in Postgres functions and Row Level Security (RLS). Web and Android call the same functions, so the two apps can never disagree.
2. **Writes go through RPC functions**, one database transaction each, so a half-finished save is impossible. The exceptions are a few simple admin master-data tables (doctors, schedules, libraries), which are written directly under RLS. Reads use plain table queries under RLS when simple, or one RPC when a screen needs several things at once ("one screen, one call").
3. **RLS checks the live `staff` table, not only the login token.** Deactivating someone or changing their role takes effect immediately. The token carries the role only so the app can show the right menus.
4. **Money in paise (`bigint`).** The database calculates every amount, tax and total. The screen shows a live preview using the same maths from `packages/shared`. Both are tested against one shared file of worked examples ("golden vectors"), so they always agree.
5. **Finalized documents are frozen.** Bills and discharge summaries store a snapshot of the clinic header and patient strip at finalize. Reprints never change when settings change later.
6. **Next.js 16 (App Router).** In v16 the login-redirect file is called `proxy.ts` (it was "middleware" before). TanStack Query handles caching, next-intl handles translations, and Tailwind + shadcn/ui the components.
7. **Printing** uses HTML/CSS A4 templates. Chrome/Edge support repeating headers and "Page 1 of 2" footers. **PDF files** (for WhatsApp, email and the patient's Documents tab) are made by rendering the **same** print page in headless Chrome on a Vercel function. One template serves both, and it will handle Kannada/Hindi text later (in-browser PDF libraries break Indian-language text shaping).
8. **Webhooks and scheduled jobs run in Supabase** (Edge Functions + pg_cron), as the brief says.
   - Integration secrets (Tigris, WhatsApp, Meta, Brevo, Firebase, OpenRouteService) live in the **root `.env`** (git-ignored). `pnpm env:sync` copies them to **Edge Function secrets**: `supabase/functions/.env` locally, `supabase secrets set` online. Only Edge Functions can read them.
   - Admin screens show each integration's status with masked values and a **Test connection** button.
   - *Changed 23/10/2026 at the owner's request; was "typed into admin screens → Vault".*
9. **Android:** one app with menus by role. The local Room database feeds every list. The app pulls only what changed since its last sync. User actions go into an outbox that WorkManager sends with retries. Every new record gets its ID on the phone, so a retry can never create a duplicate.
10. **Private files:** one `StorageAdapter` (S3 API) inside Edge Functions. The `files` table is the index, so the bucket is never listed.
11. **Caller pop-up without taking the "call screening" role.** Only one app can hold that role, and Truecaller usually has it. We use phone-state and call-log permissions instead. Using the role becomes an optional setting.
12. **Audio:** Opus/Ogg on Android 10+, AAC (m4a) on Android 8–9, because the Opus encoder only exists from Android 10.
13. **Undo (5 seconds):** the app waits 5 seconds before sending a delete or cancel. Undo cancels the send, and closing the page sends it immediately.
14. **Monorepo** with pnpm workspaces. The Supabase CLI runs a full local copy of the backend in Docker for development and tests.

### B3. Repo layout

```
/web                Next.js app (reception, admin, sales manager)
  app/(auth)/…        login, forgot password
  app/(clinic)/…      today, patients/[id], appointments, bills, pharmacy, leads, admin/…
  app/print/…         A4 print pages
  app/r/[token]       public self-registration · app/scan/[token] phone scan
  app/api/…           keepalive, pdf
  components/         ui (shadcn), library-combobox, slot-board, …
  lib/                supabase clients, queries, upload-queue (IndexedDB), scan (lazy OpenCV), backup (File System Access)
  messages/en.json    all screen text
/android            Kotlin app
  app/                navigation, role routing
  core/{model,data,sync,ui,location,media,telephony}
  feature/{leads,calls,appointments,recordings,bdm,settings}
/supabase           migrations/, functions/ (Edge, with _shared/), tests/ (pgTAP), seed/ (fake: 01_users local-only, 02_demo_settings), config.toml
/packages/shared    Zod schemas, money / GST / number-to-words, IST date helpers, generated DB types
/tests-mocks        local fake Meta Graph, WhatsApp, OpenRouteService, Brevo, FCM; MinIO for S3
/scripts            type generation, perf seed, golden-vector export
/dev-docs           SETUP.md, SETUP_META.md, API.md, TESTING.md, PLAN.md
/docs               PRIVATE, git-ignored, never committed
```

### B4. Environments

| Environment | Database | Files | Web | Used for |
|---|---|---|---|---|
| Local | Supabase CLI in Docker | MinIO (S3 look-alike) | localhost | Development and automated tests |
| Staging | Supabase Free project 1 | Tigris bucket `pearl-staging` | Vercel preview | You test each phase here |
| Production | Supabase project 2 (Free → Pro) | Tigris bucket `pearl-prod` | Vercel Pro + your domain | The clinic |

Only fake data outside production.

### B5. Design system — ChatGPT-style, dark by default (approved 23/10/2026)

- **Look:** inspired by ChatGPT's dark UI (no OpenAI logo or name). Neutral greys, flat surfaces with hairline borders, rounded-2xl cards, pill buttons, quiet hover washes, no heavy shadows. Granny rules still apply: 16–18 px base text, 44 px buttons, icon + text, status = icon + label.
- **Layout (web):** collapsible left sidebar (logo, the role's main action at the top like ChatGPT's "New chat", menu with icon + text, user menu at the bottom with theme switch). Slim top bar with one search box (`/` or Ctrl+K opens a command palette). Content in a centred, comfortable width.
- **Tokens:** one file, `packages/shared/design/tokens.json`, generates CSS variables (web) and `Color.kt` (Android).

| Token | Dark (default) | Light |
|---|---|---|
| Page / cards / chart surface | `#212121` | `#ffffff` |
| Sidebar | `#171717` | `#f9f9f9` |
| Raised (menus, inputs, dialogs, search) | `#2f2f2f` | `#ffffff` + soft shadow |
| Hover wash | `#2f2f2f` | `#f3f3f3` |
| Border | `rgba(255,255,255,0.10)` | `rgba(0,0,0,0.10)` |
| Text primary / secondary / muted | `#ececec` / `#b4b4b4` / `#9b9b9b` | `#0d0d0d` / `#5d5d5d` / `#6b6b6b` |
| Primary button | white bg, black text | black bg, white text |
| Focus ring / links | `#3987e5` / `#7ab7ff` | `#2a78d6` / `#2964aa` |

(Muted greys were raised from the first draft's `#8f8f8f` / `#737373` so that muted text passes 4.5:1 on menus and hover rows as well. This is checked by `packages/shared/tests/palette.test.ts`.)

- **Font:** Inter, self-hosted through next/font.
- **Behaviour:** Dark (default) / Light / System per user, saved in their profile, no flash on load. **Print pages and PDFs are always white.** Android uses a Material 3 dark scheme from the same tokens.

### B6. Dashboards and KPIs per role (approved 23/10/2026)

**Charts.** Web uses **Apache ECharts 6**, tree-shaken (only Bar, Line, Heatmap, Gauge + Grid, Tooltip, Legend, Dataset, Aria) and lazy-loaded only on dashboard pages, with the SVG renderer. One `<EChart>` wrapper handles theme, resize, dispose, aria and a **"View as table"** toggle. Android uses **Vico** (native Compose). Stat-tile sparklines are tiny inline SVGs.

**Colours** (validated with the dataviz palette checker against `#212121` dark and `#ffffff` light; every check passes):
- Categorical, fixed order, never cycled. Dark: `#3987e5 #d95926 #199e70 #c98500 #d55181 #008300 #9085e9 #e66767`. Light: `#2a78d6 #eb6834 #1baf7a #eda100 #e87ba4 #008300 #6250d6 #e34948`.
- Chart cards sit on the page colour, not the raised grey (one slot fails contrast on `#2f2f2f`).
- Light mode has 3 low-contrast slots, so every chart ships direct labels and the table view. More than 6 series fold into "Other".
- Status colours are reserved: good `#0ca30c`, warning `#fab219`, serious `#ec835a`, critical `#d03b3b`, always with icon + label.
- Sequential uses one blue ramp.

**Forms.**
- Stat tiles (value + change vs previous period + sparkline) for headline numbers, line for trends, bars for comparisons.
- Stacked bar for part-to-whole (no pies). Horizontal ordinal bars + step conversion % for funnels. Meters for limits. Tables with in-cell bars for long lists.
- **No dual-axis charts.**
- One filter row: Today / 7 days / Month-to-date / Last month / Custom + compare to previous period.
- Clicking a bar opens the matching filtered table.

| Role / where | KPI tiles | Charts / tables |
|---|---|---|
| **Receptionist** (web home) | Appointments today, Arrived, With doctor, Done, No-show, Walk-ins, Waiting for confirmation, Collected today (by mode), Bills today, Follow-ups due/overdue, Pharmacy alerts, Pending registrations | Arrivals by hour (today vs typical day in grey), Doctor load today (stacked by status) |
| **Sales executive** (Android) | Calls today, Connected %, Talk time, Follow-ups due/overdue, Booked today, Pending confirmations; month: Leads assigned, Converted, Conversion %, Agreed amount, target meter | Calls per day (14 days), My funnel |
| **Sales manager** (web + Android) | New leads, Contacted within 1 h %, Consultations booked, Show rate, Converted, Conversion %, Agreed amount, Overdue follow-ups, Recordings to review / pending sync | Stage funnel, Leads by source over time, Conversion by source, Exec leaderboard, Calls heatmap (hour × weekday), Lost reasons, Agreed vs billed per exec |
| **BDM** (Android) | Visits, Km actual vs estimated, Leads created, Break used vs allowed; month: visits, leads, conversions, km | Time split (travel / meeting / break / office) |
| **Admin** (web) | Revenue (hero), Collected, Outstanding, Discounts, New vs returning patients, No-show rate, IP admissions + average stay, Pharmacy sales / margin / stock value / near-expiry value, WhatsApp sent / delivered / read + cost, BDMs on duty, storage meter, last verified backup, integration health | Revenue trend, Revenue by bill type and category, Payment modes, Outstanding ageing, Doctor utilisation + revenue per doctor, Session adherence, Revenue by lead source, Lead funnel, Agreed vs billed, Top medicines, BDM summary |

Defaults: reception sees today's collections only. Optional monthly targets per sales exec (off by default).

**Fast and cheap.**
- One RPC per dashboard (`dashboard_reception`, `dashboard_sales_exec`, `dashboard_sales_manager`, `dashboard_bdm`, `dashboard_admin`), each returning one JSON under 30 KB.
- Closed days come from the `kpi_daily` rollup (additive counts and sums only; ratios computed when read). Today is computed live by the same SQL function `kpi_compute_day(day)`, so the two can't disagree. Backdated edits mark the day dirty and an hourly job recomputes it.
- No polling: cached 60 s, refetched on tab focus, refresh button.
- Budget: p95 < 300 ms on the perf seed.

**Tests.**
- KPI golden fixture with hand-worked answers (pgTAP).
- Rollup = live for sampled days.
- RLS per role.
- Nightly performance job.
- Playwright screenshots in dark and light, "View as table", empty states, axe contrast.
- Palette validator in CI.
- Android Compose screenshot tests.

---

## C. Database

### C1. Conventions

- Two schemas: `public` holds tables and RPCs the apps can reach; `private` holds helpers, triggers and cron functions the apps can't reach.
- Every table has `id uuid` (the phone or browser may generate it, which makes retries safe), `created_at`, `created_by`, `updated_at`, `updated_by`.
- Times are `timestamptz`. Columns ending in `_date` hold IST calendar dates worked out on the server.
- Money columns are `*_paise bigint`. Rates are `numeric(5,2)` and quantities `numeric(10,3)`.
- Phones are stored as `*_e164` plus `*_last10` for search and matching.
- User-extendable lists (sources, reasons, payment modes, categories) live in `lookup_values`. Fixed system states use Postgres enums.
- A field-level audit trigger covers business tables (patients, treatments, bills, payments, leads, settings, discharge summaries, stock adjustments).
- Extensions: `pgcrypto`, `pg_trgm` (fast name search), `btree_gist` (no-overlap rules), `pg_cron`, `pg_net`, `supabase_vault`. No PostGIS: geofence and distances use simple SQL maths.

### C2. Enums

```
staff_role          receptionist, sales_executive, sales_manager, bdm, admin
gender              female, male, other, unknown
appt_status         pending_confirmation, confirmed, arrived, with_doctor, done, no_show, cancelled, rescheduled
appt_type           consultation, session, procedure, surgery, follow_up, review      (+ is_walk_in flag)
appt_mode           offline, online
confirm_via         reception, sales_call, whatsapp, auto
treatment_category  surgery_ip, procedure, non_surgical, wellness
treatment_status    active, on_hold, completed, closed, cancelled
session_status      planned, booked, done, missed, skipped
admission_status    admitted, discharged, cancelled
bill_type           procedure_receipt, pharmacy_invoice, final_bill
doc_status          draft, finalized, cancelled                   (bills, discharge summaries)
discount_type       amount, percent
payment_kind        payment, advance, refund
stock_move_kind     opening, purchase, sale, sale_cancel, patient_return, damaged, expired, supplier_return, count_correction
series_key          uhid, ip_number, procedure_receipt, pharmacy_invoice, final_bill
lead_stage          new, contacted, interested, consultation_booked, consulted, surgery_scheduled, converted, lost, not_reachable, junk
wa_mode             auto, manual
call_direction      outgoing, incoming, missed
call_outcome        connected, no_answer, busy, switched_off, wrong_number, call_back
recording_kind      call, visit, voice_note
recording_status    on_phone, queued, uploading, synced, failed, archived
file_purpose        prescription, document, registration_form, patient_photo, call_recording, visit_recording, voice_note,
                    punch_photo, selfie, doctor_signature, pdf, thumbnail
file_status         pending, uploaded, failed, archived, deleted
wa_direction        outbound, inbound
wa_status           queued, sent, delivered, read, failed, received, manual      (status_rank keeps the highest)
template_category   marketing, utility, authentication
drip_status         active, paused, completed, stopped
followup_kind       followup, call_to_confirm, reschedule_request, review_recording, other
followup_status     open, done, cancelled
bdm_state           off_duty, in_office, travelling, at_visit, on_break
bdm_event_kind      start_day, office, travel_start, reached, visit_complete, break_start, break_end, end_day,
                    gps_off, gps_on, permission_lost, battery_saver, mock_location, no_heartbeat, auto_end
integration         whatsapp, meta_leads, brevo, ors, fcm, tigris
```

### C3. Tables

#### Settings and system
- **clinic_settings** (one row now; `branch_code` for later): name, legal_name, gstin, llpin, address lines, city, state, state_code, pincode, phones[], email, website, logo_path, letterhead_qr_url, signatory_label, `terms jsonb` (points per bill type, pre-filled from your 9 points).
- **app_settings**: `section` (pk), `value jsonb`, `version`. Each section is checked against a Zod schema on save. Sections: appointments, billing, pharmacy, sales, bdm, whatsapp, meta, storage, notifications, security, registration_form.
- **number_series**: series_key, fy (`2026-27`, or `ALL` for UHID), prefix, format (e.g. `{prefix}/{fy}/{n}`), next_value, padding. `unique(series_key, fy)`. Only `private.take_number()` changes `next_value`, under a row lock.
- **lookup_values**: kind (lead_source, lost_reason, referral_name, bill_category, payment_mode, relation, document_kind, quick_reply, break_type), label, code, sort, active, usage_count, last_used_at, created_on_the_fly, reviewed_at. `unique(kind, lower(label))`, trigram index on label.
- **holidays** (day unique, name) · **offices** (name, lat, lng, radius_m: the BDM geofence).
- **files**: bucket, object_key (unique), purpose, mime, size_bytes, sha256, width, height, page_count, duration_s, status, owner_staff_id, patient_id, lead_id, linked_table + linked_id, thumbnail_file_id, archived_at, backup_item_id. Indexes: (patient_id, created_at desc), (sha256), (purpose, status, created_at).
- **public_links**: kind (self_registration, phone_scan), token_hash (unique), patient_id, created_by, expires_at, max_uses, uses.
- **notifications**: recipient_id, type, title, body, link, data, `dedupe_key` (unique, which makes "fire once" possible), read_at. Index (recipient_id, read_at, created_at desc). Realtime.
- **device_tokens**: staff_id, fcm token (unique), platform, app_version, last_seen_at.
- **audit_log** (bigint id): at, actor_id, table_name, row_id, action, `changes jsonb` (only changed fields, `{field: [old, new]}`), reason, request_id. BRIN index on `at`, btree on (table_name, row_id). Written only by trigger; admin read only.
- **idempotency_keys** (key, staff_id, fn, response; kept 7 days) · **job_runs** (job, started, finished, ok, detail; also used as the cron lock) · **usage_counters** (month, metric such as tigris_writes / wa_utility / emails / ors_calls, value) · **integration_status** (integration pk, state, last_ok_at, last_error, checked_at) · **client_errors** (app, version, staff_id, message, stack, context; kept 30 days).
- **backup_batches** (scope, started/finished, status, counts) · **backup_items** (batch_id, kind, file_id or table + row range, local_path, size, sha256, verified_at; `unique(batch_id, file_id)`).
- **kpi_daily**: day, metric, dim_kind (clinic, doctor, staff, source, bill_type, mode, category), dim_id, value (numeric). Primary key (day, metric, dim_kind, dim_id). Additive counts and sums only. About 9 MB/year.
- **kpi_dirty_days**: day (pk), marked_at. Filled by triggers when a past day's bills, payments, appointments, leads or calls change; cleared by the hourly recompute.
- **sales_targets**: staff_id, month, metric (converted, agreed_paise, calls), target. Optional, off by default.

#### People
- **staff**: id = auth user id, role, full_name, username, email, phone, active, avatar_path, theme (dark, light, system; default dark), office_id, bdm_start_anywhere, recording_upload_override, deactivated_at. The view **staff_directory** (id, name, role, active, avatar) is readable by everyone.
- **doctors**: full_name, display_name, specialization, qualification, designation, reg_council, reg_number, signature_file_id (private), consultation_fee_paise, colour, slot_minutes, capacity_override, active, sort.
- **doctor_schedules**: doctor_id, weekday, start_time, end_time, slot_minutes, capacity, valid_from, valid_to. An exclusion constraint blocks overlapping hours for the same doctor and weekday.
- **doctor_leaves**: doctor_id, `during tstzrange`, reason. No overlaps.

#### Patients
- **patients**: uhid (unique), title, full_name, gender, dob, dob_estimated (when only age was given), phone, whatsapp phone, alt phone, email, address, area, city, pincode, attender name/relation/phone, blood_group, allergies[], conditions[], current_medicines, previous_surgeries, chief_complaints, complaint_since, heard_from_id, referred_by_text, lead_id, preferred_language, occupation, id_proof_type/number, photo_file_id, `consents jsonb` (each: given, at, by, method), `custom_fields jsonb`, family_group_id, tags[], wa_mode, merged_into_id. Indexes: phone_last10, trigram(full_name), family_group_id. **Phone is not unique.**
- **registration_requests**: link_id, payload jsonb, phone_last10, status (pending, created, updated, family, discarded), patient_id, reviewed_by/at, ip_hash.
- **patient_merges**: from_id, into_id, moved (row counts per table), by, at, reason.

#### Libraries
- **services**: name, category_id, default_price_paise, sac, gst_rate, doctor_id, is_doctor_charge, active, usage_count, last_used_at, created_on_the_fly, reviewed_at. Trigram(name).
- **treatment_templates**: name, category, default_sessions, gap_days int[] (e.g. `{0,14,30,60}`), session_minutes, pricing (per_session or package), default_price_paise, pre_care, post_care, drip_campaign_id, discharge_template_id, follow_up_days. Plus **treatment_template_services** (template_id, service_id, qty, when: each_session / once / ip_stay).
- **discharge_templates**: name, treatment_template_id, `sections jsonb`, `medications jsonb`, follow_up_days, version, active. One generic Septoplasty template is pre-loaded (no patient details).
- **room_types**: name, daily_rate_paise, sac, gst_rate, active.
- **pharmacy_items**: name, form, strength, manufacturer, hsn, gst_rate, mrp_paise, selling_price_paise, purchase_price_paise, pack_size, sell_unit, reorder_level, rack, active, usage_count, created_on_the_fly, reviewed_at. Trigram(name).

#### Care
- **patient_treatments**: patient_id, template_id, name, category, status, doctor_id, start_date, planned_sessions, gap_days, pricing, package_price_paise, **agreed_price_paise, agreed_by, agreed_at**, lead_id, drip_campaign_id, discharge_template_id, notes. Index (patient_id, status).
- **treatment_sessions**: treatment_id, patient_id, seq, planned_date, actual_date, status, doctor_id, appointment_id, notes. `unique(treatment_id, seq)`. Index (status, planned_date).
- **appointments**: patient_id, lead_id, doctor_id, appt_date (IST), slot_start, slot_end, type, mode, status, is_walk_in, queue_no, confirmed_via/at/by, treatment_id, session_id, source_id, booked_by, booked_from (web or android), notes, rescheduled_from_id, arrived_at, with_doctor_at, done_at, cancel_reason. `check(patient_id is not null or lead_id is not null)`. Indexes: (doctor_id, slot_start) for active statuses only, (appt_date, status), (lead_id), (patient_id, slot_start desc). Realtime, filtered by `appt_date`.
- **visits**: patient_id, appointment_id, doctor_id, visit_date, check_in_at, check_out_at, complaints, notes.
- **admissions**: patient_id, treatment_id, ip_number (unique), admitted_at, discharged_at, room_type_id, room_label (e.g. "SEMI DELUX ROOM/1"), attender fields, procedures[], anaesthesia, surgery_at, status. `check(discharged_at >= admitted_at)`. Plus **admission_surgeons** (admission_id, doctor_id, role: primary / assistant / visiting).
- **followups** (also used for tasks): kind, patient_id, lead_id, due_date, due_at, reason, source (session, discharge, doctor, manual, sales, system), assigned_to (empty = reception queue), status, done_at/by, outcome, ref_table + ref_id. Indexes: (status, due_date), (assigned_to, status, due_date).
- **documents**: patient_id, kind_id, title, doc_date, visit_id, session_id, admission_id, doctor_id, file_id, thumbnail_file_id, page_count, archived. Index (patient_id, doc_date desc).
- **discharge_summaries**: admission_id, patient_id, status, version, `content jsonb` (header snapshot, ordered sections, medication rows, signature block), template_id, finalized_at/by, pdf_file_id, followup_id. One active summary per admission. Plus **discharge_summary_versions** (summary_id, version, content, edited_by, reason, at).

#### Billing
- **bills**: bill_type, bill_no (empty until finalize), fy, status, patient_id, doctor_id, referred_by_text, bill_at, treatment_id, admission_id, visit_id, consolidated_into_id, tax_inclusive, gross / discount / taxable / cgst / sgst / round_off / total paise (this bill's **own** lines), carried_in_paise (final bill only), agreed_price_paise, below_agreed_reason, `header_snapshot jsonb`, version, print_count, finalized_at/by, cancelled_at/by, cancel_reason. `unique(bill_type, bill_no)`. Indexes: (patient_id, bill_at desc), (status, bill_at), treatment_id, admission_id.
- **bill_items**: bill_id, line_no, category_id, kind (service, pharmacy, room, doctor_charge, custom, carried_in), service_id, pharmacy_item_id, batch_id, room_type_id, doctor_id, description, hsn_sac, mfg, batch_no, expiry_date, service_date, rate_paise, qty, discount_type, discount_value, gst_rate, and the **calculated** gross / discount / taxable / cgst / sgst / total paise, set by trigger and read-only. carried_from_item_id is unique across active final bills. Checks: qty > 0, 0 ≤ discount ≤ gross, 0 ≤ gst_rate ≤ 40.
- **payments**: patient_id, kind, mode_id, amount_paise (> 0), reference (UPI transaction id etc.), received_at, received_by, treatment_id, admission_id, note, cancelled_at/by/reason. Plus **payment_allocations** (payment_id, bill_id, amount_paise). A trigger keeps total allocations ≤ the payment, which handles advances, part payments and refunds cleanly.
- **bill_versions**: bill_id, version, full snapshot, edited_by, reason, at.

#### Pharmacy
- **suppliers** · **purchases** (supplier_id, invoice_no, invoice_date, status draft or posted, totals; `unique(supplier_id, invoice_no)`) · **purchase_items** (item_id, batch_no, expiry_date, qty, free_qty, purchase_price, mrp, gst_rate).
- **item_batches**: item_id, batch_no, expiry_date (last day of the month), mrp_paise, purchase_price_paise, selling_price_paise, supplier_id, `qty_on_hand` (a cached total kept by trigger from movements, and re-checked nightly). `unique(item_id, batch_no, expiry_date)`. Index (item_id, expiry_date) where qty_on_hand > 0.
- **stock_movements** (append-only, no update or delete): batch_id, item_id, kind, qty (signed), ref_table, ref_id, reason, at, by. **Stock = sum of movements.**
- **stock_alert_state**: item or batch, alert (low, near_expiry_90/60/30, expired), fired_at, cleared_at. This makes an alert fire once and clear after restock.

#### CRM
- **leads**: sl_no (auto number shown as "Sl No"), lead_date, name, phone, alt_phone, email, treatment_template_id, treatment_text, assigned_to, doctor_id, source_id, `source_detail jsonb` (campaign, ad, form), meta_leadgen_id (unique), referred_by_text, referred_by_staff_id, appointment_mode, surgery_date, next_followup_at (due date), amount_quoted_paise, **amount_finalised_paise + by + at**, comments1, comments2, reminder_on, wa_mode, stage, lost_reason_id, lost_recording_id, patient_id, duplicate_of_id, created_via, last_activity_at, deleted_at. Indexes: (assigned_to, stage, next_followup_at), phone_last10, trigram(name), (lead_date desc), (stage, lead_date).
- **lead_activities**: lead_id, staff_id, kind, body, data, at. Index (lead_id, at desc).
- **lead_assignments** (history): lead_id, from_staff, to_staff, by, method (manual, round_robin, rule), at. This also tells a phone to remove a lead that was reassigned away.
- **call_logs** (ID made on the phone): staff_id, lead_id, patient_id, phone, direction, started_at, duration_s, outcome, notes, source (app or phone call log), device_call_key, recording_id. `unique(staff_id, device_call_key)`. Indexes: (lead_id, started_at desc), (staff_id, started_at desc), (patient_id, started_at desc).
- **recordings** (ID made on the phone): kind, staff_id, call_log_id, site_visit_id, lead_id, patient_id, recorded_at, duration_s, uploaded_s, trimmed, status, match_confidence, needs_review, sync_requested_by/at, file_id, error.
- **round_robin_state**: pool (pk), last_staff_id.

#### Messaging
- **wa_templates**: meta_id, name, language, category, status, components jsonb, purpose, variable_map jsonb (which field fills `{{1}}`, `{{2}}`…), synced_at.
- **wa_contacts**: phone (pk), last_inbound_at (for the 24-hour window), opted_out_at.
- **wa_messages**: patient_id, lead_id, phone, direction, kind (template, text, media, button_reply, manual), template_id, body, wa_message_id (unique), status, status_rank, status_at, error_code, error_text, category, est_cost_paise, sent_by, appointment_id, drip_send_id.
- **wa_webhook_events**: event_key (unique), kind, received_at, processed_at, error, payload (kept 14 days, then cleared to save space).
- **optouts**: phone, channel, at, source.
- **drip_campaigns** (name, trigger, stop_on_reply, stop_on_booking, active) · **drip_steps** (seq, template_id, offset, anchor: enrollment or event, send window) · **drip_enrollments** (target, anchor_at, status, next_seq, next_send_at; index (status, next_send_at)) · **drip_sends** (`unique(enrollment_id, step_id)`, which makes a double send impossible).

#### BDM
- **bdm_days**: staff_id, work_date, started_at, start point + accuracy, selfie_file_id, start_in_geofence, office_id, ended_at, end point, auto_ended, flags[], summary jsonb. `unique(staff_id, work_date)`.
- **bdm_events** (ID made on the phone): day_id, kind, device_at, **server_at** (server time, used for all records), point + accuracy, site_visit_id, data.
- **site_visits** (ID made on the phone): destination, purpose, travel_started_at + point, reached_at + point, punch_photo_file_id, recording_id, completed_at, outcome, contact name/phone/designation, interest, lead_id, km_actual, est_distance_m, est_minutes, estimate_status (pending, ok, failed), flag_long_route.
- **bdm_breaks**: day_id, type_id, planned_minutes, started_at, ended_at, overrun_alerted.
- **location_chunks** (ID made on the phone, so uploads are idempotent): day_id, seq, started_at, ended_at, points, encoded polyline, time offsets (int2[]), accuracies (int2[]), distance_m, flags. `unique(day_id, seq)`.
- **bdm_live_status**: staff_id (pk, one row per BDM, overwritten), state, point, accuracy, battery, charging, gps_on, network, app_version, last_heartbeat_at (server time). Realtime to the admin map.
- **trips**: day_id, site_visit_id, started_at, ended_at, simplified polyline, distance_m, stops, gaps (no-network vs GPS-off periods).

### C4. Rules the database enforces (never only the screen)

| Rule | How |
|---|---|
| **Slot capacity** | `book_appointment` takes a lock on (doctor, slot), counts active bookings, compares with the doctor's override or the global max (default 3), then inserts, all in one transaction. 10 people booking the same 3-place slot at once → exactly 3 succeed |
| **Gap-free bill numbers** | `finalize_bill` calls `take_number()`, which locks that series row and increments it in the same transaction. If finalize fails, the number rolls back. Drafts never take numbers. FY is worked out in IST (resets 1 April) |
| **Stock** | The sale locks the batch rows, checks expiry (expired batches can't be sold) and quantity (negative stock blocked or warned, per setting), then writes movements. The ledger is append-only |
| **Bill maths** | Clients send only inputs (rate, qty, discount, GST rate). A trigger calculates every amount. Words and totals are always derived, never stored as typed text |
| **Finalized means locked** | A trigger blocks changes to finalized bills and summaries. Only the admin `amend_*` / `cancel_*` functions can change them, which require a reason and write a version + audit row. Cancelled bills keep their number and print CANCELLED |
| **No double counting** | A line carried into a final bill points at its original line (unique). A bill already included in one final bill can't go into another (see C6) |
| **Retries are safe** | Creates use client-generated IDs (`insert … on conflict do nothing`). Other commands use `idempotency_keys`. Drip sends are unique per enrollment + step |
| **Purge only what is backed up** | The purge function refuses any item without `backup_items.verified_at`, checked on the server |

### C5. Money and GST maths (one definition, tested in both TypeScript and SQL)

Per line, all in paise, rounding half away from zero:
1. `gross = rate × qty`
2. `discount = amount` or `gross × percent / 100`, never more than gross
3. `net = gross − discount`
4. If prices **exclude** GST: `taxable = net`, `tax = taxable × rate / 100`. If prices **include** GST (default): `taxable = net × 100 / (100 + rate)`, `tax = net − taxable`
5. `CGST = floor(tax / 2)`, `SGST = tax − CGST`. The odd paisa goes to SGST
6. `line total = taxable + tax`

Bill total = sum of line totals. Optional rounding to the nearest rupee appears as a separate "Round off" line (setting). Amount in words uses lakh/crore with paise, e.g. "Rupees One Lakh Fifty Thousand and Fifty Paise Only". GST is taken off the discounted value. This matches your pharmacy sample, where a 100% discount gives ₹0.00 tax.

### C6. Final bill: how double counting is avoided

An **episode** is a treatment or an admission. When you make its final bill:

1. **Interim bills stay valid.** Procedure receipts and pharmacy tax invoices already issued remain legal documents. Re-invoicing the same medicines would be double invoicing.
2. Their lines are copied into the final bill as **carried-in lines** (marked with the original bill number) and appear under their category, e.g. Pharmacy. They count towards the final bill's Bill Amount but **not** towards its own revenue or tax totals.
3. **New lines** (room = daily rate × days, surgeon and visit charges, IP services, session services not yet billed) belong to the final bill itself.
4. **Amount Received** = payments allocated to the final bill + payments on the carried-in bills + advances for the episode. **Balance** = Net − Received.
5. On finalize, each carried-in bill is stamped "included in final bill X". It can't go into another final bill, and it can't be cancelled unless an admin amends the final bill.
6. **Reports** count every line once, at the bill that owns it. So revenue is never doubled, and the patient's outstanding balance is the same whichever way you add it up.

### C7. Who can see what (RLS)

Helper functions (`private.my_role()`, `private.my_staff_id()`) read the live `staff` table. Policies call them as `(select …)` so Postgres runs them once per query, and the columns they filter on are indexed.

Codes: **full** = read + write · **read** · **own** = only rows they created or own · **asg** = only leads assigned to them and things linked to those leads · **rpc** = only limited fields through a function · **—** = no access.

| Area | Receptionist | Sales exec | Sales manager | BDM | Admin |
|---|---|---|---|---|---|
| Clinic profile, non-secret settings, libraries, doctors, schedules, holidays | read; can add library items on the fly | read | read | read (lists only) | full |
| Staff | directory | directory | directory | directory | full |
| Patients, registration requests | full (no merge) | rpc: name, upcoming appointments, agreed price for asg leads' patients | rpc: same, all leads | — | full + merge |
| Treatments, sessions, admissions, visits, discharge summaries, documents | full | — | — | — | full; edits finalized with reason |
| Appointments | full | asg leads + own bookings: read, book, confirm, cancel; slot **counts** only | all leads; counts + names of lead bookings | — | full |
| Follow-ups / tasks | reception queue + patients | own | all sales | own | full |
| Bills, payments | full; finalized are read-only | — | rpc: agreed-vs-billed totals | — | full; amend / cancel with reason |
| Pharmacy (items, batches, stock, purchases, suppliers) | full | — | — | — | full |
| Leads, activities, assignments | rpc search + link; create walk-in / referral leads | asg | full | create; read own-created (limited) | full |
| Call logs | read (patient-linked) | own | all | — | full |
| Recordings (play) | — (setting) | own | all sales; request sync | own visit recordings | full |
| WhatsApp messages, drips | patients | asg leads | all leads | — | full |
| BDM days, events, visits, chunks, live status, trips | — | — | — | own | full |
| Notifications, device tokens | own | own | own | own | own |
| Audit log, backups, usage, integration status, job runs | — | — | — | — | read (system writes) |
| Private files (signed link) | patient files | own recordings, asg lead files | sales recordings | own | all |

An automated test runs every role against every table (select / insert / update / delete) and compares the results with an expected-access file. It also **fails if a new table has no policy**, so a leak can't slip in later.

### C8. Size estimates (free-tier check)

Assumed team: 3 receptionists, 4 sales execs, 1 sales manager, 3 BDMs. 40 patient visits, 30 bills and 300 calls a day. I'll redo this once you answer question 13.

**Database (free limit 500 MB)**

| Data | Per month |
|---|---|
| Patients, appointments, visits, treatments | ~3 MB |
| Bills, items, payments, stock | ~4 MB |
| Leads, activities, call logs | ~7 MB |
| WhatsApp messages + compact webhook events | ~6 MB |
| Audit log (key tables only) | ~7 MB |
| Notifications (kept 60 days) | ~3 MB |
| **BDM location**: ~35 KB per BDM per day (10-second points packed into chunks + trips + events) | **~3 MB for 3 BDMs · ~10 MB for 10 BDMs** |
| Indexes (about half again) | ~17 MB |
| **Total** | **~50 MB/month → 500 MB in about 9–10 months.** With the purges (audit > 180 days, chunks > 30 days, raw webhooks > 14 days), about 30 MB/month → about 15 months |

**Tigris (free: 5 GB, 10,000 writes/month)**

| Data | Size / month | Writes / month |
|---|---|---|
| Prescriptions and scans (20/day, ~1.5 pages, ~350 KB each + thumbnail) | ~300 MB | ~1,200 |
| BDM selfies + photo punches (~200 KB) | ~110 MB | ~550 |
| **Visit recordings** (3 BDMs × 5 visits × ~20 min at 16 kbps ≈ 2.4 MB) | **~1.1 GB** | ~400 |
| Call recordings synced (~20/day, ~0.6 MB) | ~300 MB | ~500 |
| Registration scans, patient photos, PDFs | ~100 MB | ~1,000 |
| **Total** | **~1.9 GB** | **~3,700** |

Writes are comfortably inside the free tier. **Storage is not:** 5 GB fills in about 2.5 months, mostly from visit recordings. So either the admin backs up and purges visit recordings every month (the brief's workflow, which I'll build), or you accept Tigris overage, which is very cheap (about $0.02 per GB per month, verify; 20 GB extra ≈ $0.40/month). My advice: build the purge tools, but don't delete useful recordings just to stay at ₹0.

---

## D. API

### D1. Conventions

- **Kinds:** RPC = Postgres function called from supabase-js (web) or supabase-kt (Android). Edge = Supabase Edge Function (Deno). Route = Next.js route on Vercel. Cron = pg_cron job.
- **Types:** `Money` = integer paise. `Cursor` = opaque string. `Page<T> = { items: T[], next_cursor: string | null }`. `TablePage<T> = { rows: T[], total: number }`. TypeScript types are generated from the database into `packages/shared`. Kotlin mirrors them with `@Serializable` classes, checked by shared JSON contract fixtures.
- **Paging:** **keyset** (cursor) for infinite lists, pickers ("load 10 more") and Android sync. **Offset** with page numbers for manager/admin tables (max 100 rows a page).
- **Errors:** stable codes (`slot_full`, `stale_version`, `not_allowed`, `bill_locked`, `stock_insufficient`, `expired_batch`, `outside_window`…), each shown as a friendly translated message.
- **Safety:** every create takes `p_client_id uuid` (idempotent). Drafts take `p_version` (optimistic locking: "someone else changed this, reload").
- **Roles:** R receptionist, SE sales executive, SM sales manager, B BDM, A admin, PUB public with token, SYS cron/system.

### D2. RPC functions

**Auth, settings**

| Function | Input → Output | Paging | Roles |
|---|---|---|---|
| `me()` | → staff, role, permissions, public settings | – | all |
| `update_settings(section, value, version)` | → new version (validated, audited) | – | A |
| `integration_overview()` | → state, masked fields, webhook URLs, verify tokens per integration | – | A |
| `set_number_series(key, fy, prefix, format, next_value)` | → series (rejects going below last used) | – | A |
| `register_device(token, platform, app_version)` | → ok | – | all (Android) |
| `report_client_error(app, version, message, stack, context)` | → ok (rate-limited) | – | all |

**Libraries and search**

| Function | Input → Output | Paging | Roles |
|---|---|---|---|
| `library_search(kind, q, cursor, limit=10)` | → Page of {id, label, subtitle, defaults}; empty q = most used first | keyset | per kind |
| `library_create(kind, payload, client_id)` | → item flagged `created_on_the_fly` | – | R, A; SE/SM for lead sources, lost reasons, referral names |
| `library_review_list(kind?, cursor)` · `library_mark_reviewed(ids)` · `library_merge(kind, from, into)` | review and merge on-the-fly items | keyset | A |
| `global_search(q, limit=10)` | → [{type: patient or lead, id, title, subtitle, uhid, stage}] filtered by role | – | R, SE, SM, A |

**Doctors and slots**

| Function | Input → Output | Paging | Roles |
|---|---|---|---|
| `get_free_slots(doctor_id, date)` | → [{start, end, capacity, booked, left, blocked_reason}] | – | R, SE, SM, A |
| `slot_board(date, doctor_ids?)` | → doctors, slots, chips {appointment, name, status} | – | R, SM, A |
| `leave_conflicts(doctor_id, from, to)` | → affected appointments | – | R, A |

**Patients and registration**

| Function | Input → Output | Paging | Roles |
|---|---|---|---|
| `find_patient_matches(phone, name, dob?)` | → [{patient, uhid, differing fields old → new}] | – | R, A |
| `register_patient(payload, decision new / update / family, target_id?, fields_to_update?, request_id?, client_id)` | → {patient_id, uhid}; never overwrites without a decision | – | R, A |
| `discard_registration(request_id, reason)` | → ok | – | R, A |
| `create_public_link(kind, patient_id?)` | → {url, expires_at} | – | R, A |
| `patient_header(patient_id)` | → patient, allergies, balance, active treatments, tags | – | R, A |
| `patient_timeline(patient_id, kinds?, cursor, limit=20)` | → Page of {at, kind, title, ref} | keyset | R, A |
| `patient_tab(patient_id, tab, cursor, limit=20)` | → Page of rows (appointments, treatments, bills, pharmacy, documents, calls, whatsapp) | keyset | R, A |
| `merge_patients(from_id, into_id, reason)` | → rows moved per table | – | A |
| `lead_patient_summary(lead_id)` | → name, uhid, upcoming appointments, last visit, active treatment, agreed price | – | SE (asg), SM, A |

**Appointments, walk-ins, Today**

| Function | Input → Output | Paging | Roles |
|---|---|---|---|
| `book_appointment({patient_id or lead_id, doctor_id, slot_start, type, mode, treatment_id?, session_id?, source_id?, notes?, confirm?}, client_id)` | → appointment, or `slot_full` / `doctor_on_leave` / `holiday` / `outside_schedule` | – | R, SE (asg), SM, A |
| `book_walk_in({name, phone, patient_id?, doctor_id?}, client_id)` | → {patient_id, appointment_id or queue_no} | – | R, A |
| `set_appointment_status(id, status, reason?)` | → appointment (allowed transitions only) | – | R, A; SE/SM confirm or cancel their own |
| `reschedule_appointment(id, new_slot_start, doctor_id?, reason)` | → new appointment; old marked rescheduled | – | R, SE (asg), SM, A |
| `appointments_table(filters, sort, offset, limit)` | → TablePage | offset | R, SM, A |
| `today_board(date?)` | → slots, walk-ins, queue, waiting for confirmation, counters, follow-ups due, sessions due this week, pharmacy alerts | – | R, A |
| `needs_confirmation(cursor)` | → Page of appointments with lead | keyset | R, SE (asg), SM, A |

**Treatments, sessions, follow-ups**

| Function | Input → Output | Paging | Roles |
|---|---|---|---|
| `start_treatment({patient_id, template_id?, name, doctor_id, start_date, sessions, gap_days, pricing, price, lead_id?}, client_id)` | → treatment + planned sessions; price pre-filled from lead's Amount finalised | – | R, A |
| `update_treatment(id, patch, reason?)` | → treatment; gap change re-plans only future planned sessions; price change needs reason | – | R, A |
| `add_session` · `remove_session(id, reason)` · `set_session_status(id, status, notes?)` | → session + "book next?" suggestion | – | R, A |
| `sessions_due(from, to, cursor)` | → Page | keyset | R, A |
| `followups_list(scope today / overdue / upcoming, assignee?, cursor)` | → Page | keyset | R, SE (own), SM, B (own), A |
| `create_followup(…)` · `complete_followup(id, outcome)` | → follow-up | – | R, SE, SM, A |

**IP stay and discharge summary**

| Function | Input → Output | Paging | Roles |
|---|---|---|---|
| `admit_patient(treatment_id, {admitted_at, room_type_id, room_label, attender, surgeons, procedures, anaesthesia, surgery_at})` | → admission with IP number | – | R, A |
| `discharge_patient(admission_id, discharged_at)` | → admission | – | R, A |
| `discharge_autofill(admission_id)` | → patient, admission, surgeons, complaints, template, pharmacy medicines (the screen fills placeholders) | – | R, A |
| `save_discharge_summary(id?, admission_id, content, version)` | → {id, version} (autosave) | – | R, A |
| `finalize_discharge_summary(id, version)` | → summary; checks dates, surgery inside stay, no `{{…}}` left, ≥ 1 surgeon; creates follow-up | – | R, A |
| `amend_discharge_summary(id, content, reason)` | → new version | – | A |
| `save_discharge_template(summary_id, name, mode new / update)` | → template | – | R, A |
| `meds_from_pharmacy_bills(admission_id)` · `pharmacy_bill_from_meds(summary_id)` | → medication rows · draft pharmacy bill | – | R, A |

**Billing**

| Function | Input → Output | Paging | Roles |
|---|---|---|---|
| `create_bill(type, patient_id, {treatment_id?, admission_id?, visit_id?}, client_id)` | → draft bill | – | R, A |
| `save_bill(bill_id, header, items, version)` | → bill with server-calculated lines and totals | – | R, A |
| `final_bill_autofill(bill_id)` | → proposed carried-in lines, room, sessions, doctor charges, IP services, amount received | – | R, A |
| `finalize_bill(bill_id, version, payments?)` | → bill with number; stock out for pharmacy; below-agreed reason check | – | R, A |
| `add_payment({patient_id, kind, mode_id, amount, reference?, treatment_id?, admission_id?, allocations[{bill_id, amount}]}, client_id)` | → payment | – | R, A |
| `cancel_payment(id, reason)` · `amend_bill(id, items, reason)` · `cancel_bill(id, reason)` | → new version / CANCELLED | – | A |
| `bill_print_data(bill_id)` | → frozen header, patient strip, lines, totals, payments, T&C, "Original" or "Duplicate copy"; counts prints | – | R, A |
| `bills_table(filters, sort, offset, limit)` | → TablePage | offset | R, A |
| `patient_balance(patient_id)` | → billed, received, balance, unallocated advance | – | R, A |

**Pharmacy**

| Function | Input → Output | Paging | Roles |
|---|---|---|---|
| `pharmacy_item_search(q, cursor, limit=10)` | → Page of item + stock + suggested FEFO batch + defaults | keyset | R, A |
| `batches_for_sale(item_id)` | → batches in FEFO order with qty, expiry, expired flag | – | R, A |
| `post_purchase(purchase_id)` | → batches + stock movements | – | R, A |
| `adjust_stock(batch_id, kind, qty, reason, client_id)` | → movement | – | R, A |
| `stock_ledger(item_id, cursor)` · `pharmacy_alerts(type, cursor)` | → Page | keyset | R, A |

**Documents**

| Function | Input → Output | Paging | Roles |
|---|---|---|---|
| `create_document({patient_id, kind_id, file_id, thumbnail_file_id?, doc_date, links}, client_id)` | → document | – | R, A |
| `find_duplicate_file(sha256, patient_id)` | → existing document if the same file was already uploaded | – | R, A |

**Leads and sales**

| Function | Input → Output | Paging | Roles |
|---|---|---|---|
| `leads_table(filters, sort, offset, limit)` | → TablePage | offset | SM, A |
| `create_lead(payload, client_id)` | → lead + possible duplicates (same phone → link/merge; patient match → link) | – | R, SE, SM, B, A |
| `update_lead(id, patch, version)` | → lead (inline edit) | – | SE (asg), SM, A |
| `set_lead_stage(id, stage, lost_reason_id?, note?, recording_id?)` | → lead | – | SE (asg), SM, A |
| `set_amount_finalised(id, amount)` | → lead; blocked for sales once a treatment has started | – | SE (asg), SM, R, A |
| `assign_leads(ids, to_staff_id, reason?)` | → count | – | SM, A |
| `lead_detail(id)` · `lead_activities(id, cursor)` · `add_lead_note(id, body, client_id)` | → detail / Page / note | keyset | SE (asg), SM, A |
| `log_call({client_id, lead_id?, phone, direction, started_at, duration, outcome, notes, next_followup_at?, stage?})` | → call log | – | SE, SM |
| `import_call_log(rows)` | → inserted / skipped (CRM numbers only; idempotent) | – | SE, SM |
| `link_lead_to_patient(lead_id, patient_id)` | → ok | – | R, SM, A |
| `sync_pull(since per entity)` | → per entity: changed rows, removals, next marker, has_more (leads, follow-ups, appointments, call logs, CRM numbers, lists) | keyset | SE, SM, B |
| `recording_register(rows)` | → ok (On-phone recordings become visible to managers) | – | SE, SM, B |
| `request_recording_sync(recording_id)` | → ok (sends push) | – | SM, A |
| `dashboard_sales_exec(from, to)` | → own tiles + calls per day + own funnel (see B6) | – | SE, SM |
| `dashboard_sales_manager(from, to, staff_ids?, compare?)` | → team tiles, funnel, sources, conversion, leaderboard, call heatmap, lost reasons, agreed vs billed | – | SM, A |
| `agreed_vs_billed(from, to, staff_id?, cursor)` | → Page per patient / exec | keyset | SM (totals), A |

**WhatsApp (database side)**

| Function | Input → Output | Paging | Roles |
|---|---|---|---|
| `wa_thread(patient_id or lead_id, cursor)` | → Page of messages with ticks | keyset | R, SE (asg), SM, A |
| `wa_prepare_manual(target, template_id or text)` | → wa.me link + text; logged as "sent manually" | – | R, SE, SM, A |
| `drip_enroll(campaign_id, target, anchor_at?)` · `drip_set_status(enrollment_id, status)` | → enrollment | – | R, SM, A |

**BDM**

| Function | Input → Output | Paging | Roles |
|---|---|---|---|
| `bdm_start_day({client_id, point, accuracy, selfie_file_id, is_mock})` | → day + geofence decision | – | B |
| `bdm_event({client_id, kind, device_at, point, accuracy, data})` | → ok | – | B |
| `bdm_travel_start({client_id, destination, dest point, purpose, point})` | → site visit | – | B |
| `bdm_reached({visit_id, point, accuracy, photo_file_id, recording_id?})` | → visit; queues route estimate | – | B |
| `bdm_visit_complete({visit_id, outcome, contact, interest, create_lead?})` | → visit + lead_id | – | B |
| `bdm_break(start or end, type_id, client_id)` · `bdm_end_day(day_id)` | → break / day summary | – | B |
| `bdm_heartbeat({point, accuracy, battery, charging, gps_on, network, state, app_version})` | → pending commands (locate now, flush, new settings) | – | B |
| `bdm_upload_chunks(chunks)` | → accepted IDs (idempotent) | – | B |
| `bdm_live()` | → live status of all BDMs (then Realtime) | – | A |
| `bdm_day_timeline(staff_id, date)` | → events, visits, breaks, trips, gaps, photos, recordings, flags, summary | – | A; B own |
| `bdm_locate_now(staff_id)` | → ok (push) | – | A |
| `bdm_report(from, to, staff_ids?)` | → rows for Excel | – | A |

**Admin**

| Function | Input → Output | Paging | Roles |
|---|---|---|---|
| `dashboard_admin(from, to, compare?)` | → one JSON with every admin tile and chart series, including storage meter and backup status (see B6) | – | A |
| `dashboard_reception(date?)` | → today tiles + arrivals by hour + doctor load + today's collections by mode | – | R, A |
| `dashboard_bdm(date?)` | → own day tiles, time split, month summary | – | B (own), A |
| `set_sales_target(staff_id, month, metric, target)` | → target | – | A |
| `set_my_theme(theme)` | → ok (dark, light, system) | – | all |
| `storage_meter()` | → DB MB / 500, Tigris GB / 5, writes this month / 10,000, thresholds | – | A |
| `audit_list(filters, cursor)` | → Page | keyset | A |
| `backup_plan(scope)` · `backup_items_page(batch_id, cursor, limit=100)` | → batch + totals · Page of {item, file, path, size, sha256} | keyset | A |
| `backup_mark_verified(batch_id, items[{id, sha256}])` | → verified / mismatched counts | – | A |
| `export_table_page(table, cursor, limit ≤ 1000)` | → Page of rows | keyset | A |
| `purge_preview(types, older_than)` | → groups with MB to free (verified only) | – | A |
| `import_rows(kind, rows, dry_run)` | → ok count + errors [{row, field, message}], 500 rows per batch | – | A |

### D3. Edge Functions

| Function | What it does | Who can call |
|---|---|---|
| `files-sign` | `put`: permission check → file row → signed upload link (size and type locked in). `get`: signed view links (5 min). `confirm`: checks size and real file type (reads first bytes) → uploaded | staff (permission per file purpose) |
| `public-form` | GET with token → form fields; POST (Turnstile check) → pending registration | PUB (token) |
| `phone-scan` | token → signed upload links for pages; tells the desktop "page added" over Realtime | PUB (one-time token) |
| `admin-users` | create, reset password, deactivate (block + sign out everywhere), reactivate, change role | A |
| `wa-webhook` | GET: Meta verification. POST: checks signature, stores events once, keeps the highest status, handles replies (keywords, STOP, 24-hour window) | Meta (signed) |
| `wa-send` | template or free text; checks opt-out, 24-hour window, Auto/Manual mode, quiet hours | R, SE, SM, A, SYS |
| `wa-templates-sync` | pulls approved templates from Meta | A |
| `drip-runner` | every 10 min: takes a lock → due steps → send → record (never double-sends) | SYS |
| `meta-leads-webhook` | GET verify; POST leadgen → fetch lead from Meta → normalise phone → dedupe → create → assign → notify | Meta (signed) |
| `route-estimate` | queued visits → RoutingProvider (OpenRouteService) → km + minutes; on failure, retries later | SYS |
| `notify` | sends push (FCM) and email (Brevo) by notification rules | SYS |
| `daily-summary` | evening email to admin | SYS |
| `integration-test` | ✅/❌ plus the error in plain words, per integration | A |
| `purge` | deletes Tigris objects and bulky rows; **refuses anything not verified** | A |

### D4. Next.js routes

| Route | What it does | Who |
|---|---|---|
| `/api/keepalive` | Vercel Cron, daily: one tiny query so Free Supabase never pauses | cron secret |
| `/api/pdf/[kind]/[id]` | headless Chrome renders the print page → PDF → Tigris → document row | R, A |
| `/print/[kind]/[id]` | A4 print pages: three bill types, discharge summary, registration form (blank and filled) | R, A |
| `/r/[token]` · `/scan/[token]` | public self-registration, phone scanning | PUB |

### D5. Scheduled jobs (IST; pg_cron runs in UTC, IST = UTC + 5:30)

| When | Job |
|---|---|
| every 5 min | `bdm_watchdog()`: no heartbeat for X min, break overrun, late start → alerts |
| every 10 min | `drip-runner` |
| every 15 min | appointment reminders due → `wa-send`; not confirmed X hours before → "Call to confirm" task |
| hourly | pharmacy alerts; retry pending route estimates; expire public links; recompute dirty KPI days |
| 00:15 | `kpi_compute_day(yesterday)` → `kpi_daily` rollup |
| BDM auto-end time (setting) | auto-end open BDM days + flag |
| 23:30 | merge chunks → trips for ended days; stock cache check |
| 20:00 | admin daily summary email |
| 02:00 | housekeeping: clear raw webhook payloads > 14 days, idempotency keys > 7 days, client errors > 30 days; storage meter snapshot and threshold alerts |
| Monday 10:00 | backup reminder |
| daily (Vercel) | keepalive |

---

## E. How we'll build and test

### E1. Testing approach — DRAFT (replace with your section 17)

| Layer | Tool | Proves |
|---|---|---|
| Database | pgTAP (`supabase test db`) | RLS for every role × table; capacity; numbering; stock; bill maths; finalize locks; IST day and FY boundaries |
| Shared maths | Vitest + **golden vectors** (one JSON file of worked examples, run against both the TypeScript and the SQL maths) | Screen preview = database result, always |
| Edge Functions | Deno tests against `tests-mocks` (fake Meta, WhatsApp, ORS, Brevo, FCM) + MinIO | Signatures, idempotency, permission checks, failure handling |
| Web | Playwright end-to-end against the local stack | Each phase's real user flows; print-page screenshots against approved baselines |
| Concurrency | Node script firing parallel calls | 10 bookings into a 3-place slot → 3 succeed; 50 parallel finalizes → numbers with no gaps or duplicates |
| Performance | `scripts/perf-seed` (≈ 3 years of fake data: 50k patients, 300k bills, 1M call logs) + query-plan checks | Key lists and searches stay fast at real size |
| Android | JUnit + Turbine + Robolectric, Compose UI tests, Room migration tests, emulator tests | Offline queue, sync, idempotency, screens |
| Field tests (manual, scripted) | Checklists per phone brand | Caller pop-up, recording matching, background tracking. These can't be fully automated |

Every change runs the automated tests in GitHub Actions. A phase is done only when its tests pass **and** you've tried it on staging.

### E2. Performance and API rules — DRAFT (replace with your section 16)

1. Every list is paginated on the server (default 20, max 100). Nothing ever fetches "all rows".
2. Search, filter and sort run in Postgres, each with a matching index. Query plans for key screens are checked in tests.
3. One screen, one or two calls. RPCs return everything a screen needs as JSON, so there are no request waterfalls.
4. Select only the columns needed.
5. Rule-bearing writes run in one transaction with the right locks (capacity, numbering, stock).
6. Client-generated IDs for creates; idempotency keys for commands.
7. Search is debounced (250–300 ms) and stale requests are cancelled.
8. Long lists and tables are virtualised.
9. Heavy libraries load only when needed: OpenCV (scanning, about 8 MB), ExcelJS, pdf-lib, maps.
10. Files never pass through our servers.
11. Realtime only for the bell, Today board, phone-scan sessions and the BDM live map.
12. Targets on the perf seed: list APIs p95 < 300 ms, search < 150 ms, first page JS < 250 KB gzipped.
13. Android: Room feeds the lists, sync pulls only changes, uploads are batched with backoff.

### E3. Phases — DRAFT (I'll merge with your section 18)

Each phase ends with: tests green → I tell you step by step how to try it on staging → I stop and wait.

| # | Phase | What you get | Done when (tests) |
|---|---|---|---|
| **0** | **Foundations** | git + `.gitignore` (docs/ first), monorepo, local Supabase, staging project, Tigris + MinIO, Brevo email for logins. Staff, roles, login-token hook, RLS helpers, audit trigger, settings, number series, files + `files-sign`, notifications. Shared maths (money, GST split, number-to-words, IST dates). **Design tokens + ChatGPT-style dark theme (Dark / Light / System) + sidebar shell + Ctrl+K search + `<EChart>` wrapper with "View as table".** Web shell: login, forgot password, top search bar, menus by role, bell, translations, big-font theme, error reporting, keepalive. `SETUP.md`, `TESTING.md`, `CLAUDE.md`, CI | Palette validator passes on tokens (both modes); theme screenshots in dark and light; words golden vectors (₹1,50,000 → "One Lakh Fifty Thousand", paise, zero, crores); GST odd-paisa split; RLS matrix for staff/settings; deactivated user blocked on the next request; `files-sign` refuses the wrong role and accepts a real upload to MinIO; Playwright: each role lands on its own home |
| **1** | **Admin setup and libraries** | Clinic profile + logo, users and roles, doctors + schedules + leaves + holidays, appointment and billing settings, number series, libraries (services, treatments, room types, pharmacy items, lists) with the reusable LibraryCombobox, "New items to review", audit viewer | Combobox: first 10 most used, server search, "load 10 more"; on-the-fly items flagged; overlapping schedules rejected; receptionist can't change settings (direct API call denied); Playwright: admin sets up a doctor; receptionist adds a service on the fly |
| **2** | **Patients** | Registration typed by reception, duplicate check with the 3 choices, family link, printable blank and filled form, QR self-registration with pending review, simple scan/upload of the signed paper form, patient file header + timeline + tabs, global search, admin merge, **DocPulse patient import** | Duplicate matrix (never auto-overwrites); merge moves rows from **every** linked table; UHID gap-free; public form rejects expired token or failed Turnstile; search < 150 ms on 50k patients; Playwright: all three registration paths |
| **3** | **Appointments and Today board** | Slot board, booking with database-enforced capacity, table view + Excel export, walk-ins + queue, status flow, reschedule, doctor-leave conflicts, Today board with live updates, follow-up lists, manual WhatsApp (wa.me) button, **reception dashboard** | Parallel booking test (exactly 3 of 10); per-doctor capacity; holiday and leave blocked; 23:59 vs 00:01 IST correct; invalid status changes rejected; Playwright: book from board, walk-in into a full slot goes to the queue, second browser updates live |
| **4** | **Treatments, sessions, follow-ups** | Treatment library use, start treatment with editable defaults, agreed price from lead, session planning, "book next session?", add/remove sessions, parallel treatments, statuses | Gap change re-plans only future planned sessions; price change needs a reason and is audited; parallel treatments independent; Playwright: 6-session package from start to done |
| **5** | **Procedure bills, payments, printing** | Bill cum Receipt, payments with advances / part payments / refunds, numbering on finalize, A4 print (multi-page, repeating headers, "Duplicate copy"), admin amend/cancel with versions, outstanding balance, bills table, PDF route, **KPI rollup infrastructure (`kpi_daily`, dirty days) + money KPIs** | KPI golden fixture for money tiles; rollup = live for sampled days; same totals in TypeScript and SQL for every golden vector; numbering gap-free under 50 parallel finalizes; FY rollover at 31/03 23:59:59 vs 01/04 00:00 IST; finalized bill can't be edited even by a direct API call; cancelled bill keeps its number; print screenshot matches the approved baseline; words always match the amount |
| **6** | **Pharmacy and inventory** | Item master, suppliers, purchases → batches, stock ledger, adjustments, FEFO, Tax / Retail Invoice (GST inclusive or exclusive), alerts with badges, **opening stock import**, pharmacy KPIs | Stock = sum of movements after random operations; expired batch can't be sold; FEFO choice correct; two parallel sales of the last unit → one blocked; GST golden vectors incl. odd paise; changing an item's GST leaves old bills unchanged; alert fires once and clears after restock |
| **7** | **IP stay, final bill, discharge summary** | Admission, final bill auto-fill with no double counting, agreed price shown + reason below it, discharge summary draft → edit → preview → finalize → print/PDF, templates with placeholders, medicines import, follow-up creation | An interim bill is included once and can't go into a second final bill; room days rule; out-of-stay date warning; totals and words derived; female → she/her, other → they/their; leftover `{{…}}` blocks finalize; date checks; print baseline |
| **8** | **Prescription scanning (full)** | Camera, PDF/HEIC upload, phone scan via QR with live pages, scanner-folder watch, edge detection + straightening, document mode, compression, multi-page PDF, thumbnails, offline-safe upload queue, duplicate warning | Output ≤ size cap on sample images; real file type checked by content; Playwright: go offline → add pages → reload → go online → uploaded; phone-scan link single-use and expires; duplicate warning shown |
| **★** | **Milestone A: replace DocPulse** | DocPulse import done, opening stock entered, a few days running both systems side by side, staff walkthrough, Supabase Pro switched on, first backup | Your sign-off |
| **9** | **Leads (web) and Meta Lead Ads** | Leads model, manager table (inline edit, filters, bulk assign, export), lead detail, assignment rules (round-robin), lead ↔ patient link, agreed price flow, Meta webhook + field mapping, CSV import, **sales manager dashboard** | Bad webhook signature rejected; repeated leadgen id ignored; phone dedupe links; round-robin skips inactive execs; sales exec sees only assigned leads; Amount finalised locked for sales after treatment starts |
| **10** | **WhatsApp Cloud API and drips** | Connection settings (Vault), test buttons, template sync, sending, webhook, Confirm/Reschedule buttons + keywords, STOP opt-out, "call to confirm" tasks, drip campaigns, manual fallback, cost estimate, WhatsApp tab | Out-of-order statuses keep the highest; duplicate webhook ignored; keyword matrix (YES, y, "Ok!", ಹೌದು, हाँ) confirms the nearest upcoming pending appointment; reply after the appointment time ignored; two drip-runners at once → one send; quiet hours respected; free text outside 24 h blocked |
| **11** | **Android: foundation and sales** | Login + PIN, menus by role, offline cache + sync + outbox, leads list/detail with swipe Call/WhatsApp, call flow + notes sheet, follow-ups, booking with free slots, needs-confirmation, reject/lost with voice note, push notifications, LibraryPicker, **"My day" dashboard (Vico)** | Note added offline → sent later → exactly one row on the server; reassigned lead disappears from the old exec's phone; slot-full error shown; Room migration tests; UI tests for the notes sheet |
| **12** | **Android: caller pop-up and call recordings** | Call-log import (CRM numbers only), number cache, floating caller bubble + after-call sheet, restart on boot, battery/autostart guides per brand, recording-folder wizard, file ↔ call matching, "On phone" list, Sync (trim → compress → upload), admin upload modes, "Request sync" | Matcher tests per brand filename pattern; compressed output mono 16 kHz under target size; 14-min call → first 10 min uploaded with a note; original file unchanged (checksum before/after); retry never duplicates; field checklist on each phone model you'll use |
| **13** | **BDM app and admin BDM views** | Start day (selfie, geofence), office / travel / reached / photo punch / visit audio / visit complete / create lead, breaks, end day, background tracking with filters, chunk uploads (Auto interval), heartbeat → live map, GPS-off and no-heartbeat alerts, route estimates, trips, admin live map, day timeline like your sheet, route playback, Excel export, **BDM "My day" dashboard** | Filter tests (> 50 m accuracy dropped, > 150 km/h spikes dropped, standing-still jitter removed); distance on recorded test routes within ±5%; chunk upload idempotent; watchdog alerts once after 15 min without heartbeat; geofence; ORS down → "estimate pending" → filled later; scripted drive test |
| **14** | **Dashboards, notifications, backup and purge** | Admin dashboard completed (one call, all sections in B6), storage meter, agreed vs billed, optional sales targets, notification rules + daily email + push, backup centre (Chrome/Edge folder), verify, purge, full database export + weekly reminder, Excel import/export everywhere | Dashboard < 300 ms on perf seed; purge refuses unverified items (server test); interrupted backup resumes without duplicates; SHA-256 verify catches a corrupted file; Windows/Mac-safe file names |
| **15** | **Hardening and go-live of the CRM** | Performance pass, full security review (RLS fuzzing on every table), accessibility pass, Supabase advisor checks, restore drill (backup → staging), final setup docs, APK release process | All suites green; restore drill succeeds; your sign-off |

**Start now, in parallel (your side):** Meta Business Verification, the WhatsApp number decision, the domain/DNS, buying sales phones. These take days to weeks and shouldn't hold up Phases 9–13.

---

## F. Risks

### F1. Monthly running cost

| Item | During build | Production |
|---|---|---|
| Supabase | Free | Free possible; **Pro $25 (≈ ₹2,200) recommended** for backups and no pausing |
| Web hosting | Vercel Hobby (personal dev only) | **Vercel Pro $20 (≈ ₹1,750)** per seat, or Cloudflare Workers Paid $5 |
| Tigris | Free | Free up to 5 GB; then about $0.02/GB-month (verify) |
| WhatsApp | – | Per message. Example: 1,500 utility + 500 marketing ≈ ₹170 + ₹430 + 18% GST ≈ **₹710/month** |
| Brevo, OpenRouteService, FCM, Turnstile, OpenFreeMap, GitHub | Free | Free |
| Domain | – | ≈ ₹800–1,500 per **year** |
| Android distribution | – | Direct APK: free. Developer verification (expected 2027): small one-time fee |

### F2. Free-tier limits

| Limit | Risk | What I'll do |
|---|---|---|
| Supabase 500 MB DB | Full in about 9–15 months (C8) | Compact storage (chunks, compact webhook events, field-only audit), purges, storage meter warnings at 70/85/95%. Pro gives 8 GB |
| Supabase: no backups on Free | A bad migration or accident = data loss | Weekly full export reminder; **recommend Pro at go-live** |
| Supabase pauses after 7 idle days | Jobs and webhooks stop | Vercel keepalive; daily clinic use also prevents it |
| Tigris 5 GB | Full in about 2.5 months from visit recordings | Monthly backup + purge, or accept cents of overage |
| Tigris 10,000 writes | ~3,700 expected | One write per file; thumbnails only for documents; never LIST |
| Brevo 300 emails/day | Fine for summaries + alerts | Alerts batched into digests |
| OpenRouteService 2,000 routes/day | Fine (one per visit) | Behind RoutingProvider; queue + retry |
| Edge Function CPU limits | Heavy work would time out | No heavy work in Edge: files go direct, PDFs on Vercel |

### F3. Android

| Risk | Detail | Mitigation |
|---|---|---|
| **Call recordings unreadable on Google Phone app phones** | Recordings stay inside the dialer | Company Samsung phones (question 10). Otherwise: voice note in our app for important calls |
| Caller pop-up vs Truecaller | Only one app can hold the call-screening role | Use phone-state + call-log permissions instead; the role is optional |
| Phone makers kill background apps (Xiaomi, Oppo, Vivo, Realme, OnePlus) | Tracking and pop-ups stop | Battery-optimisation exemption, per-brand autostart guides in the app, server watchdog alerts |
| Android 14–16 background rules | Foreground services need declared types (location, microphone); starting from the background is restricted; "Allow all the time" location needed for resilience | Declared service types, high-priority push for "Locate now", setup wizard checks every permission |
| Google Play policy | Call log, overlay and background location are restricted | Direct APK install (question 11) |
| Sideloading verification (expected India 2027, verify) | Directly installed apps may need a verified developer | Register when required |
| Battery drain from 10-second GPS | BDM phones die by evening | Motion detection + distance filter when still; tuned sampling; battery shown on the live map |
| Personal phones | Reading call logs on personal phones is a privacy concern | Only CRM-number calls kept; nothing else leaves the phone |

### F4. WhatsApp and Meta

| Risk | Mitigation |
|---|---|
| Business verification and display-name approval take days to weeks | Start now; manual wa.me fallback works from Phase 3 |
| New numbers start with a low daily messaging limit | Limit rises with verification and good quality; prefer utility templates; reminders spread across the day |
| Template rejections | Draft templates early; keep wording factual (utility) |
| Coexistence onboarding path and trade-offs need checking | I'll confirm the exact steps once you decide (question 12) |
| Token expiry / revoked permissions | Permanent System-User token; daily integration check; red status + admin alert |
| Meta Lead Ads access | Use the clinic's own Business Manager + System User. Full App Review is probably not needed for your own Page, but verify during setup. Step-by-step in `SETUP_META.md` |

### F5. Vercel

| Risk | Mitigation |
|---|---|
| Hobby plan is non-commercial | Pro for production (or Cloudflare $5) — question 3 |
| PDF rendering function is heavy (headless Chrome) | Pro limits are enough; PDFs only on demand; fallback is browser "Save as PDF" |
| Lock-in | Webhooks and jobs live in Supabase, so moving the web app later is small work |

### F6. Legal, privacy, tax (please get professional advice; I'm not giving legal advice)

| Topic | Note |
|---|---|
| DPDP Act 2023 + DPDP Rules (notified Nov 2025, phasing in to 2027) | The build includes consent capture, access control, audit trail, export and deletion workflows. Notices, breach process and contracts with providers (Supabase, Tigris, Meta, Brevo, Vercel) need a short legal review before go-live |
| Where data is stored | Supabase and Vercel in Mumbai. **Tigris may store files outside India** (verify the bucket region) if residency matters to you |
| Medical records | Clinical records (patients, bills, treatments, summaries) are never purged, only heavy media and bulky logs |
| GST on cosmetic procedures and room rent | See A2. Ask your CA before go-live |
| Recording calls and meetings | Disclosure reminders built in; follow your lawyer's advice on consent |

### F7. Day-to-day operations

| Risk | Mitigation |
|---|---|
| Clinic internet goes down → no billing | Keep a 4G hotspot as backup. Uploads queue offline, but billing needs the server |
| Scope is very large | Milestone A (replace DocPulse) goes live first; CRM and field apps follow |
| Staff adoption | Big-button UI, step-by-step wizards, training walkthrough at each milestone |
| Wrong data from the DocPulse import | Dry-run import with an error report; parallel run before switching off DocPulse |

---

## G. Status

- 23/10/2026: plan approved, including B5 (ChatGPT-style dark theme) and B6 (dashboards per role). Phase 0 started with the A2 defaults.
- Still needed: the full brief (sections 15–19) and your answers to A1. Each answer is needed only by the phase that uses it.
- After each phase: tests green → step-by-step "how to try it" on staging → I stop and wait for you.
- 23/10/2026: owner asked to build **all phases to production-ready without stopping** between phases (each still has to pass its tests). Vercel deploys itself from git pushes.
- 24/10/2026: **Logins are username + password only, for every role** (owner's rule). No email logins, email codes or reset links. Admins create logins and set passwords; staff change their own password from the user menu. Email on a staff record is only a contact detail. (Replaces A1 question 9's mixed email/username plan.)
- 24/10/2026, Phase 1 done: admin setup and libraries. Decisions made while building:
  - GST rates are stored as **basis points** (`gst_rate_bp`, 5% = 500), the same unit as `packages/shared/src/gst.ts`, instead of `numeric(5,2)`.
  - Library merge repoints every foreign key found in the catalog; a foreign key commented `merge:keep` (e.g. finalized bill lines) keeps its old reference.
  - Function privileges: PostgreSQL's global "EXECUTE to PUBLIC" default is revoked for the migration role, and every migration ends with `select private.lock_down_public_functions();`.
- 25/10/2026, Phase 2 done: patients. Decisions made while building:
  - An age without a birth date is stored as 1 July of the birth year, flagged `dob_estimated`.
  - QR self-registration links last 30 minutes and are stored as a SHA-256 hash only. At most 5 forms per network in 10 minutes (salted IP hash, never the IP).
  - Cloudflare Turnstile uses Cloudflare's public **test keys** until real keys are added (`.env` section 1 and 3, and Vercel's environment variables). The form refuses to work if no secret is set at all.
  - DocPulse import is CSV (Excel → Save As → CSV) in batches of 500 with a dry run first. Excel files directly come with Phase 14's import/export.
  - Merge repoints every foreign key to `patients` found in the catalog, so later phases' tables are covered automatically.
- 26/10/2026, Phase 3 done: appointments, walk-ins, Today board, follow-ups, reception dashboard. Decisions made while building:
  - Capacity: the slot's lock is a transaction-level advisory lock on (doctor, slot). Tested with 10 parallel bookings into a 3-place slot → exactly 3.
  - Slot capacity order: the doctor's "patients per slot" → the schedule block's → Settings → Appointments (default 3). Slot length the same way (default 15 minutes). Only whole slots fit before closing time.
  - A walk-in goes into the doctor's slot running right now if it has room; otherwise (or without a doctor) it joins the day's numbered queue.
  - "Call to confirm" tasks are made every 15 minutes (pg_cron) for bookings not confirmed N hours before (Settings, default 4), once per booking.
  - The appointments table refuses ranges over a year, so its cost can't grow with the range picked.
  - WhatsApp reminders are manual (wa.me links with a ready message) until the Cloud API (Phase 10).
- 27/10/2026, Phase 4 done: treatments and sessions. Decisions made while building:
  - Session n is planned at start + gap_days[n]; past the last gap, the last interval repeats ({0,30} → 0, 30, 60, 90).
  - A session follows its appointment automatically (trigger): booked when linked, done when the visit is done, back to planned on cancel, missed on no-show; a reschedule keeps the link.
  - Removing a session keeps it as "removed" (skipped) with the reason, never deletes it.
  - When the last open session is done the treatment becomes Completed and, if the treatment has "follow-up after N days", a follow-up is created once.
- 28/10/2026, Phase 5 done: bills, payments, printing, KPI rollup. Decisions made while building:
  - Line maths in integer paise, GST in basis points, rounding half away from zero; the bill total is rounded to the nearest rupee with a visible "Round off" line. The same rules run in `packages/shared/src/gst.ts` (live preview) and in SQL (the saved figures), both checked against `test-vectors/gst.json`.
  - A finalized bill is locked by a trigger. Only the admin "amend" and "cancel" functions open it, for their own transaction (`app.bill_amend`); every amendment keeps the previous version in `bill_versions` with the reason.
  - The first print is "Original"; every later print says "Duplicate". The Print button is a plain link so a page prefetch can't use up the original.
  - Discounts over the limit in Settings need an admin (checked in the database, per line and per bill).
  - Payments can be split across modes, kept as an advance, applied from the advance later, or refunded from it. Cancelling a bill returns its payments to the advance.
  - Dashboards read a daily rollup (`kpi_daily`): yesterday is rolled up at 00:15 IST, and any day whose bills, payments or appointments change is marked and re-rolled within the hour. Today is computed live.
  - PDF files: the print pages are A4-ready; until Phase 10 (sending bills on WhatsApp needs a file) staff use the browser's "Save as PDF".
  - Fixed while testing: rupee fields now replace the amount when you type into them (they used to append), and the finalize dialog no longer closes itself after the draft is saved.
- 29/10/2026, Phase 6 done: pharmacy and inventory. Decisions made while building:
  - Stock = sum of movements. `stock_movements` is append-only (a trigger refuses edits and deletes, even by the database owner); `item_batches.qty_on_hand` is a cache kept by a trigger and re-checked every night at 23:30 IST (any drift is fixed and logged).
  - Expiry is the month on the strip, stored as that month's last day; a batch can be sold through that day. Expired batches are listed but can't be sold or bought in.
  - FEFO: the bill picks the earliest-expiring batch that has stock; staff can choose another. Selling locks the batch rows in a fixed order, so two desks selling the last strip can't both succeed (tested: 1 of 2) and can't deadlock.
  - A bill line keeps the batch number, expiry, maker, HSN, GST rate and unit cost from the moment it was billed. Changing the medicine later doesn't change old bills or past margins.
  - Finalize takes stock out; an admin amend books only the difference; cancelling a bill puts everything back. A patient return outside a bill is a stock adjustment.
  - Purchases: quantities are in selling units (e.g. tablets); free units add stock at no cost; line total = qty × price + GST, rounded per line like bills. Posting is final (fix mistakes with an adjustment). The same supplier invoice number can't be entered twice.
  - Adjustments (damaged, expired, returned to supplier, returned by patient, stock count) always need a reason and are idempotent. A stock count books the difference from the counted quantity.
  - Alerts: low stock (at or below the reorder level, counting unexpired stock), near expiry (the tightest of Settings → Pharmacy → 90/60/30 days) and expired. Each fires once and clears itself after restock or sale; re-checked hourly and after every stock change. The bell gets one notification per person per day, refreshed when new alerts fire; the menu shows the open count.
  - Opening stock import (Admin → Import opening stock): CSV, 500 rows a batch, a check run first; each batch's opening stock can be entered once.
  - Pharmacy KPIs (sales, taxable value, cost of goods → margin) join the daily rollup. A pharmacy invoice without GST prints as "Retail invoice", with GST as "Tax invoice".
  - Fixed while testing: pickers that answer after a round trip (adding an item on the fly) no longer overwrite what was typed meanwhile; live boards reload once when their realtime channel (re)joins, so a change made in that gap isn't missed.
- 30/10/2026, Phase 7 done: IP stay, final bill, discharge summary. Decisions made while building:
  - IP number: its own series per financial year, or (Settings → Billing → IP number) the UHID, with "/2", "/3" for repeat stays. One open stay per patient. A stay made by mistake can be cancelled only while nothing is billed or summarised; after discharge only an admin edits it, with a reason.
  - Room days = nights (IST midnights crossed), at least 1 — the sample 30/03 10:50 → 31/03 10:50 is 1 day.
  - Final bill: the desk ticks which finalized receipts / pharmacy bills to include (the stay's own are listed first). Their lines are copied as carried-in lines with the original amounts (even if the final bill's tax mode differs) and "from bill X". On finalize the interim bills are stamped "included in final bill X"; one can't go into a second final bill or be cancelled; cancelling the final bill releases them.
  - Money per episode: each bill keeps its own balance. The final bill shows received = its own payments + those of the bills it includes; a payment taken on it pays its own lines first, then the included bills (oldest first). Revenue, tax and the patient balance count each line once, at the bill that owns it.
  - Suggested stay charges: room daily rate × nights, the treatment template's IP-stay services, each surgeon's doctor-charge service. The desk ticks what to add.
  - Discharge summary: the text keeps {{placeholders}}; they are filled when previewing and at finalize, the same way in TypeScript and SQL (golden vectors `test-vectors/placeholders.json`, one left-to-right pass, unknown or empty ones stay so finalize refuses them). Pronouns follow the patient's gender: female → she/her, male → he/him/his, other or not said → they/them/their.
  - Finalize needs: discharged, at least one surgeon, surgery inside the stay, nothing left in {{…}}. The filled text, clinic header, patient/stay strip and signature block (doctor, qualification, designation, council registration) are frozen; a follow-up is added when the summary asks for one. Admins amend with a reason; the earlier version is kept.
  - Templates are saved from a summary with their placeholders (no patient details); Admin → Discharge templates edits or switches them off. A generic Septoplasty template is included.
  - Print: the letterhead repeats on every page; the first print is "Original", later ones "Duplicate".
  - KPIs: admissions, discharges and stay days join the daily rollup (average stay = stay days ÷ discharges).
  - Fixed while testing: the finalize dialog asks only for what is still due when included bills were already paid; every screen text is now checked to parse as ICU (a literal `{` must be quoted).
- 31/10/2026, Phase 8 done: prescription scanning (built in a parallel git worktree, then merged). Decisions made while building:
  - Page finding and straightening are our own small code (edge map → largest four-sided outline → perspective warp), run in a Web Worker; no OpenCV download. "Document mode" whitens the background and sharpens text. Staff can drag the corners when the guess is wrong.
  - Size limits live in `web/lib/scan/config.ts` and match the server's upload rules: a saved document ≤ 3 MB, ≈ 450 KB a page, thumbnails ≤ 100 KB, at most 30 pages. Compression lowers quality first and size last, never below a readable 900 px.
  - The real file type is checked from the file's first bytes (not its name), in the browser and again on the server. HEIC photos work where the browser can open them (Safari, recent Chrome on some phones); elsewhere staff get a clear "save as JPEG" message.
  - Duplicate warning: each original's SHA-256 is stored; the same file for the same patient asks before saving again.
  - Phone scan: reception shows a QR (valid 5–120 min, default 30). The link works on the first phone that opens it only (that phone keeps its own secret key); pages appear live on the desk screen. Closing the session ends the link.
  - Offline-safe queue: pages wait in the browser's storage (IndexedDB) and upload when the connection returns, with retries that back off; a reload doesn't lose them.
  - Scanner-folder watch: Chrome/Edge only (folder access permission); new files in the chosen folder are offered for upload.
  - Browser tests for upload need the storage bucket to allow the test site's address (CORS); see continue.md.
- 24/10/2026 (session 6), validation and imports (owner: "why is validation not there; import has no template"):
  - Every form runs a zod schema before anything is sent: messages under each field, focus on the first bad one, a field's message clears when it's edited, and a database "invalid_input: <field>" is shown under that field. Field rules live in `packages/shared/src/validation.ts`; screen-specific schemas in `web/lib/schemas/`. Date-range filters refuse To before From or more than a year before loading.
  - Imports (patients, opening stock, leads): a downloadable CSV template with two made-up rows; the browser checks the file (CSV only — an Excel file gets "Save As CSV" steps —, ≤ 5 MB, ≤ 20,000 rows, required columns, every cell); "Check the file" runs the real import on the server inside an undone savepoint, so it finds everything the import would refuse, including a UHID / batch / number repeated within the file. Problem rows can be left out; the problem list downloads as CSV with the original cells.
- 24/10/2026 (session 6), Phase 9 done: leads (web) and Meta lead ads. Decisions made while building:
  - Lead pages are for sales managers and admins; executives work on the phone app. The sales manager's home is the sales dashboard; admins also reach it from Leads.
  - New leads: name and mobile are required; a number that already has a lead is shown first and can be saved as a linked new lead. Without an owner a lead goes round-robin to the ticked executives (longest-waiting first, optional per-source), skipping inactive staff; with round-robin off, managers are notified.
  - A booking for a lead without a patient file shows "Lead — not registered" on the Today board; reception's "Register as patient" opens the registration form filled from the lead and links the two, so the booking, calls and tasks move to the patient file.
  - "Amount finalised" (agreed price) pre-fills Start treatment's agreed price; once a treatment has started only reception or an admin can change it, with a reason.
  - Meta lead ads: Admin → Meta lead ads shows the callback URL, maps extra form questions, lists every delivery and retries failed ones (setup: `dev-docs/SETUP_META.md`). Answers not mapped go to "More comments".
  - Fixed while testing: an admin settings form could lose a row typed before the saved settings arrived; editable lists now copy server data once and never over unsaved edits.
- 24/10/2026 (session 6), Phase 10 done: WhatsApp Cloud API and drip campaigns. Decisions made while building:
  - Every outgoing message is saved first and sent by `wa-dispatch` (every 5 minutes from the database timer, and at once after a staff send). Booking confirmations and reminders are sent once each, whatever runs twice; delivery ticks only move forward (sent → delivered → read).
  - Replies are understood in English, Kannada and Hindi (YES / ok / ಹೌದು / हाँ confirm the next booking; NO / change ask for a call back; STOP / START switch messages off and on). Longer or mixed replies are left for staff to read. A reply after the booking time does nothing.
  - Free-typed messages only within 24 hours of the person's last message (Meta's rule); otherwise an approved template. Automatic messages wait outside quiet hours (default 21:00–09:00 IST); staff sends go at once.
  - Without the Cloud API (or for a number set to manual), staff type the message, it is saved, and WhatsApp opens on their phone with it ready.
  - Templates are made in Meta's WhatsApp Manager and copied in; the admin picks what each is for and which value fills each {{n}}. Estimated cost per message is a setting; Meta's invoice is the real amount.
  - Drip campaigns: patients (consultation done, treatment started / completed, discharged, or added by staff) or leads (new lead, or added by staff); a reply or a booking can stop it; opted-out numbers never get it.
  - Live site address: https://pearl-sales.vercel.app (login emails link there; set in WEB_ORIGIN).
  - Team inbox (owner, 24/10/2026: "3–5 people will chat, mostly real time"): menu → WhatsApp lists conversations with unread replies and opens the chat beside the list; it, the chat panel and the menu badge update live through Realtime on `wa_threads` (same visibility as messaging). Opening a conversation marks it read for the team.
  - Housekeeping still to add (Phase 14): `job_runs` grows by one row per dispatch run (~105k rows a year) — purge rows older than 90 days.
- 24/10/2026 (session 7), Phase 11 done: the Android sales app. Decisions made while building:
  - Everything a salesperson does on the phone (call notes, notes, stage changes, "done" on a follow-up, confirming a booking, a new lead) is saved on the phone first and sent by the outbox; it works with no signal and shows "Not sent yet" until the server has it. Free slots, booking and the "My day" numbers need the internet (the server decides them).
  - Call flow: Call opens the phone's dialer; coming back to the app opens the "How did the call go?" sheet for that lead (result required, notes up to 2,000 letters, next step: done for now / tomorrow / in 3 days / next week at 11 AM IST / no more calls, optional stage, lost needs a reason from the list). Phase 12 replaces the guessed call length with the real call log.
  - A new lead typed on the phone warns when the number is already on the phone and is then saved anyway (the server links it to the older lead, as on the web).
  - "Done for now" closes the follow-up that was due; later ones stay (same as the web's call log).
  - A retry of "Done" or "Confirmed" whose first send reached the server but lost its answer is treated as sent, not as a failure.
  - Push: a new notification for someone with the app installed rings their phone (Firebase, data-only message shown by the app). Tokens Firebase no longer knows are removed. Push is best effort; the notification is always in the app.
  - Charts on the phone use Vico 3.1.0 (3.2+ needs a newer Android build toolchain than ours).
  - Moved to Phase 12 (recordings): the voice note when marking a lead lost.
