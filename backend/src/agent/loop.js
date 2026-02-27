/**
 * Agent loop: user message -> OpenAI with tools -> execute tool -> return reply + result.
 * Model only invokes tools; it does not perform calculations.
 */
import OpenAI from 'openai';
import { getTools, executeTool } from './tools.js';
import { loadConfig } from '../storage/config.js';
import { getViews } from '../views/first-purchase-views.js';

const OPENAI_TIMEOUT_MS = 60000;

function getOpenAI() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error('OPENAI_API_KEY is missing or empty. Set it in Data-Agent/.env (project root, not backend/.env).');
  }
  const customFetch = async (url, options = {}) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), OPENAI_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...options, signal: c.signal });
      clearTimeout(t);
      return res;
    } catch (e) {
      clearTimeout(t);
      const msg = e.message || String(e);
      const code = e.code ?? e.cause?.code;
      throw new Error(msg + (code ? ` (${code})` : ''), { cause: e });
    }
  };
  return new OpenAI({ apiKey: key, fetch: customFetch });
}

function buildPresetPrompt() {
  const views = getViews();
  if (!views.length) return '';
  const list = views.map((v) => `"${v.label}" (id: ${v.id})`).join('; ');
  return (
    'Preset views (use as starting points; apply overrides from the user): ' +
    list +
    '. Overridable params: time_window, group_by, include_product, region, segment, exclude_regions, regions, exclude_segments, segments, exclude_industries, industries, include_acv. When the user asks to remove specific rows use exclude_segments, exclude_regions, or exclude_industries (map plain-English to table values per docs/mrrpv-schema-mapping.md, e.g. public sector → ["US-SLED","US - SLED"], EMEA → ["UK","DACH","FR","BNL"]) — and keep the SAME group_by and time_window. When the user asks to include or restore previously excluded rows (e.g. "include EMEA again", "restore public sector", "add CML back"), remove those values from the corresponding exclude_* list so that data appears again; if the list would be empty, omit that parameter entirely. Do NOT omit time_window (that returns all quarters from FY18). Do NOT switch presets or group_by unless the user explicitly asks for a different view. Use exact dimension values from the table. When the user asks to remove or show ACV columns, set include_acv to false or true. Preserve include_acv from the current view when making other changes.\n' +
    'For comparisons like "AIM4 vs not AIM4": call get_mrrpv TWICE—once with include_product set to that product, once without—then present both outcomes.\n\n'
  );
}

function buildCurrentViewPrompt(currentView) {
  if (!currentView || typeof currentView !== 'object') return '';
  const label = currentView.label || currentView.presetId || 'current view';
  const parts = [
    `The user is currently viewing: ${label}.`,
    'CRITICAL: When they ask to remove or include specific rows (e.g. "exclude MM", "don\'t include MM accounts", "remove EMEA", "remove CML"), you MUST keep the SAME group_by and time_window. Do NOT switch to a different view type: if they are on the industry view, keep group_by "industry" and apply exclude_segments or other filters so the industry numbers update; if they are on geo-segment view, keep group_by "geo_segment". Only change group_by if the user explicitly asks to see a different breakdown (e.g. "show me by geo instead").',
    'Call get_mrrpv with the SAME time_window and group_by and the appropriate row filter. Do not say you cannot modify the data.',
  ];
  if (currentView.time_window) {
    parts.push(`Time: ${currentView.time_window}. You MUST pass time_window: "${currentView.time_window}" — do not omit it or change it when the user only asks to exclude or include rows. If you omit time_window, the query returns ALL quarters (e.g. from FY18), which is wrong.`);
  }
  if (currentView.group_by) {
    parts.push(`Group by: ${currentView.group_by}. You MUST pass group_by: "${currentView.group_by}" — do not change it when the user only asks to exclude or include rows.`);
  }
  const hasFilters =
    (Array.isArray(currentView.exclude_regions) && currentView.exclude_regions.length > 0) ||
    (Array.isArray(currentView.regions) && currentView.regions.length > 0) ||
    (Array.isArray(currentView.exclude_segments) && currentView.exclude_segments.length > 0) ||
    (Array.isArray(currentView.segments) && currentView.segments.length > 0) ||
    (Array.isArray(currentView.exclude_industries) && currentView.exclude_industries.length > 0) ||
    (Array.isArray(currentView.industries) && currentView.industries.length > 0);
  if (hasFilters) {
    parts.push('Current row filters (you MUST preserve these when adding or changing another filter):');
    if (Array.isArray(currentView.exclude_regions) && currentView.exclude_regions.length > 0) {
      parts.push(`exclude_regions: [${currentView.exclude_regions.map((r) => `"${r}"`).join(', ')}].`);
    }
    if (Array.isArray(currentView.regions) && currentView.regions.length > 0) {
      parts.push(`regions: [${currentView.regions.map((r) => `"${r}"`).join(', ')}].`);
    }
    if (Array.isArray(currentView.exclude_segments) && currentView.exclude_segments.length > 0) {
      parts.push(`exclude_segments: [${currentView.exclude_segments.map((s) => `"${s}"`).join(', ')}].`);
    }
    if (Array.isArray(currentView.segments) && currentView.segments.length > 0) {
      parts.push(`segments: [${currentView.segments.map((s) => `"${s}"`).join(', ')}].`);
    }
    if (Array.isArray(currentView.exclude_industries) && currentView.exclude_industries.length > 0) {
      parts.push(`exclude_industries: [${currentView.exclude_industries.map((i) => `"${i}"`).join(', ')}].`);
    }
    if (Array.isArray(currentView.industries) && currentView.industries.length > 0) {
      parts.push(`industries: [${currentView.industries.map((i) => `"${i}"`).join(', ')}].`);
    }
    if (currentView.include_acv === false) {
      parts.push('ACV columns are hidden (include_acv: false).');
    }
    parts.push(
      'When the user asks to remove or add more rows (or change columns), pass ALL of the above filters and options unchanged and only add or change the one they asked for. When the user asks to include or restore previously excluded rows (e.g. "include EMEA again", "restore public sector", "add CML back"), remove those values from the corresponding exclude_regions, exclude_segments, or exclude_industries so that data appears again; if a list would be empty, omit that parameter entirely.'
    );
  } else {
    if (currentView.include_acv === false) {
      parts.push('ACV columns are hidden (include_acv: false). Preserve this when applying other changes unless the user asks to show ACV again.');
    }
    parts.push(
      'Row filters (use the one that matches the dimension the user is changing):',
      '• To drop rows by geo: exclude_regions. To include or restore previously excluded geos, remove those values from exclude_regions (omit the parameter if the list would be empty). Map plain-English to table values (see schema mapping: e.g. EMEA, public sector).',
      '• To drop rows by segment: exclude_segments. To include or restore previously excluded segments, remove those values from exclude_segments.',
      '• To drop rows by industry: exclude_industries. To include or restore previously excluded industries, remove those values from exclude_industries.',
      '• To show only certain rows: use regions, segments, or industries (arrays to include).',
      '• To remove or show ACV columns: set include_acv to false or true.',
      'Re-run with the same time_window and group_by plus the new filter; then report the updated result.'
    );
  }
  return '\n' + parts.join(' ') + '\n\n';
}

/**
 * Run one agent turn: messages + optional system prompt override and context (e.g. dataSource from UI).
 * @param {{ messages: Array<{role:string, content:string}>, systemPrompt?: string, dataSource?: string, currentView?: { presetId?: string, label?: string, time_window?: string, group_by?: string, region?: string, segment?: string } }}
 * @returns {{ reply: string, toolCalls: Array<{name:string, args:object}>, lastResult: object | null }}
 */
const MRRPV_RULES =
  'For get_mrrpv you MUST call the tool for any MRRpV question. Do not refuse or say you need more parameters.\n' +
  '- For overall/total MRRpV (e.g. "what was MRRpV in FY26 Q4"): call with time_window set to that period and do NOT set group_by.\n' +
  '- For multiple quarters in one view: pass time_window as comma-separated quarters in one call. Example: "last three Q3s" or "MRRpV by industry for the last three Q3s" → call get_mrrpv ONCE with time_window "FY25 Q3,FY26 Q3,FY27 Q3" and group_by "industry". You will get a table with a row per (industry, quarter). Do NOT call with only one quarter (e.g. not just FY26 Q2); use the quarters the user asked for (Q3s = FY25 Q3, FY26 Q3, FY27 Q3).\n' +
  '- When the user says "from [quarter] onwards", "from [quarter] to now", "starting from [quarter]", or "since [quarter]" (e.g. "show this data from FY25 Q1 onwards"), you MUST pass time_window as a comma-separated list of ALL quarters from that start quarter through the most recent quarter, not just the single start quarter. Example: "from FY25 Q1 onwards" → time_window "FY25 Q1,FY25 Q2,FY25 Q3,FY25 Q4,FY26 Q1,FY26 Q2,FY26 Q3,FY26 Q4,FY27 Q1" (or through whatever the latest quarter is). One column per quarter in the range.\n' +
  '- When the user says "between [quarter] and [quarter]" or "[quarter] - [quarter]" (e.g. "show values between FY25 Q1 - FY25 Q4" or "between FY25 Q1 and FY25 Q4"), pass time_window as comma-separated quarters covering that inclusive range. Example: "between FY25 Q1 and FY25 Q4" → "FY25 Q1,FY25 Q2,FY25 Q3,FY25 Q4".\n' +
  '- When the user specifies a fiscal year only (e.g. "MRRpV for FY26", "give me data for fiscal year 26", "year 26"), treat it as that year\'s four quarters: time_window "FYnn Q1,FYnn Q2,FYnn Q3,FYnn Q4". "Year" and "FY" are equivalent (e.g. "FY26" = FY26 Q1 through Q4).\n' +
  '- Never ask the user to specify a grouping. If they do not say "by industry", "by segment", or "by region/geo", omit group_by.\n' +
  '- If they do not specify a time period, omit time_window to get MRRpV across all data. EXCEPTION: when the user is on a preset view (currentView has time_window set) and only asks to filter rows or columns (e.g. "exclude MM", "remove EMEA"), you MUST pass the same time_window from the current view — do not omit it or the result will show all quarters from FY18 onward.\n' +
  '- When the tool returns success: true, state the result briefly; if there is an "overall" object, mention it. Do not say "I will retrieve" or "Please hold on" after you have the result.\n' +
  '- When the tool returns success: false with an "error" field, tell the user exactly what went wrong.\n' +
  '- When the user asks for deal count, account count, or number of accounts/deals, set include_account_count to true. When they ask for average deal size, set include_avg_deal_size to true.\n\n';

export async function runAgent({ messages, systemPrompt: systemPromptOverride, dataSource, currentView } = {}) {
  const config = loadConfig();
  const basePrompt = systemPromptOverride ?? config.systemPrompt ?? '';
  const systemPrompt = buildPresetPrompt() + buildCurrentViewPrompt(currentView) + MRRPV_RULES + basePrompt;
  const tools = getTools();
  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const modelId = config.modelId || 'gpt-4o-mini';
  const openai = getOpenAI();
  const response = await openai.chat.completions.create({
    model: modelId,
    messages: apiMessages,
    tools,
    tool_choice: 'auto',
    temperature: config.temperature ?? 0.2,
    max_tokens: config.maxTokens ?? 1024,
  });

  const choice = response.choices?.[0];
  const message = choice?.message;
  const toolCalls = message?.tool_calls || [];
  const lastResult = { toolCalls: [], result: null };

  if (toolCalls.length === 0) {
    return {
      reply: message?.content || 'No response.',
      toolCalls: [],
      lastResult: null,
    };
  }

  let lastToolError = null;
  let toolResults = [];
  for (const tc of toolCalls) {
    const name = tc.function?.name;
    let args = {};
    try {
      if (tc.function?.arguments) args = JSON.parse(tc.function.arguments);
    } catch (_) {}
    lastResult.toolCalls.push({ name, args });
    try {
      const result = await executeTool(name, args, { dataSource });
      if (name === 'get_mrrpv') {
        if (!lastResult.result) lastResult.result = result;
        lastToolError = null;
      }
      toolResults.push({
        tool_call_id: tc.id,
        role: 'tool',
        content: JSON.stringify(result),
      });
    } catch (err) {
      if (name === 'get_mrrpv') lastToolError = err.message;
      toolResults.push({
        tool_call_id: tc.id,
        role: 'tool',
        content: JSON.stringify({ success: false, error: err.message }),
      });
    }
  }

  // Second call: send tool results back to get final reply
  const followUpMessages = [
    ...apiMessages.slice(1),
    message,
    ...toolResults,
  ];
  const followUp = await getOpenAI().chat.completions.create({
    model: modelId,
    messages: [{ role: 'system', content: systemPrompt }, ...followUpMessages],
    temperature: config.temperature ?? 0.2,
    max_tokens: config.maxTokens ?? 1024,
  });
  const finalMessage = followUp.choices?.[0]?.message;
  const reply = finalMessage?.content || 'Done.';

  return {
    reply,
    toolCalls: lastResult.toolCalls,
    lastResult: lastResult.result,
    lastToolError: lastResult.result == null ? lastToolError : undefined,
  };
}
