/**
 * Data-Agent backend: HTTP server, health check, static frontend (when built).
 * Port: DATABRICKS_APP_PORT (when deployed as Databricks App) or PORT for local.
 */
// Suppress Node's punycode deprecation from dependencies (e.g. URL/fetch); harmless.
process.on('warning', (w) => {
  if (w.name === 'DeprecationWarning' && w.message && w.message.includes('punycode')) return;
  console.warn(w);
});

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env from project root (Data-Agent/) so it works whether you run from root or backend/
const projectRoot = path.join(__dirname, '../..');
dotenv.config({ path: path.join(projectRoot, '.env') });

import express from 'express';
import cors from 'cors';
const PORT = Number(process.env.DATABRICKS_APP_PORT) || Number(process.env.PORT) || 3000;
const app = express();

app.use(cors());
app.use(express.json());

// Health check (databricksConfigured helps debug .env loading)
app.get('/health', async (req, res) => {
  const { isConfigured } = await import('./databricks/client.js');
  const configured = isConfigured();
  if (!configured) {
    console.log('[health] process.env at request time: HOST=', !!process.env.DATABRICKS_HOST, 'TOKEN=', !!process.env.DATABRICKS_TOKEN, 'PATH=', !!process.env.DATABRICKS_WAREHOUSE_HTTP_PATH);
  }
  res.json({ ok: true, databricksConfigured: configured });
});

import queryRoutes from './routes/query.js';
import chatRoutes from './routes/chat.js';
import adminRoutes from './routes/admin.js';
app.use('/api/query', queryRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes);

// Serve built frontend in production (when frontend/dist exists)
const publicPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(publicPath));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/health') return next();
  res.sendFile(path.join(publicPath, 'index.html'), (err) => {
    if (err) next();
  });
});

app.listen(PORT, () => {
  console.log(`Data-Agent backend listening on http://localhost:${PORT}`);
});
