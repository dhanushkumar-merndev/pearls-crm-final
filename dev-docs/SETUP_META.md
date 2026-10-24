# Facebook & Instagram lead ads → CRM (Meta Lead Ads)

When someone fills a lead form on a Facebook or Instagram ad, the lead appears in the CRM within seconds, goes to the next sales executive in turn (round-robin) and gets a "call now" task.

You need: the clinic's **Facebook Page**, admin access to the clinic's **Meta Business account** (business.facebook.com), and about 30 minutes. Nothing here costs money.

> Never paste the secret values into chat, WhatsApp or screenshots. They go only into the `.env` file on the computer.

---

## 1. Create the Meta app (once)

1. Open **developers.facebook.com** and log in with the Facebook account that is an admin of the clinic's business.
2. Click **My Apps → Create App**.
3. Choose **Other** → **Next** → **Business** → **Next**.
4. App name: `Clinic CRM`. Contact email: the clinic email. Business account: choose the clinic's business. Click **Create app**.
5. On the left, open **App settings → Basic**. Copy:
   - **App ID** → in `.env` (section 5) put it after `META_APP_ID=`
   - **App secret** (click **Show**) → `META_APP_SECRET=`

## 2. A permanent token for the Page (once)

1. Open **business.facebook.com → Settings (gear) → Users → System users → Add**. Name: `crm`. Role: **Admin**. Click **Create system user**.
2. With `crm` selected, click **Assign assets → Pages**, tick the clinic's Page, switch on **Manage Page** (full control), **Save changes**.
3. Click **Generate new token**. App: `Clinic CRM`. Token expiry: **Never**. Tick these permissions:
   `leads_retrieval`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`, `ads_management`.
   Click **Generate token** and copy it.
4. That token is a *user* token; the CRM needs the **Page** token. In a browser open (replace `TOKEN`):
   `https://graph.facebook.com/v23.0/me/accounts?access_token=TOKEN`
   Find the clinic's Page in the answer. Copy its `"access_token"` → `META_PAGE_ACCESS_TOKEN=` and its `"id"` → `META_PAGE_ID=`.
5. Make up a long random password-like text (at least 20 letters and numbers) → `META_WEBHOOK_VERIFY_TOKEN=`.

## 3. Send the keys to the server

In VS Code's terminal, in the project folder:

```
pnpm env:sync
pnpm supabase:configure
```

The second command copies the keys to the online server. It never prints them.

## 4. Tell Meta where to send leads

1. In the CRM, log in as admin → **Admin → Meta lead ads**. Click **Copy** next to **Callback URL**.
2. Back on developers.facebook.com → your app → **Webhooks** (add the product "Webhooks" if you don't see it) → choose **Page** in the dropdown → **Subscribe to this object**.
3. Callback URL: paste. Verify token: the same text you put in `META_WEBHOOK_VERIFY_TOKEN`. Click **Verify and save**. (If it says it couldn't verify, check that step 3 ran without errors.)
4. In the list of fields, find **leadgen** → **Subscribe**.
5. Connect the Page to the app: open in a browser (replace `PAGE_ID` and `PAGE_TOKEN`):
   `https://graph.facebook.com/v23.0/PAGE_ID/subscribed_apps?subscribed_fields=leadgen&access_token=PAGE_TOKEN`
   It must be sent as a **POST**. Easiest: in the terminal
   ```
   curl -X POST "https://graph.facebook.com/v23.0/PAGE_ID/subscribed_apps?subscribed_fields=leadgen&access_token=PAGE_TOKEN"
   ```
   The answer is `{"success":true}`.
6. Switch the app to **Live** (top bar of the app dashboard). Meta may ask for a privacy policy URL: the clinic website's privacy page.

## 5. Test it

1. Open **developers.facebook.com/tools/lead-ads-testing**. Choose the Page and a lead form → **Create lead**.
2. In the CRM: **Admin → Meta lead ads → Deliveries** shows the test as **Created** within a few seconds, and the lead is on the **Leads** page.
3. If it shows **Failed**, the problem column says why (e.g. "token expired"). Fix it, then click **Try again** on that row.

## 6. Who gets the leads

**Leads → Who gets new leads**: tick the sales executives who take new leads. You can limit someone to certain sources (e.g. only Instagram). Round-robin itself is switched on or off in **Admin → Settings → Sales**.

## 7. Your own form questions

Name (or first + last name), phone number and email are read automatically. Every other answer (city, "Which treatment?", …) is kept in the lead's **More comments** as "Question: answer". To put an answer somewhere better, open **Admin → Meta lead ads → Extra form questions**, type the question's key exactly as in the Meta form (Ads Manager → Forms library → the form → the question's "key"), and choose where it goes (Treatment, Comments, Alternate mobile, or Ignore).

## Good to know

- The same person filling the form twice does **not** create a second lead while their first lead is open; the owner gets an "Enquired again" note instead.
- Each delivery is processed once, even if Meta sends it twice.
- Form answers are kept 14 days for checking, then cleared; the lead itself stays.
- A token stops working if the system user loses access to the Page or is deleted. Deliveries then show **Failed — token**; generate a new token (step 2) and run step 3 again.
