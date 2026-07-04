import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.routes.js';
import categoriesRoutes from './routes/categories.routes.js';
import expensesRoutes from './routes/expenses.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;
const isProd = process.env.NODE_ENV === 'production';

app.use(express.json());
app.use(cookieParser());
if (!isProd) {
  app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
}

app.use('/api/auth', authRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/expenses', expensesRoutes);

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
    app.use(express.static(clientDist));
    app.get(/^(?!\/api).*/, (req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }
}

app.listen(PORT, () => {
  console.log(`Taxify server listening on http://localhost:${PORT}`);
});
