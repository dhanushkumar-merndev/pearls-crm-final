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
| `enquiry_followup` | Marketing | `Hello from {{1}}! You contacted us on WhatsApp about our treatments. Would you like our team to help you? Tap a button below or reply to this message.` | `Yes, please` · `Stop messages` |

**Quicker: let the CRM submit them all.** In VS Code's terminal, in the project folder, run `pnpm wa:templates` (shows what it would send; changes nothing), then `pnpm wa:templates --submit`. It sends the five templates above for review and skips any that already exist. This needs the system user to have the WhatsApp account (step 3.2, **Full control**). Otherwise Meta answers "This API is not supported for this WhatsApp Business Account".

You can write your own as well; Kannada and Hindi templates work the same way. Meta usually answers within an hour. Rejected templates show the reason in WhatsApp Manager.

## 7. Connect the templates in the CRM

1. **Admin → WhatsApp → Test connection.** It should say **Connected ✓** with the clinic's name and number.
2. Click **Get templates from Meta**. The templates appear in the list with Meta's status.
3. Click **Edit** on each one:
   - **Used for**: `appointment_booked` → Booking confirmation, `appointment_reminder` → Booking reminder, `lead_welcome` → New lead welcome, `followup_checkin` → Other (staff can send it, and drip campaigns can use it).
   - **Value for {{1}}, {{2}} …**: for `appointment_booked`, {{1}} First name, {{2}} Clinic name, {{3}} Booking date, {{4}} Booking time, {{5}} Doctor. For `enquiry_followup` (Used for: Other), {{1}} Clinic name: staff send it from the inbox to a number whose 24 hours have passed.
   - Click **Save**.
4. Under **Settings**: tick **Send WhatsApp messages from the CRM**, check the quiet hours (default 9 pm to 9 am, India time), and click **Save**. Reminders go the number of hours before the booking set in **Admin → Settings → Appointments**.

## 8. Test it

1. Book an appointment for a test patient whose WhatsApp number is your own.
2. Within 5 minutes the confirmation arrives. In the patient file → **WhatsApp** tab, the message shows **Sent → Delivered → Read**.
3. Reply **YES**. Within a few seconds the booking shows **Confirmed**, and the "call to confirm" task disappears from the Today board.
4. Reply **STOP**. You get one message saying messages have stopped, and the tab shows **Asked for no messages**. Reply **START** to undo it.

## Chatting as a team

The **WhatsApp** item in the menu (reception, sales managers, admin) is the team inbox. It lists every conversation you're allowed to reply to, newest first. Conversations with new replies show a count, and the menu shows how many conversations have unread replies. Everything updates by itself within a second or two: a reply, a message a colleague sends, or the Delivered/Read ticks. Opening a conversation marks it read for the whole team. Reception sees patients (and numbers that aren't in the CRM yet); sales managers see leads.

## Chat bot (answers new numbers by itself)

When someone new messages the clinic's WhatsApp number, the bot:

1. sends a welcome with your **brochure link** and **website link** (each on its own line, with a preview);
2. asks their **name**;
3. asks which **treatments** they want: they tap **Choose treatments**, pick one, and the list comes back without it plus **✅ Done**, so they can pick as many as they like (or reply with numbers like `1, 3`);
4. asks their **area or city**;
5. shows everything, **with their WhatsApp number**, and two buttons: **Confirm** / **Cancel**.

**Confirm** makes a lead (source **WhatsApp**) and gives it to the next sales person, who gets a notification. **Cancel** saves nothing.

The bot reads typed messages only. A photo, voice note, video, file or sticker gets "Sorry, I can only read typed messages…" and the question again. An emoji reaction gets no reply.

The bot does **not** answer existing patients, numbers that already have an open lead, chats a staff member has replied to (a staff reply takes over), or numbers that sent STOP. Each number can start at most **5 chats a day** (you can change this). After 3 answers it can't use, the bot stops and leaves the chat to staff.

**In the team inbox** (reception and admin), a number that isn't a patient or lead yet shows the whole chat: their messages on the left, the clinic's and the bot's on the right. You can reply from there. **Register** and **Add lead** open the form with their WhatsApp number already filled in, and once saved the chat shows their name.

**The 24-hour window.** The label at the top of a chat says until when you can type freely (Meta's rule: 24 hours after their last message). When it ends, the label changes to **Templates only** by itself and the reply box offers approved templates.

**Do not disturb (one number).** In any chat, click **⋮ → Do not disturb…** and tick:
- **Chat bot off**: the bot never answers this number (a chat it is in goes to staff);
- **Automatic messages off**: no booking confirmations, reminders, campaign messages or new-lead welcome.

Staff can still send messages by hand. The chat header shows **Do not disturb: …** while it is on. This is different from **STOP**, which stops everything.

The patient page and the lead page have a green **WhatsApp chat** link next to the phone number.

**Set it up:** **Admin → WhatsApp → Chat bot**.
1. Type the treatments (up to 20, each up to 30 letters). Use the arrows to change the order.
2. Paste the **Brochure link** and the **Website link** (both must start with `https://`; for a Google Drive PDF choose **Share → Anyone with the link**).
3. Optional: open **Messages the bot sends** to change any text. An empty box uses the grey text.
4. Tick **Answer new numbers with the chat bot** and click **Save chat bot**. **Send WhatsApp messages from the CRM** (in Settings above) must be ticked as well.
5. Optional, later: **Tick-box form** shows all treatments at once with tick boxes. Meta allows it only for a **verified business** (business.facebook.com → **Security Centre → Start verification**). Until then the bot uses the tap list above, which works without it. After verification, click **Set up tick-box form**.

Bot replies are free: Meta doesn't charge for replies within 24 hours of the person's message.

## Drip campaigns

**Admin → Drip campaigns → New campaign.** Pick who gets it (patients or leads), when it starts (a new lead, a consultation done, a treatment started or completed, a discharge, or "staff add someone") and the messages with their delays. For example: an after-care message 1 day after a treatment is completed, then another 7 days after.

People are added by themselves when the event happens. Staff can also add someone from the patient's WhatsApp tab or the lead's card. A reply or a booking stops the campaign for that person (you choose), and numbers that said STOP never get it. Each message is sent once, even if something runs twice.

## Good to know

- **Quiet hours**: automatic messages (reminders, confirmations made at night, drips) wait until the morning. Messages staff send go at once.
- **24-hour rule (Meta's)**: a free-typed message is allowed only within 24 hours of the person's last message. Outside that window, staff pick a template.
- **Manual numbers**: a patient whose WhatsApp setting is "manual" gets nothing automatic. Staff send from their phone and the CRM keeps a copy.
- **Problems** show on **Admin → WhatsApp**: the connection state, Meta's reason for each message that couldn't be sent, and the last sending run. If the token stops working (the system user lost access or was deleted), the state turns **Problem** with Meta's reason (for example "token expired"). Make a new token (step 3), then run step 4 again. Messages waiting meanwhile are sent after that.
- Raw delivery data from Meta is kept 14 days, then cleared. The messages themselves stay.
