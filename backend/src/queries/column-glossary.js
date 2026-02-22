/**
 * Plain-English ↔ product/feature column mapping for MRRpV tables.
 * Kept in sync with docs/mrrpv-schema-mapping.md (Product / feature columns section).
 * Use for agent system prompts, tool descriptions, or future query params (e.g. product_area).
 */

/**
 * Map plain-English phrases (lowercase, keyed for lookup) to column prefix used in table column names.
 * e.g. "telematics" → "vg", "safety + telematics" → "vgcm", "ai multicam" → "aim4".
 */
const PLAIN_ENGLISH_TO_PREFIX = {
  telematics: 'vg',
  vg: 'vg',
  'safety + telematics': 'vgcm',
  vgcm: 'vgcm',
  'safety and telematics': 'vgcm',
  'ai multicam': 'aim4',
  aim4: 'aim4',
  camera: 'cm',
  cm: 'cm',
  safety: 'cm',
  'dual facing camera': 'cm_d',
  'dual camera': 'cm_d',
  cm_d: 'cm_d',
  'single facing camera': 'cm_s',
  'single camera': 'cm_s',
  cm_s: 'cm_s',
  st: 'st',
  'smart trailers': 'st',
  stce: 'st',
  trailers: 'st',
  'worker safety': 'cw',
  'worker application': 'cw',
  'worker safety app': 'cw',
  cw: 'cw',
  'connected training': 'ct',
  training: 'ct',
  ct: 'ct',
  'c-nav': 'cnav',
  cnav: 'cnav',
  'commercial navigation': 'cnav',
  flapps: 'flapps',
  'fleet applications': 'flapps',
  'fleet software': 'flapps',
  software: 'flapps',
  'camera connector': 'cc',
  'camera connector portfolio': 'cc',
  'hd camera connector': 'ahd1',
  cc: 'cc',
  '360 visibility': 'moby',
  moby: 'moby',
  cam: 'cam',
  'connected asset maintenance': 'cam',
  maintenance: 'cam',
  qual: 'qual',
  qualifications: 'qual',
  'connected qualifications': 'qual',
  rp: 'rp',
  sat: 'sat',
  satellite: 'sat',
  ahd1: 'ahd1',
  fa: 'fa',
  subsidy: 'subsidy',
  other: 'other',
};

/**
 * Reverse: column prefix → human-readable label (for UI or replies).
 */
const PREFIX_TO_PLAIN_ENGLISH = {
  vg: 'Telematics',
  vgcm: 'Safety + Telematics',
  aim4: 'AI Multicam',
  cm: 'Camera / Safety',
  cm_d: 'Dual facing camera',
  cm_s: 'Single facing camera',
  st: 'Smart trailers',
  cw: 'Worker safety',
  ct: 'Connected Training',
  cnav: 'Commercial navigation',
  flapps: 'Fleet Applications',
  cc: 'Camera Connector',
  moby: '360 visibility',
  cam: 'Connected Asset Maintenance',
  qual: 'Qualifications',
  rp: 'RP',
  sat: 'Satellite',
  ahd1: 'HD Camera Connector',
  fa: 'FA',
  subsidy: 'Subsidy',
  other: 'Other',
};

/**
 * Which data sources have columns for each prefix (first_purchase, upsell, fleet).
 */
const PREFIX_BY_SOURCE = {
  vg: ['first_purchase', 'upsell', 'fleet'],
  vgcm: ['first_purchase', 'upsell', 'fleet'],
  aim4: ['first_purchase', 'fleet'],
  cm: ['first_purchase', 'upsell', 'fleet'],
  cm_d: ['first_purchase'],
  cm_s: ['first_purchase'],
  st: ['first_purchase', 'upsell', 'fleet'],
  cw: ['first_purchase', 'fleet'],
  ct: ['first_purchase', 'fleet'],
  cnav: ['first_purchase', 'fleet'],
  flapps: ['first_purchase', 'upsell'],
  cc: ['first_purchase', 'upsell'],
  moby: ['first_purchase'],
  cam: ['first_purchase'],
  qual: ['first_purchase'],
  rp: ['first_purchase', 'fleet'],
  sat: ['first_purchase'],
  ahd1: ['first_purchase'],
  fa: ['first_purchase'],
  subsidy: ['first_purchase', 'upsell', 'fleet'],
  other: ['first_purchase', 'fleet'],
};

/**
 * Metric terms: what users say for column types (for prompts / tooling).
 */
const METRIC_TERMS = {
  acv: 'Annual Contract Value',
  count: 'Licenses',
  licenses: 'Licenses',
  arr: 'Annual Recurring Revenue',
  mrrpv: 'Monthly Recurring Revenue per Vehicle',
};

/**
 * Resolve user-like input to a known prefix (for agent or API).
 * @param {string} input - e.g. "Telematics", "VG", "safety + telematics"
 * @returns {string | null} - prefix (vg, vgcm, aim4, ...) or null if unknown
 */
function resolveProductArea(input) {
  if (!input || typeof input !== 'string') return null;
  const key = input.trim().toLowerCase();
  return PLAIN_ENGLISH_TO_PREFIX[key] ?? null;
}

/**
 * Get human-readable label for a prefix (for replies or UI).
 * @param {string} prefix - e.g. "vg", "aim4"
 * @returns {string} - e.g. "Telematics", "AI Multicam"
 */
function getLabelForPrefix(prefix) {
  if (!prefix) return '';
  return PREFIX_TO_PLAIN_ENGLISH[prefix.toLowerCase()] || prefix;
}

export {
  PLAIN_ENGLISH_TO_PREFIX,
  PREFIX_TO_PLAIN_ENGLISH,
  PREFIX_BY_SOURCE,
  METRIC_TERMS,
  resolveProductArea,
  getLabelForPrefix,
};
