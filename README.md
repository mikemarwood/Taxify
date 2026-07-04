# Taxify

A multi-user tax deduction tracker — log a purchase, attach the receipt, pick a category. Every new account starts with the same default categories (General, Training, Tooling, Electronics, Home Rental, Business, Other).

## Stack

- **Server**: Node.js + Express + `better-sqlite3` (single file database, no separate DB service to run)
- **Client**: React + Vite, `framer-motion` for animations
- **Auth**: bcrypt-hashed passwords, JWT in an httpOnly cookie
- **Uploads**: local disk (`server/uploads/`), served back only to the owning user

## Local development

Requires Node.js 18+.

```bash
npm install                       # root tooling (concurrently)
npm install --prefix server       # server deps
npm install --prefix client       # client deps

cp .env.example server/.env
# edit server/.env and set a real JWT_SECRET (see the comment in the file for how to generate one)

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
cp .env.example server/.env      # set a real JWT_SECRET
npm run build

pm2 start ecosystem.config.cjs   # runs as "taxify" on port 3004
pm2 save
```

Run the above as the `mike1118` Linux user (or `pm2 start` under that user's own PM2 daemon) so the process, its `server/uploads/` files, and `server/data/taxify.db` are all owned by that account. Put a reverse proxy (nginx/Caddy) in front of port 3004 for TLS if this is exposed to the internet.

## Importing historical spreadsheet data

`server/src/scripts/importLegacy.js` is a one-off CLI — it is never called by the running app. It reads a folder of `Tax *.xlsx` files (the same shape as Mike's own tax-tracking spreadsheets: one sheet per category, "Recurring Payments"/"Single Payments" sections) and inserts the entries into a Taxify account.

```bash
node server/src/scripts/importLegacy.js "<path-to-folder-with-xlsx-files>" someone@example.com "Full Name" "SomeStrongPassw0rd"
```

- If the account already exists, omit the name/password and it imports into that account.
- Sheets named General/Training/Tooling/Electronics/Home Rental map to those default categories; any other sheet name (e.g. a business name) is imported under "Business".
- The `Outcome` sheet (an income summary) is skipped — only expense sheets are imported.

No transaction data from these spreadsheets is ever committed to source control — the script only reads whatever `.xlsx` files you point it at, locally, and writes straight to the git-ignored SQLite database.

## Notes

- `server/src/scripts/importLegacy.js` depends on the `xlsx` package, which has a known unpatched advisory (prototype pollution / ReDoS). It's only used for this offline import of trusted local files, never on the request path of the running server.
