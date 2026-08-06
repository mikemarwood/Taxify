# Taxify

A multi-user tax deduction tracker — log a purchase, attach the receipt, pick a category. Every new account starts with the same default categories (General, Training, Tooling, Electronics, Home Rental, Business, Other).

## Stack

- **Server**: Node.js + Express + MariaDB/MySQL (via `mysql2`)
- **Client**: React + Vite, `framer-motion` for animations
- **Auth**: bcrypt-hashed passwords, JWT in an httpOnly cookie, optional email OTP login (2FA)
- **Uploads**: local disk (`server/uploads/`), served back only to the owning user

## Database setup

Taxify needs a MariaDB or MySQL database and a user that can access it. Create both first:

```sql
CREATE DATABASE taxify CHARACTER SET utf8mb4;
CREATE USER 'taxify'@'localhost' IDENTIFIED BY '<a-strong-generated-password>';
GRANT ALL PRIVILEGES ON taxify.* TO 'taxify'@'localhost';
FLUSH PRIVILEGES;
```

Run that via the `mysql`/`mariadb` CLI, or through your host's control panel (e.g. CyberPanel's "Databases" section) if it offers one. The app creates its own tables automatically on first start — no separate migration step.

## Local development

Requires Node.js 18+ and a reachable MariaDB/MySQL instance.

```bash
npm install                       # root tooling (concurrently)
npm install --prefix server       # server deps
npm install --prefix client       # client deps

cp .env.example server/.env
# edit server/.env: set a real JWT_SECRET and your DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME

npm run dev                       # runs the API on :4000 and Vite on :5173
```

Open http://localhost:5173, register an account, and start tracking.

## Production build

```bash
npm run build                     # builds client/dist
npm run start                     # serves API + built client from one Express process
```

By default the server listens on the `PORT` env var (falls back to 4000). Set `NODE_ENV=production` so cookies are marked `Secure` and the built client is served.

## Deploying on Linux with PM2 (port 3004)

```bash
git clone <this-repo> taxify
cd taxify
npm install --prefix server
npm install --prefix client
cp .env.example server/.env      # set a real JWT_SECRET and DB_* credentials
npm run build

pm2 start ecosystem.config.cjs   # runs as "taxify" on port 3004
pm2 save
```

Run the above as your app's dedicated Linux user (not root) so the process and its `server/uploads/` files are owned by that account. Put a reverse proxy (nginx/OpenLiteSpeed/Caddy) in front of port 3004 for TLS if this is exposed to the internet.

## Importing historical spreadsheet data

`server/src/scripts/importLegacy.js` is a one-off CLI — it is never called by the running app. It reads a folder of `Tax *.xlsx` files (the same shape as Mike's own tax-tracking spreadsheets: one sheet per category, "Recurring Payments"/"Single Payments" sections) and inserts the entries into a Taxify account.

```bash
node server/src/scripts/importLegacy.js "<path-to-folder-with-xlsx-files>" someone@example.com "Full Name" "SomeStrongPassw0rd"
```

- If the account already exists, omit the name/password and it imports into that account.
- Sheets named General/Training/Tooling/Electronics/Home Rental map to those default categories; any other sheet name (e.g. a business name) is imported under "Business".
- The `Outcome` sheet (an income summary) is skipped — only expense sheets are imported.

No transaction data from these spreadsheets is ever committed to source control — the script only reads whatever `.xlsx` files you point it at, locally, and writes straight to your (already-configured) database via `DB_*` in `server/.env`.

## Email login codes (MFA)

Every account requires a 4-digit email code at login — it cannot be turned off, for new or
existing users. A code emailed to the user expires after 5 minutes, and 3 wrong attempts locks
that account's login for 60 minutes.

**This requires SMTP to be configured in `server/.env`** (`SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM`,
see `.env.example`) **before deploying** — since MFA is mandatory, every login attempt will fail
with a "could not send code" error for every user until SMTP is set up correctly.

Logging in also offers a "this is a public device" checkbox, which uses a browser session
cookie instead of a persistent one, so the user is signed out as soon as the browser window closes.

## Android app

`client/android/` is a Capacitor wrapper that loads the live site (`https://taxify.mikesapphub.com`)
inside a native shell — a real installable app, not a rebuild of the UI. It ships with:

- A branded splash screen (`SplashActivity`): animated logo, "Taxify", and "Powered by Mikes App Hub",
  fading into the app.
- An in-app update checker: on every resume, `MainActivity` calls `GET /api/app/version`; if the
  server's `versionCode` is newer than the installed build, it shows a notification + dialog with an
  **Update** button that downloads and launches the Android installer for the new APK.
- A native notification channel (`NotificationHelper`), currently used for the update alert — reusable
  for future triggers.

**Building the APK** requires Android Studio (not available on this machine — no JDK/Android SDK here,
so this project was scaffolded and hand-written but never compiled). To build it:

```bash
cd client
npm install
npm run build          # produces dist/, used as the offline fallback + copies public/downloads/
npx cap sync android    # only needed after changing capacitor.config.json or web assets
```

Then open `client/android` in Android Studio and **Build → Generate Signed Bundle / APK**.

**Shipping an update** — the download button on the login page and the in-app update checker both
always point at the same file, so releasing is just:

1. Bump `versionCode`/`versionName` in `client/android/app/build.gradle`
2. Bump the matching values in `server/src/app-version.json`, **and** `appendUserAgent` in
   `client/capacitor.config.json` (`TaxifyAndroid/<versionCode>`) — that string is how a running app
   knows which build it is, so an update prompt that never appears is almost always this step missed
3. Build + sign the release APK in Android Studio
4. Copy it to `client/public/downloads/taxify.apk` (overwrite)
5. `npm run build` (client) and deploy as usual — both the button and in-app checker pick it up automatically, and `/downloads/*` is served with `Cache-Control: no-store` so nothing caches a stale build.

Only ever one APK exists on the server. The filename never changes, so there is no old build to
serve by mistake and nothing to clean up; `app-version.json` is the only thing that says which build
that file is.

There are two independent update paths, and the difference matters:

- **The web app inside the shell updates itself.** `capacitor.config.json` points at the live site, so
  every launch loads whatever was last deployed. Almost all changes ship this way, with nothing for
  anyone to install.
- **The native shell prompts.** Android does not let a sideloaded app install over itself silently —
  a new APK always requires the person to confirm. `AppUpdateBanner.jsx` compares the running build
  against `/api/app/version` every six hours and offers the download; "Later" is remembered per
  version so the same prompt is not asked twice.

### Push notifications

Every notification is written to the `notifications` table and shown in the app's bell, whether or not
push is configured — the record is the notification, and push is only how it gets someone's attention.

To also raise them in the Android notification tray:

1. Create a Firebase project and add an Android app with the id `com.mikesapphub.taxify`.
2. Download `google-services.json` into `client/android/app/`. **Not currently present** — the Google
   Services Gradle plugin is applied conditionally (`client/android/app/build.gradle`), so the build
   works without it and simply has no push.
3. In Firebase, **Project settings → Service accounts → Generate new private key**, then paste the
   downloaded JSON into **Administration → Push notifications** in the app. "Send myself a test" runs
   the whole chain and says exactly which part is missing.

The device token is registered by `client/src/lib/pushNotifications.js` after login and stored in
`device_tokens`; tokens Google reports as dead are deleted rather than retried.

## Plans

Two, and the only thing that differs is how many sets of books an account may hold:

| Plan | Individual | Businesses |
|---|---|---|
| Individual | 1 | 0 |
| Small Business | 1 | up to 2 |

**One person per account.** There used to be a Family plan with a second full login, and it could not
work: `tax_years`, `vehicle_trips` and `home_office_hours` are keyed to the account holder, so a
household had exactly one 2025-2026 row between two people with two jobs. Whoever recorded a refund
second overwrote the first, and finalising the year locked the other person out of editing their own
expenses. Two people means two accounts.

The rule lives in [planLimits.js](server/src/lib/planLimits.js) and is enforced at the one place
entities are created. Two things about it are deliberate:

- **An unknown `planType` gets the smallest allowance, never the largest.** `plan_type` is a free
  VARCHAR with no constraint, so a typo or a half-finished rename must not be a way to get more than
  was paid for.
- **Only creation is capped.** An account already over its limit keeps everything — nothing is
  deleted or hidden because a price changed. Archived businesses still count, or the cap would be one
  archive away from meaningless.

The Stripe price for Small Business falls back to the old Family price setting when
`stripe_*_price_business` is empty, so the rename needed no billing change.

## Sets of books

An account holds one **Individual** and, on Small Business, up to two businesses. An expense belongs
to exactly one of them, and that is what decides whether it is asked for a business-use percentage —
personal records never are.

- Managed on the **Categories** page, and switched from the picker at the top of the nav. The picker
  is hidden entirely while an account has only one set of books, so an account that has never made a
  business sees nothing new.
- **Everything** is a combined view. It is a way of looking, not a place to file, so reads allow it
  and writes refuse it — the expense form asks which books instead.
- The selection travels as an `X-Taxify-Entity` header on every request. Downloads carry
  `?entityId=` instead, because an `<a href>` cannot set a header, and the year archive refuses to
  build without it when there is more than one set of books.

**Lodgement.** Each set of books files either annually or quarterly. Quarters derive from the
account's own financial-year start, so an Australian business gets Jul–Sep / Oct–Dec / Jan–Mar /
Apr–Jun and a British one gets 6 Apr–5 Jul. Nothing hard-codes a deadline: an AU BAS due date is 28
days after quarter end *except* Q2, and the UK differs again, so if deadlines are ever wanted they
belong in admin-managed data like `tax_rates` rather than in code that goes stale silently.

**Receipts do not move.** The default entity's `path_segment` is NULL, so every path it produces is
byte-for-byte what it was before entities existed — asserted by the first test in
`receiptStorage.test.js`. Only additional businesses get a folder of their own:

```
uploads/<userId>/receipts/2025-2026/tooling/          ← Individual, unchanged
uploads/<userId>/receipts/marwood-plumbing/2025-2026/tooling/
```

A business's segment is fixed when it is created and never changed, so renaming a business cannot
move a file. The split also fixes a real bug: two businesses could each hold a "Tooling" in one
year, and renaming one would have moved the other's receipts while repointing only its own rows.

## Accountants

An accountant is not a role somebody has instead of being a normal user — it is
simply **having clients**. One login covers every client, and an account holder
who also does someone else's books is one login wearing both hats.

Three separate things, deliberately kept apart:

| | What it is | Table |
|---|---|---|
| **Invitation** | An offer. Grants nothing; nothing that decides access consults it. Lasts **24 hours**, then it is deleted and the client is emailed. | `accountant_invites` |
| **Login** | Created only when somebody accepts. Their own address, their own password, `account_holder_id` NULL. | `users` |
| **Assignment** | The grant itself, and the only thing the read path consults. | `accountant_assignments` |

**The flow.** The client invites by email from Account → Family. If that address
already has a Taxify login they are granted access immediately and told; if not,
they get an invitation link and set up an accountant login by completing name,
practice or firm, optional phone, and a password. Either way they end up on
`/clients`, pick a client, and that first open is what starts the clock.

**The window** is the client's choice at grant time — 24, 48, 72 or 96 hours —
and starts on **first open**, not when it was granted, so an invitation sent on
a Friday is still good on Monday. The client can change the years, change the
length, or hand out a fresh window from **Manage**, without revoking and
re-inviting. Narrowing takes effect on the accountant's very next request.

**Two-factor is required** of anyone acting for clients, whatever
`mfa_mode` says, and cannot be switched off while any client is assigned. It is
enforced in two places: the door at `POST /auth/clients/:ownerId` refuses before
the clock starts, and `requireAuth` drops the client from the session — before
the year rule, entity and `accessLocked` resolve against it, so every scope
function behaves as though no client is open.

> Deploying that gate blocks every accountant whose `otp_enabled` is 0, and they
> find out mid-job. Run this first and warn them:
> ```sql
> SELECT DISTINCT u.email, u.name FROM accountant_assignments a
> JOIN users u ON u.id = a.accountant_user_id WHERE u.otp_enabled = 0;
> ```

**Both ends are announced.** Invited, granted, accepted, first open, changed,
revoked, expired, and the client's account being deleted all produce an email, a
notification, or both. The way in was always announced and the way out never
was, so a client simply vanished from the list.

Two things to know before changing this code:

- **`expires_at IS NULL` means *not opened yet*, not expired.** Invert it and you
  either lock every accountant out or never expire anything.
- **An invitation token proves control of a mailbox and nothing more.** It may
  create a login; it may never write to one. An address that already has an
  account is *linked*, never given a new password — otherwise forwarding an
  invitation email is account takeover. `accountantInvites.test.js` has a test
  whose only job is to fail if that branch ever changes.

## Notes

- `server/src/scripts/importLegacy.js` depends on the `xlsx` package, which has a known unpatched advisory (prototype pollution / ReDoS). It's only used for this offline import of trusted local files, never on the request path of the running server.
- `npm audit` reports two things that are deliberately left alone, so they aren't mistaken for oversights:
  - **`xlsx`** — no fixed version exists. See above; it never touches a request.
  - **`react-router`** — the advisory is an RSC-mode CSRF bypass. This app is a Vite SPA using `BrowserRouter` with no React Server Components and no router actions, so the affected code never runs. `npm audit fix` can't resolve it either: the advisory covers 7.12.0–8.2.0 and the latest published `react-router-dom` is 7.18.2, so there is nothing to upgrade to. Revisit when one ships.
- `server/package.json` overrides `uuid` to 11 because the version `exceljs` asks for carries an advisory. exceljs only calls `v4()`, whose signature is unchanged — and `src/lib/spreadsheet.test.js` round-trips a real workbook so the override can't break the export quietly.
- The server refuses to start if it can't reach the database — check `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` in `server/.env` if you see a connection error on startup.
