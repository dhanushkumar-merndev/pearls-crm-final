# Hand-check list (what a robot can't judge)

The automatic tests (see [TEST_CASES.md](TEST_CASES.md)) check every page, form and rule. This list is
only for things that need a person: paper, a real call, a real drive, your own WhatsApp.
Tick each box. If something is wrong, write what you saw next to it (a photo helps) and send it to me.

Use the **online test site** with the fake logins from [SETUP.md](SETUP.md) (admin / reception / manager /
sales / bdm), never real patients. Things you create: put **TEST** in the name.

---

## A. Before you start (phone)

The automatic phone run removes the Pearl app from your phone and puts a test version on it. Afterwards:

1. ☐ In the project folder run `cd android && ./gradlew assembleDebug` (or ask me to build it).
2. ☐ Copy `android/app/build/outputs/apk/debug/app-debug.apk` to the phone → open it → **Install** → **Open**.
3. ☐ Log in with your own username and password, choose your PIN.
4. ☐ **Settings → Calls setup**: every row says done (allow anything it asks for).

---

## B. Printed bill (web, reception login)

1. Open **Patients → New patient**, name `TEST Print`, any 10-digit mobile → **Save patient**.
2. **Bills** tab → **New bill** → add a service, rate `1250.50` → **Finalize bill** → Cash → **Fully paid**.
3. Click **Print**, then in the print window choose **Save as PDF** (and once on the real printer).

| Check | ✓ |
|---|---|
| Logo, clinic name, address, phone, e-mail and website at the top are yours (Admin → Clinic profile) | ☐ |
| GSTIN · State code · LLPIN line is right | ☐ |
| Faint logo in the middle of the page (watermark), not hiding any text | ☐ |
| "Bill cum receipt", bill number, date and **Original** at the top right | ☐ |
| Patient box: name, UHID, age / gender, phone, doctor | ☐ |
| Total ₹1,250.50, "Paid in full", amount in words correct | ☐ |
| Numbered Terms & Conditions are your clinic's terms | ☐ |
| Fits on one A4 page; paper is white (even though the app is dark) | ☐ |
| Printing again says **Duplicate** | ☐ |
| Same checks on a **pharmacy bill** (batch, expiry, HSN under each medicine) | ☐ |
| Same checks on an **IP final bill** (grouped by category, GST summary, 2 pages OK) | ☐ |

---

## C. Your phone: calls (sales login on the phone)

Have a second phone ready (a friend's or your personal one).

1. On the web as **manager**, make a lead `TEST Call` with the **second phone's** number and assign it to `sales`.
2. On your phone (logged in as `sales`), open the lead → swipe/tap **Call**.

| Check | ✓ |
|---|---|
| While ringing / talking, a small bubble shows the lead's name | ☐ |
| After hanging up, the notes sheet opens; Save is refused until you pick a result | ☐ |
| The call shows on the web lead page once, with the right length | ☐ |
| Call your phone **from** the second phone: bubble shows while it rings | ☐ |
| Don't answer: a missed call still asks for notes | ☐ |
| A call from a number that's **not** in the CRM shows nothing | ☐ |
| Same with the phone **locked** | ☐ |
| If your dialer records calls: **Settings → Recordings on this phone** finds it and matches the lead | ☐ |
| Phone restarted, app not opened: the bubble still comes on the next CRM call | ☐ |
| Next morning (phone idle all night): still works | ☐ |

Battery saver (Xiaomi, Vivo, Oppo, Samsung…): if the bubble stops after a while, follow
[TRY_ANDROID.md](TRY_ANDROID.md) "If something goes wrong" and note your phone model here: __________

---

## D. Your phone: no signal

| Do this | Should happen | ✓ |
|---|---|---|
| Turn on airplane mode, make a new lead and a note | Saved on the phone; a strip says "Offline…" | ☐ |
| Turn airplane mode off | Strip goes away; lead appears on the web within a minute, **once** | ☐ |
| Turn the phone sideways while typing a new lead | What you typed stays | ☐ |
| Leave the app for 6 minutes, come back | PIN asked | ☐ |

---

## E. WhatsApp chat bot (your personal WhatsApp → the clinic's number)

The bot only answers numbers that are **not** a patient or an open lead, that staff haven't replied to in the
last 24 h, and that haven't sent STOP. If it stays silent, that's probably why: use another person's phone.

| Do this | Should happen | ✓ |
|---|---|---|
| Send "Hi" to the clinic's WhatsApp number | Blue ticks + "typing…", then a welcome with the brochure and website links | ☐ |
| Reply with your name | Asks which treatments, with a **Choose treatments** button | ☐ |
| Tap a treatment, then another, then **✅ Done** | Each pick disappears from the list; Done moves on | ☐ |
| Type your area | Summary with name, **your WhatsApp number**, treatments, area + **Confirm / Cancel** | ☐ |
| Tap **Confirm** | Thank-you message; a new lead (source WhatsApp) on the web, given to a sales person | ☐ |
| Send a photo or voice note instead of an answer | "Sorry, I can only read typed messages…" and the question again | ☐ |
| Start again and tap **Cancel** at the summary | Nothing saved | ☐ |
| Start a 6th chat the same day | Bot stays silent (5 a day per number) | ☐ |
| On the web **WhatsApp** inbox (reception) | The whole chat shows; **Register** / **Add lead** fill in the number | ☐ |
| In that chat: **⋮ → Do not disturb… → Chat bot off** → message again | Bot doesn't answer; staff can still reply | ☐ |
| 24 h after their last message | The chat says **Templates only**; the box offers templates | ☐ |

---

## F. BDM day (bdm login on the phone, once)

| Do this | Should happen | ✓ |
|---|---|---|
| Start the day away from the office | Refused, says how far you are | ☐ |
| Start at the office (selfie) | "Day started", route recording on | ☐ |
| Travel → Reached (photo) → Complete visit (outcome) | Each step saved; visit shows on the web BDM page | ☐ |
| A real drive of a few km, then End day | Km on the web within ±5% of the car's trip meter | ☐ |
| Web **BDM** page as admin | Live dot moves; day sheet + Excel download open | ☐ |

---

## G. Patient self-registration (QR)

| Do this | Should happen | ✓ |
|---|---|---|
| Reception → **Patients → QR**, scan it with another phone | Form opens on that phone, with the captcha | ☐ |
| Fill it and send | Appears under **Patients → Waiting**; reception can check & save or discard | ☐ |

---

## H. After testing

☐ Tell me which boxes failed (photo + phone model). ☐ Delete any **TEST** WhatsApp lead you made on the live
number. ☐ The phone tests use PIN **2468**; change yours in **Settings → Change PIN** if you like.
