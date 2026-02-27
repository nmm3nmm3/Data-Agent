/**
 * First-purchase preset view registry.
 * Each preset is a template with default params for getMRRpV; agent/UI apply overrides (timeWindow, groupBy, includeProduct, region, segment).
 * Plan: .cursor/plans/first-purchase_preset_views_713314d5.plan.md
 */

/** Most recent 4 quarters for preset views (grouped by quarter). */
const DEFAULT_FOUR_QUARTERS = 'FY26 Q2,FY26 Q3,FY26 Q4,FY27 Q1';

const PRESETS = [
  {
    id: 'first-purchase-overall',
    label: 'First Purchase MRRpV (overall by quarter)',
    description: 'MRRpV, vehicles, ACV, and account count by quarter with no dimension breakdown.',
    defaultParams: {
      dataSource: 'first_purchase',
      timeWindow: DEFAULT_FOUR_QUARTERS,
      groupBy: null,
      filters: {},
      includeProduct: undefined,
      includeAccountCount: true,
      includeAvgDealSize: false,
    },
    overridable: ['timeWindow', 'groupBy', 'includeProduct', 'region', 'segment', 'includeAccountCount', 'includeAvgDealSize'],
  },
  {
    id: 'first-purchase-by-industry',
    label: 'First Purchase MRRpV by Industry',
    description: 'MRRpV, ACV, and vehicles by industry with quarters as columns per metric.',
    defaultParams: {
      dataSource: 'first_purchase',
      timeWindow: DEFAULT_FOUR_QUARTERS,
      groupBy: 'industry',
      filters: {},
      includeProduct: undefined,
      includeAccountCount: true,
      includeAvgDealSize: false,
    },
    overridable: ['timeWindow', 'groupBy', 'includeProduct', 'region', 'segment', 'includeAccountCount', 'includeAvgDealSize'],
  },
  {
    id: 'first-purchase-by-geo-segment',
    label: 'First Purchase MRRpV by Geo-Segment',
    description: 'MRRpV, ACV, and vehicles by geography and segment (e.g. NA vs EMEA) with quarters as columns per metric.',
    defaultParams: {
      dataSource: 'first_purchase',
      timeWindow: DEFAULT_FOUR_QUARTERS,
      groupBy: 'geo_segment',
      filters: {},
      includeProduct: undefined,
      includeAccountCount: true,
      includeAvgDealSize: false,
    },
    overridable: ['timeWindow', 'groupBy', 'includeProduct', 'region', 'segment', 'includeAccountCount', 'includeAvgDealSize'],
  },
];

/**
 * Returns the list of preset views for GET /api/views and for the agent system prompt.
 * Each item includes id, label, description, defaultParams, and overridable.
 */
export function getViews() {
  return PRESETS.map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
    defaultParams: { ...p.defaultParams },
    overridable: [...p.overridable],
  }));
}
