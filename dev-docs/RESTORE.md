# Restoring from a backup

The weekly backup (dev-docs/OPERATIONS.md section 4) is only worth something if it can be put back. This page covers two things:

- **The restore drill** (once a month, about 10 minutes): proves the latest backup is complete and loads cleanly. Nothing changes anywhere.
- **The real restore** (only after a disaster, about 1 hour): puts the clinic's data into a new Supabase project.

Both need the developer computer, the one with this project and its `.env` file, and the backup USB drive.

---

## 1. The restore drill (monthly)

1. Plug in the backup USB drive.
2. In the CRM, do this week's **Export the database** first (Admin → Backup centre), so the drill tests a fresh copy.
3. Open a terminal in the project folder and run, with your own drive's path:
   ```
   pnpm restore:drill "/media/usb/Clinic CRM backup"
   ```
   On Windows the path looks like `"E:\Clinic CRM backup"`.
4. Wait 1–2 minutes. It ends with one of these:
   - **`✔ DRILL PASSED: this backup restores completely. Nothing was changed (rolled back).`** All good.
   - **`✖ the export is damaged`**: a file on the drive has changed or is missing. Run **Export the database** again and repeat. If it still fails, the drive may be faulty: copy the folder to a new drive.
   - **`✖ restore failed`**: the message says why. Send it to your developer.
5. The line starting **`• files:`** says how many stored files (scans, recordings, photos) have a good copy on the drive. If it says some are "without one yet", run **Copy files** in the Backup centre.

**What the drill does:**
1. It checks every exported table file against its fingerprint (SHA-256) in the manifest, and each file copy against the fingerprint taken when it was uploaded.
2. Inside one database transaction, it loads the whole export into the **staging** project (the online test copy, set as `DATABASE_URL` in `.env`).
3. It compares every row with the export, value for value.
4. It then cancels the transaction, so staging is left exactly as it was.

While the drill runs, staging is busy for about a minute. Never point `DATABASE_URL` at the clinic's live project for a drill.

---

## 2. The real restore (after a disaster)

Use this if the clinic's Supabase project is lost: deleted, its data corrupted, or the account gone. On the paid plan (Pro), first try **Supabase dashboard → Database → Backups → Restore**: it is quicker and loses at most a day. This section is for when that isn't possible.

### 2.1 Make the new project (about 15 minutes)
1. supabase.com → **New project**. Region **Mumbai (ap-south-1)**. Save the database password.
2. In `.env`, set `SUPABASE_PROJECT_REF` and `SUPABASE_DB_PASSWORD` to the **new** project's, and `DATABASE_URL` to its **Session pooler** connection string (Connect → Session pooler).
3. Run `pnpm deploy:supabase`. This creates all tables and server functions.
4. Run `pnpm supabase:configure`. This sets the secrets and timers.

### 2.2 Load the data (about 10 minutes)
1. In `.env`, fill section **10. RESTORE**:
   - `RESTORE_DATABASE_URL`: the new project's Session pooler connection string, the same as `DATABASE_URL` above.
   - `RESTORE_SUPABASE_URL` and `RESTORE_SERVICE_ROLE_KEY`: new project → **Settings → API**.
   - `RESTORE_TEMP_PASSWORD`: a temporary password of 10 or more characters. Every login gets it.
2. Before the restore, point `DATABASE_URL` back at the **staging** project. The script refuses to run if both addresses are the same.
3. Run:
   ```
   pnpm restore:drill "/media/usb/Clinic CRM backup" --commit
   ```
   It refuses if the new project already has patients. It ends with **`✔ database restored.`** and **`✔ … files uploaded`**.
4. Now point `DATABASE_URL` at the new project for good.

### 2.3 Reconnect everything (about 20 minutes)
1. **Vercel** → the project → Settings → Environment Variables: set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the new project's, then **Redeploy**.
2. **Android**: build and share a new app version (dev-docs/RELEASE_ANDROID.md) with the new project's address. Staff install it over the old app.
3. **WhatsApp**: update the webhook address in Meta (dev-docs/SETUP_WHATSAPP.md step "Webhook"). **Meta Lead Ads**: dev-docs/SETUP_META.md.
4. Log in as admin with the temporary password. Change your own password (user menu), then everyone else's (**Admin → Users → Edit**).
5. Spot-check: search a few patients, open a recent bill, play a recording.

**What is lost:** anything entered after the export you restored from. That is why the export is weekly and the drill is monthly.

---

## Good to know
- A drill or restore never needs the internet for the backup itself: everything comes from the drive.
- Older exports stay on the drive. To use one, add `--stamp <folder name>` (the folders are in `database/` on the drive).
- Recordings removed from the cloud with **Free up cloud space** come back from the drive in a real restore, as long as their copy is there.
