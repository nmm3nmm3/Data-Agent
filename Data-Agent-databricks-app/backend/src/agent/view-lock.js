/**
 * View-lock safeguard: when the user only asks to filter (remove/exclude/include rows),
 * we force get_mrrpv args to keep the current view (preset_id, group_by, time_window).
 * Prevents the agent from switching view type when the user did not ask for that.
 */
import { getViews } from '../views/first-purchase-views.js';

/** Phrases that indicate the user wants to change view/breakdown (not filter-only). */
const VIEW_CHANGE_PATTERNS = [
  /\bby\s+industry\b/i,
  /\bby\s+segment\b/i,
  /\bby\s+geo\b/i,
  /\bby\s+region\b/i,
  /\bby\s+geo-segment\b/i,
  /\bby\s+geo_segment\b/i,
  /\bbreakdown\s+by\b/i,
  /\bswitch\s+to\b/i,
  /\bshow\s+me\s+by\b/i,
  /\bchange\s+(?:to\s+)?(?:view|breakdown)\b/i,
  /\bdifferent\s+view\b/i,
  /\differently\s+by\b/i,
  /\bgroup(?:ed)?\s+by\b/i,
  /\bindustry\s+view\b/i,
  /\bgeo\s+view\b/i,
  /\bsegment\s+view\b/i,
];

/** Phrases that indicate filter-only intent (remove/exclude/include/restrict rows or by product). */
const FILTER_ONLY_PATTERNS = [
  /\bremove\s+(?:the\s+)?(?:rows?|emea|na|government|public\s+sector|mm|cml|segment|region)/i,
  /\bexclude\s+(?:the\s+)?(?:rows?|emea|na|government|public\s+sector|mm|cml|segment|region)/i,
  /\binclude\s+(?:the\s+)?(?:rows?|emea|na|government|public\s+sector|mm|cml|segment|region)/i,
  /\b(?:add|show|bring)\s+.+\s+(?:back|again)\b/i,
  /\brestore\s+/i,
  /\bonly\s+(?:us|na|emea|show|display)\b/i,
  /\bonly\s+include\s+accounts\b/i,
  /\bonly\s+.+\s+deals?\b/i,
  /\bdeals?\s+that\s+included\s+/i,
  /\brestrict\s+to\s+.+\s+accounts?\b/i,
  /\bdon'?t\s+include\s+/i,
  /\bdrop\s+(?:the\s+)?(?:rows?|emea|mm|cml)/i,
  /\b(filter|restrict)\s+(?:to|by)\b/i,
];

/**
 * True if the message appears to be only about filtering (remove/exclude/include rows)
 * and does NOT ask for a different view or breakdown.
 * @param {string} message
 * @returns {boolean}
 */
export function isFilterOnlyRequest(message) {
  if (!message || typeof message !== 'string') return false;
  const text = message.trim();
  if (!text) return false;

  for (const re of VIEW_CHANGE_PATTERNS) {
    if (re.test(text)) return false;
  }

  for (const re of FILTER_ONLY_PATTERNS) {
    if (re.test(text)) return true;
  }

  // Also treat short filter-like phrases without a strong view-change signal
  if (/^(remove|exclude|include|only|drop)\s+/i.test(text) && text.length < 120) return true;

  return false;
}

/** Patterns indicating the user explicitly requested a time period (do not overwrite time_window in view lock). */
const TIME_REQUEST_PATTERNS = [
  /\bFY\d{2}\b/i,
  /\bFY\s*\d{2}\b/i,
  /\b(?:fiscal\s+)?year\s+\d{2}\b/i,
  /\b(?:only\s+)?(?:show\s+)?(?:for\s+)?FY\d{2}\b/i,
  /\bFY\d{2}\s+Q[1-4]\b/i,
  /\bQ[1-4]\s+FY\d{2}\b/i,
  /\blast\s+\d+\s+quarters?\b/i,
  /\b(?:only\s+)?(?:show\s+)?(?:data\s+)?(?:for\s+)?(?:the\s+)?(?:quarter|period)\b/i,
  /\b(?:from|between|since)\s+.+\s+(?:to|through|onwards?)\b/i,
  /\bonly\s+show\s+FY\b/i,
  /\bonly\s+FY\b/i,
];

/**
 * True if the message explicitly requests a specific time period (e.g. "only show FY26", "FY26 Q4").
 * When true, view lock should NOT overwrite time_window so the model's time_window is preserved.
 * @param {string} message
 * @returns {boolean}
 */
export function userRequestedTimeChange(message) {
  if (!message || typeof message !== 'string') return false;
  const text = message.trim();
  for (const re of TIME_REQUEST_PATTERNS) {
    if (re.test(text)) return true;
  }
  return false;
}

/**
 * Force get_mrrpv args to match the current view so the agent cannot switch view on filter-only requests.
 * Mutates args in place: sets time_window (unless user requested a time period), group_by, preset_id from currentView; for bridge, sets view_type and deletes group_by.
 * If currentView has presetId but missing time_window/group_by, fills from the preset's defaultParams.
 * @param {object} args - get_mrrpv tool args (mutated).
 * @param {object} currentView - Current view with time_window?, group_by?, presetId?.
 * @param {string} [userMessage] - Last user message; when it indicates a time-period request, time_window is not overwritten.
 */
export function applyCurrentViewLock(args, currentView, userMessage) {
  if (!args || typeof args !== 'object') return;
  if (!currentView || typeof currentView !== 'object') return;

  let timeWindow = currentView.time_window;
  let groupBy = currentView.group_by;
  const presetId = currentView.presetId != null && currentView.presetId !== '' ? String(currentView.presetId) : null;

  if (presetId && (timeWindow == null || timeWindow === '' || groupBy === undefined)) {
    const views = getViews();
    const preset = views.find((v) => v.id === presetId);
    if (preset?.defaultParams) {
      if (timeWindow == null || timeWindow === '') timeWindow = preset.defaultParams.timeWindow ?? preset.defaultParams.time_window;
      if (groupBy === undefined) groupBy = preset.defaultParams.groupBy ?? preset.defaultParams.group_by;
    }
  }

  const preserveModelTime = userMessage && userRequestedTimeChange(userMessage);
  if (!preserveModelTime && timeWindow != null && timeWindow !== '') {
    args.time_window = String(timeWindow);
  }
  if (presetId) {
    args.preset_id = presetId;
  }

  const isBridge = presetId === 'first-purchase-bridge';
  const isASP = presetId === 'asp-investigation';
  if (isBridge) {
    args.view_type = 'bridge';
    delete args.group_by;
  } else if (isASP) {
    args.view_type = 'asp';
    let products = Array.isArray(currentView.products) && currentView.products.length > 0 ? currentView.products : null;
    if (!products) {
      const views = getViews();
      const preset = views.find((v) => v.id === presetId);
      products = Array.isArray(preset?.defaultParams?.products) && preset.defaultParams.products.length > 0 ? preset.defaultParams.products : ['cm', 'vg', 'aim4'];
    }
    args.products = products;
    delete args.group_by;
    // Preserve existing region filter from current view so "only MM" keeps e.g. regions: ["US"]
    if (Array.isArray(currentView.regions) && currentView.regions.length > 0 && (!Array.isArray(args.regions) || args.regions.length === 0)) {
      args.regions = currentView.regions.slice();
    }
    // When user says "only include MM accounts" / "only mid-market", ensure segments: ["MM"] is set if agent omitted it
    if (userMessage && typeof userMessage === 'string' && /\bonly\s+(?:include\s+)?(?:mm|mid-?market)\s*(?:accounts?)?\b/i.test(userMessage.trim())) {
      if (!Array.isArray(args.segments) || args.segments.length === 0) {
        args.segments = ['MM'];
      }
    }
  } else if (groupBy != null && groupBy !== '') {
    args.group_by = String(groupBy);
  }
}
