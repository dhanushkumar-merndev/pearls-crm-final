# Try the Android sales app (Phase 11)

For the owner. About 20 minutes. You need an Android phone (Android 8 or newer) and a USB cable or a way to copy a file to the phone.

## 1. Turn on push notifications (one time, optional)
The app works without this; it just won't ring for new leads.
1. Open https://console.firebase.google.com and open the project you made for Pearl (the same one whose key is in `.env` as `FCM_SERVICE_ACCOUNT_JSON`).
2. Click the gear → **Project settings** → **General** → **Add app** → the Android icon.
3. Package name: `com.pearl.crm`. Click **Register app**.
4. Click **Download google-services.json**. Put the file in the project folder at `android/app/google-services.json`. (It is private: git ignores it.)

## 2. Build the app
In the project folder, run:
```
cd android
./gradlew assembleDebug
```
The app file is `android/app/build/outputs/apk/debug/app-debug.apk`.

## 3. Put it on the phone
1. Copy `app-debug.apk` to the phone (USB, Google Drive, or WhatsApp to yourself).
2. On the phone, open the file. If Android asks, allow **Install unknown apps** for the app you opened it from.
3. Tap **Install**, then **Open**.

## 4. Log in
1. Use a **sales executive** login (username + password) made in the web app under Admin → Staff.
2. Set a 4–6 digit PIN when asked. Allow notifications.

## 5. Things to try
| Try this | What should happen |
|---|---|
| Open **Leads** | Your leads; "Due now" shows who to call first |
| Type part of a name or number (e.g. `98450`) in the search | The list narrows |
| **Swipe a lead to the right** | The phone's dialer opens with the number |
| Make or cancel the call, then come back to the app | "How did the call go?" opens. Tap **Save notes** without choosing a result: a red message asks for it |
| Choose **Spoke**, type a note, choose **Call tomorrow**, save | "Saved"; the lead shows tomorrow 11:00 AM as its call-back |
| **Swipe a lead to the left** | WhatsApp opens a chat with that number |
| Tap a lead → **Change stage** → **Lost** → Save without a reason | It asks for the reason; choose one from the list |
| Tap a lead → **Book a consultation** → pick doctor, day, time → **Book** | "Booked for …". In the web app the booking appears on the slot board |
| Book a time that someone has just filled (use the web to fill it first) | "That slot is full. Please choose another time." and the times reload |
| **Follow-ups** → **Done** on a task | It disappears; the web shows it done |
| **My day** | Today's calls, follow-ups, bookings, a calls-per-day chart ("Show as table" for numbers) and bookings waiting for the patient to confirm (**Confirmed** button) |
| Turn on **Airplane mode**, add a call note, then turn it off | The note shows "Not sent yet", then is sent by itself within a minute or two. On the web it appears once, never twice |
| In the web app, assign one of this person's leads to someone else, then pull down to sync (Settings → **Sync now**) | The lead disappears from this phone |
| In the web app, assign a new lead to this person | The phone rings with a notification (only if you did step 1) |

## If something goes wrong
- "Some changes couldn't be saved": open **Settings** — each refused change shows why, with **Try again** and **Discard**.
- The app says it isn't set up: the build didn't find the root `.env`. Build again from the project folder.

---

# Phase 12: caller pop-up and call recordings

Rebuild and reinstall the app (steps 2–3 above). Then on the phone:

## 6. One-time setup (about 5 minutes)
1. Open the app → **Settings** → **Set up calls and recordings**.
2. Tap **Allow** on each step until it shows **Done**:
   - **Phone and call log** — Android asks twice; choose Allow.
   - **Show over other apps** — a settings page opens; switch it on for "Clinic CRM", then press Back.
   - **Notifications**, **Microphone** — Allow.
   - **Keep the app running** — choose Allow, then follow the extra steps written for your phone's brand.
   - **Recordings folder** — first switch on automatic call recording in the phone's own dialer (the step says where), make one test call, then tap **Allow** and pick the folder shown in the step.
3. Leave **Caller pop-up** on.

## 7. Things to try
| Try this | What should happen |
|---|---|
| Call a lead's number from another phone | While it rings, a dark card at the top shows the lead's name, stage and last note. Tap it to hide it |
| Answer, talk a little, hang up | The app opens "How did the call go?" for that lead, with the real call length |
| Call a number that isn't a lead | Nothing happens. That call never leaves the phone |
| Mark a lead **Lost** in the notes sheet | "Record why (voice note, optional)" appears. Record a few words, then Stop, then Save |
| Wait a minute, then **Settings → Recordings on this phone** | The call's recording is listed as "On this phone" (or "Uploaded" if the admin chose "every call") |
| On the web (as manager): menu → **Recordings** → **Request sync** on that recording | The phone gets a notification. Within a few minutes the recording shows "Uploaded", and **Play** works on the web |
| Make a call longer than 10 minutes and request it | The web shows "Long call: only the first 10 minutes were uploaded." The file on the phone is untouched |
| Web: **Admin → Settings → Sales** | "Call recordings are uploaded": only when asked / every CRM call; and how many minutes |
| Web: **Admin → Users → Edit** on a sales person | "Call recordings": override the clinic setting for that person |
| Restart the phone, then call a lead | The pop-up still works without opening the app first |

## 8. Field checklist (do this once on every phone model you buy)
Tick each box on each model. If something fails, note the model and Android version and tell me.

| Check | Model 1: ______ | Model 2: ______ | Model 3: ______ |
|---|---|---|---|
| Pop-up shows for an incoming CRM call (screen on) | ☐ | ☐ | ☐ |
| Pop-up shows for an incoming CRM call (phone locked) | ☐ | ☐ | ☐ |
| Pop-up shows for an outgoing CRM call | ☐ | ☐ | ☐ |
| Notes sheet opens after hanging up, with the right length | ☐ | ☐ | ☐ |
| A missed CRM call appears in the lead's calls on the web | ☐ | ☐ | ☐ |
| A personal (non-CRM) call does NOT appear anywhere | ☐ | ☐ | ☐ |
| The dialer's recording is found ("Recordings on this phone") | ☐ | ☐ | ☐ |
| Matched to the right lead (check the name) | ☐ | ☐ | ☐ |
| Request sync → uploaded within 15 minutes on Wi-Fi | ☐ | ☐ | ☐ |
| Uploaded audio plays clearly on the web | ☐ | ☐ | ☐ |
| Original file still plays in the phone's own app afterwards | ☐ | ☐ | ☐ |
| Works after a restart (no need to open the app) | ☐ | ☐ | ☐ |
| Works the next morning (phone idle overnight) | ☐ | ☐ | ☐ |

Phones that use the **Google Phone app** (Pixel, Motorola, many newer Xiaomi/OnePlus/Oppo/Realme) keep recordings inside the dialer where no app can read them. The pop-up and notes still work there; use the voice note for important calls.

# Phase 13: BDM field day (office start, route, visits)

Rebuild and reinstall the app (steps 2–3 above). You need one staff login with the role **BDM**.

## 9. One-time setup on the web (about 5 minutes, as admin)
1. **Admin → Offices → Add**: type the office name, then its location. To get the location: open Google Maps, long-press the office building, and copy the two numbers shown at the top (for example `12.97160, 77.59460`): the first is **Latitude**, the second **Longitude**. Leave **Circle (metres)** at 200 unless the building is large.
2. **Admin → Users → Edit** the BDM: pick their **Office**. Tick **May start the day away from the office** only for people who start from home or a site.
3. **Admin → Settings → BDM** (the defaults are fine to begin with):
   - Selfie needed to start the day (on)
   - Late start after 10:30 AM, the day ends itself at 9:00 PM
   - "No signal from the phone" alert after 15 minutes
   - "Long route" when the km driven is more than 1.5 × the expected km

## 10. Things to try (on the BDM's phone)
| Try this | What should happen |
|---|---|
| Log in as the BDM | The home tab is **My day**, with **Start your day** and **Allow location** |
| Tap **Allow location**, choose **While using the app**, then (Android asks again) **Allow all the time** | The start button appears |
| At the office: **Take selfie and start** | "Day started at the office." A notification "Your day is being recorded" stays while the day is on |
| Try the same away from the office | "You're not at the office yet…" (unless the admin allowed starting anywhere) |
| **Start travel** → type a hospital name → **Start**, then drive there | The card shows "Going to …". Km driven goes up during the day |
| **Reached** → **Take photo** → **Mark reached** | The card shows "At …" with **Record the meeting** and **Complete visit** |
| **Record the meeting** (tell the person first), **Stop** | "Meeting recording 0:42 ✓" |
| **Complete visit**: what happened, the person met, tick **Add a lead from this visit** | Saved. The lead appears in **Leads** and on the web in the sales manager's pool |
| Switch on airplane mode, do Start travel / Reached / Complete visit | Each says "Saved. It will be sent when there is signal." Switch airplane mode off: everything reaches the web within a minute |
| **Take a break** → Lunch, 30 minutes → **End break** | Break used goes up. Going over the allowed minutes shows on the admin's day sheet |
| **End day** | The notification goes away and the day can't be changed after this |
| Web (admin): menu → **BDM** | A live map with each BDM as a dot: green = all well, amber = GPS switched off, red = no signal from the phone for 15 minutes, grey = day not started or ended. Beside it: state, battery, GPS off, "started away" |
| **Locate now** on a BDM | Their phone sends its position within a minute (needs push, step 1, and signal) |
| **Day sheet** | The day's route on the map with **Play**, every event in order, the visits with photo and meeting recording, the breaks and the km (driven and expected) |
| **Download Excel** in "Report" | One row per BDM per day: start, end, office, visits, leads, km, breaks, flags |
| Restart the phone in the middle of a day | A notification "Tap to keep recording your day". Tap it: recording continues |
| Leave the day open past 9:00 PM | The day ends itself and is marked "ended automatically" |

## 11. Field checklist for route recording (once on every phone model)
Tick each box. Phone makers stop apps in the background in different ways; this finds problems before the team relies on it.

| Check | Model 1: ______ | Model 2: ______ | Model 3: ______ |
|---|---|---|---|
| Day starts at the office (selfie, inside the office circle) | ☐ | ☐ | ☐ |
| "Your day is being recorded" stays while the screen is off for an hour | ☐ | ☐ | ☐ |
| A 20-minute drive shows as a smooth line on the day sheet (no zig-zags) | ☐ | ☐ | ☐ |
| **Scripted drive**: a known route (for example office → a hospital 8 km away by Google Maps). Km driven on the day sheet is within ±5% of Google's distance | ☐ | ☐ | ☐ |
| Standing still for 30 minutes adds almost no km | ☐ | ☐ | ☐ |
| The admin's map shows the BDM moving (refreshes within 5 minutes) | ☐ | ☐ | ☐ |
| Airplane mode for 30 minutes while driving, then off: the route fills in | ☐ | ☐ | ☐ |
| Phone restarted mid-day: the "tap to keep recording" notification appears | ☐ | ☐ | ☐ |
| Battery used by the app over a full day (Settings → Battery) is under 10% | ☐ | ☐ | ☐ |
| Location switched off mid-day: the admin sees "GPS off" | ☐ | ☐ | ☐ |

If recording stops when the screen is off, open **Settings → Set up calls and recordings → Keep the app running** and follow the steps for that brand (the same setting keeps the route going).
