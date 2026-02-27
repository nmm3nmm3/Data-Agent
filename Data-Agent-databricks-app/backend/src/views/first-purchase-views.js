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
  {
    id: 'first-purchase-bridge',
    label: 'MRRpV Bridge',
    description: 'Bridge view: First Purchase vehicles, ACV, MRRpV, VG/CM ASP and attach rates, and contribution components by quarter.',
    defaultParams: {
      dataSource: 'first_purchase',
      timeWindow: DEFAULT_FOUR_QUARTERS,
      groupBy: null,
      filters: {},
      viewType: 'bridge',
    },
    overridable: ['timeWindow', 'filters'],
  },
  {
    id: 'asp-investigation',
    label: 'ASP Investigation',
    description: 'ASP and ACV by product with time series across the top. Default: Safety, Telematics, AIM4. Supports add/remove products, timeframe, and filters by segment, geo, industry.',
    defaultParams: {
      dataSource: 'first_purchase',
      timeWindow: DEFAULT_FOUR_QUARTERS,
      viewType: 'asp',
      products: ['cm', 'vg', 'aim4'],
      filters: {},
    },
    overridable: ['timeWindow', 'products', 'filters', 'region', 'segment', 'regions', 'segments', 'exclude_regions', 'exclude_segments', 'industries', 'exclude_industries'],
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
