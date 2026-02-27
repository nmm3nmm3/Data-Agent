/**
 * Include/restore safeguard: when the user asks to include or restore rows,
 * we correct get_mrrpv args so exclude_* lists have the corresponding values removed.
 * Uses plain-English → table value mapping from docs/mrrpv-schema-mapping.md.
 */

/** Phrases that indicate include/restore intent (case-insensitive). */
const INCLUDE_RESTORE_PATTERN = /\b(include|restore|add\s+.+\s+back|show\s+.+\s+again|bring\s+back)\b/i;

/** Plain-English phrase (lowercase) → table values to remove from exclude_regions. */
const PHRASE_TO_REGIONS = {
  'public sector': ['US - SLED', 'US-SLED'],
  government: ['US - SLED', 'US-SLED'],
  'us-sled': ['US - SLED', 'US-SLED'],
  'us sled': ['US - SLED', 'US-SLED'],
  emea: ['UK', 'DACH', 'FR', 'BNL'],
  europe: ['UK', 'DACH', 'FR', 'BNL'],
  na: ['US', 'CA', 'MX', 'US - SLED', 'US-SLED'],
  'north america': ['US', 'CA', 'MX', 'US - SLED', 'US-SLED'],
  uk: ['UK'],
  dach: ['DACH'],
  fr: ['FR'],
  france: ['FR'],
  bnl: ['BNL'],
  'benelux': ['BNL'],
  us: ['US'],
  canada: ['CA'],
  ca: ['CA'],
  mexico: ['MX'],
  mx: ['MX'],
};

/** Plain-English phrase (lowercase) → table values to remove from exclude_segments. */
const PHRASE_TO_SEGMENTS = {
  cml: ['CML'],
  mm: ['MM'],
  'mid market': ['MM'],
  'mid-market': ['MM'],
  core: ['ENT - COR'],
  'ent - cor': ['ENT - COR'],
  'ent-cor': ['ENT - COR'],
  select: ['ENT - SEL'],
  'ent - sel': ['ENT - SEL'],
  'ent-sel': ['ENT - SEL'],
  strategic: ['ENT - STR'],
  'ent - str': ['ENT - STR'],
  'ent-str': ['ENT - STR'],
  'public sector mm': ['US - SLED-MM'],
  'government mm': ['US - SLED-MM'],
  'public sector mid market': ['US - SLED-MM'],
  'public sector sel': ['US - SLED-ENT - SEL'],
  'government sel': ['US - SLED-ENT - SEL'],
  'public sector select': ['US - SLED-ENT - SEL'],
  'government select': ['US - SLED-ENT - SEL'],
  'us - sled-mm': ['US - SLED-MM'],
  'us-sled-mm': ['US - SLED-MM'],
  'us - sled-ent - sel': ['US - SLED-ENT - SEL'],
  'us-sled-ent - sel': ['US - SLED-ENT - SEL'],
};

/**
 * Detect if the user message indicates include/restore intent (e.g. "include government again").
 * @param {string} message
 * @returns {boolean}
 */
export function isIncludeRestoreIntent(message) {
  if (!message || typeof message !== 'string') return false;
  const text = message.trim();
  if (!text) return false;
  return INCLUDE_RESTORE_PATTERN.test(text);
}

/**
 * Resolve phrases in the message to dimension table values to remove from exclude_* when user said include/restore.
 * @param {string} message - Last user message (plain English).
 * @returns {{ regions: string[], segments: string[], industries: string[] }}
 */
export function getValuesToRestore(message) {
  const out = { regions: [], segments: [], industries: [] };
  if (!message || typeof message !== 'string') return out;
  const lower = message.toLowerCase();

  for (const [phrase, values] of Object.entries(PHRASE_TO_REGIONS)) {
    if (lower.includes(phrase)) {
      for (const v of values) {
        if (!out.regions.includes(v)) out.regions.push(v);
      }
    }
  }
  for (const [phrase, values] of Object.entries(PHRASE_TO_SEGMENTS)) {
    if (lower.includes(phrase)) {
      for (const v of values) {
        if (!out.segments.includes(v)) out.segments.push(v);
      }
    }
  }
  return out;
}

/**
 * Apply include/restore correction to get_mrrpv args: remove restored values from exclude_* lists.
 * Mutates args in place. If a list becomes empty, the key is deleted.
 * @param {object} args - get_mrrpv tool args (will be mutated).
 * @param {object} currentView - Current view with exclude_regions, exclude_segments, exclude_industries.
 * @param {string} userMessage - Last user message.
 */
export function applyIncludeRestoreCorrection(args, currentView, userMessage) {
  if (!args || typeof args !== 'object') return;
  if (!currentView || typeof currentView !== 'object') return;
  if (!isIncludeRestoreIntent(userMessage)) return;

  const toRestore = getValuesToRestore(userMessage);
  if (toRestore.regions.length === 0 && toRestore.segments.length === 0 && toRestore.industries.length === 0) return;

  if (toRestore.regions.length > 0 && Array.isArray(args.exclude_regions) && args.exclude_regions.length > 0) {
    const next = args.exclude_regions.filter((r) => !toRestore.regions.includes(r));
    if (next.length === 0) delete args.exclude_regions;
    else args.exclude_regions = next;
  }
  if (toRestore.segments.length > 0 && Array.isArray(args.exclude_segments) && args.exclude_segments.length > 0) {
    const next = args.exclude_segments.filter((s) => !toRestore.segments.includes(s));
    if (next.length === 0) delete args.exclude_segments;
    else args.exclude_segments = next;
  }
  if (toRestore.industries.length > 0 && Array.isArray(args.exclude_industries) && args.exclude_industries.length > 0) {
    const next = args.exclude_industries.filter((i) => !toRestore.industries.includes(i));
    if (next.length === 0) delete args.exclude_industries;
    else args.exclude_industries = next;
  }
}

/** Phrases that indicate the user wants to restore the original unfiltered table (clear all row filters). */
const RESTORE_UNFILTERED_PATTERN = /\b(restore\s+(?:the\s+)?(?:original\s+)?(?:unfiltered\s+)?(?:table|view|data)|remove\s+all\s+filters?|clear\s+all\s+filters?|show\s+(?:the\s+)?(?:full|unfiltered)\s+(?:table|view|data)|unfiltered\s+(?:table|view))\b/i;

/**
 * True if the message asks to restore the original unfiltered table (remove all filters).
 * @param {string} message
 * @returns {boolean}
 */
export function isRestoreUnfilteredRequest(message) {
  if (!message || typeof message !== 'string') return false;
  return RESTORE_UNFILTERED_PATTERN.test(message.trim());
}

/**
 * Clear all row-filter params from get_mrrpv args so the query returns the full table for the current view.
 * Call when the user asks to "restore unfiltered" or "remove all filters".
 * @param {object} args - get_mrrpv tool args (mutated).
 * @param {string} userMessage - Last user message.
 */
export function applyRestoreUnfiltered(args, userMessage) {
  if (!args || typeof args !== 'object') return;
  if (!isRestoreUnfilteredRequest(userMessage)) return;

  delete args.exclude_regions;
  delete args.exclude_segments;
  delete args.exclude_industries;
  delete args.regions;
  delete args.segments;
  delete args.industries;
  delete args.region;
  delete args.segment;
  delete args.industry;
  delete args.include_product;
}

/** Phrases that indicate the user is adding another product to the current filter (not replacing). */
const ADD_PRODUCT_PATTERN = /\b(also|and\s+also|that\s+also\s+had?|in\s+addition|add\s+(?:aim4|vg|cm|telematics|safety|st|flapps|cc|cw|ct|cnav|moby|rp)\b|only\s+(?:accounts?|deals?)\s+that\s+also\s+had?|accounts?\s+that\s+also\s+had?|deals?\s+that\s+also\s+had?)\b/i;

/**
 * When the current view has a product filter and the user asks to add another product,
 * merge the new product(s) with the current include_product so we keep "all of these" (AND).
 * Mutates args.include_product in place. Call after parsing tool args.
 * @param {object} args - get_mrrpv tool args (will be mutated).
 * @param {object} currentView - Current view with include_product (array).
 * @param {string} userMessage - Last user message.
 */
export function applyProductFilterMerge(args, currentView, userMessage) {
  if (!args || typeof args !== 'object') return;
  if (!currentView || typeof currentView !== 'object') return;
  const current = Array.isArray(currentView.include_product) && currentView.include_product.length > 0
    ? currentView.include_product
    : null;
  if (!current) return;
  if (!userMessage || typeof userMessage !== 'string') return;
  if (!ADD_PRODUCT_PATTERN.test(userMessage.trim())) return;

  const fromArgs = args.include_product == null ? [] : Array.isArray(args.include_product) ? args.include_product : [args.include_product];
  const union = [...current];
  for (const p of fromArgs) {
    const key = typeof p === 'string' ? p.trim() : String(p);
    if (key && !union.includes(key)) union.push(key);
  }
  args.include_product = union;
}
