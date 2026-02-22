/**
 * Usage log: each agent request (timestamp, session, message, tool calls, row count, latency, success).
 * Stored in data/usage.jsonl (one JSON object per line).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const USAGE_PATH = path.join(DATA_DIR, 'usage.jsonl');
const MAX_LINES = 5000;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * @param {{ sessionId?: string, message: string, toolCalls: Array<{name:string, args?:object}>, rowCount?: number, latencyMs: number, success: boolean }} entry
 */
export function logUsage(entry) {
  ensureDataDir();
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...entry,
  }) + '\n';
  fs.appendFileSync(USAGE_PATH, line, 'utf8');
}

/**
 * Read recent N lines (newest first).
 */
export function getRecentUsage(limit = 100) {
  if (!fs.existsSync(USAGE_PATH)) return [];
  const content = fs.readFileSync(USAGE_PATH, 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);
  const parsed = [];
  for (let i = lines.length - 1; i >= 0 && parsed.length < limit; i--) {
    try {
      parsed.push(JSON.parse(lines[i]));
    } catch (_) {}
  }
  return parsed;
}

/**
 * Aggregate: top tools, error rate, request count.
 */
export function getUsageStats() {
  const recent = getRecentUsage(MAX_LINES);
  const total = recent.length;
  const failed = recent.filter((r) => !r.success).length;
  const toolCounts = {};
  recent.forEach((r) => {
    (r.toolCalls || []).forEach((t) => {
      toolCounts[t.name] = (toolCounts[t.name] || 0) + 1;
    });
  });
  const topTools = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));
  return {
    totalRequests: total,
    errorCount: failed,
    errorRate: total ? (failed / total).toFixed(2) : 0,
    topTools,
  };
}
