/**
 * Views API: preset view list for first-purchase MRRpV.
 * GET /api/views — returns id, label, description, defaultParams, overridable for each preset.
 * POST /api/views/run-default — run a preset with default params and no filters (hard-coded restore unfiltered).
 */
import express from 'express';
import { getViews } from '../views/first-purchase-views.js';
import { getMRRpV, getBridgeMRRpV, getASPInvestigation } from '../queries/mrrpv.js';

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

/**
 * POST /api/views/run-default
 * Body: { presetId: string, dataSource?: string }
 * Runs the preset with its default params and no filters (no row filters, no include_product).
 * Returns the same shape as a chat lastResult plus querySummary so the frontend can display the table without using the LLM.
 */
router.post('/run-default', async (req, res) => {
  try {
    const { presetId, dataSource: rawSource } = req.body || {};
    if (!presetId || typeof presetId !== 'string') {
      res.status(400).json({ error: 'presetId is required' });
      return;
    }
    const views = getViews();
    const preset = views.find((v) => v.id === presetId);
    if (!preset) {
      res.status(400).json({ error: `Unknown preset: ${presetId}` });
      return;
    }
    const dp = preset.defaultParams || {};
    const dataSource = (rawSource && String(rawSource).toLowerCase()) || dp.dataSource || 'first_purchase';
    const timeWindow = dp.timeWindow ?? dp.time_window ?? undefined;
    const isBridge = presetId === 'first-purchase-bridge' || dp.viewType === 'bridge';
    const isASP = presetId === 'asp-investigation' || dp.viewType === 'asp';
    const filters = {};
    if (isBridge) {
      const result = await getBridgeMRRpV({ timeWindow, filters });
      const querySummary = {
        tool: 'get_mrrpv',
        dataSource,
        time_window: timeWindow,
        group_by: undefined,
        viewType: 'bridge',
      };
      res.json({
        data: result.data,
        columns: result.columns,
        rowCount: result.rows?.length ?? 0,
        overall: undefined,
        viewType: 'bridge',
        grandTotals: result.grandTotals,
        querySummary,
      });
    } else if (isASP) {
      const products = Array.isArray(dp.products) && dp.products.length > 0 ? dp.products : ['cm', 'vg', 'aim4'];
      const result = await getASPInvestigation({ timeWindow, products, filters });
      const querySummary = {
        tool: 'get_mrrpv',
        dataSource,
        time_window: timeWindow,
        viewType: 'asp',
        products,
      };
      res.json({
        data: result.data,
        columns: result.columns,
        rowCount: result.rows?.length ?? 0,
        overall: undefined,
        viewType: 'asp',
        grandTotals: undefined,
        querySummary,
      });
    } else {
      const groupBy = dp.groupBy ?? dp.group_by ?? undefined;
      const result = await getMRRpV({
        dataSource,
        timeWindow,
        groupBy,
        filters,
        includeProduct: undefined,
        includeAccountCount: dp.includeAccountCount ?? true,
        includeAvgDealSize: dp.includeAvgDealSize ?? false,
      });
      const querySummary = {
        tool: 'get_mrrpv',
        dataSource,
        time_window: timeWindow,
        group_by: groupBy || undefined,
      };
      res.json({
        data: result.data,
        columns: result.columns,
        rowCount: result.rows?.length ?? 0,
        overall: result.overall,
        viewType: undefined,
        grandTotals: undefined,
        querySummary,
      });
    }
  } catch (err) {
    console.error('Run-default error:', err.message);
    res.status(err.message?.includes('Invalid') || err.message?.includes('required') ? 400 : 500).json({
      error: err.message || 'Run failed',
    });
  }
});

export default router;
