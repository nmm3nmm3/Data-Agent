/**
 * Query API: MRRpV and future metrics.
 */
import express from 'express';
import { getMRRpV, getBridgeMRRpV } from '../queries/mrrpv.js';
import { logUsage } from '../storage/usage.js';

const router = express.Router();

/**
 * POST /api/query/mrrpv
 * Body: { dataSource?, timeWindow?, groupBy?, filters?, includeProduct?, viewType?: 'bridge', presetId? }
 * When viewType === 'bridge' or presetId === 'first-purchase-bridge', runs bridge query instead.
 */
router.post('/mrrpv', async (req, res) => {
  const start = Date.now();
  try {
    const body = req.body || {};
    const { dataSource, timeWindow, groupBy, filters, includeProduct, includeAccountCount, includeAvgDealSize, viewType, presetId } = body;
    const useBridge = viewType === 'bridge' || presetId === 'first-purchase-bridge';
    const result = useBridge
      ? await getBridgeMRRpV({ timeWindow, filters: filters || {} })
      : await getMRRpV({ dataSource, timeWindow, groupBy, filters, includeProduct, includeAccountCount, includeAvgDealSize });
    logUsage({
      message: 'POST /api/query/mrrpv',
      toolCalls: [{ name: useBridge ? 'get_bridge_mrrpv' : 'get_mrrpv', args: useBridge ? { time_window: timeWindow, ...filters } : { time_window: timeWindow, group_by: groupBy, include_product: includeProduct, include_account_count: includeAccountCount, include_avg_deal_size: includeAvgDealSize, ...filters } }],
      rowCount: result.rows?.length,
      latencyMs: Date.now() - start,
      success: true,
    });
    res.json(result);
  } catch (err) {
    console.error('MRRpV query error:', err.message);
    logUsage({
      message: 'POST /api/query/mrrpv',
      toolCalls: [],
      latencyMs: Date.now() - start,
      success: false,
    });
    res.status(err.message?.includes('Invalid') ? 400 : 500).json({
      error: err.message || 'Query failed',
    });
  }
});

/**
 * GET /api/query/mrrpv?dataSource=...&timeWindow=...&groupBy=...&includeProduct=...&region=...&segment=...
 */
router.get('/mrrpv', async (req, res) => {
  const start = Date.now();
  try {
    const dataSource = req.query.dataSource || undefined;
    const timeWindow = req.query.timeWindow || undefined;
    const groupBy = req.query.groupBy || undefined;
    const includeProduct = req.query.includeProduct || undefined;
    const includeAccountCount = req.query.includeAccountCount === 'true' || req.query.includeAccountCount === '1';
    const includeAvgDealSize = req.query.includeAvgDealSize === 'true' || req.query.includeAvgDealSize === '1';
    const filters = {};
    if (req.query.region) filters.region = req.query.region;
    if (req.query.segment) filters.segment = req.query.segment;
    const result = await getMRRpV({ dataSource, timeWindow, groupBy, filters, includeProduct, includeAccountCount, includeAvgDealSize });
    logUsage({
      message: 'GET /api/query/mrrpv',
      toolCalls: [{ name: 'get_mrrpv', args: { time_window: timeWindow, group_by: groupBy, include_product: includeProduct, include_account_count: includeAccountCount, include_avg_deal_size: includeAvgDealSize, ...filters } }],
      rowCount: result.rows?.length,
      latencyMs: Date.now() - start,
      success: true,
    });
    res.json(result);
  } catch (err) {
    console.error('MRRpV query error:', err.message);
    logUsage({
      message: 'GET /api/query/mrrpv',
      toolCalls: [],
      latencyMs: Date.now() - start,
      success: false,
    });
    res.status(err.message?.includes('Invalid') ? 400 : 500).json({
      error: err.message || 'Query failed',
    });
  }
});

export default router;
