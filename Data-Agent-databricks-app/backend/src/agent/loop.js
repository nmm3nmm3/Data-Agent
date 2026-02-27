/**
 * Agent loop: user message -> OpenAI with tools -> execute tool -> return reply + result.
 * Model only invokes tools; it does not perform calculations.
 */
import OpenAI from 'openai';
import { getTools, executeTool } from './tools.js';
import { applyIncludeRestoreCorrection, applyProductFilterMerge, applyRestoreUnfiltered, isRestoreUnfilteredRequest } from './include-restore.js';
import { isFilterOnlyRequest, applyCurrentViewLock } from './view-lock.js';
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

function buildDimensionResolutionRule() {
  return (
    'Dimension value resolution (apply to every "remove X", "exclude X", "include X again", or "only X" request): ' +
    "Resolve the user's words to the exact table values used in the API. One phrase can map to one or more table values; use the correct parameter (exclude_regions for geo, exclude_segments for segment, exclude_industries for industry). " +
    'Geo: "public sector", "government" → exclude_regions ["US - SLED", "US-SLED"] (both forms exist in data). "EMEA", "Europe" → exclude_regions ["UK", "DACH", "FR", "BNL"]. "NA", "North America" → regions ["US", "CA", "MX", "US - SLED", "US-SLED"] when including. ' +
    'Segment: "mid market", "MM" → "MM"; "core" → "ENT - COR"; "select" → "ENT - SEL"; "strategic" → "ENT - STR"; "public sector MM", "government MM" → "US - SLED-MM"; "public sector SEL", "government select" → "US - SLED-ENT - SEL". ' +
    'Rule: Remove/exclude = add those table values to the relevant exclude_* list. Include/restore = take the CURRENT exclude_* list from the view, REMOVE the table values that match what the user said, and pass the resulting list (or omit that parameter if the list becomes empty). Never pass the same exclude_* list when the user asked to include or restore — the tool call must reflect the updated list. ' +
    "Always pass these exact strings; matching is case-insensitive for the user's phrase only. Full mapping: docs/mrrpv-schema-mapping.md (Dimension values: Segment, Geo, Super-regions).\n\n" +
    'Product filter (when the user asks to restrict to accounts or deals that included a product): Set include_product to an array of product keys so only rows where ALL those products have license count > 0 are included. One product → ["aim4"]; multiple (e.g. "safety and telematics", "both CM and VG") → ["cm", "vg"]. Resolve plain-English to keys per docs/mrrpv-schema-mapping.md: "Safety", "Camera", "CM" → "cm"; "Telematics", "VG" → "vg"; "AIM4" → "aim4"; "ST" → "st"; etc. Keep the SAME view when applying. When the user specifies multiple conditions in one message (e.g. "US-MM, FY26, deals with safety and telematics"), pass ALL of them in a single get_mrrpv call: regions/segments for geo-segment, time_window for the period, include_product for the product(s). Do not split into multiple calls or ignore any condition.\n\n'
  );
}

function buildPresetPrompt() {
  const views = getViews();
  if (!views.length) return '';
  const list = views.map((v) => `"${v.label}" (id: ${v.id})`).join('; ');
  return (
    buildDimensionResolutionRule() +
    'Preset views (use as starting points; apply overrides from the user): ' +
    list +
    '. Overridable params depend on the preset: time_window, group_by (only for non-bridge presets), include_product, region, segment, exclude_regions, regions, exclude_segments, segments, exclude_industries, industries, include_acv. When the user asks to remove or include specific rows, resolve their words using the dimension resolution rule above and set the appropriate exclude_* or include param — keep the SAME view type (same preset_id and group_by). When the user asks to restrict to accounts or deals that included one or more products (e.g. "only AIM4", "safety and telematics"), set include_product to an array of product keys (e.g. ["aim4"] or ["cm", "vg"]) and keep the SAME view. When the user specifies multiple conditions in one message (geo, segment, time, product(s)), pass every condition in the same get_mrrpv call. For include/restore of rows: start from the current view\'s exclude_* list, remove the table values that correspond to what the user asked to include, pass the new list (or omit the param if empty). Do NOT pass the current exclude_* unchanged when the user asked to include or restore. Do NOT omit time_window (that returns all quarters from FY18). NEVER switch presets or change group_by unless the user explicitly asks for a different view or breakdown (e.g. "show me by industry", "switch to geo-segment view"). When the user asks to remove or show ACV columns, set include_acv to false or true. Preserve include_acv from the current view when making other changes.\n' +
    'MRRpV Bridge (id: first-purchase-bridge) has no group_by; it shows overall metrics by quarter. To filter the bridge (e.g. only US accounts), pass view_type: "bridge" and preset_id: "first-purchase-bridge" with time_window and filters (e.g. regions: ["US"]). Do NOT set group_by when the user is on the bridge.\n' +
    'ASP Investigation (id: asp-investigation): for ASP questions pass view_type: "asp" and preset_id: "asp-investigation" with time_window and products. To restrict to specific segments (e.g. "only MM accounts", "only mid-market") pass segments: ["MM"]; to restrict to geo pass regions (e.g. regions: ["US"]). You can combine both (e.g. regions: ["US"] and segments: ["MM"] for US MM only). Resolve plain-English to table values per docs/mrrpv-schema-mapping.md (MM = Mid-Market).\n' +
    'For comparisons like "AIM4 vs not AIM4": call get_mrrpv TWICE—once with include_product set to that product, once without—then present both outcomes.\n\n'
  );
}

function buildCurrentViewPrompt(currentView) {
  if (!currentView || typeof currentView !== 'object') return '';
  const label = currentView.label || currentView.presetId || 'current view';
  const isBridge = currentView.presetId === 'first-purchase-bridge';
  const parts = [
    `The user is currently viewing: ${label}.`,
    'CRITICAL — NEVER switch view type or preset when the user only asks to filter or restrict the data (e.g. "only US accounts", "exclude EMEA", "remove MM", "only include accounts with AIM4", "don\'t include public sector"). Apply the requested filter: for row filters use regions, exclude_regions, segments, exclude_segments, industries, exclude_industries; for product-based restriction set include_product to an array of product keys (e.g. ["cm", "vg"]) and keep the SAME view. Only change group_by or switch to a different preset when the user explicitly asks for a different view or breakdown (e.g. "show me by industry", "switch to geo-segment view"). If you cannot apply the requested filter to the current view, say so instead of switching view.',
  ];
  if (isBridge) {
    parts.push(
      'This is the MRRpV Bridge view. It has NO group_by. To filter it (e.g. only US, exclude EMEA), pass view_type: "bridge" and preset_id: "first-purchase-bridge" with the same time_window and the filter (e.g. regions: ["US"] or exclude_regions: ["UK","DACH","FR","BNL"] for EMEA). Do NOT set group_by — if you set group_by you will replace the bridge with a different view and the user will lose the bridge table.'
    );
  } else if (currentView.presetId === 'asp-investigation') {
    const aspProducts = Array.isArray(currentView.products) && currentView.products.length > 0 ? currentView.products : ['cm', 'vg', 'aim4'];
    parts.push(
      `This is the ASP Investigation view. Pass view_type: "asp" and preset_id: "asp-investigation" with time_window and products. Current products: [${aspProducts.join(', ')}]. When the user asks to add a product (e.g. "add Maintenance", "add Smart Trailers"), pass products as the union of current plus the new one. Resolve names per schema: Maintenance / Connected Asset Maintenance → cam; Smart Trailers / ST → st (do not confuse Maintenance with st). When they ask to remove a product, pass products without that key. To limit which accounts are included: use segments for "only MM accounts" / "only mid-market" → segments: ["MM"]; use regions for "only US" → regions: ["US"]. When the user says "only include MM accounts" or "only mid-market" you MUST pass segments: ["MM"] in addition to any existing regions (e.g. keep regions: ["US"] if already applied). To limit by segment, geo, or industry use regions, segments, exclude_regions, exclude_segments, industries, exclude_industries. Resolve plain-English to table values per schema mapping (MM = Mid-Market).`
    );
  } else {
    parts.push(
      'When they ask to remove or include specific rows (e.g. "exclude MM", "remove EMEA", "remove CML"), keep the SAME group_by and time_window: if they are on the industry view, keep group_by "industry" and apply exclude_segments or other filters; if on geo-segment view, keep group_by "geo_segment". Only change group_by if the user explicitly asks to see a different breakdown (e.g. "show me by geo instead"). Call get_mrrpv with the SAME time_window and group_by and the appropriate row filter. Do not say you cannot modify the data.'
    );
  }
  if (currentView.time_window) {
    parts.push(`Time: ${currentView.time_window}. You MUST pass time_window: "${currentView.time_window}" — do not omit it or change it when the user only asks to exclude or include rows. If you omit time_window, the query returns ALL quarters (e.g. from FY18), which is wrong.`);
  }
  if (currentView.group_by && !isBridge) {
    parts.push(`Group by: ${currentView.group_by}. You MUST pass group_by: "${currentView.group_by}" — do not change it when the user only asks to exclude or include rows.`);
  }
  if (isBridge) {
    parts.push('Pass preset_id: "first-purchase-bridge" and view_type: "bridge" so the result remains the bridge table.');
  }
  const currentIncludeProduct = Array.isArray(currentView.include_product) && currentView.include_product.length > 0
    ? currentView.include_product
    : null;
  if (currentIncludeProduct) {
    parts.push(
      `Current product filter: include_product: [${currentIncludeProduct.map((p) => `"${p}"`).join(', ')}]. When the user asks to add or restrict to an additional product (e.g. "also AIM4", "only accounts that also had AIM4", "add AIM4", "that also had telematics") you MUST set include_product to ALL products: the current list plus the newly requested product(s). Do NOT replace the existing list with only the new product — pass the union so the filter remains "deals that had all of these".`
    );
  }
  const hasFilters =
    (Array.isArray(currentView.exclude_regions) && currentView.exclude_regions.length > 0) ||
    (Array.isArray(currentView.regions) && currentView.regions.length > 0) ||
    (Array.isArray(currentView.exclude_segments) && currentView.exclude_segments.length > 0) ||
    (Array.isArray(currentView.segments) && currentView.segments.length > 0) ||
    (Array.isArray(currentView.exclude_industries) && currentView.exclude_industries.length > 0) ||
    (Array.isArray(currentView.industries) && currentView.industries.length > 0);
  if (hasFilters) {
    parts.push('Current row filters (use these as the starting state for the next call):');
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
      'Apply the user\'s request to this state. (1) If they ask to REMOVE or EXCLUDE more rows: keep all current exclude_* and add the new values; keep regions/segments/industries unchanged. (2) If they ask to INCLUDE or RESTORE previously excluded rows (e.g. "include government again", "restore EMEA", "add CML back"): resolve their words to table values, then REMOVE those values from the corresponding exclude_regions, exclude_segments, or exclude_industries and pass the resulting list; if the result is empty, omit that parameter entirely. Do NOT pass the current exclude_* list unchanged when the user asked to include or restore — you must output the list with the restored values removed.'
    );
  } else {
    if (currentView.include_acv === false) {
      parts.push('ACV columns are hidden (include_acv: false). Preserve this when applying other changes unless the user asks to show ACV again.');
    }
    parts.push(
      'Row filters (use the one that matches the dimension the user is changing). Resolve plain-English to exact table values using the dimension resolution rule (e.g. "public sector"/"government" → exclude_regions ["US - SLED", "US-SLED"]; "EMEA" → exclude_regions ["UK","DACH","FR","BNL"]; "MM" → exclude_segments ["MM"]):',
      '• To drop rows by geo: exclude_regions. To include or restore previously excluded geos, remove those values from exclude_regions (omit the parameter if the list would be empty).',
      '• To drop rows by segment: exclude_segments. To include or restore previously excluded segments, remove those values from exclude_segments.',
      '• To drop rows by industry: exclude_industries. To include or restore previously excluded industries, remove those values from exclude_industries.',
      '• To show only certain rows: use regions, segments, or industries (arrays to include).',
      '• To restrict to accounts or deals that included one or more products: set include_product to an array of keys (e.g. ["cm", "vg"] for safety AND telematics). When the current view already has a product filter and the user asks to add or narrow by another product (e.g. "also AIM4", "only accounts that also had AIM4"), pass include_product as the union of the current view\'s include_product and the newly requested product(s) — do not replace with only the new product. When the user gives multiple conditions in one message, pass all of them in this call.',
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
  '- If they do not specify a time period, omit time_window to get MRRpV across all data. EXCEPTION: when the user is on a preset view (currentView has time_window set) and only asks to filter rows, columns, or by product (e.g. "exclude MM", "remove EMEA", "only include accounts with AIM4", "safety and telematics"), you MUST pass the same time_window from the current view — do not omit it or the result will show all quarters from FY18 onward.\n' +
  '- When the user asks to remove or exclude a dimension: add the resolved table values to the relevant exclude_* list (or set it if none yet). When the user asks to include or restore a dimension (e.g. "include government again", "restore EMEA", "add CML back"): take the current view\'s exclude_* for that dimension, remove the table values that match the user\'s request, and pass the resulting list; if the result is empty, omit that parameter. Do NOT pass the same exclude_* list when the user asked to include or restore — the call must use the updated list.\n' +
  '- When the user asks to restrict to accounts or deals that included one or more products: set include_product to an array of product keys (e.g. ["aim4"] or ["cm", "vg"] for safety AND telematics). When the current view already has include_product set and the user asks to add or narrow by another product (e.g. "also AIM4", "only accounts that also had AIM4"), pass the union of the current view\'s include_product and the newly requested product(s) — do not replace with only the new product. When the user specifies multiple conditions in one message, pass ALL conditions in a single call. Do not split into multiple calls or drop any condition.\n' +
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

  const lastUserMessage = messages.length > 0 && messages[messages.length - 1]?.role === 'user'
    ? String(messages[messages.length - 1].content || '')
    : '';

  let lastToolError = null;
  let toolResults = [];
  for (const tc of toolCalls) {
    const name = tc.function?.name;
    let args = {};
    try {
      if (tc.function?.arguments) args = JSON.parse(tc.function.arguments);
    } catch (_) {}
    if (name === 'get_mrrpv' && currentView) {
      if (lastUserMessage && (isFilterOnlyRequest(lastUserMessage) || isRestoreUnfilteredRequest(lastUserMessage))) {
        applyCurrentViewLock(args, currentView, lastUserMessage);
      }
      if (lastUserMessage) {
        applyRestoreUnfiltered(args, lastUserMessage);
        applyIncludeRestoreCorrection(args, currentView, lastUserMessage);
        applyProductFilterMerge(args, currentView, lastUserMessage);
      }
      if (lastUserMessage && isRestoreUnfilteredRequest(lastUserMessage) && currentView?.presetId) {
        const views = getViews();
        const preset = views.find((v) => v.id === currentView.presetId);
        const defaultTime = preset?.defaultParams?.timeWindow ?? preset?.defaultParams?.time_window;
        if (defaultTime != null && defaultTime !== '') {
          args.time_window = String(defaultTime);
        }
      }
    }
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
