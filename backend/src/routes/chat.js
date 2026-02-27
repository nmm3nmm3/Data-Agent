/**
 * Chat/agent API: POST /api/chat with user message, returns reply + last query result.
 */
import express from 'express';
import { runAgent } from '../agent/loop.js';
import { logUsage } from '../storage/usage.js';

const router = express.Router();

const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE) || 0;
const rateLimitTimestamps = new Map(); // key -> [timestamps]

function checkRateLimit(key) {
  if (RATE_LIMIT_PER_MINUTE <= 0) return null;
  const now = Date.now();
  const oneMinAgo = now - 60000;
  let ts = rateLimitTimestamps.get(key) || [];
  ts = ts.filter((t) => t > oneMinAgo);
  if (ts.length >= RATE_LIMIT_PER_MINUTE) return 'Too many requests; try again in a minute.';
  ts.push(now);
  rateLimitTimestamps.set(key, ts);
  return null;
}

// In-memory conversation store by session/conversation id (for refinement flow). Key = conversationId.
const conversations = new Map();

/**
 * POST /api/chat
 * Body: { message: string, conversationId?: string, dataSource?: 'fleet'|'first_purchase'|'upsell', currentView?: { presetId?, label?, time_window?, group_by?, region?, segment? } }
 * Response: { reply, lastResult?: { data, columns, rowCount }, toolCalls?, querySummary?, conversationId }
 */
router.post('/', async (req, res) => {
  try {
    const { message, conversationId: id, dataSource, currentView } = req.body || {};
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message is required' });
      return;
    }
    const conversationId = id || `conv-${Date.now()}`;
    const rateKey = conversationId || (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'anon');
    const rateErr = checkRateLimit(rateKey);
    if (rateErr) {
      res.status(429).json({ error: rateErr });
      return;
    }
    const history = conversations.get(conversationId) || [];
    history.push({ role: 'user', content: message.trim() });

    const start = Date.now();
    let reply, toolCalls, lastResult, lastToolError;
    let success = true;
    try {
      const out = await runAgent({ messages: history, dataSource, currentView });
      reply = out.reply;
      toolCalls = out.toolCalls;
      lastResult = out.lastResult;
      lastToolError = out.lastToolError;
    } catch (err) {
      success = false;
      reply = err.message || 'Agent failed';
      toolCalls = [];
      lastResult = null;
      throw err;
    } finally {
      logUsage({
        sessionId: conversationId,
        message: message.trim().slice(0, 500),
        toolCalls: toolCalls || [],
        rowCount: lastResult?.rowCount,
        latencyMs: Date.now() - start,
        success,
      });
    }

    history.push({ role: 'assistant', content: reply });
    conversations.set(conversationId, history);

    // Build query summary for transparency (first get_mrrpv call)
    const mrrpvCall = toolCalls?.find((t) => t.name === 'get_mrrpv');
    const querySummary = mrrpvCall
      ? {
          tool: 'get_mrrpv',
          dataSource: dataSource || 'fleet',
          time_window: mrrpvCall.args?.time_window,
          group_by: mrrpvCall.args?.group_by,
          include_product: mrrpvCall.args?.include_product,
          region: mrrpvCall.args?.region,
          regions: mrrpvCall.args?.regions,
          exclude_regions: mrrpvCall.args?.exclude_regions,
          segment: mrrpvCall.args?.segment,
          segments: mrrpvCall.args?.segments,
          exclude_segments: mrrpvCall.args?.exclude_segments,
          industries: mrrpvCall.args?.industries,
          exclude_industries: mrrpvCall.args?.exclude_industries,
          include_acv: mrrpvCall.args?.include_acv,
        }
      : undefined;

    res.json({
      reply,
      toolCalls,
      querySummary,
      lastResult: lastResult
        ? {
            data: lastResult.data,
            columns: lastResult.columns,
            rowCount: lastResult.rowCount,
            overall: lastResult.overall,
            viewType: lastResult.viewType,
            grandTotals: lastResult.grandTotals,
          }
        : undefined,
      lastToolError: lastToolError || undefined,
      conversationId,
    });
  } catch (err) {
    const raw = err.message || 'Agent failed';
    const status = err.status ?? err.statusCode;
    const code = err.code;
    const cause = err.cause;
    console.error('Chat error:', raw);
    console.error('  status:', status, 'code:', code, 'type:', err.type ?? err.name);
    if (cause) {
      console.error('  cause:', cause.message ?? cause);
      console.error('  cause.code:', cause.code, 'cause.stack:', cause.stack ? cause.stack.slice(0, 200) : '');
    }
    if (err.stack) console.error('  stack:', err.stack.slice(0, 300));

    let message = raw;
    if (status === 401 || /invalid.*api.*key|incorrect.*key|authentication/i.test(raw)) {
      message = 'OpenAI API key is invalid or expired. Check OPENAI_API_KEY in .env and try a new key at platform.openai.com.';
    } else if (status === 429 || /rate limit/i.test(raw)) {
      message = 'OpenAI rate limit hit. Try again in a minute or check your usage at platform.openai.com.';
    } else if (/UNABLE_TO_GET_ISSUER_CERT|CERT_HAS_EXPIRED|certificate|SSL|TLS/i.test(raw) || (cause && /UNABLE_TO_GET_ISSUER_CERT|CERT_HAS_EXPIRED/i.test(String(cause.message ?? '')))) {
      message = 'SSL certificate error when calling OpenAI (often corporate proxy/firewall). For local dev only: run with NODE_TLS_REJECT_UNAUTHORIZED=0 (insecure). Better: set NODE_EXTRA_CA_CERTS to your org CA bundle. See README Troubleshooting.';
    } else if (/connection|fetch|network|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(raw) || code === 'ECONNREFUSED' || code === 'ETIMEDOUT') {
      message = 'Cannot reach OpenAI (api.openai.com). Check network, firewall, or proxy. From this machine run: curl -s -o /dev/null -w "%{http_code}" https://api.openai.com';
    }
    res.status(500).json({ error: message });
  }
});

export default router;
