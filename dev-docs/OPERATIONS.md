# Running the CRM: dashboard, alerts, targets and backups

This is the admin's routine once the clinic uses the CRM every day. Everything here is on the website (log in as an admin). The backup steps need **Chrome or Microsoft Edge on a computer**: they save files into a folder, which phones and other browsers can't do.

---

## 1. The dashboard (any time)

1. Open the menu → **Dashboard**.
2. At the top, pick the period: **Today**, **Last 7 days**, **This month**, **Last month** or **Custom**. Each number shows the change against the period before it (arrow and words).
3. What you see:
   - **Money:** revenue, collected, outstanding (who owes money now), discounts.
   - **Patients:** new and returning patients, the no-show rate, IP admissions with the average stay.
   - **Pharmacy:** sales, margin, stock value, and stock expiring in the next 90 days.
   - **WhatsApp:** messages sent, how many were delivered and read, and the estimated cost.
   - **BDMs on duty now.**
   - Charts: revenue and collections over time; revenue by bill type, by category and by lead source; payment modes; outstanding by age; session adherence; the lead funnel; agreed vs billed per salesperson.
   - Tables: doctors, top medicines, the BDM summary.
   - At the bottom: **storage used**, the last backup, and whether each connection (WhatsApp, email, push, route estimates…) is working.
4. Every chart has **View as table** for exact numbers.

Today's numbers are live. Earlier days come from a nightly summary, so a bill changed today for last week shows up within the hour.

## 2. Alerts: phone and email (once)

1. **Admin → Notifications.**
2. For each kind of alert, tick **Phone** (rings the Android app) and/or **Email**. The bell in the CRM always shows every alert.
3. Click **Save**.
4. Emails go to the address on each person's login (**Admin → Users → Edit → Email**). People without an address get only the bell and the phone.

By default, "Storage filling up" and "Weekly backup reminder" are also emailed to the admins.

### The evening summary email

1. **Admin → Settings → Daily summary.**
2. **Send the daily summary**: on. **Send at**: 8:00 PM (change if you like).
3. **Also email the summary to**: up to 5 more addresses, separated by commas (for example the owner's personal email).
4. Click **Save**. Each evening the admins get an email with the day's billing, collections by mode, patients seen, new leads, BDM visits and anything that needs attention. The same short summary appears in the bell.

## 3. Sales targets (optional)

1. **Admin → Settings → Sales**: tick **Sales targets**, then **Save**.
2. Menu → **Targets**. Pick the month.
3. For each salesperson, type a target for **Converted**, **Agreed amount (₹)** and/or **Calls**, then click the save icon next to the box. Leave a box empty for no target.
4. Each salesperson sees a bar for each target on **My day** in the Android app. The sales manager can open **Targets** to watch progress but cannot change them.

## 4. Backups (every week, about 10 minutes)

The CRM's free plan keeps no backups you can restore, so these copies are the clinic's safety net. Keep the backup folder on a USB drive or an external disk, not only on the office computer.

### First time
1. Plug in the USB drive. Create a folder on it called `Clinic CRM backup`.
2. Open **Admin → Backup centre** in Chrome or Edge.
3. **1. Choose the backup folder** → **Choose folder** → pick `Clinic CRM backup` → **Allow** when the browser asks to let the site save there.

### Every week
1. **Admin → Backup centre.** Choose the same folder again if asked.
2. **Export the database** → wait until it says "Database exported: … tables ✓" (a minute or two). This copies every table (patients, bills, stock, leads…) into `database` and then today's date. If a week passes without this, the admins get a reminder on Monday morning.
3. **2. Copy files** → leave all kinds ticked → **Start backup**. Each file is downloaded, saved by kind and month, read back and checked. You can click **Stop** and carry on another day: the button then says **Carry on with the backup**, and nothing is copied twice.
4. **3. Check the copies** → **Check the folder** (once a month is enough). If a copy has changed or disappeared, the screen says so; run step 3 again and it is copied afresh.

The **Storage** card shows how full the database, the file store and this month's uploads are. You get an alert at 70%, 85% and 95%.

## 5. Freeing up cloud space (when storage passes 70%)

Recordings and visit photos take most of the space. Once they have a checked copy in the backup, they can be removed from the cloud.

1. First do a backup (section 4, steps 3 and 4).
2. **Admin → Backup centre → Free up cloud space.**
3. Tick the kinds (call recordings, visit recordings, voice notes, visit photos, day-start selfies) and a date: only files stored before it are removed (the default is three months ago).
4. **Show what can be removed.** The table shows what can go and what must stay because it has no checked copy yet.
5. **Remove … files from the cloud** → read the warning → confirm.

After this, those recordings can't be played on the website or the phone; open them from the backup folder instead. Patient records, scans, prescriptions and bills are **never** removed: the server refuses.

## 6. Importing and exporting with Excel

- **Download Excel** on the appointments, bills and leads tables saves what the filters show as an `.xlsx` file. Amounts are real numbers, so Excel can total them.
- **Admin → Import patients**, **Import opening stock** and **Leads → Import** accept an Excel file (`.xlsx`) or a CSV. **Download template (Excel)** gives a sheet with the right columns. Old `.xls` files must first be saved as **Excel Workbook (.xlsx)**.
- The BDM page's report and every import's problem list are Excel files too.
