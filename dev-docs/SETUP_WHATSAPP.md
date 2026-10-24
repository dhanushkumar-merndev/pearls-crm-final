# WhatsApp Cloud API → CRM

Once this is set up, the CRM sends booking confirmations and reminders on WhatsApp by itself. When the patient replies **YES** (or ಹೌದು / हाँ / ok), the booking turns **Confirmed**. If they reply **NO**, a "call back" task appears. Staff can message patients and leads from the patient file or the lead page, and drip campaigns send a series of messages on a schedule.

You need:
- the clinic's **Meta Business account** (business.facebook.com);
- the **Clinic CRM** app from `SETUP_META.md` (or make it as in its step 1);
- a **phone number that is not on the WhatsApp app** (a new SIM is easiest; a number on the WhatsApp Business app can be moved, but it then stops working in that app);
- about 45 minutes, plus waiting for Meta to approve templates (minutes to a day).

**What it costs:** Meta charges for each template message the clinic starts. In India this is roughly ₹0.12 for a service message (confirmation, reminder) and ₹0.88 for a marketing message. Replies within 24 hours of the patient writing are free. Meta asks for a card in WhatsApp Manager. The CRM shows an estimate on **Admin → WhatsApp**; Meta's invoice has the real amount.

> Never paste the secret values into chat, WhatsApp or screenshots. They go only into the `.env` file on the computer.

Until this is done, nothing breaks. The WhatsApp tab and the lead card open WhatsApp on the staff member's phone with the message ready, and save it in the CRM.

---

## 1. Add WhatsApp to the Meta app

1. Open **developers.facebook.com → My Apps → Clinic CRM**.
2. Under **Add products to your app**, find **WhatsApp** and click **Set up**. Choose the clinic's business account and click **Continue**.

## 2. The clinic's WhatsApp number

1. In the app, open **WhatsApp → API Setup**. Under step 5, click **Add phone number**.
2. Display name: the clinic's name (Meta checks it matches the business). Category: **Medical and health**. Click **Next**.
3. Type the number, choose **Text message**, and type the code Meta sends.
4. Back on **API Setup**, choose the new number in the **From** list. Copy:
   - **Phone number ID** → in `.env` (section 6) after `WHATSAPP_PHONE_NUMBER_ID=`
   - **WhatsApp Business Account ID** → `WHATSAPP_WABA_ID=`

## 3. A permanent key (token)

1. Open **business.facebook.com → Settings (gear) → Users → System users**. Choose **crm** (made in `SETUP_META.md`), or click **Add**, name it `crm` and give it the **Admin** role.
2. Click **Assign assets**:
   - **Apps** → **Clinic CRM** → switch on **Manage app** → **Save changes**;
   - **WhatsApp accounts** → the clinic's account → switch on **Full control** → **Save changes**.
3. Click **Generate new token**. App: **Clinic CRM**. Token expiry: **Never**. Tick `whatsapp_business_messaging` and `whatsapp_business_management`. Click **Generate token**, copy it → `WHATSAPP_ACCESS_TOKEN=`.
   Don't use the 24-hour "temporary access token" on the API Setup page: it stops working the next day.
4. **developers.facebook.com → Clinic CRM → App settings → Basic → App secret → Show**. Copy it → `WHATSAPP_APP_SECRET=`. This is the same value as `META_APP_SECRET` when it is the same app.
5. Make up a long random password-like text (at least 20 letters and numbers) → `WHATSAPP_WEBHOOK_VERIFY_TOKEN=`.
6. Leave `EDGE_CRON_SECRET=` empty. The next step fills it in.

## 4. Send the keys to the server

In VS Code's terminal, in the project folder:

```
pnpm env:sync
pnpm supabase:configure
```

The second command copies the keys to the online server. It also connects the database's 5-minute timer to the sending function. It never prints the keys. The last line should say **✔ Database timer can start server functions**.

## 5. Tell Meta where to send replies and delivery ticks

1. In the CRM, log in as admin → **Admin → WhatsApp**. Click **Copy** next to **Webhook callback URL**.
2. **developers.facebook.com → Clinic CRM → WhatsApp → Configuration → Webhook → Edit**. Paste the URL. Verify token: the same text as `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. Click **Verify and save**.
3. Under **Webhook fields**, click **Manage** and switch on **messages**. Click **Done**.
4. Payment: **business.facebook.com → WhatsApp Manager → (the account) → Payment settings → Add payment method**.
5. Switch the app to **Live** (top of the app dashboard) if it is still in Development.

## 6. Make the message templates

Messages the clinic starts must use a template that Meta has approved. Open **business.facebook.com → WhatsApp Manager → Message templates → Create template**. For each template below: choose the category and language **English**, type the name exactly (small letters and _), and paste the text. Each `{{1}}`, `{{2}}` is a blank the CRM fills in. Use **Add sample** to give Meta an example. Then click **Submit**.

| Name | Category | Text | Buttons (Quick reply) |
|---|---|---|---|
| `appointment_booked` | Utility | `Hi {{1}}, your appointment at {{2}} is booked for {{3}} at {{4}} with {{5}}. Reply YES to confirm or NO to change it.` | `Yes, I'll come` · `Change time` |
| `appointment_reminder` | Utility | `Hi {{1}}, a reminder of your appointment at {{2}} on {{3}} at {{4}}. Reply YES to confirm or NO to change it.` | `Yes, I'll come` · `Change time` |
| `lead_welcome` | Marketing | `Hi {{1}}, thank you for contacting {{2}}. Our team will call you shortly. Reply STOP to stop these messages.` | `Stop messages` |
| `followup_checkin` | Utility | `Hi {{1}}, this is {{2}}. How are you feeling after your treatment? Reply to this message if you have any questions.` | — |

You can write your own as well; Kannada and Hindi templates work the same way. Meta usually answers within an hour. Rejected templates show the reason in WhatsApp Manager.

## 7. Connect the templates in the CRM

1. **Admin → WhatsApp → Test connection.** It should say **Connected ✓** with the clinic's name and number.
2. Click **Get templates from Meta**. The templates appear in the list with Meta's status.
3. Click **Edit** on each one:
   - **Used for**: `appointment_booked` → Booking confirmation, `appointment_reminder` → Booking reminder, `lead_welcome` → New lead welcome, `followup_checkin` → Other (staff can send it, and drip campaigns can use it).
   - **Value for {{1}}, {{2}} …**: for `appointment_booked`, {{1}} First name, {{2}} Clinic name, {{3}} Booking date, {{4}} Booking time, {{5}} Doctor.
   - Click **Save**.
4. Under **Settings**: tick **Send WhatsApp messages from the CRM**, check the quiet hours (default 9 pm to 9 am, India time), and click **Save**. Reminders go the number of hours before the booking set in **Admin → Settings → Appointments**.

## 8. Test it

1. Book an appointment for a test patient whose WhatsApp number is your own.
2. Within 5 minutes the confirmation arrives. In the patient file → **WhatsApp** tab, the message shows **Sent → Delivered → Read**.
3. Reply **YES**. Within a few seconds the booking shows **Confirmed**, and the "call to confirm" task disappears from the Today board.
4. Reply **STOP**. You get one message saying messages have stopped, and the tab shows **Asked for no messages**. Reply **START** to undo it.

## Drip campaigns

**Admin → Drip campaigns → New campaign.** Pick who gets it (patients or leads), when it starts (a new lead, a consultation done, a treatment started or completed, a discharge, or "staff add someone") and the messages with their delays. For example: an after-care message 1 day after a treatment is completed, then another 7 days after.

People are added by themselves when the event happens. Staff can also add someone from the patient's WhatsApp tab or the lead's card. A reply or a booking stops the campaign for that person (you choose), and numbers that said STOP never get it. Each message is sent once, even if something runs twice.

## Good to know

- **Quiet hours**: automatic messages (reminders, confirmations made at night, drips) wait until the morning. Messages staff send go at once.
- **24-hour rule (Meta's)**: a free-typed message is allowed only within 24 hours of the person's last message. Outside that window, staff pick a template.
- **Manual numbers**: a patient whose WhatsApp setting is "manual" gets nothing automatic. Staff send from their phone and the CRM keeps a copy.
- **Problems** show on **Admin → WhatsApp**: the connection state, Meta's reason for each message that couldn't be sent, and the last sending run. If the token stops working (the system user lost access or was deleted), the state turns **Problem** with Meta's reason (for example "token expired"). Make a new token (step 3), then run step 4 again. Messages waiting meanwhile are sent after that.
- Raw delivery data from Meta is kept 14 days, then cleared. The messages themselves stay.
