# Setup guide

Step by step. Copy each grey box into the terminal and press **Enter**.

To open a terminal in VS Code: menu **Terminal → New Terminal**. It opens in the project folder.

---

## Part 1 — Run the app on this computer

### 1.1 Install Docker (one time)

Docker runs a private copy of the database on your computer. **This is the one step still missing on this PC.**

**CachyOS / Arch Linux:**
```bash
sudo pacman -S --needed docker docker-compose docker-buildx
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```
Then **log out of the computer and log back in** (so the last line takes effect). Check it works:
```bash
docker run --rm hello-world
```
You should see "Hello from Docker!".

**Windows or Mac:** install **Docker Desktop** from docker.com, open it once and wait until it says "Engine running".

### 1.2 Install the project's tools (one time, and after each update)
```bash
pnpm install
```

### 1.3 Start the database
```bash
pnpm db:start
```
- **First time:** it downloads about 2 GB and takes 5–15 minutes.
- When it finishes it prints a list with **API URL** and **anon key** (also shown as "publishable key").

### 1.4 Create your keys file (one time)

All keys live in **one file at the project root: `.env`**. It is never committed to git.
```bash
cp .env.example .env
pnpm env:sync
```
- The local values already in it work with `pnpm db:start`. You don't need to change anything to run on this PC.
- `.env` is split into numbered sections, and each one says which phase needs it. Fill a section when its phase starts, then run `pnpm env:sync` again.
- `pnpm env:sync` copies each key only where it's needed: browser-safe keys to the web app, secrets to the server functions. It refuses to put a secret key into the web app.

### 1.5 Load the fake test data
```bash
pnpm db:reset
```
This rebuilds the database from scratch and loads fake staff. **It erases everything in the local database**, which is fine because it is only test data.

### 1.6 Open the app
```bash
pnpm dev
```
Open **http://localhost:3000** in Chrome or Edge.

### 1.7 Test logins (fake people, local only)

Every login is a **username + password** (no email, no codes). All passwords: **`Pearl@2026`**

| Username | Role | What you should see |
|---|---|---|
| `admin` | Admin | Home + **Admin** pages in the menu |
| `reception` | Receptionist | Home |
| `reception2` | Receptionist | Home |
| `manager` | Sales manager | Home |
| `sales` | Sales executive | "Please use the mobile app" |
| `bdm` | BDM | "Please use the mobile app" |

Forgot a password? The admin sets a new one: **Admin → Staff logins → Password**.

To stop everything: press **Ctrl + C** in the terminal running `pnpm dev`, then:
```bash
pnpm db:stop
```

---

## Part 2 — Online test copy ("staging")

You need these accounts before you can try each phase on the internet. All have free plans. Use the clinic's own email so the clinic owns the accounts.

### 2.1 Supabase (database + logins)
1. Go to **supabase.com** → **Start your project** → sign up.
2. Click **New project**.
   - Name: `pearl-staging`
   - Database password: click **Generate a password**, then save it somewhere safe (a password manager).
   - Region: **South Asia (Mumbai)**
   - Plan: **Free**
3. Wait about 2 minutes until the project is ready.
4. Go to **Project Settings → API**. Put the **Project URL** and the **anon / publishable key** in `.env` **section 1**. Never use the service_role / secret key there.
5. Go to **Account → Access Tokens → Generate new token**. Put the token, the project ref (the part before `.supabase.co`) and your database password in `.env` **section 9**.

### 2.2 Tigris (private files: prescriptions, recordings) — done 23/10/2026
Account: the clinic's sales Gmail, organisation "pearlasthetic.sales org". Bucket **`pearl-staging`**: private, stored in Singapore (Tigris has no India location), uploads allowed only from the web app's own address.

To redo it (for example for production, with `pearl-prod`):
1. Log the Tigris tool in. A browser tab opens; check the code matches and click **Confirm**:
   ```bash
   pnpm exec tigris login
   ```
2. Create the bucket and allow uploads from the web app's address:
   ```bash
   pnpm exec tigris buckets create pearl-staging --access private --locations sin
   pnpm exec tigris buckets set-cors pearl-staging --origins http://localhost:3000 --methods GET,HEAD,PUT --headers content-type --expose-headers ETag --override
   ```
   For more than one address, separate them with commas: `--origins http://localhost:3000,https://your-app.vercel.app`.
3. Create a key that only works on that bucket. This writes it straight into `.env` section 2 without showing it:
   ```bash
   pnpm exec tigris access-keys create pearl-staging-functions --bucket pearl-staging --role Editor --export | pnpm -s env:set TIGRIS_STORAGE_ACCESS_KEY_ID=STORAGE_ACCESS_KEY_ID TIGRIS_STORAGE_SECRET_ACCESS_KEY=STORAGE_SECRET_ACCESS_KEY
   pnpm env:sync
   ```
4. Test it. Every line should show ✔:
   ```bash
   pnpm storage:check
   ```

### 2.3 Brevo (login emails: password reset, invites)
1. Go to **brevo.com** → sign up (free: 300 emails/day).
2. Go to **SMTP & API → SMTP**. Put the **server**, **port**, **login** and **SMTP key** in `.env` **section 4**.
3. Add the clinic's domain under **Senders, Domains & Dedicated IPs → Domains** and follow the DNS steps. This stops emails landing in spam. It needs your domain's DNS access (question 14 in PLAN.md).

### 2.4 Vercel (hosting the web app) — before go-live
Covered in a later phase, once you decide question 3 in PLAN.md (Vercel Pro or Cloudflare).

---

## Part 3 — Common problems

| Problem | Fix |
|---|---|
| `pnpm db:start` says Docker is not running | Linux: run `sudo systemctl start docker`. Windows/Mac: open Docker Desktop and wait for "Engine running" |
| `permission denied ... docker.sock` | You skipped the log-out/log-in after `usermod` in step 1.1 |
| The login page says "Can't reach the server" | The database isn't running. Run `pnpm db:start` |
| You can log in but are sent back to the login page with "account is not active" | That staff member was deactivated. An admin can reactivate them |
| Port 54321 or 3000 already in use | Another program is using it. Restart the computer, or stop the other app |
