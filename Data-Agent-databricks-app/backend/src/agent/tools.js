/**
 * OpenAI function/tool definitions. The model only invokes these; it does not perform calculations.
 * Data source (first_purchase, upsell, fleet) is set by the user via the UI and passed in context.
 */
import { getMRRpV, getBridgeMRRpV, getASPInvestigation, DATA_SOURCES } from '../queries/mrrpv.js';
import { resolveProductArea } from '../queries/column-glossary.js';

export const MRRPV_TOOL = {
  type: 'function',
  function: {
    name: 'get_mrrpv',
      description:
            'Get MRRpV from Databricks. Call for every MRRpV question. Supports one quarter or multiple: pass time_window as one value ("FY26 Q4") or comma-separated quarters. For ASP (Average Selling Price) questions (e.g. "what were the ASPs for Safety, Telematics, and AIM4 in FY26", "show me ASP by product") use the ASP Investigation view: set view_type to "asp" and preset_id to "asp-investigation", pass time_window (e.g. "FY26 Q1,FY26 Q2,FY26 Q3,FY26 Q4" for FY26) and products (e.g. ["cm", "vg", "aim4"] for Safety, Telematics, AIM4). The ASP view supports add/remove products (products array), change timeframe (time_window), and limit by segment/geo/industry (regions, segments, exclude_regions, exclude_segments, industries, etc.). For overall/total or for the MRRpV Bridge view, omit group_by. When the user is on a preset view and only asks to filter or restrict data, keep the SAME view. When refining the current view, pass ALL existing filters plus any new one. Data source is set by the user in the app.',
    parameters: {
      type: 'object',
      properties: {
        time_window: {
          type: 'string',
          description:
            'Optional. One quarter (e.g. "FY26 Q4") OR comma-separated quarters for multi-quarter views. Accept "year" and "FY" as equivalent: "FY26" or "fiscal year 26" or "year 26" → "FY26 Q1,FY26 Q2,FY26 Q3,FY26 Q4". "From [quarter] onwards" / "since [quarter]" → all quarters from that start through the most recent. "Between [quarter] and [quarter]" or "[quarter] - [quarter]" → all quarters in that inclusive range (e.g. "between FY25 Q1 and FY25 Q4" → "FY25 Q1,FY25 Q2,FY25 Q3,FY25 Q4"). Use FYnn Qn format; Q1–Q4 = fiscal quarters. Omit only if they did not specify a period. When refining the current view (e.g. user only asked to exclude MM or remove EMEA), you MUST pass the same time_window as the current view — omitting it returns ALL quarters (e.g. from FY18), which is wrong.',
        },
        group_by: {
          type: 'string',
          enum: ['industry', 'segment', 'geo', 'geo_segment'],
          description:
            'Optional. Do NOT set for overall/total MRRpV—leave unset and you get one total row. Set when the user asks for breakdown by industry, by segment, by region/geo, or by geo and segment together (geo_segment). When the user is on a preset view and only asks to exclude/include rows (e.g. "exclude MM"), you MUST pass the same group_by as the current view (e.g. "industry" for industry view, "geo_segment" for geo-segment view)—do not switch to a different group_by.',
        },
        include_product: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional. Product keys for "deals that included [product]" or "deals that included both X and Y". Only rows where ALL listed products have license count > 0 are included. Pass one key (e.g. ["aim4"]) or multiple (e.g. ["cm", "vg"] for safety AND telematics). When the current view already has include_product and the user asks to add or narrow by another product (e.g. "also AIM4", "only accounts that also had AIM4"), pass the union of the current view\'s include_product and the newly requested product(s) — do not replace with only the new product. Resolve names per docs/mrrpv-schema-mapping.md. When the user specifies multiple conditions in one message, pass all in this same call.',
        },
        include_account_count: {
          type: 'boolean',
          description:
            'Optional. Set to true when the user asks for deal count, account count, or number of unique accounts/deals. Adds an account_count column (distinct accounts).',
        },
        include_avg_deal_size: {
          type: 'boolean',
          description:
            'Optional. Set to true when the user asks for average deal size, average account size, or ACV per account. Adds an avg_deal_size column (ACV per distinct account).',
        },
        include_acv: {
          type: 'boolean',
          description:
            'Optional. Set to false when the user asks to remove, hide, or drop the ACV columns. Set to true when they ask to show ACV again. Default true. Preserve from current view when making other changes.',
        },
        region: {
          type: 'string',
          description: 'Optional filter by a single region (geo), e.g. "US". Use regions or exclude_regions for multiple.',
        },
        regions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional. Include only these geos (e.g. ["US","CA","MX","US-SLED"] for NA only). Overrides region.',
        },
        exclude_regions: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional. Exclude these geos. Resolve plain-English to exact table values: "public sector", "government" → ["US - SLED", "US-SLED"] (both forms); "EMEA", "Europe" → ["UK", "DACH", "FR", "BNL"]. Full mapping in docs/mrrpv-schema-mapping.md. When the user asks to include or restore geos: pass the CURRENT exclude_regions with those values REMOVED (do not pass the same list unchanged); omit this parameter entirely if the resulting list would be empty.',
        },
        segments: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional. Include only these segments (e.g. ["MM","ENT - COR"]). Use exact values as in the table.',
        },
        exclude_segments: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional. Exclude these segments. Resolve plain-English to exact table values: "MM", "mid market" → "MM"; "public sector MM", "government MM" → "US - SLED-MM"; "public sector SEL", "government select" → "US - SLED-ENT - SEL"; "core" → "ENT - COR"; "select" → "ENT - SEL"; "strategic" → "ENT - STR". Full mapping in docs/mrrpv-schema-mapping.md. When the user asks to include or restore segments: pass the CURRENT exclude_segments with those values REMOVED (do not pass the same list unchanged); omit this parameter entirely if the resulting list would be empty.',
        },
        industries: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional. Include only these industries. Use exact values as in the table.',
        },
        exclude_industries: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional. Exclude these industries. Use exact table values. When the user asks to include or restore industries: pass the CURRENT exclude_industries with those values REMOVED (do not pass the same list unchanged); omit this parameter entirely if the resulting list would be empty.',
        },
        segment: {
          type: 'string',
          description: 'Optional filter by a single segment (use segments or exclude_segments for multiple).',
        },
        industry: {
          type: 'string',
          description: 'Optional filter by a single industry (use industries or exclude_industries for multiple).',
        },
        view_type: {
          type: 'string',
          enum: ['bridge'],
          description:
            'Optional. Set to "bridge" ONLY when the user is on the MRRpV Bridge preset and is filtering or refining that view (e.g. "only US accounts"). Do NOT set when the user is on industry, geo_segment, or overall view. When set, do NOT set group_by; the bridge has no group_by. Pass time_window and filters (e.g. regions) as needed.',
        },
        preset_id: {
          type: 'string',
          description:
            'Optional. When the user is on a preset view and only asks to filter or refine (e.g. exclude rows, only US), pass the same preset id so the view type does not change. For MRRpV Bridge use "first-purchase-bridge". For ASP Investigation use "asp-investigation". Do NOT pass a different preset_id than the current view unless the user explicitly asks for a different view.',
        },
        products: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional. For ASP Investigation view only: product keys to show (e.g. ["cm", "vg", "aim4"] for Safety, Telematics, AIM4). User can ask to add or remove products (e.g. "add Maintenance", "add Smart Trailers", "remove AIM4"). Resolve names per schema mapping: Maintenance / Connected Asset Maintenance → cam (NOT st; st = Smart Trailers). Supported: cm (Safety), vg (Telematics), aim4 (AIM4), st (Smart Trailers), cam (Maintenance), flapps, cc, cw, ct, cnav, rp.',
        },
      },
      required: [],
    },
  },
};

const TOOLS = [MRRPV_TOOL];

/**
 * Execute a tool by name with the given args. Returns result for the model.
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @param {{ dataSource?: string }} context - dataSource from UI: 'fleet' | 'first_purchase' | 'upsell'
 */
export async function executeTool(name, args, context = {}) {
  if (name === 'get_mrrpv') {
    const timeWindow = args?.time_window != null ? String(args.time_window) : undefined;
    const groupBy = args?.group_by != null ? String(args.group_by) : undefined;
    const rawProducts = args?.include_product == null ? [] : Array.isArray(args.include_product) ? args.include_product : [args.include_product];
    const includeProduct = rawProducts.length === 0 ? undefined : rawProducts
      .map((p) => (resolveProductArea(String(p).trim()) || String(p).trim()).toLowerCase())
      .filter(Boolean);
    const dataSource = context.dataSource && DATA_SOURCES.includes(String(context.dataSource).toLowerCase())
      ? String(context.dataSource).toLowerCase()
      : 'fleet';
    const filters = {};
    if (Array.isArray(args?.regions) && args.regions.length > 0) {
      filters.regions = args.regions.map((g) => String(g).trim()).filter(Boolean);
    } else if (Array.isArray(args?.exclude_regions) && args.exclude_regions.length > 0) {
      filters.excludeRegions = args.exclude_regions.map((g) => String(g).trim()).filter(Boolean);
    } else if (args?.region) {
      filters.region = String(args.region);
    }
    if (Array.isArray(args?.segments) && args.segments.length > 0) {
      filters.segments = args.segments.map((s) => String(s).trim()).filter(Boolean);
    } else if (Array.isArray(args?.exclude_segments) && args.exclude_segments.length > 0) {
      filters.excludeSegments = args.exclude_segments.map((s) => String(s).trim()).filter(Boolean);
    } else if (args?.segment) {
      filters.segment = String(args.segment);
    }
    if (Array.isArray(args?.industries) && args.industries.length > 0) {
      filters.industries = args.industries.map((i) => String(i).trim()).filter(Boolean);
    } else if (Array.isArray(args?.exclude_industries) && args.exclude_industries.length > 0) {
      filters.excludeIndustries = args.exclude_industries.map((i) => String(i).trim()).filter(Boolean);
    } else if (args?.industry) {
      filters.industry = String(args.industry);
    }
    const includeAccountCount = args?.include_account_count === true;
    const includeAvgDealSize = args?.include_avg_deal_size === true;
    const includeAcv = args?.include_acv !== false;
    const viewType = args?.view_type;
    const presetId = args?.preset_id;
    const useBridge = viewType === 'bridge' || presetId === 'first-purchase-bridge';
    const useASP = viewType === 'asp' || presetId === 'asp-investigation';
    if (useBridge) {
      const bridgeResult = await getBridgeMRRpV({ timeWindow, filters, includeProduct });
      return {
        success: true,
        data: bridgeResult.data,
        columns: bridgeResult.columns,
        rowCount: bridgeResult.rows?.length ?? 0,
        overall: undefined,
        viewType: 'bridge',
        grandTotals: bridgeResult.grandTotals,
      };
    }
    if (useASP) {
      const aspProducts = Array.isArray(args?.products) && args.products.length > 0
        ? args.products.map((p) => (resolveProductArea(String(p).trim()) || String(p).trim()).toLowerCase()).filter(Boolean)
        : ['cm', 'vg', 'aim4'];
      const aspResult = await getASPInvestigation({ timeWindow, products: aspProducts, filters });
      return {
        success: true,
        data: aspResult.data,
        columns: aspResult.columns,
        rowCount: aspResult.rows?.length ?? 0,
        overall: undefined,
        viewType: 'asp',
      };
    }
    const result = await getMRRpV({ dataSource, timeWindow, groupBy, filters, includeProduct, includeAccountCount, includeAvgDealSize, includeAcv });
    return {
      success: true,
      data: result.data,
      columns: result.columns,
      rowCount: result.rows?.length ?? 0,
      overall: result.overall,
    };
  }
  throw new Error(`Unknown tool: ${name}`);
}

export function getTools() {
  return TOOLS;
}
