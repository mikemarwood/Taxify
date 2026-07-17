import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.routes.js';
import categoriesRoutes from './routes/categories.routes.js';
import expensesRoutes, { purgeExpiredTrash } from './routes/expenses.routes.js';
import adminRoutes from './routes/admin.routes.js';
import appRoutes from './routes/app.routes.js';
import billingRoutes from './routes/billing.routes.js';
import exportRoutes from './routes/export.routes.js';
import { purgeUnactivatedAccounts, runBillingReminders } from './jobs/billingJobs.js';
import pool, { ensureSchema } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;
const isProd = process.env.NODE_ENV === 'production';

// Stripe requires the raw request body to verify webhook signatures, so this
// must be parsed before the global express.json() touches it.
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(cookieParser());
if (!isProd) {
  app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
}

app.use('/api/auth', authRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/app', appRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/export', exportRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.name === 'MulterError' || err?.message === 'Unsupported file type') {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

if (isProd) {
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use('/downloads', express.static(path.join(clientDist, 'downloads'), {
      setHeaders: (res) => res.set('Cache-Control', 'no-store'),
    }));
    app.use(express.static(clientDist));
    app.get(/^(?!\/api).*/, (req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }
}

try {
  await ensureSchema();
} catch (err) {
  console.error('Failed to connect to the database. Check DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME in server/.env');
  console.error(err);
  process.exit(1);
}

purgeExpiredTrash(pool).catch((err) => console.error('Failed to purge expired recycle bin entries', err));
setInterval(() => {
  purgeExpiredTrash(pool).catch((err) => console.error('Failed to purge expired recycle bin entries', err));
}, 60 * 60 * 1000);

purgeUnactivatedAccounts(pool).catch((err) => console.error('Failed to purge unactivated accounts', err));
setInterval(() => {
  purgeUnactivatedAccounts(pool).catch((err) => console.error('Failed to purge unactivated accounts', err));
}, 60 * 60 * 1000);

runBillingReminders(pool).catch((err) => console.error('Failed to run billing reminders', err));
setInterval(() => {
  runBillingReminders(pool).catch((err) => console.error('Failed to run billing reminders', err));
}, 6 * 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Taxify server listening on http://localhost:${PORT}`);
});
