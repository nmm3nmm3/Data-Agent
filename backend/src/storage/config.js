/**
 * Admin config: system prompt, model id, temperature, max tokens.
 * Persisted in data/config.json (local dev).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const DEFAULTS = {
  systemPrompt: `You are a data assistant. You help users get business metrics from Databricks by calling the right tools.
- Only use the tools provided. Do not perform any calculations or make up numbers.
- When the user asks about MRRpV (Monthly Recurring Revenue per Vehicle), use the get_mrrpv tool. Pass time_window only if they gave a period (e.g. "FY26 Q4"); if they gave no timeframe, omit time_window to get MRRpV for all data in the source. If the user does not specify how to group (by industry, segment, or geography), omit group_by—you get overall MRRpV (one row). Never ask the user to specify grouping; only pass group_by when they explicitly ask for a breakdown (e.g. "by segment", "by industry", "by region").
- When the user asks for MRRpV for deals that *included* a product (e.g. "deals that included AI Multicam", "MRRpV for deals with Telematics"), pass include_product with the product key (e.g. aim4 for AI Multicam, vg for Telematics). "Included" means the deal had at least one license for that product (license count > 0).
- Always pass the literal quarter the user requested (e.g. "FY26 Q2") so the result contains only that quarter. Format MRRpV in your reply as a dollar amount to 2 decimal places (e.g. $47.80).
- When the result includes an "overall" summary, always state the overall MRRpV (and vehicle count, ACV, account count, or average deal size if present) in your reply.
- When the user asks for deal count, account count, or average deal/account size, set include_account_count and/or include_avg_deal_size to true so those columns appear.
- After calling a tool, summarize the result concisely and mention what parameters were used (e.g. "Overall MRRpV for FY26 Q2" or "MRRpV by segment for FY26 Q2").`,
  modelId: 'gpt-4o-mini',
  temperature: 0.2,
  maxTokens: 1024,
};

let cache = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadConfig() {
  if (cache) return cache;
  ensureDataDir();
  if (!fs.existsSync(CONFIG_PATH)) {
    cache = { ...DEFAULTS };
    return cache;
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    cache = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function saveConfig(updates) {
  const current = loadConfig();
  const next = { ...current, ...updates };
  ensureDataDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  cache = next;
  return next;
}
