/**
 * Views API: preset view list for first-purchase MRRpV.
 * GET /api/views — returns id, label, description, defaultParams, overridable for each preset.
 */
import express from 'express';
import { getViews } from '../views/first-purchase-views.js';

const router = express.Router();

/**
 * GET /api/views
 * Returns list of preset views (templates) with default params and overridable param names.
 * Frontend and agent use this to run a preset via the query API with optional overrides.
 */
router.get('/', (req, res) => {
  try {
    const views = getViews();
    res.json(views);
  } catch (err) {
    console.error('Views list error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to list views' });
  }
});

export default router;
