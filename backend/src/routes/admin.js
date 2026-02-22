/**
 * Admin API: config (system prompt, model, etc.) and usage stats.
 * Optional: require ADMIN_SECRET header for write operations.
 */
import express from 'express';
import { loadConfig, saveConfig } from '../storage/config.js';
import { getRecentUsage, getUsageStats } from '../storage/usage.js';
import { getTools } from '../agent/tools.js';

const router = express.Router();

function checkAdmin(req) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return true;
  const header = req.headers['x-admin-secret'] || req.body?.adminSecret;
  return header === secret;
}

/**
 * GET /api/admin/config — get current model config
 */
router.get('/config', (req, res) => {
  if (!checkAdmin(req)) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  const config = loadConfig();
  res.json(config);
});

/**
 * PUT /api/admin/config — update system prompt, model id, temperature, max tokens
 */
router.put('/config', (req, res) => {
  if (!checkAdmin(req)) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  const allowed = ['systemPrompt', 'modelId', 'temperature', 'maxTokens'];
  const updates = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }
  const config = saveConfig(updates);
  res.json(config);
});

/**
 * GET /api/admin/usage — recent requests and stats
 */
router.get('/usage', (req, res) => {
  if (!checkAdmin(req)) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const recent = getRecentUsage(limit);
  const stats = getUsageStats();
  res.json({ recent, stats });
});

/**
 * GET /api/admin/tools — tool definitions (for admin reference)
 */
router.get('/tools', (req, res) => {
  if (!checkAdmin(req)) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  const tools = getTools();
  res.json({ tools });
});

export default router;
