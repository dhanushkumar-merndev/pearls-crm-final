# Android navigation and empty-state UX

**Goal:** Replace Android screen fades with horizontal slides, center empty states in the usable content area, and give headers and navigation comfortable clearance.

**Approach:** Keep the existing Navigation Compose back stack. Opening a screen moves left; Back moves right. Tab motion follows the visible tab order for each role. Keep lead-row Call/WhatsApp swipes. Use one centered empty-state component, with list items filling the remaining list viewport. Inline chart empty states keep their compact height.

**Constraints:** One Android polish phase; no new dependencies or services. Use existing theme/spacing and string resources. Preserve unrelated web changes. Work in the current checkout because these changes are confined to Android and directly reviewable there; no commits or deployment requested.

## Implementation

- [x] Add regression coverage for empty-state centering and screen layout, including a short viewport.
- [x] Center shared empty-state content and fill the available list space on Leads, Follow-ups, Calls, BDM visits/leads, Alerts and Recordings; add spacing below headers and above navigation.
- [x] Add directional navigation transitions with coverage of forward, Back and role-specific tab ordering. The full-screen New lead form uses matching window slides and has a header Back button.
- [x] Run Android tests, debug build and lint; review the diff and supply owner steps.

**Validation:** `cd android && ./gradlew test assembleDebug lintDebug` passed: 190 tests, zero failures/skips; debug APK built; lint completed without errors. Regression checks cover directional navigation, centering, a compact viewport, a long empty-search message, and scrolling Alerts in landscape-sized space.

## Review focus

Keep pull-to-refresh available on empty lists, avoid covering content with the New lead button, keep inline chart messages compact, respect system animation settings, and preserve the existing back stack and lead-row swipe actions.

Review caught two small-screen cases, both reproduced by failing tests and fixed: empty content uses a minimum viewport height so long messages can grow and scroll; the Alerts header remains part of the scrollable list and its measured height is subtracted from the empty-state area. A second review found no further important issues.

## How to try the updated build

1. Open Leads, tap a lead, then use the top-left Back arrow or Android Back. Opening moves left; going back moves right.
2. Tap between the bottom tabs in both directions. Motion should follow their positions in the navigation bar.
3. Open New lead, then tap its top-left Back arrow. The form should slide in and out.
4. On an empty list, check that the message is centered below the controls and above navigation. Search for something with no matches and use Clear search.
5. Turn the phone sideways and repeat the empty search. Long messages and Alerts should still scroll, keeping their actions reachable.

Release **1.2.7 (10)** was built on 03/11/2026 with the existing release certificate. `./gradlew test assembleRelease lintRelease` passed (190 tests, zero failures). Installed over 1.2.6 on the owner's connected phone with `adb install -r`; Android confirms version 1.2.7 (10), and launching MainActivity returned `Status: ok`. The release APK is `android/app/build/outputs/apk/release/PearlCRM-1.2.7.apk`. The owner can now try the steps above on the phone.

## Follow-up: navigation performance, softer corners and list optimization

Owner reports lag specifically on tab changes and opening/closing screens, requests slightly rounder component corners, and asks about debouncing/pagination.

Evidence: 18 controlled tab switches on 1.2.7 produced 990 frames, 37 missed deadlines (3.74%), p95 17 ms / p99 48 ms, with 32 slow UI-thread frames. Android reports the new install as `verify`, not precompiled. A temporary measurement test showed the navigation host itself does not remeasure every animation frame; do not replace Navigation Compose on that assumption. Search currently submits every keystroke; Leads/Calls show only the first 200 rows. Server sync already uses bounded cursor pages; this follow-up fixes the phone's list presentation.

- [x] Add regression tests for canceling superseded searches and bounded, deterministic local database pages.
- [x] Debounce Leads search by 300 ms, clearing immediately; show 50-row pages with previous/next controls for Leads, Calls, Follow-ups and BDM Leads, resetting on filter/search changes. Server sync remains cursor-paginated and offline data remains in Room.
- [x] Remove unconditional BoxWithConstraints subcomposition from the list wrapper while keeping minimum-height empty content and existing short-screen regressions; use 220 ms directional slides. List rows and the My day dashboard wait for RESUMED, keeping initial data/chart composition out of the incoming slide.
- [x] Round the Android theme's small fields/cards/dialogs slightly (including the previously default 4 dp extra-small field corners).
- [x] Build/test/lint signed releases, update the connected phone preserving its data, attempt precompilation, and repeat navigation timing. The owner installed 1.2.8; this session installed and measured 1.2.9. The phone rejected explicit precompilation (details below).

**1.2.8 validation:** `./gradlew test assembleRelease lintRelease` passed: 197 tests, zero failures/errors/skips. The signed APK is `android/app/build/outputs/apk/release/PearlCRM-1.2.8.apk`, version code 11; signing certificate matches the previous release. Review found and fixed Back/tab restoration losing scroll: the real list state is keyed by page/filter/search, with a separate loading-placeholder state so restoring a STARTED destination does not clamp saved position. A regression restores at STARTED, waits 250 ms, resumes, and verifies row 41 is still visible. Final review found no further important issues.

Installation attempt on 03/11/2026 was stopped because the USB phone disconnected before `adb install -r` could run. Reconnection requested; installation and after-change phone measurements remain pending. Do not report the phone as updated or the measured lag as resolved until those succeed.

### Try 1.2.8

1. Tap between Leads, Follow-ups, Calls and Settings, then open a lead and use Back.
2. Scroll down a lead list, open a lead and return. The list should keep its position.
3. Type a search quickly: it applies after a short pause; clearing it applies immediately.
4. On a list with more than 50 entries, scroll down to Next, then Previous. Search/filter changes return to page one.
5. Compare the rounder fields, cards and dialogs; check an empty search in portrait and landscape.

## Follow-up: bounded memory cache (1.2.9)

Owner requests a little caching. Phone reconnected; Android reports 1.2.8 (11), so the owner has already installed that APK.

- [x] Add a 30-second memory cache for the current dashboard and up to six pages per main list. Cache keys include staff/role, filter/search/page, and the dashboard's IST date. Room remains authoritative and revalidates cached page snapshots through its live flows.
- [x] Invalidate cached reads on local writes, completed sync and sign-out/account change; reject late writes to a cleared cache. Manual dashboard refresh bypasses cached data and overlapping automatic reads share one request.
- [x] Reuse cached snapshots as screens' initial data, run cache/freshness/account-isolation regressions, then full Android tests/build/lint.
- [x] Build/install 1.2.9, attempt precompilation on the reconnected phone, verify version/startup and measure tab navigation after the owner unlocks the app.

Cache review caught an active-observer invalidation issue: a cleared cache rejected later fresh emissions from the same long-lived Room subscription. A failing regression reproduced it; generation changes now restart the authoritative flow while still rejecting late results from old reads. Targeted data and sales-screen suites pass, including immediate cached Back restoration and uncached scroll restoration. The cache-hit UI test explicitly disposes its composition before closing Room. Final cache review found no further important issues.

**1.2.9 validation:** `./gradlew test assembleRelease lintRelease` passed on 03/11/2026: 207 tests, zero failures/errors/skips; release build and lint passed. Version metadata is 1.2.9 (12); `apksigner verify` passed and the certificate matches the prior release. `git diff --check -- android dev-docs/2026-11-03-android-navigation-ux.md` passed. APK: `android/app/build/outputs/apk/release/PearlCRM-1.2.9.apk`.

Installed on the connected RMX2161 with `adb install -r` (Success), preserving app data. Android confirms 1.2.9 (12). MainActivity starts with `Status: ok` (cold launch 607 ms) and the process is running. The phone rejected explicit `cmd package compile -m speed -f com.pearl.crm`; ART still reports `verify`, so no manual precompilation claim is made. The owner unlocked the app for the measurements below. No patient text or screen images were saved.

### Try 1.2.9

1. Open Leads, switch to Calls, then return to Leads. Recently viewed pages can appear immediately from the short memory cache.
2. Scroll down a list, open a lead and use Back. It should slide right and keep the list position.
3. Return to My day within 30 seconds. Its numbers are reused briefly; pull down whenever you want fresh server numbers.
4. Type a search quickly, pause, then clear it. Search waits 300 ms; clearing applies immediately. Lists show 50 entries per page with Next/Previous controls.
5. Check the rounder fields/cards, an empty search and the clearance above bottom navigation.

**On-phone navigation check:** Repeated the same 18 tab switches used for the 1.2.7 baseline, using currently verified navigation bounds. First 1.2.9 run: 992 frames, 35 missed deadlines (3.53%), p95 16 ms / p99 77 ms, 33 slow UI-thread frames. A warmed-up run: 988 frames, 32 missed deadlines (3.24%), p95 16 ms / p99 61 ms, 29 slow UI-thread frames. Baseline was 990 frames / 3.74%, p95 17 ms / p99 48 ms. Fewer frames missed deadlines, but tail latency is higher; these results do not establish that lag is resolved. No manual ART precompilation succeeded, and runs on a live phone are not an isolated cache benchmark.

Also opened New lead using its verified action, confirmed the empty form's Name field and Back control, then used Android Back and confirmed the main navigation returned. No form input was entered or saved. The cache/release phase is complete; intermittent frame stalls remain a known performance limitation for owner feedback.
